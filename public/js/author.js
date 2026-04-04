const AUTHOR_LIMIT = 10;
const AUTHOR_SORT_LABELS = {
  newest: '최신순',
  oldest: '오래된순',
  likes: '공감 많은순',
};
const AUTHOR_FEED_STATES = new Set(['idle', 'loading', 'empty', 'end', 'error']);
const AUTHOR_MOBILE_MEDIA = '(max-width: 768px)';
const AUTHOR_ABOUT_COLLAPSE_THRESHOLD = 170;
const AUTHOR_CARD_NAV_IGNORE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  '.like-btn',
  '.post-bookmark-toggle',
  '.more-toggle',
  '.hashtag-pill',
  '.gls-tag-btn',
  '.gls-hashtag-chip',
  '.gls-user-badge--link',
  '.gls-author-badge[role="link"]',
  '[data-card-stop-nav="1"]',
].join(',');

const authorPostCache = new Map();

const state = {
  authorId: null,
  offset: 0,
  loading: false,
  done: false,
  sort: 'newest',
  nickname: '',
  latestPost: null,
  feedState: 'idle',
  followState: {
    isLoggedIn: false,
    isOwnProfile: false,
    isFollowing: false,
  },
  followProcessing: false,
  overflowOpen: false,
  overflowBound: false,
  sortModal: null,
  sortModalRestoreFocus: null,
  profileViewTracked: false,
  observer: null,
  scrollFallbackBound: false,
};

const dom = {};

function trackUxEvent(eventName, properties = {}, options = {}) {
  if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') {
    return;
  }
  window.glsoopAnalytics.trackEvent(eventName, properties, options);
}

function isMobileViewport() {
  if (window.matchMedia) {
    return window.matchMedia(AUTHOR_MOBILE_MEDIA).matches;
  }
  return window.innerWidth <= 768;
}

function setAuthorDataset(name, value) {
  if (dom.body) {
    dom.body.dataset[name] = String(value);
  }
  if (dom.pageSection) {
    dom.pageSection.dataset[name] = String(value);
  }
}

function setFeedState(nextState) {
  const stateKey = AUTHOR_FEED_STATES.has(nextState) ? nextState : 'idle';
  state.feedState = stateKey;
  setAuthorDataset('authorFeedState', stateKey);

  const isLoading = stateKey === 'loading';
  const isEmpty = stateKey === 'empty';
  const isEnd = stateKey === 'end';
  const isError = stateKey === 'error';

  dom.postsLoading?.classList.toggle('is-hidden', !isLoading);
  dom.postsEmpty?.classList.toggle('is-hidden', !isEmpty);
  dom.postsEnd?.classList.toggle('is-hidden', !isEnd);
  dom.postsError?.classList.toggle('is-hidden', !isError);
}

function parseJsonSafe(response) {
  return response.json().catch(() => ({}));
}

function showAuthorToast(message, type = 'info', autoHideMs = 2200) {
  if (!message || !dom.toast) return;

  dom.toast.textContent = message;
  dom.toast.classList.remove('is-error', 'is-success', 'is-visible');
  if (type === 'error') dom.toast.classList.add('is-error');
  if (type === 'success') dom.toast.classList.add('is-success');

  if (dom.toast.dataset.timerId) {
    clearTimeout(Number(dom.toast.dataset.timerId));
  }

  dom.toast.classList.add('is-visible');
  const timerId = window.setTimeout(() => {
    dom.toast.classList.remove('is-visible');
  }, Math.max(1000, Number(autoHideMs) || 2200));
  dom.toast.dataset.timerId = String(timerId);
}

function showUiNotice(message, type = 'info', autoHideMs = 2200) {
  if (!message) return;
  if (window.glsoopUi && typeof window.glsoopUi.showPageNotice === 'function') {
    window.glsoopUi.showPageNotice(message, { type, autoHideMs });
    return;
  }
  showAuthorToast(message, type, autoHideMs);
}

function cacheAuthorDom() {
  dom.body = document.body;
  dom.pageSection = document.querySelector('.author-page-section');

  dom.pageTitle = document.getElementById('authorPageTitle');
  dom.heroSubtitle = document.getElementById('authorHeroSubtitle');
  dom.nickname = document.getElementById('authorNicknameDisplay');
  dom.avatar = document.getElementById('authorAvatarInitial');
  dom.email = document.getElementById('authorEmailDisplay');
  dom.bio = document.getElementById('authorBio');
  dom.about = document.getElementById('authorAbout');
  dom.aboutToggle = document.getElementById('authorBioToggleBtn');
  dom.growthBadge = document.getElementById('authorGrowthBadge');

  dom.postCount = document.getElementById('authorPostCount');
  dom.likeCount = document.getElementById('authorLikeCount');
  dom.followerCount = document.getElementById('authorFollowerCount');
  dom.followingCount = document.getElementById('authorFollowingCount');

  dom.followBtn = document.getElementById('authorFollowBtn');
  dom.followHint = document.getElementById('authorFollowHint');
  dom.profileActionBtn = document.getElementById('authorProfileActionBtn');
  dom.latestPostBtn = document.getElementById('authorLatestPostBtn');

  dom.postsList = document.getElementById('authorPostsList');
  dom.postsLoading = document.getElementById('authorPostsLoading');
  dom.postsEmpty = document.getElementById('authorPostsEmpty');
  dom.postsEnd = document.getElementById('authorPostsEnd');
  dom.postsError = document.getElementById('authorPostsError');
  dom.feedSentinel = document.getElementById('authorFeedSentinel');

  dom.overflowBtn = document.getElementById('authorOverflowBtn');
  dom.overflowMenu = document.getElementById('authorOverflowMenu');
  dom.shareBtn = document.getElementById('authorShareBtn');
  dom.sortBtn = document.getElementById('authorSortBtn');
  dom.reportBtn = document.getElementById('authorReportBtn');
  dom.blockBtn = document.getElementById('authorBlockBtn');
  dom.guidelinesBtn = document.getElementById('authorGuidelinesBtn');

  dom.sortModal = document.getElementById('authorSortModal');
  dom.sortOptions = Array.from(document.querySelectorAll('.author-sort-options input[name="authorSort"]'));

  dom.toast = document.getElementById('authorToast');
}

function bindProfileControls() {
  if (dom.followBtn && !dom.followBtn.dataset.bound) {
    dom.followBtn.addEventListener('click', handleAuthorFollowToggle);
    dom.followBtn.dataset.bound = 'true';
  }

  if (dom.latestPostBtn && !dom.latestPostBtn.dataset.bound) {
    dom.latestPostBtn.addEventListener('click', handleOpenLatestPost);
    dom.latestPostBtn.dataset.bound = 'true';
  }

  if (dom.aboutToggle && !dom.aboutToggle.dataset.bound) {
    dom.aboutToggle.addEventListener('click', toggleAuthorAboutText);
    dom.aboutToggle.dataset.bound = 'true';
  }

  if (dom.postsError && !dom.postsError.dataset.bound) {
    dom.postsError.setAttribute('role', 'button');
    dom.postsError.setAttribute('tabindex', '0');
    dom.postsError.addEventListener('click', () => {
      if (state.loading) return;
      loadMoreAuthorPosts();
    });
    dom.postsError.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (state.loading) return;
      loadMoreAuthorPosts();
    });
    dom.postsError.dataset.bound = 'true';
  }
}

function setupAuthorSortModal() {
  if (!dom.sortOptions.length) return;

  if (dom.sortModal && window.bootstrap?.Modal) {
    dom.sortModal.addEventListener('hidden.bs.modal', () => {
      if (dom.sortModal) {
        dom.sortModal.setAttribute('aria-hidden', 'true');
      }
      if (state.sortModalRestoreFocus && typeof state.sortModalRestoreFocus.focus === 'function') {
        state.sortModalRestoreFocus.focus({ preventScroll: true });
      }
      state.sortModalRestoreFocus = null;
    });
    dom.sortModal.addEventListener('shown.bs.modal', () => {
      dom.sortModal?.setAttribute('aria-hidden', 'false');
      const checkedInput = dom.sortOptions.find((option) => option.checked);
      checkedInput?.focus({ preventScroll: true });
    });
    state.sortModal = window.bootstrap.Modal.getOrCreateInstance(dom.sortModal);
  }

  dom.sortOptions.forEach((option) => {
    if (option.value === state.sort) {
      option.checked = true;
    }

    if (option.dataset.bound) return;

    option.addEventListener('change', async () => {
      const nextSort = option.value;
      if (!nextSort || nextSort === state.sort) return;

      state.sort = nextSort;
      updateSortButtonLabel();
      resetAuthorPosts();
      await loadMoreAuthorPosts();
      hideAuthorSortModal();
    });

    option.dataset.bound = 'true';
  });

  if (dom.sortModal) {
    const dismissButtons = dom.sortModal.querySelectorAll('[data-gls-dismiss="modal"]');
    dismissButtons.forEach((button) => {
      if (button.dataset.bound) return;
      button.addEventListener('click', () => hideAuthorSortModal());
      button.dataset.bound = 'true';
    });
  }

  updateSortButtonLabel();
}

function openAuthorSortModal(triggerEl = null) {
  if (!dom.sortModal) return;

  state.sortModalRestoreFocus = triggerEl || dom.overflowBtn || null;

  if (state.sortModal && typeof state.sortModal.show === 'function') {
    state.sortModal.show();
    return;
  }

  dom.sortModal.classList.add('show');
  dom.sortModal.style.display = 'block';
  dom.sortModal.setAttribute('aria-hidden', 'false');
}

function hideAuthorSortModal() {
  if (!dom.sortModal) return;

  if (state.sortModal && typeof state.sortModal.hide === 'function') {
    state.sortModal.hide();
    return;
  }

  dom.sortModal.classList.remove('show');
  dom.sortModal.style.display = 'none';
  dom.sortModal.setAttribute('aria-hidden', 'true');

  if (state.sortModalRestoreFocus && typeof state.sortModalRestoreFocus.focus === 'function') {
    state.sortModalRestoreFocus.focus({ preventScroll: true });
  }
  state.sortModalRestoreFocus = null;
}

function setupAuthorOverflowMenu() {
  if (state.overflowBound || !dom.overflowBtn || !dom.overflowMenu) return;
  state.overflowBound = true;

  dom.overflowBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.overflowOpen) {
      closeAuthorOverflowMenu({ restoreFocus: true });
      return;
    }
    openAuthorOverflowMenu({ focusFirstItem: false });
  });

  dom.overflowBtn.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    openAuthorOverflowMenu({ focusFirstItem: true });
  });

  dom.overflowMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAuthorOverflowMenu({ restoreFocus: true });
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    const items = getOverflowMenuItems();
    if (!items.length) return;

    const currentIndex = items.indexOf(document.activeElement);
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + offset + items.length) % items.length;

    event.preventDefault();
    items[nextIndex].focus({ preventScroll: true });
  });

  document.addEventListener('click', (event) => {
    if (!state.overflowOpen) return;
    if (dom.overflowMenu.contains(event.target) || dom.overflowBtn.contains(event.target)) return;
    closeAuthorOverflowMenu({ restoreFocus: false });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!state.overflowOpen) return;
    event.preventDefault();
    closeAuthorOverflowMenu({ restoreFocus: true });
  });
}

function getOverflowMenuItems() {
  if (!dom.overflowMenu) return [];
  return Array.from(dom.overflowMenu.querySelectorAll('[role="menuitem"]')).filter(
    (item) => !item.disabled
  );
}

function openAuthorOverflowMenu(options = {}) {
  if (!dom.overflowBtn || !dom.overflowMenu) return;

  state.overflowOpen = true;
  setAuthorDataset('authorOverflowOpen', 'true');
  dom.overflowBtn.setAttribute('aria-expanded', 'true');
  dom.overflowMenu.classList.remove('is-hidden');
  dom.overflowMenu.setAttribute('aria-hidden', 'false');

  if (options.focusFirstItem) {
    const [firstItem] = getOverflowMenuItems();
    firstItem?.focus({ preventScroll: true });
  }
}

function closeAuthorOverflowMenu(options = {}) {
  if (!dom.overflowBtn || !dom.overflowMenu) return;

  state.overflowOpen = false;
  setAuthorDataset('authorOverflowOpen', 'false');
  dom.overflowBtn.setAttribute('aria-expanded', 'false');
  dom.overflowMenu.classList.add('is-hidden');
  dom.overflowMenu.setAttribute('aria-hidden', 'true');

  if (options.restoreFocus) {
    dom.overflowBtn.focus({ preventScroll: true });
  }
}

function setupAuthorToolbarActions() {
  if (dom.shareBtn && !dom.shareBtn.dataset.bound) {
    dom.shareBtn.addEventListener('click', async () => {
      trackUxEvent('author_overflow_click', {
        author_id: state.authorId,
        action: 'share',
        source: 'overflow_menu',
        mobile: isMobileViewport(),
      });
      closeAuthorOverflowMenu({ restoreFocus: true });
      await handleAuthorShare();
    });
    dom.shareBtn.dataset.bound = 'true';
  }

  if (dom.sortBtn && !dom.sortBtn.dataset.bound) {
    dom.sortBtn.addEventListener('click', () => {
      trackUxEvent('author_overflow_click', {
        author_id: state.authorId,
        action: 'sort',
        source: 'overflow_menu',
        mobile: isMobileViewport(),
      });
      closeAuthorOverflowMenu({ restoreFocus: false });
      openAuthorSortModal(dom.overflowBtn);
    });
    dom.sortBtn.dataset.bound = 'true';
  }

  if (dom.reportBtn && !dom.reportBtn.dataset.bound) {
    dom.reportBtn.addEventListener('click', async () => {
      trackUxEvent('author_overflow_click', {
        author_id: state.authorId,
        action: 'report',
        source: 'overflow_menu',
        mobile: isMobileViewport(),
      });
      closeAuthorOverflowMenu({ restoreFocus: true });
      await handleAuthorReport();
    });
    dom.reportBtn.dataset.bound = 'true';
  }

  if (dom.blockBtn && !dom.blockBtn.dataset.bound) {
    dom.blockBtn.addEventListener('click', async () => {
      trackUxEvent('author_overflow_click', {
        author_id: state.authorId,
        action: 'block',
        source: 'overflow_menu',
        mobile: isMobileViewport(),
      });
      closeAuthorOverflowMenu({ restoreFocus: true });
      await handleAuthorBlock();
    });
    dom.blockBtn.dataset.bound = 'true';
  }

  if (dom.guidelinesBtn && !dom.guidelinesBtn.dataset.bound) {
    dom.guidelinesBtn.addEventListener('click', async () => {
      trackUxEvent('author_overflow_click', {
        author_id: state.authorId,
        action: 'guidelines',
        source: 'overflow_menu',
        mobile: isMobileViewport(),
      });
      closeAuthorOverflowMenu({ restoreFocus: true });
      await handleOpenAuthorGuidelines();
    });
    dom.guidelinesBtn.dataset.bound = 'true';
  }
}

function updateAuthorOverflowSafetyUI() {
  const shouldHideViewerOnlyActions = !state.authorId || state.followState.isOwnProfile;
  [dom.reportBtn, dom.blockBtn].forEach((button) => {
    if (!button) return;
    button.hidden = shouldHideViewerOnlyActions;
    button.disabled = shouldHideViewerOnlyActions;
  });
}

function ensureAuthorSafetyAccess(actionLabel) {
  if (!state.authorId) {
    showUiNotice('작가 정보를 불러온 뒤 다시 시도해주세요.', 'error');
    return false;
  }

  if (state.followState.isOwnProfile) {
    showUiNotice('내 프로필에는 사용할 수 없는 기능입니다.', 'error');
    return false;
  }

  if (state.followState.isLoggedIn) {
    return true;
  }

  if (window.glsoopSafety && typeof window.glsoopSafety.openLoginGate === 'function') {
    window.glsoopSafety.openLoginGate({
      actionLabel,
      source: 'author-safety',
    });
  } else if (typeof redirectToLoginWithNext === 'function') {
    redirectToLoginWithNext({
      alertMessage: `${actionLabel}은 로그인 후 이용할 수 있습니다.`,
      source: 'author-safety',
    });
  } else {
    window.location.href = '/html/login.html';
  }

  return false;
}

async function handleOpenAuthorGuidelines() {
  try {
    if (window.glsoopSafety && typeof window.glsoopSafety.openGuidelines === 'function') {
      await window.glsoopSafety.openGuidelines();
      return;
    }
    window.open('/html/community-guidelines.html', '_blank', 'noopener,noreferrer');
  } catch (error) {
    console.error(error);
    showUiNotice('가이드라인을 열지 못했습니다.', 'error');
  }
}

async function handleAuthorReport() {
  if (!ensureAuthorSafetyAccess('작가 신고')) return;

  try {
    const payload = await window.glsoopSafety?.openPrompt?.({
      targetType: 'user',
      eyebrow: 'REPORT USER',
      title: '작가 신고',
      description: `${state.nickname || '이 작가'}를 신고하는 이유를 선택해 주세요. 운영 검토 큐에 접수됩니다.`,
      confirmLabel: '신고하기',
      detailPlaceholder: '기타 사유를 200자 이내로 적어주세요.',
    });

    if (!payload) return;

    await window.glsoopSafety.reportUser(state.authorId, {
      reason_code: payload.reasonCode,
      detail: payload.detail,
    });
    showUiNotice('신고가 운영 검토 큐에 접수되었습니다.', 'success', 2200);
  } catch (error) {
    console.error(error);
    if (window.glsoopSafety?.isAuthRequiredError?.(error)) {
      ensureAuthorSafetyAccess('작가 신고');
      return;
    }
    showUiNotice(error.message || '신고를 접수하지 못했습니다.', 'error');
  }
}

async function handleAuthorBlock() {
  if (!ensureAuthorSafetyAccess('작가 차단')) return;

  try {
    const payload = await window.glsoopSafety?.openPrompt?.({
      targetType: 'user',
      eyebrow: 'BLOCK USER',
      title: '작가 차단',
      description: `${state.nickname || '이 작가'}를 차단하면 이 사용자의 글과 프로필이 내 화면에서 숨겨집니다.`,
      confirmLabel: '차단하기',
      defaultReasonCode: 'harassment',
      detailPlaceholder: '기타 사유를 200자 이내로 적어주세요.',
    });

    if (!payload) return;

    await window.glsoopSafety.blockUser(state.authorId, {
      reason_code: payload.reasonCode,
      detail: payload.detail,
    });
    showUiNotice('작가를 차단했습니다. 이제 내 화면에서 이 사용자의 글과 프로필이 숨겨집니다.', 'success', 1800);
    window.setTimeout(() => {
      window.location.href = '/explore';
    }, 420);
  } catch (error) {
    console.error(error);
    if (window.glsoopSafety?.isAuthRequiredError?.(error)) {
      ensureAuthorSafetyAccess('작가 차단');
      return;
    }
    showUiNotice(error.message || '차단 처리 중 오류가 발생했습니다.', 'error');
  }
}

async function handleAuthorShare() {
  const shareData = {
    title: `${state.nickname || '작가'}님의 글숲`,
    text: '글숲 작가 페이지를 함께 읽어보세요.',
    url: window.location.href,
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      showAuthorToast('공유가 완료되었습니다.', 'success', 1600);
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(window.location.href);
      showAuthorToast('링크를 클립보드에 복사했습니다.', 'success', 1800);
      return;
    }

    showAuthorToast('공유 기능을 사용할 수 없는 환경입니다.', 'error');
  } catch (error) {
    if (error?.name === 'AbortError') {
      return;
    }
    console.error(error);
    showAuthorToast('공유에 실패했습니다.', 'error');
  }
}

function setupInfiniteLoadTrigger() {
  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
  }

  if ('IntersectionObserver' in window && dom.feedSentinel) {
    state.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          loadMoreAuthorPosts();
        });
      },
      {
        root: null,
        rootMargin: '0px 0px 260px 0px',
        threshold: 0,
      }
    );
    state.observer.observe(dom.feedSentinel);
    return;
  }

  if (!state.scrollFallbackBound) {
    state.scrollFallbackBound = true;
    window.addEventListener('scroll', handleAuthorScrollFallback, { passive: true });
  }
}

function handleAuthorScrollFallback() {
  if (state.loading || state.done) return;

  const scrollTop =
    window.pageYOffset ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0;
  const clientHeight =
    document.documentElement.clientHeight || window.innerHeight;
  const scrollHeight =
    document.documentElement.scrollHeight || document.body.scrollHeight;

  if (scrollTop + clientHeight >= scrollHeight - 240) {
    loadMoreAuthorPosts();
  }
}

function getGrowthBadge(level) {
  const n = Number(level) || 1;
  let emoji = '🌰';
  let label = '씨앗';

  if (n >= 26) {
    emoji = '🏛️';
    label = '숲의 수호자';
  } else if (n >= 21) {
    emoji = '🌲';
    label = '큰 나무';
  } else if (n >= 16) {
    emoji = '🌳';
    label = '나무';
  } else if (n >= 11) {
    emoji = '🌿';
    label = '묘목';
  } else if (n >= 6) {
    emoji = '🌱';
    label = '새싹';
  }

  return {
    display: `${emoji} Lv.${n} ${label}`,
    ariaLabel: `레벨 ${n} ${label}`,
  };
}

function updateAuthorProfileActionUI() {
  if (!dom.profileActionBtn) return;

  if (state.followState.isOwnProfile) {
    dom.profileActionBtn.classList.remove('gls-hidden');
    dom.profileActionBtn.textContent = '내 프로필';
  } else {
    dom.profileActionBtn.classList.add('gls-hidden');
  }

  updateAuthorOverflowSafetyUI();
}

function updateAuthorFollowUI() {
  if (!dom.followBtn) return;

  dom.followBtn.classList.remove('gls-btn-primary', 'gls-btn-secondary', 'is-active');
  dom.followBtn.classList.add('gls-btn');
  dom.followBtn.disabled = false;
  dom.followBtn.removeAttribute('aria-pressed');

  if (!state.followState.isLoggedIn) {
    dom.followBtn.textContent = '로그인 후 팔로우';
    dom.followBtn.classList.add('gls-btn-secondary');
    dom.followBtn.disabled = true;
    if (dom.followHint) dom.followHint.textContent = '팔로우하려면 로그인해주세요.';
    return;
  }

  if (state.followState.isOwnProfile) {
    dom.followBtn.textContent = '내 프로필입니다';
    dom.followBtn.classList.add('gls-btn-secondary');
    dom.followBtn.disabled = true;
    if (dom.followHint) dom.followHint.textContent = '내 작가 페이지에서는 팔로우가 비활성화됩니다.';
    return;
  }

  if (state.followState.isFollowing) {
    dom.followBtn.textContent = '팔로잉';
    dom.followBtn.classList.add('gls-btn-primary', 'is-active');
    dom.followBtn.setAttribute('aria-pressed', 'true');
    if (dom.followHint) dom.followHint.textContent = '팔로잉 상태입니다. 다시 누르면 해제됩니다.';
    return;
  }

  dom.followBtn.textContent = '팔로우';
  dom.followBtn.classList.add('gls-btn-secondary');
  dom.followBtn.setAttribute('aria-pressed', 'false');
  if (dom.followHint) dom.followHint.textContent = '팔로우해서 작가의 새 글 소식을 받아보세요.';
}

function updateSortButtonLabel() {
  if (!dom.sortBtn) return;
  const label = AUTHOR_SORT_LABELS[state.sort] || AUTHOR_SORT_LABELS.newest;
  dom.sortBtn.textContent = `정렬: ${label}`;
}

function setAboutTextContent(aboutTextRaw) {
  if (!dom.about || !dom.aboutToggle) return;

  const aboutText = String(aboutTextRaw || '').trim();
  if (!aboutText) {
    dom.about.textContent = '아직 등록된 작가 소개가 없습니다.';
    dom.about.classList.remove('is-hidden', 'is-collapsed');
    dom.aboutToggle.classList.add('is-hidden');
    dom.aboutToggle.setAttribute('aria-expanded', 'true');
    dom.aboutToggle.textContent = '소개 접기';
    return;
  }

  dom.about.textContent = aboutText;
  dom.about.classList.remove('is-hidden');
  syncAuthorAboutCollapseToggle();
}

function syncAuthorAboutCollapseToggle() {
  if (!dom.about || !dom.aboutToggle) return;

  const aboutText = String(dom.about.textContent || '').trim();
  const shouldCollapse = isMobileViewport() && aboutText.length > AUTHOR_ABOUT_COLLAPSE_THRESHOLD;

  if (!shouldCollapse) {
    dom.about.classList.remove('is-collapsed');
    dom.aboutToggle.classList.add('is-hidden');
    dom.aboutToggle.setAttribute('aria-expanded', 'true');
    dom.aboutToggle.textContent = '소개 접기';
    return;
  }

  dom.aboutToggle.classList.remove('is-hidden');

  if (!dom.about.dataset.collapseInitialized) {
    dom.about.classList.add('is-collapsed');
    dom.aboutToggle.setAttribute('aria-expanded', 'false');
    dom.aboutToggle.textContent = '소개 펼치기';
    dom.about.dataset.collapseInitialized = 'true';
    return;
  }

  const isCollapsed = dom.about.classList.contains('is-collapsed');
  dom.aboutToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  dom.aboutToggle.textContent = isCollapsed ? '소개 펼치기' : '소개 접기';
}

function toggleAuthorAboutText() {
  if (!dom.about || !dom.aboutToggle || dom.aboutToggle.classList.contains('is-hidden')) return;

  const nextCollapsed = !dom.about.classList.contains('is-collapsed');
  dom.about.classList.toggle('is-collapsed', nextCollapsed);
  dom.aboutToggle.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
  dom.aboutToggle.textContent = nextCollapsed ? '소개 펼치기' : '소개 접기';
}

function upsertLatestPost(post) {
  if (!post?.id) return;
  if (!state.latestPost) {
    state.latestPost = post;
    return;
  }

  const currentDate = Date.parse(String(state.latestPost.created_at || '')) || 0;
  const nextDate = Date.parse(String(post.created_at || '')) || 0;
  if (nextDate > currentDate) {
    state.latestPost = post;
    return;
  }

  if (nextDate === currentDate && Number(post.id) > Number(state.latestPost.id)) {
    state.latestPost = post;
  }
}

async function loadAuthorProfile(authorId) {
  try {
    const response = await fetch(`/api/users/${authorId}/profile`);
    const data = await parseJsonSafe(response);

    if (!response.ok || !data.ok || !data.user) {
      throw new Error(data.message || '작가 정보를 불러올 수 없습니다.');
    }

    const user = data.user;
    const nickname = (user.nickname || '').trim() || '익명';
    const emailMasked = typeof maskEmail === 'function' ? maskEmail(user.email || '') : user.email || '-';

    state.nickname = nickname;

    if (dom.pageTitle) {
      dom.pageTitle.textContent = `${nickname}님의 글숲`;
    }
    if (dom.heroSubtitle) {
      dom.heroSubtitle.textContent = `${nickname} 작가가 남긴 문장과 공감 기록을 한눈에 살펴보세요.`;
    }
    if (dom.nickname) {
      dom.nickname.textContent = nickname;
    }
    if (dom.avatar) {
      dom.avatar.textContent = nickname.charAt(0) || '🌿';
    }
    if (dom.email) {
      dom.email.textContent = emailMasked || '-';
      dom.email.hidden = !emailMasked;
    }
    if (dom.bio) {
      dom.bio.textContent = (user.bio || '').trim() || '아직 한 줄 소개가 등록되지 않았습니다.';
    }

    setAboutTextContent(user.about || '');

    if (dom.growthBadge) {
      const badge = getGrowthBadge(user.level);
      dom.growthBadge.textContent = badge.display;
      dom.growthBadge.setAttribute('aria-label', badge.ariaLabel);
    }

    if (dom.postCount) dom.postCount.textContent = String(user.post_count || 0);
    if (dom.likeCount) dom.likeCount.textContent = String(user.total_likes || 0);
    if (dom.followerCount) dom.followerCount.textContent = String(user.follower_count || 0);
    if (dom.followingCount) dom.followingCount.textContent = String(user.following_count || 0);

    state.followState = {
      isLoggedIn: Boolean(data.viewer?.is_logged_in),
      isOwnProfile: Boolean(data.viewer?.is_own_profile),
      isFollowing: Boolean(data.viewer?.is_following),
    };

    updateAuthorFollowUI();
    updateAuthorProfileActionUI();

    if (!state.profileViewTracked) {
      trackUxEvent('author_profile_view', {
        author_id: state.authorId,
        source: 'author_page',
        mobile: isMobileViewport(),
      });
      state.profileViewTracked = true;
    }
  } catch (error) {
    console.error(error);
    showUiNotice(error.message || '작가 정보를 불러오는 중 오류가 발생했습니다.', 'error', 2800);
    setFeedState('error');
    throw error;
  }
}

async function handleAuthorFollowToggle() {
  if (!state.authorId) return;
  if (state.followProcessing) return;
  if (!state.followState.isLoggedIn || state.followState.isOwnProfile) return;

  state.followProcessing = true;

  if (dom.followBtn) {
    dom.followBtn.disabled = true;
    dom.followBtn.textContent = '처리 중...';
  }

  const action = state.followState.isFollowing ? 'unfollow' : 'follow';

  try {
    const response = await fetch(`/api/users/${state.authorId}/follow`, {
      method: 'POST',
    });

    if (response.status === 401) {
      if (typeof redirectToLoginWithNext === 'function') {
        redirectToLoginWithNext({
          alertMessage: '로그인 후 이용할 수 있습니다.',
          source: 'author-follow',
        });
      } else {
        window.location.href = '/html/login.html';
      }
      return;
    }

    const data = await parseJsonSafe(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.message || '팔로우 처리 중 문제가 발생했습니다.');
    }

    state.followState.isFollowing = Boolean(data.following);
    if (dom.followerCount) {
      dom.followerCount.textContent = String(data.follower_count ?? 0);
    }

    trackUxEvent('author_follow_click', {
      author_id: state.authorId,
      action,
      source: 'follow_button',
      mobile: isMobileViewport(),
    });

    showUiNotice(
      state.followState.isFollowing ? '팔로우했습니다.' : '팔로우를 해제했습니다.',
      state.followState.isFollowing ? 'success' : 'info',
      1600
    );
  } catch (error) {
    console.error(error);
    showUiNotice(error.message || '팔로우 요청 중 오류가 발생했습니다.', 'error');
  } finally {
    state.followProcessing = false;
    updateAuthorFollowUI();
  }
}

function buildAuthorCardSourcePost(post) {
  const resolvedVariant =
    String(post?.card_length_variant || '').trim().toLowerCase() ||
    detectAuthorCardLengthVariant(post?.content || post?.title || '');
  const nickname = String(state.nickname || '').trim();
  return {
    ...post,
    author_id: post?.author_id || state.authorId || null,
    author_name: post?.author_name || nickname || '작가',
    author_nickname: post?.author_nickname || nickname || '작가',
    card_length_variant: resolvedVariant,
  };
}

function extractPlainAuthorText(rawHtml) {
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

function detectAuthorCardLengthVariant(rawContent) {
  const text = extractPlainAuthorText(rawContent);
  if (!text) return 'short';

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const compactLength = text.replace(/\s+/g, '').length;

  // 긴글/짧은글 분류를 메이슨리 높이 차이에 반영하기 위해 short/medium/long 경계를 조금 더 공격적으로 설정
  if (lines.length <= 1 && compactLength <= 22) return 'one-line';
  if (compactLength <= 80) return 'short';
  if (compactLength <= 150) return 'medium';
  return 'long';
}

function buildAuthorPostCardHtml(post) {
  const sourcePost = buildAuthorCardSourcePost(post);

  if (typeof window.buildStandardPostCardHTML !== 'function') {
    console.error('[author] postCard SSOT is unavailable: buildStandardPostCardHTML');
    return '';
  }

  const html = window.buildStandardPostCardHTML(sourcePost, {
    showMoreButton: true,
    forceRenderedImage: true,
    cardExtraClass: 'author-post-card',
    cardLengthVariant: sourcePost.card_length_variant || '',
    cardClickable: true,
  });

  // 테스트/기존 셀렉터 호환: author-post-title 클래스 유지
  return html.replace(
    'class="card-title gls-mb-2',
    'class="card-title gls-mb-2 author-post-title'
  );
}

function shouldIgnoreAuthorPostOpenTracking(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest(AUTHOR_CARD_NAV_IGNORE_SELECTOR));
}

function bindAuthorPostOpenTracking(card, post) {
  if (!card || !post || card.dataset.authorOpenTrackBound === '1') return;
  card.dataset.authorOpenTrackBound = '1';

  const trackOpen = () => {
    trackUxEvent('author_post_open', {
      author_id: state.authorId,
      post_id: post.id,
      source: 'card',
      mobile: isMobileViewport(),
    });
  };

  card.addEventListener(
    'click',
    (event) => {
      if (shouldIgnoreAuthorPostOpenTracking(event.target)) return;
      trackOpen();
    },
    true
  );

  card.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (shouldIgnoreAuthorPostOpenTracking(event.target)) return;
      trackOpen();
    },
    true
  );
}

function setupAuthorPostInteractions(card, post) {
  if (!card || !post) return;

  if (typeof window.enhanceStandardPostCard !== 'function') {
    console.warn('[author] postCard SSOT is unavailable: enhanceStandardPostCard');
    return;
  }
  window.enhanceStandardPostCard(card, buildAuthorCardSourcePost(post));

  bindAuthorPostOpenTracking(card, post);
}

function renderAuthorPosts(posts) {
  if (!dom.postsList || !Array.isArray(posts) || !posts.length) return;

  const markup = posts
    .map((post) => {
      authorPostCache.set(String(post.id), post);
      upsertLatestPost(post);
      return buildAuthorPostCardHtml(post);
    })
    .join('');

  dom.postsList.insertAdjacentHTML('beforeend', markup);

  posts.forEach((post) => {
    const card = dom.postsList.querySelector(`.author-post-card[data-post-id="${post.id}"]`);
    if (!card) return;
    setupAuthorPostInteractions(card, post);
  });
}

function resetAuthorPosts() {
  state.offset = 0;
  state.done = false;
  state.latestPost = null;
  authorPostCache.clear();

  if (dom.postsList) {
    dom.postsList.innerHTML = '';
  }

  setFeedState('idle');
}

async function loadMoreAuthorPosts() {
  if (!state.authorId) return;
  if (state.loading || state.done) return;

  state.loading = true;
  setFeedState('loading');

  try {
    const params = new URLSearchParams({
      offset: String(state.offset),
      limit: String(AUTHOR_LIMIT),
      sort: state.sort,
    });

    const response = await fetch(`/api/users/${state.authorId}/posts?${params.toString()}`);
    const data = await parseJsonSafe(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.message || '작가 글을 불러오는 중 오류가 발생했습니다.');
    }

    const posts = Array.isArray(data.posts) ? data.posts : [];

    if (state.offset === 0 && posts.length === 0) {
      state.done = true;
      setFeedState('empty');
      return;
    }

    if (posts.length === 0) {
      state.done = true;
      setFeedState('end');
      return;
    }

    renderAuthorPosts(posts);
    state.offset += posts.length;

    if (posts.length < AUTHOR_LIMIT) {
      state.done = true;
      setFeedState('end');
      return;
    }

    setFeedState('idle');
  } catch (error) {
    console.error(error);
    setFeedState('error');
    showUiNotice(error.message || '작가 글을 불러오는 중 오류가 발생했습니다.', 'error');
  } finally {
    state.loading = false;
  }
}

async function fetchLatestAuthorPostFallback() {
  if (!state.authorId) return null;

  try {
    const params = new URLSearchParams({
      offset: '0',
      limit: '1',
      sort: 'newest',
    });

    const response = await fetch(`/api/users/${state.authorId}/posts?${params.toString()}`);
    const data = await parseJsonSafe(response);

    if (!response.ok || !data.ok) {
      return null;
    }

    const first = Array.isArray(data.posts) ? data.posts[0] : null;
    if (first?.id) {
      authorPostCache.set(String(first.id), first);
      upsertLatestPost(first);
      return first;
    }
    return null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function navigateToPostDetail(post, source = 'card') {
  if (!post?.id) return;

  trackUxEvent('author_post_open', {
    author_id: state.authorId,
    post_id: post.id,
    source,
    mobile: isMobileViewport(),
  });

  try {
    const payload = {
      id: post.id,
      title: post.title,
      content: post.content,
      created_at: post.created_at,
      hashtags: post.hashtags,
      category: post.category,
      author_id: post.author_id,
    };
    window.localStorage.setItem('glsoop_lastPost', JSON.stringify(payload));
  } catch (error) {
    console.warn('glsoop_lastPost cache failed', error);
  }

  window.location.href = `/html/post.html?postId=${encodeURIComponent(post.id)}`;
}

async function handleOpenLatestPost() {
  if (!state.authorId) return;

  if (state.latestPost?.id) {
    navigateToPostDetail(state.latestPost, 'latest_cta');
    return;
  }

  if (state.offset === 0 && !state.loading) {
    await loadMoreAuthorPosts();
    if (state.latestPost?.id) {
      navigateToPostDetail(state.latestPost, 'latest_cta');
      return;
    }
  }

  const fallbackPost = await fetchLatestAuthorPostFallback();
  if (fallbackPost?.id) {
    navigateToPostDetail(fallbackPost, 'latest_cta');
    return;
  }

  showUiNotice('아직 바로 읽을 수 있는 최신 글이 없습니다.', 'info', 1800);
}

async function initAuthorPage() {
  cacheAuthorDom();
  bindProfileControls();
  setupAuthorOverflowMenu();
  setupAuthorToolbarActions();
  setupAuthorSortModal();
  setupInfiniteLoadTrigger();

  const params = new URLSearchParams(window.location.search);
  const userId = params.get('userId');

  if (!userId) {
    showUiNotice('잘못된 접근입니다. 작가 정보를 찾을 수 없습니다.', 'error', 2200);
    window.setTimeout(() => {
      window.location.href = '/index.html';
    }, 700);
    return;
  }

  state.authorId = userId;

  setAuthorDataset('authorLayout', 'v2');
  setAuthorDataset('authorOverflowOpen', 'false');
  setFeedState('idle');

  window.addEventListener('resize', syncAuthorAboutCollapseToggle, { passive: true });

  try {
    await loadAuthorProfile(userId);
  } catch (error) {
    return;
  }

  await loadMoreAuthorPosts();
}

document.addEventListener('DOMContentLoaded', () => {
  initAuthorPage();
});
