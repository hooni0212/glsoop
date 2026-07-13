// public/js/post.js
// 개별 글 상세 페이지 스크립트

document.addEventListener('DOMContentLoaded', async () => {
  await setupPostSafeAreaGuides();
  initPostDetailPage();
});

const POST_MOBILE_DOCK_MEDIA = '(max-width: 768px)';
const POST_MOBILE_DOCK_SCROLL_THRESHOLD = 0.68;
const POST_COMMENT_MAX_LENGTH = 1000;
let postSafeAreaGuidesEnabled = false;
const postCommentsState = {
  postId: null,
  comments: [],
  replyTarget: null,
  loading: false,
  submitting: false,
  refreshingByPull: false,
};
const DETAIL_TITLE_SAFE_ZONE_BY_LENGTH = {
  'one-line': {
    left: 29,
    width: 42,
    top: 24,
    height: 12.5,
    bodyLeft: 29,
    bodyTop: 34,
    bodyWidth: 42,
    bodyHeight: 32,
    textAlign: 'center',
    bodyFontRatio: 0.041,
    bodyLineHeight: 1.14,
  },
  short: {
    left: 33.6,
    width: 42.4,
    top: 25.6,
    height: 12.2,
    bodyLeft: 33.6,
    bodyTop: 36.4,
    bodyWidth: 42.4,
    bodyHeight: 34.6,
    textAlign: 'center',
    bodyFontRatio: 0.035,
    bodyLineHeight: 1.15,
  },
  medium: {
    left: 35.4,
    width: 41,
    top: 26.8,
    height: 12,
    bodyLeft: 35.4,
    bodyTop: 46.2,
    bodyWidth: 41,
    bodyHeight: 41.2,
    textAlign: 'left',
    bodyFontRatio: 0.0325,
    bodyLineHeight: 1.13,
  },
  long: {
    left: 32.2,
    width: 45.2,
    top: 26.2,
    height: 12.4,
    bodyLeft: 32.2,
    bodyTop: 44.8,
    bodyWidth: 45.2,
    bodyHeight: 45,
    textAlign: 'left',
    bodyFontRatio: 0.03,
    bodyLineHeight: 1.12,
  },
  xlong: {
    left: 29.9,
    width: 48.8,
    top: 25.8,
    height: 12.8,
    bodyLeft: 29.9,
    bodyTop: 43.8,
    bodyWidth: 48.8,
    bodyHeight: 47.4,
    textAlign: 'left',
    bodyFontRatio: 0.0275,
    bodyLineHeight: 1.11,
  },
};

function resolveDetailTitleSafeZone(lengthVariant) {
  const key = String(lengthVariant || '').trim().toLowerCase();
  if (DETAIL_TITLE_SAFE_ZONE_BY_LENGTH[key]) {
    return DETAIL_TITLE_SAFE_ZONE_BY_LENGTH[key];
  }
  return DETAIL_TITLE_SAFE_ZONE_BY_LENGTH.medium;
}

function getPostDetailImageUrls(post) {
  const topLevelImages = Array.isArray(post?.images)
    ? post.images.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (topLevelImages.length > 0) return topLevelImages;

  const nestedImages = Array.isArray(post?.render_images?.images)
    ? post.render_images.images.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (nestedImages.length > 0) return nestedImages;

  const primaryImage =
    typeof post?.primary_image === 'string' && post.primary_image.trim()
      ? post.primary_image.trim()
      : typeof post?.image_url === 'string' && post.image_url.trim()
        ? post.image_url.trim()
        : '';
  if (primaryImage) return [primaryImage];

  if (typeof buildFeedRenderedImageUrl === 'function') {
    const fallback = buildFeedRenderedImageUrl(post);
    return fallback ? [fallback] : [];
  }

  return [];
}

function buildPostDetailCarouselNavHtml(imageUrls = []) {
  if (!Array.isArray(imageUrls) || imageUrls.length <= 1) return '';

  const dots = imageUrls
    .map(
      (_url, index) => `
        <button
          type="button"
          class="post-detail-carousel-dot${index === 0 ? ' is-active' : ''}"
          data-post-carousel-dot="${index}"
          aria-label="${index + 1}번째 페이지로 이동"
          aria-pressed="${index === 0 ? 'true' : 'false'}"
        ></button>
      `
    )
    .join('');

  return `
    <div class="post-detail-carousel-nav" data-post-carousel-nav>
      <button
        type="button"
        class="post-detail-carousel-btn"
        data-post-carousel-prev
        aria-label="이전 이미지"
      >이전</button>
      <div class="post-detail-carousel-status" aria-live="polite">
        <span data-post-carousel-current>1</span>
        <span>/</span>
        <span>${imageUrls.length}</span>
      </div>
      <button
        type="button"
        class="post-detail-carousel-btn"
        data-post-carousel-next
        aria-label="다음 이미지"
      >다음</button>
    </div>
    <div class="post-detail-carousel-dots" data-post-carousel-dots>
      ${dots}
    </div>
  `;
}

function buildPostDetailReadingHtml(post) {
  const showTruncatedNotice = Boolean(
    post?.render_images?.is_truncated || post?.is_truncated
  );
  return showTruncatedNotice
    ? `
      <div class="post-detail-truncated-notice" role="note">
        이미지에는 일부만 표시됩니다.
      </div>
    `
    : '';
}

function setupPostDetailCarousel(card, imageUrls = []) {
  if (!card || !Array.isArray(imageUrls) || imageUrls.length <= 1) return;

  const imageEl = card.querySelector('.feed-rendered-card-image');
  if (!imageEl) return;

  const prevBtn = card.querySelector('[data-post-carousel-prev]');
  const nextBtn = card.querySelector('[data-post-carousel-next]');
  const currentEl = card.querySelector('[data-post-carousel-current]');
  const dotEls = Array.from(card.querySelectorAll('[data-post-carousel-dot]'));

  let currentIndex = 0;

  const sync = () => {
    const safeIndex = Math.max(0, Math.min(currentIndex, imageUrls.length - 1));
    currentIndex = safeIndex;
    imageEl.src = imageUrls[safeIndex];
    imageEl.dataset.pageIndex = String(safeIndex + 1);
    if (currentEl) {
      currentEl.textContent = String(safeIndex + 1);
    }
    if (prevBtn) prevBtn.disabled = safeIndex === 0;
    if (nextBtn) nextBtn.disabled = safeIndex >= imageUrls.length - 1;
    dotEls.forEach((dotEl, index) => {
      const isActive = index === safeIndex;
      dotEl.classList.toggle('is-active', isActive);
      dotEl.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  prevBtn?.addEventListener('click', () => {
    currentIndex = Math.max(0, currentIndex - 1);
    sync();
  });

  nextBtn?.addEventListener('click', () => {
    currentIndex = Math.min(imageUrls.length - 1, currentIndex + 1);
    sync();
  });

  dotEls.forEach((dotEl, index) => {
    dotEl.addEventListener('click', () => {
      currentIndex = index;
      sync();
    });
  });

  sync();
}

function hydratePostDetailRenderedContent(card, post) {
  if (!card || !post) return;

  const feedContent = card.querySelector('.feed-post-content');
  const quoteCard = card.querySelector('.quote-card');
  const imageShell = card.querySelector('.feed-rendered-image-shell');
  const imageEl = card.querySelector('.feed-rendered-card-image');
  if (!feedContent || !quoteCard || !imageShell || !imageEl) return;

  const imageUrls = getPostDetailImageUrls(post);
  const primaryImage = imageUrls[0] || imageEl.getAttribute('src') || '';
  if (primaryImage) {
    imageEl.src = primaryImage;
  }

  feedContent.classList.add('feed-post-content--detail-rendered');
  card.classList.add('is-rendered-detail');

  const existingNav = card.querySelector('[data-post-carousel-nav]');
  const existingDots = card.querySelector('[data-post-carousel-dots]');
  const existingReadingPanel = card.querySelector('.post-detail-reading-panel');
  const existingTruncatedNotice = card.querySelector('.post-detail-truncated-notice');
  existingNav?.remove();
  existingDots?.remove();
  existingReadingPanel?.remove();
  existingTruncatedNotice?.remove();

  const navMarkup = buildPostDetailCarouselNavHtml(imageUrls);
  if (navMarkup) {
    imageShell.insertAdjacentHTML('afterend', navMarkup);
  }

  feedContent.insertAdjacentHTML('beforeend', buildPostDetailReadingHtml(post));
  setupPostDetailCarousel(card, imageUrls);
}

async function setupPostSafeAreaGuides() {
  const body = document.body;
  if (!body) return;

  try {
    const runtimeConfig = typeof getGlsoopRuntimeConfig === 'function'
      ? await getGlsoopRuntimeConfig()
      : { safe_area_guides: false };
    postSafeAreaGuidesEnabled = Boolean(runtimeConfig?.safe_area_guides);
  } catch (error) {
    postSafeAreaGuidesEnabled = false;
  }

  body.classList.toggle('gls-safe-area-debug', postSafeAreaGuidesEnabled);
}

function initPostLoginPrompt() {
  const modalEl = document.getElementById('postLoginPromptModal');
  const loginBtn = document.getElementById('postLoginPromptLoginBtn');
  const backBtn = document.getElementById('postLoginPromptBackBtn');
  const messageEl = document.getElementById('postLoginPromptMessage');
  if (!modalEl || !loginBtn || !backBtn) return;

  const goBackFromPrompt = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = '/explore';
  };

  window.glsoopPostAuthGate = {
    open(options = {}) {
      const actionLabel = typeof options.actionLabel === 'string' && options.actionLabel.trim()
        ? options.actionLabel.trim()
        : '공감';
      if (messageEl) {
        messageEl.textContent = `${actionLabel}은 로그인한 회원만 이용할 수 있는 기능입니다.`;
      }
      if (window.glsModal) {
        window.glsModal.open(modalEl);
      }
    },
    close() {
      if (window.glsModal) {
        window.glsModal.close(modalEl);
      }
    },
  };

  if (loginBtn.dataset.bound !== '1') {
    loginBtn.dataset.bound = '1';
    loginBtn.addEventListener('click', () => {
      if (typeof redirectToLoginWithNext === 'function') {
        redirectToLoginWithNext({
          source: 'post-like-login-modal',
          alertMessage: '로그인 후 공감할 수 있습니다.',
        });
        return;
      }
      window.location.href = '/html/login.html';
    });
  }

  if (backBtn.dataset.bound !== '1') {
    backBtn.dataset.bound = '1';
    backBtn.addEventListener('click', () => {
      if (window.glsModal) {
        window.glsModal.close(modalEl);
      }
      goBackFromPrompt();
    });
  }
}

function applyDetailImageTitleOverlay(cardEl, titleText = '제목 없음') {
  if (!cardEl) return;

  const imageShell = cardEl.querySelector('.feed-rendered-image-shell');
  if (!imageShell) return;

  const existingOverlay = imageShell.querySelector('.post-image-title');
  if (existingOverlay) existingOverlay.remove();
  const existingBodyOverlay = imageShell.querySelector('.post-image-body-safe');
  if (existingBodyOverlay) existingBodyOverlay.remove();

  const safeZone = resolveDetailTitleSafeZone(cardEl.dataset.lengthVariant);
  const titleEl = cardEl.querySelector('.card-title');
  if (titleEl) {
    titleEl.classList.add('post-card-title-outside');
    titleEl.setAttribute('aria-hidden', 'true');
  }

  let bodySafeOverlay = null;
  if (postSafeAreaGuidesEnabled) {
    bodySafeOverlay = document.createElement('div');
    bodySafeOverlay.className = 'post-image-body-safe';
    bodySafeOverlay.style.setProperty('--post-safe-body-left', `${safeZone.bodyLeft ?? safeZone.left}%`);
    bodySafeOverlay.style.setProperty('--post-safe-body-top', `${safeZone.bodyTop ?? 46.2}%`);
    bodySafeOverlay.style.setProperty('--post-safe-body-width', `${safeZone.bodyWidth ?? safeZone.width}%`);
    bodySafeOverlay.style.setProperty('--post-safe-body-height', `${safeZone.bodyHeight ?? 41.2}%`);
  }

  const overlay = document.createElement('div');
  overlay.className = 'post-image-title';
  overlay.setAttribute(
    'data-title',
    titleText && String(titleText).trim().length > 0
      ? String(titleText).trim()
      : '제목 없음'
  );
  overlay.style.setProperty('--post-safe-left', `${safeZone.left}%`);
  overlay.style.setProperty('--post-safe-width', `${safeZone.width}%`);
  overlay.style.setProperty('--post-safe-top', `${safeZone.top}%`);
  overlay.style.setProperty('--post-safe-title-height', `${safeZone.height}%`);
  overlay.style.setProperty('--post-safe-title-align', safeZone.textAlign || 'left');
  overlay.style.setProperty('--post-body-font-ratio', String(safeZone.bodyFontRatio || 0.0325));
  overlay.style.setProperty('--post-body-line-height', String(safeZone.bodyLineHeight || 1.13));

  const text = document.createElement('span');
  text.className = 'post-image-title__text';
  text.textContent =
    titleText && String(titleText).trim().length > 0
      ? String(titleText).trim()
      : '제목 없음';

  overlay.appendChild(text);
  if (bodySafeOverlay) {
    imageShell.appendChild(bodySafeOverlay);
  }
  imageShell.appendChild(overlay);
}

function trackUxEvent(eventName, properties = {}, options = {}) {
  if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') {
    return;
  }
  window.glsoopAnalytics.trackEvent(eventName, properties, options);
}

function getPostDockTargets() {
  return {
    body: document.body,
    dock: document.querySelector('[data-post-action-dock="1"]'),
  };
}

function syncPostMobileDockClass() {
  const { body, dock } = getPostDockTargets();
  if (!body || !body.classList.contains('page-post')) return;

  const isMobile = window.matchMedia
    ? window.matchMedia(POST_MOBILE_DOCK_MEDIA).matches
    : window.innerWidth <= 768;

  if (!isMobile) {
    body.classList.remove('has-mobile-action-dock');
    body.dataset.postActionMode = 'inline';
    return;
  }

  const doc = document.documentElement;
  const scrollable = Math.max(1, doc.scrollHeight - window.innerHeight);
  const progress = Math.max(0, Math.min(1, window.scrollY / scrollable));
  const dockRect = dock?.getBoundingClientRect();
  const inlineDockVisible = Boolean(
    dockRect &&
      dockRect.top < window.innerHeight - 12 &&
      dockRect.bottom > (window.matchMedia('(max-width: 420px)').matches ? 0 : 10)
  );
  const shouldUseFloatingDock = progress >= POST_MOBILE_DOCK_SCROLL_THRESHOLD && !inlineDockVisible;

  body.classList.toggle('has-mobile-action-dock', shouldUseFloatingDock);
  body.dataset.postActionMode = shouldUseFloatingDock ? 'dock' : 'inline';
}

function bindPostMobileDockClass() {
  if (window.__glsoopPostDockBound) return;
  window.__glsoopPostDockBound = true;
  let rafId = 0;
  const syncOnFrame = () => {
    if (rafId) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      syncPostMobileDockClass();
    });
  };
  syncPostMobileDockClass();

  if (window.matchMedia) {
    const mq = window.matchMedia(POST_MOBILE_DOCK_MEDIA);
    const onChange = () => syncOnFrame();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(onChange);
    }
  } else {
    window.addEventListener('resize', syncOnFrame, { passive: true });
  }

  window.addEventListener('scroll', syncOnFrame, { passive: true });
  window.addEventListener('resize', syncOnFrame, { passive: true });
}

async function initPostDetailPage() {
  bindPostMobileDockClass();
  initPostLoginPrompt();

  const postId = resolvePostDetailId();
  const container = document.getElementById('postDetail');

  if (!container) return;

  if (!postId) {
    container.innerHTML =
      '<p class="text-danger">글 정보를 찾을 수 없습니다. 다시 시도해주세요.</p>';
    return;
  }

  container.innerHTML = '<p class="gls-text-muted">글을 불러오는 중입니다...</p>';

  let postData = null;
  try {
    const stored = localStorage.getItem('glsoop_lastPost');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && String(parsed.id) === String(postId)) {
        postData = parsed;
      }
    }
  } catch (e) {
    console.error('Failed to parse glsoop_lastPost', e);
  }

  try {
    const res = await fetch(`/api/posts/${encodeURIComponent(postId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.post) {
        const fresh = data.post;
        postData = postData ? { ...postData, ...fresh } : fresh;

        try {
          localStorage.setItem('glsoop_lastPost', JSON.stringify(postData));
        } catch (e) {
          console.warn('glsoop_lastPost 저장 실패', e);
        }
      }
    } else {
      console.warn('detail API 응답 비정상:', res.status, res.statusText);
    }
  } catch (e) {
    console.warn('detail API 호출 실패(무시 가능)', e);
  }

  if (!postData) {
    container.innerHTML =
      '<p class="text-danger">글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
    return;
  }

  renderPostDetail(container, postData);
  initPostComments(postData);
  loadRelatedPosts(postData);
}

function resolvePostDetailId() {
  const params = new URLSearchParams(window.location.search);
  const queryId = params.get('postId');
  if (queryId) return queryId;

  const match = window.location.pathname.match(/^\/posts\/([^/?#]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : '';
}

function showPostNotice(message, type = 'success', autoHideMs = 2200) {
  if (window.glsoopUi?.showPageNotice) {
    window.glsoopUi.showPageNotice(message, { type, autoHideMs });
    return;
  }
  alert(message);
}

function getCommentAuthorName(comment) {
  const author = comment?.author || {};
  return String(author.display_name || author.displayName || author.nickname || '익명').trim() || '익명';
}

function normalizePostComment(row = {}) {
  const id = Number.parseInt(row.id, 10);
  const parentId = Number.parseInt(row.parent_comment_id, 10);
  return {
    id: Number.isFinite(id) ? id : 0,
    post_id: row.post_id,
    parent_comment_id: Number.isFinite(parentId) && parentId > 0 ? parentId : null,
    status: row.status === 'deleted' ? 'deleted' : 'active',
    content: typeof row.content === 'string' ? row.content : null,
    author: row.author || null,
    reply_count: Number(row.reply_count || 0),
    like_count: Number(row.like_count || 0),
    liked_by_me: row.liked_by_me === 1 || row.liked_by_me === true,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    deleted_at: row.deleted_at || null,
  };
}

async function fetchJsonForPostComments(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: options.method && options.method !== 'GET' ? 'no-store' : 'no-store',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (response.ok && (data.ok !== false)) {
    return data;
  }
  const error = new Error(data.message || `요청을 처리하지 못했습니다. (${response.status})`);
  error.status = response.status;
  error.code = data.code || null;
  error.payload = data;
  throw error;
}

function getPostCommentEls() {
  return {
    panel: document.getElementById('postCommentsPanel'),
    count: document.getElementById('postCommentsCount'),
    list: document.getElementById('postCommentsList'),
    status: document.getElementById('postCommentsStatus'),
    form: document.getElementById('postCommentForm'),
    input: document.getElementById('postCommentInput'),
    inputCount: document.getElementById('postCommentInputCount'),
    submitBtn: document.getElementById('postCommentSubmitBtn'),
    replyTarget: document.getElementById('postCommentReplyTarget'),
    replyTargetText: document.getElementById('postCommentReplyTargetText'),
    replyCancelBtn: document.getElementById('postCommentReplyCancelBtn'),
  };
}

function groupPostComments(comments = []) {
  const topLevel = [];
  const repliesByParent = new Map();
  comments.forEach((comment) => {
    if (comment.parent_comment_id) {
      const current = repliesByParent.get(comment.parent_comment_id) || [];
      current.push(comment);
      repliesByParent.set(comment.parent_comment_id, current);
      return;
    }
    topLevel.push(comment);
  });
  return { topLevel, repliesByParent };
}

function renderPostCommentItem(comment, { isReply = false } = {}) {
  const authorName = getCommentAuthorName(comment);
  const dateText = typeof formatKoreanDateTime === 'function'
    ? formatKoreanDateTime(comment.created_at)
    : '';
  const isDeleted = comment.status === 'deleted';
  const safeContent = isDeleted ? '삭제된 댓글입니다.' : escapeHtml(comment.content || '');
  const liked = comment.liked_by_me === true;
  const likeCount = Number(comment.like_count || 0);
  const replyBtn = !isReply && !isDeleted
    ? `
      <button type="button" class="post-comment-action post-comment-action--icon" data-comment-reply="${comment.id}" aria-label="답글 달기">
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="M8.8 19.4 5 21v-4.1A7.5 7.5 0 0 1 3 11.7C3 7 7 3.5 12 3.5s9 3.5 9 8.2-4 8.2-9 8.2c-1.1 0-2.2-.2-3.2-.5Z"></path>
        </svg>
      </button>`
    : '';
  const likeBtn = !isDeleted
    ? `
      <button
        type="button"
        class="post-comment-action post-comment-action--icon post-comment-like${liked ? ' is-liked' : ''}"
        data-comment-like="${comment.id}"
        aria-label="${liked ? '댓글 공감 취소' : '댓글 공감'}"
        aria-pressed="${liked ? 'true' : 'false'}"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="M12 20.2 5.3 13.9C1.7 10.5 3.8 4.5 8.8 4.5c1.5 0 2.8.7 3.2 1.7.4-1 1.7-1.7 3.2-1.7 5 0 7.1 6 3.5 9.4L12 20.2Z"></path>
        </svg>
        <span class="post-comment-like-count">${likeCount}</span>
      </button>`
    : '';
  const deleteBtn = !isDeleted
    ? `<button type="button" class="post-comment-action post-comment-action--danger" data-comment-delete="${comment.id}">삭제</button>`
    : '';

  return `
    <article class="${isReply ? 'post-comment-item post-comment-item--reply' : 'post-comment-item'}" data-comment-id="${comment.id}">
      <div class="post-comment-marker" aria-hidden="true">${escapeHtml(isDeleted ? '' : authorName.charAt(0) || '')}</div>
      <div class="post-comment-content">
        <div class="post-comment-meta">
          <strong class="post-comment-author">${escapeHtml(isDeleted ? '삭제된 댓글' : authorName)}</strong>
          ${dateText ? `<span class="post-comment-date">${escapeHtml(dateText)}</span>` : ''}
        </div>
        <p class="post-comment-body">${safeContent}</p>
        ${replyBtn || likeBtn || deleteBtn ? `<div class="post-comment-actions">${replyBtn}${likeBtn}${deleteBtn}</div>` : ''}
      </div>
    </article>
  `;
}

function renderPostComments() {
  const els = getPostCommentEls();
  if (!els.panel || !els.list || !els.status) return;

  const comments = postCommentsState.comments || [];
  const activeCount = comments.filter((comment) => comment.status === 'active').length;
  if (els.count) els.count.textContent = String(activeCount);

  if (postCommentsState.loading && comments.length === 0) {
    els.status.hidden = false;
    els.status.textContent = '댓글을 불러오는 중입니다...';
    els.list.innerHTML = '';
    return;
  }

  if (comments.length === 0) {
    els.status.hidden = false;
    els.status.textContent = '아직 댓글이 없습니다. 첫 댓글을 남겨보세요.';
    els.list.innerHTML = '';
    return;
  }

  els.status.hidden = true;
  const { topLevel, repliesByParent } = groupPostComments(comments);
  els.list.innerHTML = topLevel
    .map((comment) => {
      const replies = repliesByParent.get(comment.id) || [];
      return `
        <div class="post-comment-thread">
          ${renderPostCommentItem(comment)}
          ${replies.length ? `<div class="post-comment-replies">${replies.map((reply) => renderPostCommentItem(reply, { isReply: true })).join('')}</div>` : ''}
        </div>
      `;
    })
    .join('');
}

function syncPostCommentComposer() {
  const els = getPostCommentEls();
  if (!els.input || !els.submitBtn) return;

  const loggedIn = isViewerLikelyLoggedIn();
  const value = els.input.value || '';
  els.input.placeholder = loggedIn ? '댓글을 남겨보세요' : '로그인 후 댓글을 남길 수 있습니다';
  els.input.disabled = !loggedIn || postCommentsState.submitting;
  els.submitBtn.disabled = !loggedIn || postCommentsState.submitting || !value.trim();
  els.submitBtn.classList.toggle('is-loading', postCommentsState.submitting);
  els.submitBtn.setAttribute(
    'aria-label',
    postCommentsState.submitting
      ? '댓글 등록 중'
      : postCommentsState.replyTarget
        ? '답글 등록'
        : '댓글 등록'
  );
  if (els.inputCount) {
    els.inputCount.textContent = `${value.length}/${POST_COMMENT_MAX_LENGTH}`;
  }

  if (els.replyTarget && els.replyTargetText) {
    if (postCommentsState.replyTarget) {
      els.replyTarget.hidden = false;
      els.replyTargetText.textContent = `${getCommentAuthorName(postCommentsState.replyTarget)}님에게 답글`;
    } else {
      els.replyTarget.hidden = true;
      els.replyTargetText.textContent = '';
    }
  }
}

function setPostCommentReplyTarget(comment) {
  postCommentsState.replyTarget = comment || null;
  syncPostCommentComposer();
  const els = getPostCommentEls();
  if (comment && els.input) {
    els.input.focus();
  }
}

async function loadPostComments() {
  if (!postCommentsState.postId) return;
  const els = getPostCommentEls();
  postCommentsState.loading = true;
  renderPostComments();

  try {
    const data = await fetchJsonForPostComments(
      `/api/posts/${encodeURIComponent(postCommentsState.postId)}/comments?limit=50&offset=0`
    );
    postCommentsState.comments = Array.isArray(data.comments)
      ? data.comments.map(normalizePostComment)
      : [];
  } catch (error) {
    console.error(error);
    if (els.status) {
      els.status.hidden = false;
      els.status.textContent = error.message || '댓글을 불러오지 못했습니다.';
    }
  } finally {
    postCommentsState.loading = false;
    renderPostComments();
  }
}

async function togglePostCommentLike(commentId) {
  if (!commentId) return;
  if (!isViewerLikelyLoggedIn()) {
    if (window.glsoopSafety?.openLoginGate) {
      window.glsoopSafety.openLoginGate({ actionLabel: '댓글 공감', source: 'post-comment-like' });
      return;
    }
    redirectToLoginWithNext({
      source: 'post-comment-like',
      alertMessage: '로그인 후 댓글에 공감할 수 있습니다.',
    });
    return;
  }

  const current = postCommentsState.comments.find((item) => Number(item.id) === Number(commentId));
  if (!current || current.status === 'deleted') return;

  try {
    const data = await fetchJsonForPostComments(
      `/api/comments/${encodeURIComponent(commentId)}/toggle-like`,
      { method: 'POST' }
    );
    postCommentsState.comments = postCommentsState.comments.map((comment) =>
      Number(comment.id) === Number(commentId)
        ? {
            ...comment,
            liked_by_me: data.liked === true,
            like_count: Number(data.like_count || 0),
          }
        : comment
    );
    renderPostComments();
  } catch (error) {
    console.error(error);
    if (Number(error.status) === 401) {
      if (window.glsoopSafety?.openLoginGate) {
        window.glsoopSafety.openLoginGate({ actionLabel: '댓글 공감', source: 'post-comment-like' });
      } else {
        redirectToLoginWithNext({ source: 'post-comment-like' });
      }
      return;
    }
    showPostNotice(error.message || '댓글 공감 처리에 실패했습니다.', 'error');
  }
}

async function submitPostComment() {
  const els = getPostCommentEls();
  if (!els.input || !postCommentsState.postId) return;
  if (!isViewerLikelyLoggedIn()) {
    if (window.glsoopAuthGateModal && typeof window.glsoopAuthGateModal.open === 'function') {
      window.glsoopAuthGateModal.open({
        title: '로그인 후 댓글을 남길 수 있어요',
        message: '댓글은 로그인한 회원만 이용할 수 있는 기능입니다.',
        description: '로그인하면 글에 댓글과 답글을 남길 수 있습니다.',
        source: 'post-comment',
      });
      return;
    }
    redirectToLoginWithNext({
      source: 'post-comment',
      alertMessage: '로그인 후 댓글을 남길 수 있습니다.',
    });
    return;
  }

  const content = String(els.input.value || '').trim();
  if (!content) {
    showPostNotice('댓글 내용을 입력해주세요.', 'error');
    return;
  }

  postCommentsState.submitting = true;
  syncPostCommentComposer();

  try {
    const payload = {
      content,
      parent_comment_id: postCommentsState.replyTarget?.id || undefined,
    };
    const data = await fetchJsonForPostComments(
      `/api/posts/${encodeURIComponent(postCommentsState.postId)}/comments`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    if (data.comment) {
      postCommentsState.comments.push(normalizePostComment(data.comment));
    }
    els.input.value = '';
    setPostCommentReplyTarget(null);
    renderPostComments();
    showPostNotice(payload.parent_comment_id ? '답글을 남겼습니다.' : '댓글을 남겼습니다.', 'success');
  } catch (error) {
    console.error(error);
    if (Number(error.status) === 401) {
      if (window.glsoopSafety?.openLoginGate) {
        window.glsoopSafety.openLoginGate({ actionLabel: '댓글 작성', source: 'post-comment' });
      } else {
        redirectToLoginWithNext({ source: 'post-comment' });
      }
      return;
    }
    showPostNotice(error.message || '댓글 작성에 실패했습니다.', 'error');
  } finally {
    postCommentsState.submitting = false;
    syncPostCommentComposer();
  }
}

async function deletePostComment(commentId) {
  if (!commentId) return;
  if (!isViewerLikelyLoggedIn()) {
    if (window.glsoopSafety?.openLoginGate) {
      window.glsoopSafety.openLoginGate({ actionLabel: '댓글 삭제', source: 'post-comment' });
    }
    return;
  }
  if (!window.confirm('이 댓글을 삭제할까요?')) return;

  try {
    await fetchJsonForPostComments(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
    });
    postCommentsState.comments = postCommentsState.comments.map((comment) =>
      Number(comment.id) === Number(commentId)
        ? { ...comment, status: 'deleted', content: null, author: null, deleted_at: new Date().toISOString() }
        : comment
    );
    renderPostComments();
    showPostNotice('댓글을 삭제했습니다.', 'success');
  } catch (error) {
    console.error(error);
    if (Number(error.status) === 401) {
      if (window.glsoopSafety?.openLoginGate) {
        window.glsoopSafety.openLoginGate({ actionLabel: '댓글 삭제', source: 'post-comment' });
      }
      return;
    }
    showPostNotice(error.message || '댓글 삭제에 실패했습니다.', 'error');
  }
}

function bindPostCommentEvents() {
  if (window.__glsoopPostCommentsBound) return;
  window.__glsoopPostCommentsBound = true;

  const els = getPostCommentEls();
  els.form?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitPostComment();
  });
  els.input?.addEventListener('input', syncPostCommentComposer);
  els.replyCancelBtn?.addEventListener('click', () => setPostCommentReplyTarget(null));
  els.list?.addEventListener('click', (event) => {
    const replyBtn = event.target?.closest?.('[data-comment-reply]');
    if (replyBtn) {
      const commentId = Number.parseInt(replyBtn.getAttribute('data-comment-reply'), 10);
      const comment = postCommentsState.comments.find((item) => Number(item.id) === commentId);
      if (comment) setPostCommentReplyTarget(comment);
      return;
    }

    const likeBtn = event.target?.closest?.('[data-comment-like]');
    if (likeBtn) {
      const commentId = Number.parseInt(likeBtn.getAttribute('data-comment-like'), 10);
      togglePostCommentLike(commentId);
      return;
    }

    const deleteBtn = event.target?.closest?.('[data-comment-delete]');
    if (deleteBtn) {
      const commentId = Number.parseInt(deleteBtn.getAttribute('data-comment-delete'), 10);
      deletePostComment(commentId);
    }
  });

  document.querySelectorAll('.after-login').forEach((node) => {
    const observer = new MutationObserver(syncPostCommentComposer);
    observer.observe(node, { attributes: true, attributeFilter: ['class'] });
  });

  bindPostCommentsPullToRefresh();
}

function bindPostCommentsPullToRefresh() {
  const els = getPostCommentEls();
  if (!els.panel || !('ontouchstart' in window)) return;

  let startY = 0;
  let pullDistance = 0;
  let tracking = false;
  const threshold = 72;

  const reset = () => {
    tracking = false;
    pullDistance = 0;
    els.panel.style.removeProperty('--post-comment-pull');
    els.panel.classList.remove('is-pulling-comments');
  };

  els.panel.addEventListener('touchstart', (event) => {
    if (window.scrollY > 2 || postCommentsState.loading) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    startY = touch.clientY;
    tracking = true;
    pullDistance = 0;
  }, { passive: true });

  els.panel.addEventListener('touchmove', (event) => {
    if (!tracking) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const delta = touch.clientY - startY;
    if (delta <= 0) {
      reset();
      return;
    }
    pullDistance = Math.min(delta, 120);
    els.panel.classList.add('is-pulling-comments');
    els.panel.style.setProperty('--post-comment-pull', `${Math.round(pullDistance)}px`);
    if (pullDistance > 12 && event.cancelable) {
      event.preventDefault();
    }
  }, { passive: false });

  els.panel.addEventListener('touchend', () => {
    if (!tracking) return;
    const shouldRefresh = pullDistance >= threshold;
    reset();
    if (shouldRefresh && !postCommentsState.loading) {
      postCommentsState.refreshingByPull = true;
      loadPostComments().finally(() => {
        postCommentsState.refreshingByPull = false;
      });
    }
  }, { passive: true });

  els.panel.addEventListener('touchcancel', reset, { passive: true });
}

function initPostComments(post) {
  const els = getPostCommentEls();
  if (!els.panel || !post?.id) return;

  postCommentsState.postId = String(post.id);
  postCommentsState.comments = [];
  postCommentsState.replyTarget = null;
  postCommentsState.loading = false;
  postCommentsState.submitting = false;
  els.panel.hidden = false;
  if (els.input) els.input.value = '';

  bindPostCommentEvents();
  syncPostCommentComposer();
  renderPostComments();
  loadPostComments();
}

function resolveRenderedImageOptions(card) {
  const fallback = {
    template: 'paper01',
    scale: '2',
  };

  const renderedImageEl = card?.querySelector('.feed-rendered-card-image');
  const src = renderedImageEl?.getAttribute('src');
  if (!src) return fallback;

  try {
    const parsed = new URL(src, window.location.origin);
    const template = parsed.searchParams.get('template');
    const scale = parsed.searchParams.get('scale');
    return {
      template: template ? String(template).trim() : fallback.template,
      scale: scale === '1' || scale === '2' ? scale : fallback.scale,
    };
  } catch (error) {
    return fallback;
  }
}

function resolveRenderedImagePageCount(post) {
  const nestedPageCount = Number.parseInt(post?.render_images?.page_count, 10);
  if (Number.isInteger(nestedPageCount) && nestedPageCount > 0) return nestedPageCount;

  const nestedImages = Array.isArray(post?.render_images?.images)
    ? post.render_images.images.length
    : 0;
  if (nestedImages > 0) return nestedImages;

  const topLevelImages = Array.isArray(post?.images) ? post.images.length : 0;
  return Math.max(1, topLevelImages);
}

function resolveRenderedImageDownloadUrls(post, card) {
  const postId = post?.id != null ? String(post.id) : '';
  if (!postId) return [];

  const options = resolveRenderedImageOptions(card);
  const pageCount = resolveRenderedImagePageCount(post);

  return Array.from({ length: pageCount }, (_item, index) => {
    const params = new URLSearchParams();
    params.set('template', options.template || 'paper01');
    params.set('scale', options.scale || '2');
    if (index > 0) params.set('page', String(index + 1));
    return `/api/feed-images/share/post/${encodeURIComponent(postId)}?${params.toString()}`;
  });
}

function resolveRenderedImageDownloadUrl(post, card) {
  return resolveRenderedImageDownloadUrls(post, card)[0] || '';
}

function buildPostPermalink(post) {
  if (!post?.id) return window.location.href;
  return `${window.location.origin}/html/post.html?postId=${encodeURIComponent(post.id)}`;
}

async function downloadRenderedImage(post, card) {
  const imageUrls = resolveRenderedImageDownloadUrls(post, card);
  if (imageUrls.length < 1) {
    alert('저장할 이미지를 찾지 못했습니다.');
    return;
  }

  try {
    for (let index = 0; index < imageUrls.length; index += 1) {
      const response = await fetch(imageUrls[index], { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`이미지 ${index + 1} 요청 실패: ${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const pageSuffix = imageUrls.length > 1 ? `_${index + 1}of${imageUrls.length}` : '';
      link.href = objectUrl;
      link.download = `glsoop_post_${post?.id || 'card'}${pageSuffix}.webp`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    console.error(error);
    alert('이미지 저장 중 오류가 발생했습니다.');
  }
}

function ensurePostShareModal() {
  if (document.getElementById('igExportModal') || document.getElementById('postShareModal')) return;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal fade" id="igExportModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">공유</h5>
            <button type="button" class="gls-modal-close" data-gls-dismiss="modal" aria-label="닫기"></button>
          </div>
          <div class="modal-body post-share-modal-body">
            <div class="post-share-actions">
              <button type="button" class="gls-btn gls-btn-primary gls-btn-sm" id="postShareLinkBtn">링크 공유</button>
              <button type="button" class="gls-btn gls-btn-secondary gls-btn-sm" id="postShareSaveImageBtn">이미지 저장</button>
            </div>
            <p class="post-share-link-hint gls-text-small gls-text-muted" id="postShareLinkHint"></p>
            <div class="post-share-preview">
              <p class="post-share-preview-title gls-text-small">이미지 저장 미리보기</p>
              <img id="postSharePreviewImage" class="post-share-preview-image" alt="저장될 카드 이미지 미리보기" />
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper.firstElementChild);

  const linkBtn = document.getElementById('postShareLinkBtn');
  const saveBtn = document.getElementById('postShareSaveImageBtn');

  if (linkBtn && linkBtn.dataset.bound !== '1') {
    linkBtn.dataset.bound = '1';
    linkBtn.addEventListener('click', async () => {
      const state = window.__glsoopPostShareState || {};
      const post = state.post;
      const permalink = buildPostPermalink(post);
      const shareData = {
        title: post?.title || '글숲 글',
        url: permalink,
      };

      try {
        if (navigator.share) {
          await navigator.share(shareData);
          return;
        }
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(permalink);
          alert('링크를 클립보드에 복사했습니다.');
          return;
        }
        window.prompt('아래 링크를 복사해 공유하세요.', permalink);
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error(error);
          alert('링크 공유 중 오류가 발생했습니다.');
        }
      }
    });
  }

  if (saveBtn && saveBtn.dataset.bound !== '1') {
    saveBtn.dataset.bound = '1';
    saveBtn.addEventListener('click', async () => {
      const state = window.__glsoopPostShareState || {};
      await downloadRenderedImage(state.post, state.card);
    });
  }
}

function openPostShareModal(post, card) {
  ensurePostShareModal();

  const imageUrls = resolveRenderedImageDownloadUrls(post, card);
  const imageUrl = imageUrls[0] || '';
  const permalink = buildPostPermalink(post);
  window.__glsoopPostShareState = {
    post,
    card,
    imageUrl,
    permalink,
  };

  const previewImageEl = document.getElementById('postSharePreviewImage');
  if (previewImageEl) {
    previewImageEl.src = imageUrl;
  }

  const linkHintEl = document.getElementById('postShareLinkHint');
  if (linkHintEl) {
    linkHintEl.textContent = permalink;
  }

  const saveButtonEl = document.getElementById('postShareSaveImageBtn');
  if (saveButtonEl) {
    saveButtonEl.textContent =
      imageUrls.length > 1 ? `이미지 ${imageUrls.length}장 저장` : '이미지 저장';
  }

  const modalEl = document.getElementById('igExportModal') || document.getElementById('postShareModal');
  if (window.glsModal && modalEl) {
    window.glsModal.open(modalEl);
  }
}

function isViewerLikelyLoggedIn() {
  const afterLoginNav = document.querySelector('.after-login');
  if (!afterLoginNav) return false;
  return !afterLoginNav.classList.contains('is-hidden');
}

function ensurePostSafetyMenuModal() {
  if (document.getElementById('postSafetyMenuModal')) return;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal fade" id="postSafetyMenuModal" tabindex="-1" aria-labelledby="postSafetyMenuLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content post-login-prompt-modal">
          <div class="modal-header">
            <div>
              <p class="post-login-prompt-modal__eyebrow gls-mb-1">MORE</p>
              <h5 class="modal-title" id="postSafetyMenuLabel">더보기</h5>
            </div>
            <button type="button" class="gls-modal-close" data-gls-dismiss="modal" aria-label="닫기"></button>
          </div>
          <div class="modal-body post-login-prompt-modal__body">
            <p class="gls-mb-3" id="postSafetyMenuDescription">
              공유, 게시글 신고, 작성자 차단을 할 수 있습니다.
            </p>
            <div class="gls-flex gls-flex-col gls-gap-2">
              <button type="button" class="gls-btn gls-btn-secondary" id="postSafetyShareBtn">공유하기</button>
              <button type="button" class="gls-btn gls-btn-secondary" id="postSafetyReportBtn">게시글 신고</button>
              <button type="button" class="gls-btn gls-btn-secondary" id="postSafetyBlockBtn">작성자 차단</button>
              <button type="button" class="gls-btn gls-btn-ghost" data-gls-dismiss="modal">닫기</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper.firstElementChild);

  const modalEl = document.getElementById('postSafetyMenuModal');
  const shareBtn = document.getElementById('postSafetyShareBtn');
  const reportBtn = document.getElementById('postSafetyReportBtn');
  const blockBtn = document.getElementById('postSafetyBlockBtn');

  shareBtn?.addEventListener('click', () => {
    if (window.glsModal && modalEl) {
      window.glsModal.close(modalEl);
    }
    const state = window.__glsoopPostSafetyState || {};
    if (state.post && state.card) {
      openPostShareModal(state.post, state.card);
    }
  });

  reportBtn?.addEventListener('click', async () => {
    if (window.glsModal && modalEl) {
      window.glsModal.close(modalEl);
    }
    await handlePostReport(window.__glsoopPostSafetyState?.post);
  });

  blockBtn?.addEventListener('click', async () => {
    if (window.glsModal && modalEl) {
      window.glsModal.close(modalEl);
    }
    await handlePostBlockAuthor(window.__glsoopPostSafetyState?.post);
  });

}

function openPostSafetyMenu(post, card) {
  ensurePostSafetyMenuModal();
  const modalEl = document.getElementById('postSafetyMenuModal');
  const descriptionEl = document.getElementById('postSafetyMenuDescription');
  const authorName = String(post?.author_nickname || post?.author_name || '이 글 작성자').trim() || '이 글 작성자';

  window.__glsoopPostSafetyState = { post, card };
  if (descriptionEl) {
    descriptionEl.textContent = `${authorName}의 글을 공유하거나 신고하고 작성자를 차단할 수 있습니다.`;
  }

  if (window.glsModal && modalEl) {
    window.glsModal.open(modalEl);
  }
}

function ensurePostSafetyAccess(actionLabel) {
  if (isViewerLikelyLoggedIn()) {
    return true;
  }

  if (window.glsoopSafety && typeof window.glsoopSafety.openLoginGate === 'function') {
    window.glsoopSafety.openLoginGate({
      actionLabel,
      source: 'post-safety',
    });
  } else if (typeof redirectToLoginWithNext === 'function') {
    redirectToLoginWithNext({
      alertMessage: `${actionLabel}은 로그인 후 이용할 수 있습니다.`,
      source: 'post-safety',
    });
  } else {
    window.location.href = '/html/login.html';
  }

  return false;
}

async function handlePostReport(post) {
  if (!post?.id) return;
  if (!ensurePostSafetyAccess('게시글 신고')) return;

  try {
    const payload = await window.glsoopSafety?.openPrompt?.({
      targetType: 'post',
      eyebrow: 'REPORT POST',
      title: '게시글 신고',
      description: '문제가 되는 게시글이라면 사유를 선택해 신고해 주세요. 운영 검토 큐에 접수됩니다.',
      confirmLabel: '신고하기',
      detailPlaceholder: '기타 사유를 200자 이내로 적어주세요.',
    });

    if (!payload) return;

    await window.glsoopSafety.reportPost(post.id, {
      reason_code: payload.reasonCode,
      detail: payload.detail,
    });

    if (window.glsoopUi?.showPageNotice) {
      window.glsoopUi.showPageNotice('게시글 신고가 운영 검토 큐에 접수되었습니다.', {
        type: 'success',
        autoHideMs: 2200,
      });
      return;
    }
    alert('게시글 신고가 접수되었습니다.');
  } catch (error) {
    console.error(error);
    if (window.glsoopSafety?.isAuthRequiredError?.(error)) {
      ensurePostSafetyAccess('게시글 신고');
      return;
    }
    if (window.glsoopUi?.showPageNotice) {
      window.glsoopUi.showPageNotice(error.message || '게시글 신고에 실패했습니다.', {
        type: 'error',
        autoHideMs: 2400,
      });
      return;
    }
    alert(error.message || '게시글 신고에 실패했습니다.');
  }
}

async function handlePostBlockAuthor(post) {
  const authorId = post?.author_id || post?.user_id;
  const authorName = String(post?.author_nickname || post?.author_name || '이 작성자').trim() || '이 작성자';
  if (!authorId) return;
  if (!ensurePostSafetyAccess('작성자 차단')) return;

  try {
    const payload = await window.glsoopSafety?.openPrompt?.({
      targetType: 'user',
      eyebrow: 'BLOCK USER',
      title: '작성자 차단',
      description: `${authorName}을 차단하면 이 작성자의 글이 내 화면에서 바로 숨겨집니다.`,
      confirmLabel: '차단하기',
      defaultReasonCode: 'harassment',
      detailPlaceholder: '기타 사유를 200자 이내로 적어주세요.',
    });

    if (!payload) return;

    await window.glsoopSafety.blockUser(authorId, {
      reason_code: payload.reasonCode,
      detail: payload.detail,
      context_post_id: post?.id || null,
    });

    if (window.glsoopUi?.showPageNotice) {
      window.glsoopUi.showPageNotice('작성자를 차단했습니다. 이제 내 화면에서 이 작성자의 글과 프로필이 숨겨집니다.', {
        type: 'success',
        autoHideMs: 1800,
      });
    }
    window.setTimeout(() => {
      window.location.href = '/explore';
    }, 420);
  } catch (error) {
    console.error(error);
    if (window.glsoopSafety?.isAuthRequiredError?.(error)) {
      ensurePostSafetyAccess('작성자 차단');
      return;
    }
    if (window.glsoopUi?.showPageNotice) {
      window.glsoopUi.showPageNotice(error.message || '작성자 차단에 실패했습니다.', {
        type: 'error',
        autoHideMs: 2400,
      });
      return;
    }
    alert(error.message || '작성자 차단에 실패했습니다.');
  }
}

function hasTitleBoxLayout(rawLayout) {
  if (rawLayout == null) return false;

  let parsed = rawLayout;
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

  const titleBox =
    Number.parseInt(parsed.layout_version, 10) === 2
      ? parsed?.base?.title_box
      : parsed.title_box;
  if (!titleBox || typeof titleBox !== 'object' || Array.isArray(titleBox)) {
    return false;
  }

  return (
    Number.isFinite(Number(titleBox.x)) &&
    Number.isFinite(Number(titleBox.y)) &&
    Number.isFinite(Number(titleBox.w)) &&
    Number.isFinite(Number(titleBox.h))
  );
}

/**
 * 선택된 한 개의 글을 화면 상단에 크게 렌더링
 */
function renderPostDetail(container, post) {
  if (!container || !post) return;

  const cardHtml = buildStandardPostCardHTML(post, {
    showMoreButton: false,
    forceRenderedImage: true,
    cardClickable: false,
  });

  // ✅ 레이아웃은 post.html(2컬럼)에서 담당
  // - 여기서는 카드만 렌더링하고, 메타 바는 별도 컨테이너에 담는다
  container.innerHTML = `${cardHtml}`;

  const card = container.querySelector('.gls-post-card');
  if (card) {
    const authorBadge = card.querySelector('.gls-author-badge');
    if (authorBadge) {
      const authorName = authorBadge.textContent?.trim() || '글쓴이';
      const badgeWrap = document.createElement('div');
      badgeWrap.className = 'gls-user-badge gls-user-badge--compact';
      badgeWrap.innerHTML = `
        <div class="gls-user-badge__avatar" aria-hidden="true"></div>
        <div class="gls-user-badge__body">
          <span class="gls-user-badge__name"></span>
        </div>
      `;

      const avatarEl = badgeWrap.querySelector('.gls-user-badge__avatar');
      if (avatarEl) {
        avatarEl.textContent = authorName.charAt(0) || '🌿';
      }

      const nameEl = badgeWrap.querySelector('.gls-user-badge__name');
      if (nameEl) {
        nameEl.textContent = authorName;
      }

      authorBadge.replaceWith(badgeWrap);
    }

    enhanceStandardPostCard(card, post);
    setupHashtagSearch(card);

    const feedContent = card.querySelector('.feed-post-content');
    const hasRenderedImage = !!card.querySelector('.feed-rendered-card-image');
    if (feedContent) {
      feedContent.classList.add('expanded');
      if (hasRenderedImage) {
        hydratePostDetailRenderedContent(card, post);
      } else {
        feedContent.classList.add('post-inner-surface', 'post-content-surface');
      }
    }

    const moreBtn = card.querySelector('.more-toggle');
    if (moreBtn) {
      moreBtn.classList.add('is-hidden');
      moreBtn.classList.remove('is-inline-visible', 'is-inline-flex-visible');
    }


    // ✅ 우측 스티키 패널(액션) 버튼과 카드 액션을 연결
    bindSideActions(card, post);
  }

  // ✅ 메타 바(타입 + 해시태그 + 피드 링크)를 카드 아래에서 하나로 묶기
  const metaBar = document.getElementById('postMetaBar');
  const metaCategory = document.getElementById('postMetaCategory');
  const metaTags = document.getElementById('postMetaTags');
  const backLink = document.getElementById('backToFeedLink');

  if (metaBar && metaCategory && metaTags) {
    metaCategory.innerHTML = '';
    metaTags.innerHTML = '';

    const dateText = typeof formatKoreanDateTime === 'function'
      ? formatKoreanDateTime(post.created_at)
      : '';
    if (dateText) {
      const dateChip = document.createElement('span');
      dateChip.className = 'post-time-chip post-chip-btn';
      dateChip.textContent = dateText;
      metaCategory.appendChild(dateChip);
    }

    const legacyMeta = card?.querySelector('.post-bottom-meta');
    if (legacyMeta) {
      // category row + hashtag row(s)를 분리해서 담기
      const categoryRow = legacyMeta.querySelector('.post-category-row');
      if (categoryRow) {
        const categoryBadge = categoryRow.querySelector('.post-category-label');
        if (categoryBadge) {
          categoryBadge.classList.add('post-type-chip', 'post-chip-btn');
          metaCategory.appendChild(categoryBadge);
        }
      }

      // 해시태그 컨테이너(.gls-card-hashtags)는 그대로 옮기되 버튼 클래스를 통일
      legacyMeta.querySelectorAll('.gls-tag-btn').forEach((btn) => {
        btn.classList.add('post-tag-chip', 'post-chip-btn');
      });

      Array.from(legacyMeta.children || []).forEach((node) => {
        // categoryRow는 이미 이동했으니 스킵
        if (node.classList?.contains('post-category-row')) return;
        metaTags.appendChild(node);
      });

      legacyMeta.remove();
    }

    metaBar.hidden = false;
    setupHashtagSearch(metaBar);
  }

  if (backLink) {
    backLink.setAttribute('role', 'button');
  }
}

/**
 * 우측 패널(좋아요/북마크/공유) 버튼을 카드 액션과 연결
 * - 카드 구조를 바꾸지 않고도 "액션바" UX를 만들기 위한 프록시
 */
function bindSideActions(card, post) {
  const sideLikeBtn = document.getElementById('sideLikeBtn');
  const sideLikeCount = document.getElementById('sideLikeCount');
  const sideBookmarkBtn = document.getElementById('sideBookmarkBtn');
  const sideShareBtn = document.getElementById('sideShareBtn');
  const sideSafetyBtn = document.getElementById('sideSafetyBtn');

  if (!sideLikeBtn || !sideBookmarkBtn || !sideShareBtn || !sideSafetyBtn) return;
  if (!card) return;

  const likeBtn = card.querySelector('.like-btn');
  const bookmarkBtn = card.querySelector('.post-bookmark-toggle');

  const syncLikeState = () => {
    if (!likeBtn || !sideLikeBtn) return;

    const liked = likeBtn.getAttribute('data-liked') === '1';
    const heartEl = sideLikeBtn.querySelector('.post-side-like-heart');
    if (heartEl) heartEl.textContent = liked ? '♥' : '♡';

    const countEl = likeBtn.querySelector('.like-count');
    const countTxt = countEl ? String(countEl.textContent || '0') : '0';
    if (sideLikeCount) sideLikeCount.textContent = countTxt;

    sideLikeBtn.setAttribute('aria-pressed', liked ? 'true' : 'false');
  };

  // 최초 동기화
  syncLikeState();

  // 좋아요: 상세 액션 → 공감 API
  if (sideLikeBtn.dataset.boundSideLike !== '1') {
    sideLikeBtn.dataset.boundSideLike = '1';
    sideLikeBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      trackUxEvent('post_action_click', { action: 'like' });
      if (!likeBtn) return;
      await toggleLike(post.id, likeBtn);
      syncLikeState();
    });
  }

  // 카드 좋아요 클릭 시에도 사이드 동기화
  if (likeBtn && likeBtn.dataset.boundSideLikeSync !== '1') {
    likeBtn.dataset.boundSideLikeSync = '1';
    likeBtn.addEventListener('click', () => {
      setTimeout(syncLikeState, 0);
      setTimeout(syncLikeState, 350);
    });
  }

  document.addEventListener('glsoop:like-state-changed', (event) => {
    if (String(event.detail?.postId || '') === String(post.id || '')) {
      syncLikeState();
    }
  });

  // 북마크: 상세 액션 → 북마크 모달
  if (sideBookmarkBtn.dataset.boundSideBookmark !== '1') {
    sideBookmarkBtn.dataset.boundSideBookmark = '1';
    sideBookmarkBtn.addEventListener('click', (e) => {
      e.preventDefault();
      trackUxEvent('post_action_click', { action: 'bookmark' });
      if (window.Glsoop?.BookmarkModal?.open && post?.id) {
        window.Glsoop.BookmarkModal.open(post.id);
        return;
      }
      bookmarkBtn?.click();
    });
  }

  // 공유: 사이드 → 링크 공유/이미지 저장 옵션 모달
  if (sideShareBtn.dataset.boundSideShare !== '1') {
    sideShareBtn.dataset.boundSideShare = '1';
    sideShareBtn.addEventListener('click', (e) => {
      e.preventDefault();
      trackUxEvent('post_action_click', { action: 'share' });
      try {
        openPostShareModal(post, card);
      } catch (err) {
        console.error(err);
        alert('공유 모달을 열지 못했습니다. 잠시 후 다시 시도해주세요.');
      }
    });
  }

  if (sideSafetyBtn.dataset.boundSideSafety !== '1') {
    sideSafetyBtn.dataset.boundSideSafety = '1';
    sideSafetyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      trackUxEvent('post_action_click', { action: 'safety' });
      openPostSafetyMenu(post, card);
    });
  }
}

/**
 * 해시태그 버튼 클릭 → 메인 피드 tag 검색
 */
function setupHashtagSearch(scopeEl) {
  if (!scopeEl) return;

  const tagButtons = scopeEl.querySelectorAll(
    '.hashtag-pill, .gls-tag-btn, .gls-hashtag-chip'
  );

  tagButtons.forEach((btn) => {
    if (btn.dataset.tagNavBound) return;

    const tag = btn.getAttribute('data-tag') || btn.dataset.tag;
    if (!tag) return;

    btn.dataset.tagNavBound = '1';
    btn.style.cursor = 'pointer';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.href = `/explore?tag=${encodeURIComponent(tag)}`;
    });
  });
}

/**
 * 관련 글 로드
 */
async function loadRelatedPosts(currentPost) {
  const highlightEl = document.getElementById('relatedHighlight');
  const listEl = document.getElementById('relatedList');
  const legacyBox = document.getElementById('relatedPosts');

  const hasSidebarTargets = !!(highlightEl && listEl);
  const box = hasSidebarTargets ? null : legacyBox;

  if (hasSidebarTargets) {
    highlightEl.innerHTML = '<p class="gls-text-muted gls-text-small gls-mb-0">관련 글을 불러오는 중입니다...</p>';
    listEl.innerHTML = '';
  } else {
    if (!box) return;
    box.innerHTML = '<p class="gls-text-muted">관련 글을 불러오는 중입니다...</p>';
  }

  try {
    const res = await fetch(
      `/api/posts/${encodeURIComponent(currentPost.id)}/related?limit=12`
    );

    if (!res.ok) {
      if (hasSidebarTargets) {
        highlightEl.innerHTML =
          '<p class="gls-text-muted gls-text-small gls-mb-0">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      } else if (box) {
        box.innerHTML =
          '<p class="gls-text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      }
      return;
    }

    const data = await res.json();
    if (!data.ok) {
      if (hasSidebarTargets) {
        highlightEl.innerHTML =
          '<p class="gls-text-muted gls-text-small gls-mb-0">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      } else if (box) {
        box.innerHTML =
          '<p class="gls-text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      }
      return;
    }

    const posts = (data.posts || []).filter(
      (p) => String(p.id) !== String(currentPost.id)
    );

    if (!posts.length) {
      if (hasSidebarTargets) {
        highlightEl.innerHTML =
          '<p class="gls-text-muted gls-text-small gls-mb-0">아직 함께 읽어볼 만한 관련 글이 없습니다.</p>';
        listEl.innerHTML = '';
      } else if (box) {
        box.innerHTML =
          '<p class="gls-text-muted">아직 함께 읽어볼 만한 관련 글이 없습니다.</p>';
      }
      return;
    }

    if (hasSidebarTargets) {
      renderRelatedSidebar(posts, currentPost);
    } else if (box) {
      renderRelatedPosts(box, posts, currentPost.id);
    }
  } catch (e) {
    console.error(e);
    if (highlightEl && listEl) {
      highlightEl.innerHTML =
        '<p class="gls-text-muted gls-text-small gls-mb-0">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
      listEl.innerHTML = '';
    } else if (legacyBox) {
      legacyBox.innerHTML =
        '<p class="gls-text-muted">관련 글을 불러오는 중 오류가 발생했습니다.</p>';
    }
  }
}

function toPlainText(html) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    return (doc.body && doc.body.textContent ? doc.body.textContent : '').trim();
  } catch {
    return String(html || '').replace(/<[^>]+>/g, '').trim();
  }
}

function buildSnippetFromPost(post, maxLen = 70) {
  if (!post) return '';

  let raw = post.content || '';
  try {
    // extractContentWithFont는 postCard.js에서 제공(있으면 사용)
    if (typeof extractContentWithFont === 'function') {
      const extracted = extractContentWithFont(post);
      if (extracted && extracted.cleanHtml) raw = extracted.cleanHtml;
    }
  } catch (e) {
    console.warn('extractContentWithFont failed(ignored)', e);
  }

  const text = toPlainText(raw).replace(/\s+/g, ' ');
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function cacheAndNavigateToDetail(post) {
  if (!post) return;
  try {
    const detailData = {
      id: post.id,
      title: post.title,
      content: post.content,
      created_at: post.created_at,
      hashtags: post.hashtags,

      author_id: post.author_id || null,
      author_name: post.author_name || null,
      author_nickname:
        (post.author_nickname && String(post.author_nickname).trim()) ||
        (post.author_name && String(post.author_name).trim()) ||
        null,
      author_email: post.author_email || null,

      like_count: typeof post.like_count === 'number' ? post.like_count : 0,
      user_liked: post.user_liked === 1 || post.user_liked === true ? 1 : 0,
      image_url: post.image_url || null,
      primary_image: post.primary_image || null,
      images: Array.isArray(post.images) ? post.images : [],
      has_multiple: post.has_multiple === true,
      render_images: post.render_images || null,
    };

    localStorage.setItem('glsoop_lastPost', JSON.stringify(detailData));
  } catch (e) {
    console.warn('failed to cache detail', e);
  }

  window.location.href = `/html/post.html?postId=${encodeURIComponent(post.id)}`;
}

function renderRelatedSidebar(posts, currentPost) {
  const highlightEl = document.getElementById('relatedHighlight');
  const listEl = document.getElementById('relatedList');
  const moreBtn = document.getElementById('relatedMoreBtn');

  if (!highlightEl || !listEl) return;

  // 내부 상태: "더 보기" 토글
  const state = window.__glsoopRelatedState || {
    expanded: false,
    limit: 12,
    posts: [],
    currentId: null,
  };

  state.posts = posts;
  state.currentId = currentPost?.id;
  window.__glsoopRelatedState = state;

  const render = (expanded) => {
    const maxList = expanded ? 12 : 6;
    const list = Array.isArray(state.posts) ? state.posts : [];
    const top = list[0];
    const rest = list.slice(1, 1 + maxList);

    // highlight
    if (top) {
      const dateStr = typeof formatKoreanDateTime === 'function'
        ? formatKoreanDateTime(top.created_at)
        : '';
      const snippet = buildSnippetFromPost(top, 90);
      const likeCount = typeof top.like_count === 'number' ? top.like_count : 0;

      highlightEl.innerHTML = `
        <div class="post-related-h-title">${escapeHtml(top.title || '')}</div>
        <p class="post-related-h-snippet">${escapeHtml(snippet)}</p>
        <div class="post-related-h-meta">
          ${dateStr ? `<span>${escapeHtml(dateStr)}</span>` : ''}
          <span>♥ ${likeCount}</span>
        </div>
      `;
      highlightEl.onclick = () => cacheAndNavigateToDetail(top);
    }

    // list
    listEl.innerHTML = rest
      .map((p) => {
        const dateStr = typeof formatKoreanDateTime === 'function'
          ? formatKoreanDateTime(p.created_at)
          : '';
        const snippet = buildSnippetFromPost(p, 70);
        const likeCount = typeof p.like_count === 'number' ? p.like_count : 0;

        return `
          <div class="post-related-item" data-post-id="${escapeHtml(String(p.id))}">
            <div class="post-related-item-title">${escapeHtml(p.title || '')}</div>
            <p class="post-related-item-snippet">${escapeHtml(snippet)}</p>
            <div class="post-related-item-meta">
              ${dateStr ? `<span>${escapeHtml(dateStr)}</span>` : ''}
              <span>♥ ${likeCount}</span>
            </div>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('.post-related-item').forEach((el) => {
      el.addEventListener('click', () => {
        const pid = el.getAttribute('data-post-id');
        const p = (state.posts || []).find((x) => String(x.id) === String(pid));
        if (p) cacheAndNavigateToDetail(p);
      });
    });

    // more btn
    if (moreBtn) {
      const shouldShow = list.length > 1 + 6;
      moreBtn.classList.toggle('is-hidden', !shouldShow);
      moreBtn.classList.toggle('is-inline-visible', shouldShow);
      moreBtn.textContent = expanded ? '접기' : '더 보기';
      moreBtn.dataset.expanded = expanded ? '1' : '0';
    }
  };

  render(state.expanded);

  // 더 보기: 필요하면 더 많이 fetch 후 확장
  if (moreBtn && !moreBtn.dataset.bound) {
    moreBtn.dataset.bound = '1';
    moreBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      state.expanded = !(moreBtn.dataset.expanded === '1');

      if (state.expanded && (state.posts || []).length < 18 && currentPost?.id) {
        try {
          const res = await fetch(
            `/api/posts/${encodeURIComponent(currentPost.id)}/related?limit=24`
          );
          if (res.ok) {
            const data = await res.json();
            if (data.ok) {
              state.posts = (data.posts || []).filter(
                (p) => String(p.id) !== String(currentPost.id)
              );
            }
          }
        } catch (err) {
          console.warn('related more fetch failed(ignored)', err);
        }
      }

      render(state.expanded);
    });
  }
}

function buildRelatedPostCardHTML(post) {
  if (!post) return '';
  return buildStandardPostCardHTML(post, {
    showMoreButton: false,
    cardExtraClass: 'related-card',
  });
}

function renderRelatedPosts(box, posts, currentPostId) {
  if (!box) return;

  const list = Array.isArray(posts)
    ? posts.filter((p) => String(p.id) !== String(currentPostId))
    : [];

  if (!list.length) {
    box.innerHTML =
      '<p class="gls-text-muted gls-text-small gls-mb-0">아직 관련된 글이 없습니다.</p>';
    return;
  }

  const cardsHtml = list.map((post) => buildRelatedPostCardHTML(post)).join('');
  box.innerHTML = cardsHtml;

  list.forEach((post) => {
    const card = box.querySelector(`.gls-post-card[data-post-id="${post.id}"]`);
    if (!card) return;

    if (typeof enhanceStandardPostCard === 'function') {
      enhanceStandardPostCard(card, post);
    }

    setupHashtagSearch(card);

    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('.like-btn')) return;
      if (e.target.closest('.gls-tag-btn')) return;

      let likeCount = 0;
      let userLiked = 0;
      const likeBtn = card.querySelector('.like-btn');
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
          created_at: post.created_at,
          hashtags: post.hashtags,

          author_id: post.author_id || null,
          author_name: post.author_name || null,
          author_nickname:
            (post.author_nickname && post.author_nickname.trim()) ||
            (post.author_name && post.author_name.trim()) ||
            null,
          author_email: post.author_email || null,

          like_count: likeCount,
          user_liked: userLiked,
        };

        localStorage.setItem('glsoop_lastPost', JSON.stringify(detailData));
      } catch (err) {
        console.error('failed to cache related post detail', err);
      }

      window.location.href = `/html/post.html?postId=${encodeURIComponent(post.id)}`;
    });
  });
}
