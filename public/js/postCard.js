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
  } = options;

  const dateStr = formatKoreanDateTime(post.created_at);
  const author = buildAuthorDisplay(post);

  const likeCount =
    typeof post.like_count === 'number' ? post.like_count : 0;
  const liked =
    post.user_liked === 1 || post.user_liked === true ? true : false;

  const hashtagHtml = buildHashtagHtml(post);
  const categoryHtml = renderCategoryBadge(post);
  const { cleanHtml, quoteFontClass } = extractContentWithFont(post);
  const safeHtml = sanitizePostHtml(cleanHtml);
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
      aria-label="북마크 추가"
    >
      ${bookmarkIcon}
    </button>`;

  // 카드에 붙일 추가 클래스
  const extraClass = cardExtraClass ? ` ${cardExtraClass}` : '';

  // feed-post-content에 expanded 붙일지 여부
  // 피드 미리보기 페이드 기본값은 glass로 고정(white는 ui-kit 비교/테스트용)
  // - expanded 상태에서는 페이드가 보이지 않지만, 클래스는 유지해도 무방
  const feedContentClass = contentExpanded
    ? 'feed-post-content gls-fade-glass expanded'
    : 'feed-post-content gls-fade-glass';

  return `
    <div class="card mb-3 gls-post-card${extraClass}" data-post-id="${post.id}">
      <div class="card-body">
        <!-- 상단 메타 영역: 작성자 / 날짜 / 공감 버튼 -->
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div class="d-flex align-items-center gap-3" >
            <span class="badge bg-light text-muted border gls-author-badge">
              ${escapeHtml(author)}
            </span>
            <span class="text-muted small">${escapeHtml(dateStr)}</span>
          </div>
          <div class="post-top-actions">
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
          </div>
        </div>

        <!-- 제목 -->
        <h5 class="card-title mb-2">
          ${escapeHtml(post.title || '')}
        </h5>

        <!-- 본문 카드 영역 -->
        <div class="post-content mt-2">
          <div class="${feedContentClass}">
            <div class="quote-card ${quoteFontClass}">
              ${safeHtml}
            </div>

            ${
              showMoreButton
                ? `
            <!-- 더보기 버튼 (내용이 넘칠 때만 노출) : 카드 내부 오버레이 -->
            <button
              class="btn btn-link p-0 more-toggle gls-more-overlay"
              type="button"
              style="display:none;"
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
function enhanceStandardPostCard(cardElement, post) {
  if (!cardElement) return;

  const quoteEl = cardElement.querySelector('.quote-card');
  if (quoteEl) {
    autoAdjustQuoteFont(quoteEl);
  }

  // 페이지별로 이미 존재하는 함수 재사용
  if (typeof setupCardAuthorLink === 'function') {
    setupCardAuthorLink(cardElement, post);
  }
  if (typeof setupCardInteractions === 'function') {
    setupCardInteractions(cardElement, post);
  }
}

// ==============================
// 공통: 좋아요 토글
// ==============================
async function toggleLike(postId, likeBtn) {
  if (!postId || !likeBtn) return;

  try {
    const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/toggle-like`, {
      method: 'POST',
    });

    // 401 → 비로그인
    if (res.status === 401) {
      alert('로그인 후 공감할 수 있습니다.');
      window.location.href = '/html/login.html';
      return;
    }

    const data = await res.json();

    if (!res.ok || !data.ok) {
      alert(data.message || '공감 처리 중 오류가 발생했습니다.');
      return;
    }

    const liked = !!data.liked;
    const likeCount =
      typeof data.likeCount === 'number' ? data.likeCount : 0;

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
    alert('공감 처리 중 오류가 발생했습니다.');
  }
}


// ==============================
// 공통: 작가 배지 클릭 → 작가 페이지
// ==============================
function setupCardAuthorLink(cardEl, post) {
  if (!cardEl || !post) return;

  const badge = cardEl.querySelector('.gls-author-badge');
  if (!badge) return;

  // author_id 또는 user_id 중 있는 것 사용
  const authorId = post.author_id || post.user_id;
  if (!authorId) return;

  badge.style.cursor = 'pointer';
  badge.addEventListener('click', (e) => {
    e.stopPropagation(); // 카드 클릭(상세 이동)과 분리
    window.location.href = `/html/author.html?userId=${encodeURIComponent(
      authorId
    )}`;
  });
}

// ==============================
// 공통: 카드 상호작용(♥, 더보기, 상세 페이지 이동)
// ==============================
function setupCardInteractions(cardEl, post) {
  if (!cardEl || !post) return;

  // 1) 좋아요 버튼
  const likeBtn = cardEl.querySelector('.like-btn');
  if (likeBtn) {
    likeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = likeBtn.getAttribute('data-post-id') || post.id;
      toggleLike(pid, likeBtn);
    });
  }

  // 2) 더보기 버튼 (내용이 넘칠 때만 표시)
  const feedContent = cardEl.querySelector('.feed-post-content');
  const moreBtn = cardEl.querySelector('.more-toggle');

  if (feedContent && moreBtn) {
    // 처음 렌더링 직후 높이 비교해서 넘치면 버튼 노출
    const checkOverflow = () => {
      const isOverflow = feedContent.scrollHeight > feedContent.clientHeight + 4;

      // ✅ 짧은 글에서는 페이드(잘림)가 보이지 않게
      feedContent.classList.toggle('has-overflow', isOverflow);

      if (isOverflow) {
        moreBtn.style.display = 'inline-flex';
        moreBtn.textContent = '더보기...';
      } else {
        moreBtn.style.display = 'none';
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

  // 3) 카드 전체 클릭 → 상세 페이지로 이동
  cardEl.addEventListener('click', (e) => {
    // 카드 안의 다른 버튼 클릭은 무시
    if (e.target.closest('.like-btn')) return;
    if (e.target.closest('.gls-tag-btn')) return;
    if (e.target.closest('.post-bookmark-toggle')) return;
    if (e.target.closest('.edit-post-btn')) return;
    if (e.target.closest('.delete-post-btn')) return;

    try {
      const detailData = {
        id: post.id,
        title: post.title,
        content: post.content,
        created_at: post.created_at,
        hashtags: post.hashtags,
        author_nickname:
          (post.author_nickname &&
            String(post.author_nickname).trim()) ||
          (post.author_name && String(post.author_name).trim()) ||
          null,
        author_email: post.author_email || null,
        like_count:
          post.like_count != null ? post.like_count : 0,
        user_liked:
          post.user_liked != null ? post.user_liked : 0,
      };
      localStorage.setItem(
        'glsoop_lastPost',
        JSON.stringify(detailData)
      );
    } catch (err) {
      console.error('failed to cache detail post', err);
    }

    window.location.href = `/html/post.html?postId=${encodeURIComponent(
      post.id
    )}`;
  });
}
