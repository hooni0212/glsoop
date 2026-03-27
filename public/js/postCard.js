// public/js/postCard.js

/**
 * 공통: 작성자 표시 문자열 만들기
 * - 닉네임 > 이름 > 익명
 * - 이메일은 마스킹해서 괄호 안에 표시 (예: 재원 (ab***@gmail.com))
 */

/**
 * 공통: 작성자 표시 문자열 만들기
 * - 닉네임 > 이름 > 익명
 * - 이메일은 마스킹해서 괄호 안에 표시 (예: 재원 (ab***@gmail.com))
 * - 가능한 여러 키를 다 받아줌:
 *   author_nickname, nickname / author_name, name / author_email, email
 */
function buildAuthorDisplay(post) {
  if (!post) return '익명';

  // 1) 혹시 서버에서 아예 완성된 문자열을 보내주는 경우
  if (
    post.author_display &&
    String(post.author_display).trim().length > 0
  ) {
    return String(post.author_display).trim();
  }

  // 2) 닉네임 후보: author_nickname > nickname
  const nickname =
    (post.author_nickname &&
      String(post.author_nickname).trim()) ||
    (post.nickname && String(post.nickname).trim()) ||
    '';

  // 3) 이름 후보: author_name > name
  const name =
    (post.author_name && String(post.author_name).trim()) ||
    (post.name && String(post.name).trim()) ||
    '';

  const baseName = nickname || name || '익명';

  // 4) 이메일 후보: author_email > email
  const rawEmail =
    (post.author_email && String(post.author_email).trim()) ||
    (post.email && String(post.email).trim()) ||
    '';

  const maskedEmail = rawEmail ? maskEmail(rawEmail) : '';

  return maskedEmail ? `${baseName} (${maskedEmail})` : baseName;
}

/**
 * 공통: 글 내용 + 폰트 메타 파싱
 * - post.content 안에 <!--FONT:serif--> 같은 메타가 있으면 분리
 * - cleanHtml : 실제로 카드에 넣을 HTML
 * - fontClass : quote-card에 붙일 폰트 클래스 (quote-font-*)
 */
function extractContentWithFont(post) {
  const raw = post.content || '';
  const { cleanHtml, fontKey } = extractFontFromContent(raw);

  const quoteFontClass =
    fontKey === 'serif' || fontKey === 'sans' || fontKey === 'hand'
      ? `quote-font-${fontKey}`
      : '';

  return { cleanHtml, quoteFontClass };
}

function getCategoryLabel(category) {
  if (!category) return '';
  if (category === 'poem') return '시';
  if (category === 'essay') return '에세이/일기';
  if (category === 'short') return '짧은 구절';
  return '';
}

function renderCategoryBadge(post) {
  const label = getCategoryLabel(post?.category);
  if (!label) return '';

  const cls = `post-category-label gls-category-badge gls-category-${post.category}`;
  return `<span class="${cls}">${label}</span>`;
}

function normalizeCardLengthVariant(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (
    value === 'one-line' ||
    value === 'short' ||
    value === 'medium' ||
    value === 'long'
  ) {
    return value;
  }
  return '';
}

function extractPlainPostText(rawHtml) {
  const withBreaks = String(rawHtml || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|li)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ');

  if (typeof document !== 'undefined' && document.createElement) {
    const holder = document.createElement('div');
    holder.innerHTML = withBreaks;
    return String(holder.textContent || holder.innerText || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\u200b/g, '')
      .trim();
  }

  return withBreaks
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u200b/g, '')
    .trim();
}

function detectCardLengthVariant(rawContent) {
  const text = extractPlainPostText(rawContent);
  if (!text) return 'short';

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const compactLength = text.replace(/\s+/g, '').length;

  if (lines.length <= 1 && compactLength <= 20) return 'one-line';
  if (compactLength <= 70) return 'short';
  if (compactLength <= 170) return 'medium';
  return 'long';
}

function buildFeedImageVersion(post) {
  const layoutSeed =
    typeof post?.layout_json === 'string'
      ? post.layout_json
      : post?.layout_json && typeof post.layout_json === 'object'
        ? JSON.stringify(post.layout_json)
        : '';
  const seed = [
    'feed-render-v7',
    post?.id || '',
    post?.title || '',
    post?.content || '',
    layoutSeed,
    post?.created_at || '',
  ].join('|');

  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function buildFeedRenderedImageUrl(post, template = 'paper01') {
  const postId = encodeURIComponent(post?.id || '');
  const version = buildFeedImageVersion(post);
  return `/api/feed-images/post/${postId}?template=${encodeURIComponent(
    template
  )}&scale=2&v=${encodeURIComponent(version)}`;
}

function hasLayoutTitleBox(post) {
  const raw = post?.layout_json;
  if (raw == null) return false;

  let parsed = raw;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed) return false;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_error) {
      return false;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }

  const box = parsed.title_box;
  if (!box || typeof box !== 'object' || Array.isArray(box)) {
    return false;
  }

  return (
    Number.isFinite(Number(box.x)) &&
    Number.isFinite(Number(box.y)) &&
    Number.isFinite(Number(box.w)) &&
    Number.isFinite(Number(box.h))
  );
}

function buildRenderedImageCardHtml(post, fallbackHtml, renderedImageSrc = '') {
  const src = renderedImageSrc || buildFeedRenderedImageUrl(post);

  return `
    <div class="feed-rendered-image-shell">
      <img
        class="feed-rendered-card-image"
        data-feed-render-image
        src="${src}"
        alt=""
        loading="lazy"
        decoding="async"
      />
      <div class="feed-rendered-fallback" data-feed-render-fallback hidden>
        ${fallbackHtml}
      </div>
    </div>
  `;
}

const GLS_BOOKMARK_SYNC_EVENT = 'glsoop:bookmark-state-changed';
const GLS_LIKE_SYNC_EVENT = 'glsoop:like-state-changed';
const bookmarkStateCache = new Map();
const bookmarkStateRequests = new Map();
let postCardGlobalSyncBound = false;
let bookmarkStateAuthUnavailable = false;

function normalizePostId(postId) {
  if (postId == null) return '';
  return String(postId);
}

function escapeSelectorValue(value) {
  const raw = normalizePostId(value);
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, '\\$&');
}

function buildBookmarkState(selectedIds = []) {
  const uniqueIds = Array.from(
    new Set(
      (Array.isArray(selectedIds) ? selectedIds : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  return {
    selectedIds: uniqueIds,
    count: uniqueIds.length,
    active: uniqueIds.length > 0,
  };
}

function dispatchBookmarkStateChanged(postId, state) {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(
    new CustomEvent(GLS_BOOKMARK_SYNC_EVENT, {
      detail: {
        postId: normalizePostId(postId),
        state: state || buildBookmarkState([]),
      },
    })
  );
}

function dispatchLikeStateChanged(postId, state) {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(
    new CustomEvent(GLS_LIKE_SYNC_EVENT, {
      detail: {
        postId: normalizePostId(postId),
        state,
      },
    })
  );
}

function syncBookmarkButtonsForPost(postId, state) {
  const normalizedId = normalizePostId(postId);
  if (!normalizedId || typeof document === 'undefined') return;

  const resolvedState = state || buildBookmarkState([]);
  bookmarkStateCache.set(normalizedId, resolvedState);

  const buttons = document.querySelectorAll(
    `.post-bookmark-toggle[data-post-id="${escapeSelectorValue(normalizedId)}"]`
  );

  buttons.forEach((button) => {
    const count = Number(resolvedState.count) || 0;
    const active = Boolean(resolvedState.active);
    const countEl = button.querySelector('.post-bookmark-count');

    button.classList.toggle('is-bookmarked', active);
    button.setAttribute('data-bookmark-active', active ? '1' : '0');
    button.setAttribute('data-bookmark-count', String(count));
    button.setAttribute('aria-pressed', active ? 'true' : 'false');

    const label = active
      ? count > 1
        ? `북마크 ${count}개 폴더에 저장됨`
        : '북마크됨'
      : '북마크 추가';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);

    if (countEl) {
      countEl.textContent = active ? String(count) : '';
      countEl.hidden = !active;
    }
  });
}

function syncLikeButtonsForPost(postId, state) {
  const normalizedId = normalizePostId(postId);
  if (!normalizedId || typeof document === 'undefined' || !state) return;

  const buttons = document.querySelectorAll(
    `.like-btn[data-post-id="${escapeSelectorValue(normalizedId)}"]`
  );

  buttons.forEach((button) => {
    const liked = Boolean(state.liked);
    const likeCount = Number.isFinite(Number(state.likeCount))
      ? Number(state.likeCount)
      : 0;
    button.setAttribute('data-liked', liked ? '1' : '0');
    button.classList.toggle('liked', liked);
    button.setAttribute('aria-pressed', liked ? 'true' : 'false');

    const heartEl = button.querySelector('.like-heart');
    const countEl = button.querySelector('.like-count');
    if (heartEl) heartEl.textContent = liked ? '♥' : '♡';
    if (countEl) countEl.textContent = String(likeCount);
  });
}

async function fetchBookmarkState(postId, options = {}) {
  const normalizedId = normalizePostId(postId);
  if (!normalizedId) return buildBookmarkState([]);

  if (bookmarkStateAuthUnavailable && !options.force) {
    return buildBookmarkState([]);
  }

  if (!options.force && bookmarkStateCache.has(normalizedId)) {
    return bookmarkStateCache.get(normalizedId);
  }

  if (!options.force && bookmarkStateRequests.has(normalizedId)) {
    return bookmarkStateRequests.get(normalizedId);
  }

  const request = fetch(`/api/posts/${encodeURIComponent(normalizedId)}/bookmarks`, {
    cache: 'no-store',
  })
    .then(async (res) => {
      if (res.status === 401) {
        bookmarkStateAuthUnavailable = true;
        const emptyState = buildBookmarkState([]);
        bookmarkStateCache.set(normalizedId, emptyState);
        return emptyState;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.message || '북마크 정보를 불러오지 못했습니다.');
      }

      const selectedIds = Array.isArray(data.lists)
        ? data.lists.filter((item) => item && item.contains).map((item) => item.id)
        : [];
      const nextState = buildBookmarkState(selectedIds);
      bookmarkStateCache.set(normalizedId, nextState);
      return nextState;
    })
    .finally(() => {
      bookmarkStateRequests.delete(normalizedId);
    });

  bookmarkStateRequests.set(normalizedId, request);
  return request;
}

function ensurePostCardGlobalSync() {
  if (postCardGlobalSyncBound || typeof document === 'undefined') return;
  postCardGlobalSyncBound = true;

  document.addEventListener(GLS_BOOKMARK_SYNC_EVENT, (event) => {
    const detail = event.detail || {};
    syncBookmarkButtonsForPost(detail.postId, detail.state);
  });

  document.addEventListener(GLS_LIKE_SYNC_EVENT, (event) => {
    const detail = event.detail || {};
    syncLikeButtonsForPost(detail.postId, detail.state);
  });
}

/**
 * ⭐ 공통 카드 HTML 생성 함수
 * - 인덱스 피드 / 관련 글 / 마이페이지 등에서 모두 같은 구조를 쓰기 위해 사용
 * - 좋아요/해시태그/작성자/타임스탬프/제목/내용 카드 구조 통일
 */
function buildStandardPostCardHTML(post, options = {}) {
  // 옵션
  const {
    showMoreButton = true,     // 더보기 버튼 표시 여부 (피드는 true, 관련글/마이페이지는 false도 가능)
    cardExtraClass = '',       // .related-card 같은 추가 클래스
    contentExpanded = false,   // true면 feed-post-content에 expanded 클래스 추가 (잘리지 않게)
    showEngagementActions = true, // 좋아요/북마크 버튼 표시 여부
    renderedImageSrc = '', // 렌더 이미지 URL 강제 지정(에디터 프리뷰 등)
    cardLengthVariant = '',    // 카드 길이 타입 강제 지정(one-line|short|medium|long)
    cardClickable = true,      // 카드 전체 클릭 가능 여부
  } = options;

  const author = buildAuthorDisplay(post);

  const likeCount =
    typeof post.like_count === 'number' ? post.like_count : 0;
  const liked =
    post.user_liked === 1 || post.user_liked === true ? true : false;

  const hashtagHtml = buildHashtagHtml(post);
  const categoryHtml = renderCategoryBadge(post);
  const { cleanHtml, quoteFontClass } = extractContentWithFont(post);
  const safeHtml = sanitizePostHtml(cleanHtml);
  const normalizedVariant = normalizeCardLengthVariant(cardLengthVariant);
  const resolvedLengthVariant =
    normalizedVariant || detectCardLengthVariant(cleanHtml || post?.title || '');
  const useRenderedImage = true;
  const hasImageTitleLayout = useRenderedImage && hasLayoutTitleBox(post);
  const bookmarkIcon = `
    <svg
      class="post-bookmark-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M7.5 4.25h9a1.25 1.25 0 0 1 1.25 1.25v14.5l-5.75-3.4-5.75 3.4V5.5A1.25 1.25 0 0 1 7.5 4.25Z"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
    </svg>`;

  const bookmarkBtn = `
    <button
      type="button"
      class="gls-btn gls-btn-sm post-bookmark-toggle"
      data-post-id="${post.id}"
      data-bookmark-active="0"
      data-bookmark-count="0"
      aria-label="북마크 추가"
      aria-pressed="false"
    >
      ${bookmarkIcon}
      <span class="post-bookmark-count" hidden></span>
    </button>`;

  // 카드에 붙일 추가 클래스
  const extraClass = cardExtraClass ? ` ${cardExtraClass}` : '';
  const cardLengthClass = resolvedLengthVariant
    ? ` gls-post-card--len-${resolvedLengthVariant}`
    : '';

  // feed-post-content에 expanded 붙일지 여부
  // 피드 미리보기 페이드 기본값은 glass로 고정(white는 ui-kit 비교/테스트용)
  // - expanded 상태에서는 페이드가 보이지 않지만, 클래스는 유지해도 무방
  const feedContentClass = [
    'feed-post-content',
    'gls-fade-glass',
    contentExpanded ? 'expanded' : '',
    useRenderedImage ? 'feed-post-content--rendered-image' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const quoteCardClass = [
    'quote-card',
    quoteFontClass,
    useRenderedImage ? 'quote-card--rendered-image' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const quoteBodyHtml = useRenderedImage
    ? buildRenderedImageCardHtml(post, safeHtml, renderedImageSrc)
    : safeHtml;

  const shouldShowMoreButton = showMoreButton && !useRenderedImage;

  return `
    <div
      class="card gls-mb-3 gls-post-card gls-post-card--uikit-canon CardPrimary${cardLengthClass}${extraClass}"
      data-post-id="${post.id}"
      data-length-variant="${resolvedLengthVariant}"
      data-card-clickable="${cardClickable ? 'true' : 'false'}"
    >
      <div class="card-body">
        <!-- 상단 메타 영역: 작성자 + 액션 (북마크/공감) -->
        <div class="gls-flex gls-justify-between gls-items-center gls-mb-2 post-header-row">
          <span class="gls-author-badge">
            ${escapeHtml(author)}
          </span>
          ${
            showEngagementActions
              ? `<div class="post-top-actions">
                   ${bookmarkBtn}
                   <button
                     type="button"
                     class="gls-btn gls-btn-sm like-btn ${liked ? 'liked' : ''}"
                     data-post-id="${post.id}"
                     data-liked="${liked ? '1' : '0'}"
                   >
                     <span class="like-heart">${liked ? '♥' : '♡'}</span>
                     <span class="like-count">${likeCount}</span>
                   </button>
                 </div>`
              : ''
          }
        </div>

        <!-- 제목 -->
        <h5 class="card-title gls-mb-2${hasImageTitleLayout ? ' gls-hidden' : ''}">
          ${escapeHtml(post.title || '')}
        </h5>

        <!-- 본문 카드 영역 -->
        <div class="post-content gls-mt-2">
          <div class="${feedContentClass}">
            <div class="${quoteCardClass}">
              ${quoteBodyHtml}
            </div>

            ${
              shouldShowMoreButton
                ? `
            <!-- 더보기 버튼 (내용이 넘칠 때만 노출) : 카드 내부 오버레이 -->
            <button
              class="more-toggle gls-more-overlay is-hidden"
              type="button"
            >
              더보기...
            </button>`
                : ''
            }
          </div>
        </div>

        <!-- 해시태그 버튼들 -->
        ${
          categoryHtml || hashtagHtml
            ? `<div class="post-bottom-meta">
                 ${
                   categoryHtml
                     ? `<div class="post-category-row">${categoryHtml}</div>`
                     : ''
                 }
                 ${hashtagHtml || ''}
</div>`
            : ''
        }
      </div>
    </div>
  `;
}

/**
 * 공통 카드에 “동작” 붙여주는 함수
 * - autoAdjustQuoteFont
 * - 작성자 클릭 → 작가 페이지 이동 (setupCardAuthorLink)
 * - 좋아요/더보기/상세보기 등 (setupCardInteractions)
 *
 * render할 때마다 이걸 호출해주면 됨.
 */
function enhanceStandardPostCard(cardElement, post, options = {}) {
  if (!cardElement) return;
  ensurePostCardGlobalSync();

  const quoteEl = cardElement.querySelector('.quote-card');
  const isRenderedImageCard = !!cardElement.querySelector('.feed-rendered-card-image');

  if (quoteEl && !isRenderedImageCard) {
    autoAdjustQuoteFont(quoteEl);
  }

  bindRenderedImageFallback(cardElement);

  // 페이지별로 이미 존재하는 함수 재사용
  if (typeof setupCardAuthorLink === 'function') {
    setupCardAuthorLink(cardElement, post);
  }
  if (typeof setupCardInteractions === 'function') {
    setupCardInteractions(cardElement, post, options);
  }

  const postId = post?.id;
  if (postId != null) {
    fetchBookmarkState(postId)
      .then((state) => {
        syncBookmarkButtonsForPost(postId, state);
      })
      .catch(() => {});
  }
}

// ==============================
// 공통: 좋아요 토글
// ==============================
async function toggleLike(postId, likeBtn) {
  if (!postId || !likeBtn) return;
  if (likeBtn.dataset.busy === '1') return;

  likeBtn.dataset.busy = '1';
  likeBtn.disabled = true;
  likeBtn.classList.add('is-loading');

  try {
    const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/toggle-like`, {
      method: 'POST',
    });

    // 401 → 비로그인
    if (res.status === 401) {
      if (
        document.body &&
        document.body.classList.contains('page-post') &&
        window.glsoopPostAuthGate &&
        typeof window.glsoopPostAuthGate.open === 'function'
      ) {
        window.glsoopPostAuthGate.open({ actionLabel: '공감' });
        return;
      }
      if (typeof redirectToLoginWithNext === 'function') {
        redirectToLoginWithNext({
          alertMessage: '로그인 후 공감할 수 있습니다.',
          source: 'post-card-like',
        });
      } else {
        if (window.glsoopUi && typeof window.glsoopUi.showPageNotice === 'function') {
          window.glsoopUi.showPageNotice('로그인 후 공감할 수 있습니다.', { type: 'error' });
        } else {
          alert('로그인 후 공감할 수 있습니다.');
        }
        window.location.href = '/html/login.html';
      }
      return;
    }

    const data = await res.json();

    if (!res.ok || !data.ok) {
      if (window.glsoopUi && typeof window.glsoopUi.showPageNotice === 'function') {
        window.glsoopUi.showPageNotice(data.message || '공감 처리 중 오류가 발생했습니다.', {
          type: 'error',
        });
      } else {
        alert(data.message || '공감 처리 중 오류가 발생했습니다.');
      }
      return;
    }

    const liked = !!data.liked;
    const likeCount =
      typeof data.like_count === 'number' ? data.like_count : 0;

    // 버튼 상태 갱신
    likeBtn.setAttribute('data-liked', liked ? '1' : '0');

    const heartEl = likeBtn.querySelector('.like-heart');
    const countEl = likeBtn.querySelector('.like-count');

    if (heartEl) {
      heartEl.textContent = liked ? '♥' : '♡';
    }
    if (countEl) {
      countEl.textContent = likeCount;
    }

    likeBtn.classList.toggle('liked', liked);
    likeBtn.setAttribute('aria-pressed', liked ? 'true' : 'false');
    syncLikeButtonsForPost(postId, { liked, likeCount });
    dispatchLikeStateChanged(postId, { liked, likeCount });

    if (window.glsoopUi && typeof window.glsoopUi.showPageNotice === 'function') {
      window.glsoopUi.showPageNotice(
        liked ? '공감을 남겼습니다.' : '공감을 취소했습니다.',
        { type: liked ? 'success' : 'info', autoHideMs: 1400 }
      );
    }

    // ON일 때만 살짝 "톡" 애니메이션
    if (heartEl && liked) {
      heartEl.style.transition = 'transform 0.16s ease-out';
      heartEl.style.transform = 'scale(1)';
      void heartEl.offsetWidth;
      heartEl.style.transform = 'scale(1.28)';
      setTimeout(() => {
        heartEl.style.transform = 'scale(1)';
      }, 160);
    }

    // 🔹 현재 보고 있는 글이면 localStorage 캐시도 함께 갱신
    try {
      const raw = localStorage.getItem('glsoop_lastPost');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && String(obj.id) === String(postId)) {
          obj.like_count = likeCount;
          obj.user_liked = liked ? 1 : 0;
          localStorage.setItem('glsoop_lastPost', JSON.stringify(obj));
        }
      }
    } catch (e) {
      console.warn('glsoop_lastPost like 동기화 실패', e);
    }
  } catch (e) {
    console.error(e);
    if (window.glsoopUi && typeof window.glsoopUi.showPageNotice === 'function') {
      window.glsoopUi.showPageNotice('공감 처리 중 오류가 발생했습니다.', { type: 'error' });
    } else {
      alert('공감 처리 중 오류가 발생했습니다.');
    }
  } finally {
    likeBtn.dataset.busy = '0';
    likeBtn.disabled = false;
    likeBtn.classList.remove('is-loading');
  }
}


// ==============================
// 공통: 작가 배지 클릭 → 작가 페이지
// ==============================
function setupCardAuthorLink(cardEl, post) {
  if (!cardEl || !post) return;

  const badge =
    cardEl.querySelector('.gls-user-badge') ||
    cardEl.querySelector('.gls-author-badge');
  if (!badge) return;
  if (badge.dataset.authorLinkBound) return;

  // author_id 또는 user_id 중 있는 것 사용
  const authorId = post.author_id || post.user_id;
  if (!authorId) return;

  badge.dataset.authorLinkBound = '1';
  badge.setAttribute('role', 'link');
  badge.setAttribute('tabindex', '0');
  badge.classList.add('gls-user-badge--link');
  const navigateToAuthor = (e) => {
    e.stopPropagation(); // 카드 클릭(상세 이동)과 분리
    window.location.href = `/html/author.html?userId=${encodeURIComponent(
      authorId
    )}`;
  };

  badge.addEventListener('click', navigateToAuthor);
  badge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigateToAuthor(e);
    }
  });
}

const CARD_NAV_IGNORE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  '[role="button"]',
  '[data-card-stop-nav="1"]',
  '.like-btn',
  '.post-bookmark-toggle',
  '.more-toggle',
  '.gls-tag-btn',
  '.hashtag-pill',
  '.gls-hashtag-chip',
  '.gls-user-badge--link',
  '.gls-author-badge[role="link"]',
  '.edit-post-btn',
  '.delete-post-btn',
].join(',');

function isCardClickable(cardEl) {
  return cardEl?.dataset?.cardClickable !== 'false';
}

function shouldIgnoreCardNavigation(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest(CARD_NAV_IGNORE_SELECTOR);
}

function cacheDetailData(post, cardEl) {
  if (!post) return;

  let likeCount = post.like_count != null ? post.like_count : 0;
  let userLiked = post.user_liked != null ? post.user_liked : 0;
  const likeBtn = cardEl?.querySelector?.('.like-btn');
  if (likeBtn) {
    const countEl = likeBtn.querySelector('.like-count');
    if (countEl) {
      const parsed = parseInt(countEl.textContent, 10);
      likeCount = Number.isNaN(parsed) ? 0 : parsed;
    }
    userLiked = likeBtn.getAttribute('data-liked') === '1' ? 1 : 0;
  }

  try {
    const detailData = {
      id: post.id,
      title: post.title,
      content: post.content,
      layout_json: post.layout_json || null,
      created_at: post.created_at,
      hashtags: post.hashtags,
      category: post.category || null,
      author_id: post.author_id || post.user_id || null,
      author_name: post.author_name || null,
      author_nickname:
        (post.author_nickname && String(post.author_nickname).trim()) ||
        (post.author_name && String(post.author_name).trim()) ||
        null,
      author_email: post.author_email || null,
      like_count: likeCount,
      user_liked: userLiked,
    };
    localStorage.setItem('glsoop_lastPost', JSON.stringify(detailData));
  } catch (err) {
    console.error('failed to cache detail post', err);
  }
}

function navigateToPostDetail(post, cardEl) {
  if (!post) return;
  cacheDetailData(post, cardEl);
  window.location.href = `/html/post.html?postId=${encodeURIComponent(post.id)}`;
}

// ==============================
// 공통: 카드 상호작용(♥, 더보기, 상세 페이지 이동)
// ==============================
function setupCardInteractions(cardEl, post, options = {}) {
  if (!cardEl || !post) return;
  const { onTagClick } = options;

  bindRenderedImageFallback(cardEl);

  // 1) 좋아요 버튼
  const likeBtn = cardEl.querySelector('.like-btn');
  if (likeBtn && likeBtn.dataset.likeBound !== '1') {
    likeBtn.dataset.likeBound = '1';
    likeBtn.setAttribute(
      'aria-pressed',
      likeBtn.getAttribute('data-liked') === '1' ? 'true' : 'false'
    );
    likeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = likeBtn.getAttribute('data-post-id') || post.id;
      toggleLike(pid, likeBtn);
    });
  }

  // 2) 더보기 버튼 (내용이 넘칠 때만 표시)
  const feedContent = cardEl.querySelector('.feed-post-content');
  const moreBtn = cardEl.querySelector('.more-toggle');

  if (feedContent && moreBtn && moreBtn.dataset.moreBound !== '1') {
    moreBtn.dataset.moreBound = '1';
    // 처음 렌더링 직후 높이 비교해서 넘치면 버튼 노출
    const checkOverflow = () => {
      const isOverflow = feedContent.scrollHeight > feedContent.clientHeight + 4;

      // ✅ 짧은 글에서는 페이드(잘림)가 보이지 않게
      feedContent.classList.toggle('has-overflow', isOverflow);

      if (isOverflow) {
        moreBtn.classList.remove('is-hidden');
        moreBtn.classList.add('is-inline-flex-visible');
        moreBtn.textContent = '더보기...';
      } else {
        moreBtn.classList.add('is-hidden');
        moreBtn.classList.remove('is-inline-flex-visible');
      }
    };

    // 바로 한 번 체크 + 렌더링 직후 한 번 더
    checkOverflow();
    setTimeout(checkOverflow, 0);

    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = feedContent.classList.toggle('expanded');
      if (expanded) {
        moreBtn.textContent = '접기';
      } else {
        moreBtn.textContent = '더보기...';
      }
    });
  }

  // 3) 태그 클릭: 페이지별 처리 콜백 우선, 없으면 /explore?tag=... 이동
  const hashtagChips = cardEl.querySelectorAll('.hashtag-pill, .gls-tag-btn, .gls-hashtag-chip');
  hashtagChips.forEach((chip) => {
    if (chip.dataset.tagNavBound === '1') return;
    const tag = chip.getAttribute('data-tag') || chip.dataset.tag;
    if (!tag) return;
    chip.dataset.tagNavBound = '1';
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof onTagClick === 'function') {
        onTagClick(tag, chip, post);
        return;
      }
      window.location.href = `/explore?tag=${encodeURIComponent(tag)}`;
    });
  });

  if (isCardClickable(cardEl)) {
    cardEl.classList.add('gls-post-card--clickable');
    cardEl.setAttribute('role', 'link');
    cardEl.setAttribute('tabindex', '0');
    if (!cardEl.getAttribute('aria-label')) {
      cardEl.setAttribute('aria-label', `${post.title || '글'} 상세 보기`);
    }
  } else {
    cardEl.classList.remove('gls-post-card--clickable');
    cardEl.removeAttribute('role');
    cardEl.removeAttribute('tabindex');
  }

  // 4) 카드 전체 클릭/키보드 → 상세 페이지 이동
  if (cardEl.dataset.cardNavBound !== '1') {
    cardEl.dataset.cardNavBound = '1';

    cardEl.addEventListener('click', (e) => {
      if (!isCardClickable(cardEl)) return;
      if (shouldIgnoreCardNavigation(e.target)) return;
      navigateToPostDetail(post, cardEl);
    });

    cardEl.addEventListener('keydown', (e) => {
      if (!isCardClickable(cardEl)) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (shouldIgnoreCardNavigation(e.target)) return;
      e.preventDefault();
      navigateToPostDetail(post, cardEl);
    });
  }
}

function bindRenderedImageFallback(cardEl) {
  const imageEl = cardEl?.querySelector('.feed-rendered-card-image');
  const fallbackEl = cardEl?.querySelector('[data-feed-render-fallback]');
  if (!imageEl || !fallbackEl) return;
  if (imageEl.dataset.fallbackBound === '1') return;
  imageEl.dataset.fallbackBound = '1';

  const activateFallback = () => {
    imageEl.classList.add('is-hidden');
    imageEl.setAttribute('hidden', '');
    fallbackEl.hidden = false;
    fallbackEl.classList.add('is-active');

    const quoteEl = cardEl.querySelector('.quote-card');
    if (quoteEl) {
      quoteEl.classList.add('quote-card--fallback-active');
    }

    if (typeof autoAdjustQuoteFont === 'function') {
      autoAdjustQuoteFont(fallbackEl);
    }
  };

  imageEl.addEventListener('error', activateFallback, { once: true });
  if (imageEl.complete && imageEl.naturalWidth === 0) {
    activateFallback();
  }
}
