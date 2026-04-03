// public/js/mypage.js
// 마이페이지 V2 스크립트
// - 기능 계약(API/이벤트/접근성)은 유지
// - 렌더 구조는 대시보드형으로 재작성

let myPostsLoaded = false;
let likedPostsLoaded = false;
let followingsLoaded = false;
let blockedUsersLoaded = false;
let rememberLoginEnabledInitial = false;
let marketingEmailOptInInitial = false;
let mypageSafeAreaGuidesEnabled = false;

function trackUxEvent(eventName, properties = {}, options = {}) {
  if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') {
    return;
  }
  window.glsoopAnalytics.trackEvent(eventName, properties, options);
}

function safeEscape(value) {
  const raw = value == null ? '' : String(value);
  if (typeof escapeHtml === 'function') return escapeHtml(raw);
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '-';
  if (typeof formatKoreanDateTime === 'function') {
    return formatKoreanDateTime(value) || '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stripHtmlToText(html) {
  const raw = String(html || '');
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toExcerpt(content, maxLength = 150) {
  const plain = stripHtmlToText(content);
  if (!plain) return '본문 미리보기가 없습니다.';
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength)}…`;
}

function getDisplayName(user = {}) {
  if (user.nickname && String(user.nickname).trim().length > 0) {
    return String(user.nickname).trim();
  }
  return user.name || '';
}

function getMaskedEmail(email) {
  if (typeof maskEmail === 'function') {
    return maskEmail(email || '');
  }
  const raw = String(email || '').trim();
  const at = raw.indexOf('@');
  if (at <= 1) return raw;
  return `${raw.slice(0, 2)}***${raw.slice(at)}`;
}

function getCategoryLabel(category) {
  if (category === 'poem') return '시';
  if (category === 'essay') return '에세이';
  return '짧은 구절';
}

const TITLE_SAFE_ZONE_BY_LENGTH = {
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

function resolveTitleSafeZone(lengthVariant) {
  const key = String(lengthVariant || '').trim().toLowerCase();
  if (TITLE_SAFE_ZONE_BY_LENGTH[key]) {
    return TITLE_SAFE_ZONE_BY_LENGTH[key];
  }
  return TITLE_SAFE_ZONE_BY_LENGTH.medium;
}

async function setupMypageSafeAreaGuides() {
  const body = document.body;
  if (!body) return;

  try {
    const runtimeConfig = typeof getGlsoopRuntimeConfig === 'function'
      ? await getGlsoopRuntimeConfig()
      : { safe_area_guides: false };
    mypageSafeAreaGuidesEnabled = Boolean(runtimeConfig?.safe_area_guides);
  } catch (error) {
    mypageSafeAreaGuidesEnabled = false;
  }

  body.classList.toggle('gls-safe-area-debug', mypageSafeAreaGuidesEnabled);
}

function injectMypageImageTitle(cardHtml, titleText = '제목 없음') {
  if (typeof document === 'undefined') return cardHtml;

  const template = document.createElement('template');
  template.innerHTML = String(cardHtml || '').trim();

  const cardEl = template.content.querySelector('.gls-post-card');
  if (!cardEl) return cardHtml;

  const imageShell = cardEl.querySelector('.feed-rendered-image-shell');
  if (!imageShell) return cardHtml;
  const safeZone = resolveTitleSafeZone(cardEl.dataset.lengthVariant);

  const titleEl = cardEl.querySelector('.card-title');
  if (titleEl) {
    titleEl.classList.add('mpd-card-title-outside');
    titleEl.setAttribute('aria-hidden', 'true');
  }

  let bodySafeOverlay = null;
  if (mypageSafeAreaGuidesEnabled) {
    bodySafeOverlay = document.createElement('div');
    bodySafeOverlay.className = 'mpd-image-body-safe';
    bodySafeOverlay.style.setProperty('--mpd-safe-body-left', `${safeZone.bodyLeft ?? safeZone.left}%`);
    bodySafeOverlay.style.setProperty('--mpd-safe-body-top', `${safeZone.bodyTop ?? 46.2}%`);
    bodySafeOverlay.style.setProperty('--mpd-safe-body-width', `${safeZone.bodyWidth ?? safeZone.width}%`);
    bodySafeOverlay.style.setProperty('--mpd-safe-body-height', `${safeZone.bodyHeight ?? 41.2}%`);
  }

  const overlay = document.createElement('div');
  overlay.className = 'mpd-image-title';
  overlay.setAttribute('data-title', titleText && String(titleText).trim().length > 0
    ? String(titleText).trim()
    : '제목 없음');
  overlay.style.setProperty('--mpd-safe-left', `${safeZone.left}%`);
  overlay.style.setProperty('--mpd-safe-width', `${safeZone.width}%`);
  overlay.style.setProperty('--mpd-safe-top', `${safeZone.top}%`);
  overlay.style.setProperty('--mpd-safe-title-height', `${safeZone.height}%`);
  overlay.style.setProperty('--mpd-safe-title-align', safeZone.textAlign || 'left');
  overlay.style.setProperty('--mpd-body-font-ratio', String(safeZone.bodyFontRatio || 0.0325));
  overlay.style.setProperty('--mpd-body-line-height', String(safeZone.bodyLineHeight || 1.13));

  const text = document.createElement('span');
  text.className = 'mpd-image-title__text';
  text.textContent = titleText && String(titleText).trim().length > 0
    ? String(titleText).trim()
    : '제목 없음';

  overlay.appendChild(text);
  if (bodySafeOverlay) {
    imageShell.appendChild(bodySafeOverlay);
  }
  imageShell.appendChild(overlay);

  return template.innerHTML;
}

function getCurrentPathWithSearch() {
  return `${window.location.pathname}${window.location.search || ''}`;
}

function buildLoginRedirectUrl(source = 'mypage') {
  const query = new URLSearchParams();
  query.set('next', getCurrentPathWithSearch());
  if (source) query.set('from', source);
  return `/html/login.html?${query.toString()}`;
}

function renderMyPostsEmptyState(postsBox, reason = 'load') {
  if (!postsBox) return;

  trackUxEvent('mypage_my_posts_empty', { reason });

  postsBox.innerHTML = `
    <div class="mpd-empty-state">
      <p class="gls-text-muted gls-mb-2">아직 작성한 글이 없습니다.</p>
      <a
        class="gls-btn gls-btn-primary gls-btn-sm mpd-empty-state__cta"
        href="/html/editor.html"
        id="mypageEmptyCreatePostCta"
      >
        첫 글 쓰러 가기
      </a>
    </div>
  `;

  const emptyCta = document.getElementById('mypageEmptyCreatePostCta');
  if (emptyCta) {
    emptyCta.addEventListener('click', () => {
      trackUxEvent(
        'mypage_empty_state_cta_click',
        {
          target: '/html/editor.html',
          reason,
        },
        { useBeacon: true }
      );
    });
  }
}

function renderFollowingsEmptyState(followingsBox) {
  if (!followingsBox) return;
  followingsBox.innerHTML = '<p class="mpd-empty-note gls-mb-0">아직 팔로잉한 사람이 없습니다.</p>';
}

function renderBlockedUsersEmptyState(blockedUsersBox) {
  if (!blockedUsersBox) return;
  blockedUsersBox.innerHTML = '<p class="mpd-empty-note gls-mb-0">아직 차단한 사용자가 없습니다.</p>';
}

function openUserEditModal(triggerEl = null) {
  const modalEl = document.getElementById('userEditModal');
  if (!modalEl) return;

  if (window.glsModal) {
    window.glsModal.open(modalEl, triggerEl || undefined);
  } else {
    modalEl.classList.add('is-open', 'show', 'is-flex-visible');
    modalEl.removeAttribute('hidden');
    modalEl.setAttribute('aria-hidden', 'false');
  }
}

function closeUserEditModal() {
  const modalEl = document.getElementById('userEditModal');
  if (!modalEl) return;

  if (window.glsModal) {
    window.glsModal.close(modalEl);
  } else {
    modalEl.classList.remove('is-open', 'show', 'is-flex-visible');
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.setAttribute('hidden', 'hidden');
  }
}

function setInlineMessage(targetEl, message = '', tone = '') {
  if (!targetEl) return;
  targetEl.classList.remove('text-danger', 'text-success');
  targetEl.textContent = message;
  if (tone === 'error') targetEl.classList.add('text-danger');
  if (tone === 'success') targetEl.classList.add('text-success');
}

const accountClosureFlowState = {
  step: 1,
  mode: 'deactivate',
};

function openAccountClosureFlow(triggerEl = null) {
  const modalEl = document.getElementById('accountClosureFlowModal');
  if (!modalEl) return;

  resetAccountClosureState();
  closeUserEditModal();

  if (window.glsModal) {
    window.glsModal.open(modalEl, triggerEl || undefined);
  } else {
    modalEl.classList.add('is-open', 'show', 'is-flex-visible');
    modalEl.removeAttribute('hidden');
    modalEl.setAttribute('aria-hidden', 'false');
  }
}

function resetAccountClosureState() {
  const currentPwInput = document.getElementById('accountClosureCurrentPwInput');
  const confirmInput = document.getElementById('accountClosureConfirmInput');
  const messageEl = document.getElementById('accountClosureMessage');
  const backBtn = document.getElementById('accountClosureBackBtn');
  const nextBtn = document.getElementById('accountClosureNextBtn');
  const submitBtn = document.getElementById('accountClosureSubmitBtn');

  accountClosureFlowState.step = 1;
  accountClosureFlowState.mode = 'deactivate';
  if (currentPwInput) currentPwInput.value = '';
  if (confirmInput) confirmInput.value = '';
  if (backBtn) {
    backBtn.disabled = true;
    backBtn.classList.add('gls-hidden');
    backBtn.hidden = true;
  }
  if (nextBtn) {
    nextBtn.disabled = false;
    nextBtn.classList.remove('gls-hidden');
    nextBtn.hidden = false;
    nextBtn.textContent = '계속 진행';
  }
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.dataset.originalText = submitBtn.dataset.originalText || submitBtn.textContent;
    submitBtn.textContent = submitBtn.dataset.originalText;
    submitBtn.classList.add('gls-hidden');
    submitBtn.hidden = true;
  }
  setInlineMessage(messageEl, '', '');
  syncAccountClosureFlow();
}

function syncAccountClosureSelection() {
  document.querySelectorAll('.mpd-account-choice[data-mode]').forEach((choiceEl) => {
    const isSelected = choiceEl.getAttribute('data-mode') === accountClosureFlowState.mode;
    choiceEl.classList.toggle('is-selected', isSelected);
    choiceEl.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

function syncAccountClosureFlow() {
  const choiceStepEl = document.getElementById('accountClosureChoiceStep');
  const confirmStepEl = document.getElementById('accountClosureConfirmStep');
  const backBtn = document.getElementById('accountClosureBackBtn');
  const nextBtn = document.getElementById('accountClosureNextBtn');
  const submitBtn = document.getElementById('accountClosureSubmitBtn');
  const reviewTitleEl = document.getElementById('accountClosureReviewTitle');
  const reviewDescriptionEl = document.getElementById('accountClosureReviewDescription');

  const isConfirmStep = accountClosureFlowState.step === 2;
  if (choiceStepEl) {
    choiceStepEl.classList.toggle('gls-hidden', isConfirmStep);
    choiceStepEl.hidden = isConfirmStep;
  }
  if (confirmStepEl) {
    confirmStepEl.classList.toggle('gls-hidden', !isConfirmStep);
    confirmStepEl.hidden = !isConfirmStep;
  }
  if (backBtn) {
    backBtn.disabled = !isConfirmStep;
    backBtn.classList.toggle('gls-hidden', !isConfirmStep);
    backBtn.hidden = !isConfirmStep;
  }
  if (nextBtn) {
    nextBtn.classList.toggle('gls-hidden', isConfirmStep);
    nextBtn.hidden = isConfirmStep;
  }
  if (submitBtn) {
    submitBtn.classList.toggle('gls-hidden', !isConfirmStep);
    submitBtn.hidden = !isConfirmStep;
  }

  const isDeleteMode = accountClosureFlowState.mode === 'delete';
  if (reviewTitleEl) {
    reviewTitleEl.textContent = isDeleteMode ? '즉시 완전 삭제' : '30일 비활성화';
  }
  if (reviewDescriptionEl) {
    reviewDescriptionEl.textContent = isDeleteMode
      ? '계정과 작성글, 관련 데이터가 즉시 삭제되며 되돌릴 수 없습니다.'
      : '로그인과 프로필 공개가 중단되고, 작성글은 익명으로 유지됩니다. 30일 안에 다시 로그인하면 복구됩니다.';
  }

  syncAccountClosureSelection();
}

function selectAccountClosureMode(mode) {
  accountClosureFlowState.mode = mode === 'delete' ? 'delete' : 'deactivate';
  syncAccountClosureFlow();
}

function goToAccountClosureStep(step) {
  accountClosureFlowState.step = step === 2 ? 2 : 1;
  syncAccountClosureFlow();

  if (accountClosureFlowState.step === 2) {
    const currentPwInput = document.getElementById('accountClosureCurrentPwInput');
    if (currentPwInput) currentPwInput.focus();
  }
}

async function submitAccountClosure() {
  const currentPwInput = document.getElementById('accountClosureCurrentPwInput');
  const confirmInput = document.getElementById('accountClosureConfirmInput');
  const submitBtn = document.getElementById('accountClosureSubmitBtn');
  const messageEl = document.getElementById('accountClosureMessage');
  const mode = accountClosureFlowState.mode === 'delete' ? 'delete' : 'deactivate';
  const currentPw = currentPwInput ? currentPwInput.value : '';
  const confirmText = confirmInput ? confirmInput.value.trim() : '';
  const submitBtnLabel = mode === 'delete' ? '삭제 진행 중...' : '비활성화 진행 중...';

  if (!currentPw) {
    setInlineMessage(messageEl, '현재 비밀번호를 입력해주세요.', 'error');
    currentPwInput && currentPwInput.focus();
    return;
  }

  if (confirmText.toUpperCase() !== 'DELETE') {
    setInlineMessage(messageEl, '확인 문구 DELETE를 정확히 입력해주세요.', 'error');
    confirmInput && confirmInput.focus();
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.dataset.originalText || submitBtn.textContent;
    submitBtn.textContent = submitBtnLabel;
  }
  setInlineMessage(messageEl, '', '');

  try {
    const res = await fetch('/api/me/account-closure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        currentPw,
        confirmText,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      setInlineMessage(
        messageEl,
        (data && data.message) || '계정 정리 처리 중 오류가 발생했습니다.',
        'error'
      );
      return;
    }

    setInlineMessage(
      messageEl,
      data.message || (mode === 'delete'
        ? '회원 탈퇴가 완료되었습니다.'
        : '계정이 비활성화되었습니다. 30일 안에 다시 로그인하면 복구됩니다.'),
      'success'
    );

    if (currentPwInput) currentPwInput.value = '';
    if (confirmInput) confirmInput.value = '';

    setTimeout(() => {
      window.location.href = `/html/login.html?from=account-closure&mode=${encodeURIComponent(mode)}`;
    }, 900);
  } catch (error) {
    console.error(error);
    setInlineMessage(messageEl, '계정 정리 처리 중 오류가 발생했습니다.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.originalText || '계정 정리 실행';
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await setupMypageSafeAreaGuides();
  setupMyPageTabs();
  setupMyPostCardEvents();
  setupLikedPostCardEvents();
  setupFollowingListEvents();
  setupBlockedUsersListEvents();
  setupUserEditForm();
  loadMyPage();
});

async function loadMyPage() {
  const userInfoBox = document.getElementById('userInfo');
  const myPostsBox = document.getElementById('myPosts');
  const likedBox = document.getElementById('likedPosts');

  if (!userInfoBox || !myPostsBox || !likedBox) {
    console.error('userInfo, myPosts, likedPosts 요소를 찾을 수 없습니다.');
    return;
  }

  try {
    const meRes = await fetch('/api/me', { cache: 'no-store' });

    if (!meRes.ok) {
      userInfoBox.innerHTML = '<p class="text-danger gls-mb-0">로그인이 필요합니다. 로그인 페이지로 이동합니다.</p>';
      myPostsBox.innerHTML = '';
      likedBox.innerHTML = '';
      setTimeout(() => {
        window.location.href = buildLoginRedirectUrl('mypage');
      }, 1500);
      return;
    }

    const meData = await meRes.json().catch(() => ({}));

    if (!meData.ok) {
      userInfoBox.innerHTML = '<p class="text-danger gls-mb-0">로그인이 필요합니다. 로그인 페이지로 이동합니다.</p>';
      myPostsBox.innerHTML = '';
      likedBox.innerHTML = '';
      setTimeout(() => {
        window.location.href = buildLoginRedirectUrl('mypage');
      }, 1500);
      return;
    }

    const displayName = getDisplayName({
      nickname: meData.nickname,
      name: meData.name,
    });
    const followerCount = Number(meData.follower_count) || 0;
    const followingCount = Number(meData.following_count) || 0;

    trackUxEvent('mypage_view', {
      follower_count: followerCount,
      following_count: followingCount,
    });

    const bioHtml = meData.bio
      ? `<p class="mpd-profile-bio">${safeEscape(meData.bio)}</p>`
      : '';

    const aboutHtml = meData.about
      ? `<p class="mpd-profile-about mypage-preserve-lines">${safeEscape(meData.about)}</p>`
      : '';

    userInfoBox.innerHTML = `
      <div class="mpd-profile-shell">
        <div class="mpd-profile-main">
          <p class="mpd-profile-eyebrow gls-mb-1">내 계정</p>
          <h3 class="mpd-profile-name gls-mb-1">${safeEscape(displayName)}님</h3>
          <p class="mpd-profile-email gls-mb-0">${safeEscape(meData.email)}</p>
          ${bioHtml}
          ${aboutHtml}
        </div>

        <div class="mpd-profile-stats" role="group" aria-label="팔로우 통계">
          <div class="mpd-stat-item">
            <span class="mpd-stat-label">팔로워</span>
            <strong id="mypageFollowerCount">${followerCount}</strong>
          </div>
          <div class="mpd-stat-item">
            <span class="mpd-stat-label">팔로잉</span>
            <strong id="mypageFollowingCount">${followingCount}</strong>
          </div>
        </div>

        <div class="mpd-profile-actions">
          <button
            type="button"
            class="gls-btn gls-btn-ghost gls-btn-sm mpd-profile-edit-btn"
            data-gls-toggle="modal"
            data-gls-target="#userEditModal"
          >
            내 정보 수정
          </button>
        </div>
      </div>
    `;

    const editBtn = userInfoBox.querySelector('[data-gls-target="#userEditModal"]');
    if (editBtn && !editBtn.dataset.glsModalBound) {
      editBtn.dataset.glsModalBound = '1';
      editBtn.addEventListener('click', (event) => {
        event.preventDefault();
        resetAccountClosureState();
        openUserEditModal(editBtn);
        loadMySessionsPanel();
      });
    }

    const nicknameInput = document.getElementById('nicknameInput');
    const bioInput = document.getElementById('bioInput');
    const aboutInput = document.getElementById('aboutInput');
    const rememberLoginEnabledInput = document.getElementById('rememberLoginEnabledInput');
    const marketingEmailOptInInput = document.getElementById('marketingEmailOptInInput');

    if (nicknameInput) nicknameInput.value = meData.nickname || '';
    if (bioInput) bioInput.value = meData.bio || '';
    if (aboutInput) aboutInput.value = meData.about || '';
    if (rememberLoginEnabledInput) {
      const rememberEnabled = Boolean(meData.remember_login_enabled);
      rememberLoginEnabledInput.checked = rememberEnabled;
      rememberLoginEnabledInitial = rememberEnabled;
    }
    if (marketingEmailOptInInput) {
      const marketingOptIn = Boolean(meData.marketing_email_opt_in);
      marketingEmailOptInInput.checked = marketingOptIn;
      marketingEmailOptInInitial = marketingOptIn;
    }

    await loadGrowthMiniWidget();
    await loadMySessionsPanel();
    await loadMyPosts();
  } catch (error) {
    console.error(error);
    userInfoBox.innerHTML = '<p class="text-danger gls-mb-0">마이페이지를 불러오는 중 오류가 발생했습니다.</p>';
    myPostsBox.innerHTML = '<p class="text-danger">글 목록을 불러오는 중 오류가 발생했습니다.</p>';
    likedBox.innerHTML = '<p class="text-danger">공감한 글을 불러오는 중 오류가 발생했습니다.</p>';
  }
}

async function loadGrowthMiniWidget() {
  const widget = document.getElementById('mypageGrowthMini');
  const summaryText = document.querySelector('.mypage-growth-summary-text');
  if (!widget || !summaryText) return;

  try {
    const res = await fetch('/api/growth/summary', { cache: 'no-store' });
    if (!res.ok) throw new Error('growth summary failed');

    const data = await res.json().catch(() => ({}));
    if (!data.ok || !data.summary) throw new Error('growth summary invalid');

    const {
      level = 0,
      today_xp = 0,
      streak_days = 0,
      current_xp = 0,
      next_level_xp = 0,
      title = '성장',
    } = data.summary;

    summaryText.textContent = `Lv.${level} ${title} · ${current_xp} / ${next_level_xp} XP · 오늘 +${today_xp} XP · 연속 ${streak_days}일 글쓰기`;
    widget.classList.remove('gls-hidden');
  } catch (error) {
    console.error(error);
    summaryText.textContent = '성장 정보를 불러오지 못했습니다.';
    widget.classList.remove('gls-hidden');
  }
}

async function loadMySessionsPanel() {
  const sessionsListEl = document.getElementById('mySessionsList');
  const sessionsMsgEl = document.getElementById('mySessionsMessage');
  if (!sessionsListEl) return;

  sessionsListEl.innerHTML = '<p class="gls-text-muted gls-mb-0">세션 정보를 불러오는 중입니다...</p>';
  if (sessionsMsgEl) {
    sessionsMsgEl.textContent = '';
    sessionsMsgEl.classList.remove('text-danger', 'text-success');
  }

  try {
    const res = await fetch('/api/me/sessions', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok || !Array.isArray(data.sessions)) {
      const message = (data && data.message) || '세션 정보를 불러오지 못했습니다.';
      sessionsListEl.innerHTML = `<p class="text-danger gls-mb-0">${safeEscape(message)}</p>`;
      return;
    }

    if (data.sessions.length === 0) {
      sessionsListEl.innerHTML = '<p class="gls-text-muted gls-mb-0">활성 세션이 없습니다.</p>';
      return;
    }

    sessionsListEl.innerHTML = `
      <div class="mpd-session-list">
        ${data.sessions
          .map((session) => {
            const createdAt = formatDateTime(session.created_at);
            const lastSeenAt = formatDateTime(session.last_seen_at);
            const expiresAt = formatDateTime(session.expires_at);
            const rememberText = session.remember_me ? '자동 로그인 30일' : '기본 세션 2시간';
            const currentBadge = session.current
              ? '<span class="pill gls-text-xxs">현재 기기</span>'
              : '<span class="pill gls-text-xxs">다른 기기</span>';
            const ipHint = session.ip_hint ? safeEscape(session.ip_hint) : '-';
            const userAgent = safeEscape(session.user_agent || '알 수 없는 기기');

            return `
              <article class="mpd-session-item">
                <div class="mpd-session-item__head">
                  <strong>${userAgent}</strong>
                  ${currentBadge}
                </div>
                <div class="mpd-session-item__meta">
                  <div>생성: ${safeEscape(createdAt || '-')}</div>
                  <div>최근 활동: ${safeEscape(lastSeenAt || '-')}</div>
                  <div>만료: ${safeEscape(expiresAt || '-')}</div>
                  <div>${safeEscape(rememberText)} · ${ipHint}</div>
                </div>
              </article>
            `;
          })
          .join('')}
      </div>
    `;
  } catch (error) {
    console.error(error);
    sessionsListEl.innerHTML = '<p class="text-danger gls-mb-0">세션 정보를 불러오는 중 오류가 발생했습니다.</p>';
  }
}

async function logoutAllSessions() {
  const sessionsMsgEl = document.getElementById('mySessionsMessage');
  const logoutAllBtn = document.getElementById('logoutAllSessionsBtn');

  if (logoutAllBtn) {
    logoutAllBtn.disabled = true;
    logoutAllBtn.dataset.originalText = logoutAllBtn.dataset.originalText || logoutAllBtn.textContent;
    logoutAllBtn.textContent = '처리 중...';
  }

  if (sessionsMsgEl) {
    sessionsMsgEl.textContent = '';
    sessionsMsgEl.classList.remove('text-danger', 'text-success');
  }

  try {
    const res = await fetch('/api/logout-all', { method: 'POST' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      const message = (data && data.message) || '전체 로그아웃 처리 중 오류가 발생했습니다.';
      if (sessionsMsgEl) {
        sessionsMsgEl.textContent = message;
        sessionsMsgEl.classList.add('text-danger');
      }
      return;
    }

    if (sessionsMsgEl) {
      sessionsMsgEl.textContent = data.message || '모든 기기에서 로그아웃되었습니다.';
      sessionsMsgEl.classList.add('text-success');
    }

    setTimeout(() => {
      window.location.href = '/html/login.html?from=logout-all';
    }, 700);
  } catch (error) {
    console.error(error);
    if (sessionsMsgEl) {
      sessionsMsgEl.textContent = '전체 로그아웃 처리 중 오류가 발생했습니다.';
      sessionsMsgEl.classList.add('text-danger');
    }
  } finally {
    if (logoutAllBtn) {
      logoutAllBtn.disabled = false;
      logoutAllBtn.textContent = logoutAllBtn.dataset.originalText || '모든 기기 로그아웃';
    }
  }
}

function setupMyPageTabs() {
  const tabMy = document.getElementById('tabMyPosts');
  const tabLiked = document.getElementById('tabLikedPosts');
  const tabFollowings = document.getElementById('tabFollowings');
  const tabBlockedUsers = document.getElementById('tabBlockedUsers');
  const tabBookmarks = document.getElementById('tabBookmarks');

  const mySection = document.getElementById('myPostsSection');
  const likedSection = document.getElementById('likedPostsSection');
  const followingsSection = document.getElementById('followingsSection');
  const blockedUsersSection = document.getElementById('blockedUsersSection');

  if (
    !tabMy ||
    !tabLiked ||
    !tabFollowings ||
    !tabBlockedUsers ||
    !mySection ||
    !likedSection ||
    !followingsSection ||
    !blockedUsersSection
  ) {
    return;
  }

  const tabConfigs = [
    { tab: tabMy, panel: mySection, panelId: 'myPostsSection' },
    { tab: tabLiked, panel: likedSection, panelId: 'likedPostsSection' },
    { tab: tabFollowings, panel: followingsSection, panelId: 'followingsSection' },
    { tab: tabBlockedUsers, panel: blockedUsersSection, panelId: 'blockedUsersSection' },
  ];

  tabConfigs.forEach(({ tab, panel, panelId }, index) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panelId);
    tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    tab.setAttribute('tabindex', index === 0 ? '0' : '-1');
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = index === 0 ? 0 : -1;
  });

  const tabOrder = [tabMy, tabLiked, tabFollowings, tabBlockedUsers];
  tabOrder.forEach((tab, index) => {
    tab.addEventListener('keydown', (event) => {
      let nextIndex = null;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabOrder.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabOrder.length) % tabOrder.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabOrder.length - 1;
      if (nextIndex === null) return;

      event.preventDefault();
      const nextTab = tabOrder[nextIndex];
      if (!nextTab) return;
      nextTab.focus();
      nextTab.click();
    });
  });

  tabMy.addEventListener('click', async () => {
    switchMyPageTab('my');
    if (!myPostsLoaded) {
      await loadMyPosts();
    }
  });

  tabLiked.addEventListener('click', async () => {
    switchMyPageTab('liked');
    if (!likedPostsLoaded) {
      await loadLikedPosts();
    }
  });

  tabFollowings.addEventListener('click', async () => {
    switchMyPageTab('followings');
    if (!followingsLoaded) {
      await loadMyFollowings();
    }
  });

  tabBlockedUsers.addEventListener('click', async () => {
    switchMyPageTab('blocked');
    if (!blockedUsersLoaded) {
      await loadBlockedUsers();
    }
  });

  if (tabBookmarks && !tabBookmarks.dataset.bound) {
    tabBookmarks.dataset.bound = '1';
    tabBookmarks.addEventListener('click', (event) => {
      event.preventDefault();
      window.location.href = '/html/bookmarks.html';
    });
  }

  switchMyPageTab('my');
}

function switchMyPageTab(target) {
  const tabMy = document.getElementById('tabMyPosts');
  const tabLiked = document.getElementById('tabLikedPosts');
  const tabFollowings = document.getElementById('tabFollowings');
  const tabBlockedUsers = document.getElementById('tabBlockedUsers');
  const tabBookmarks = document.getElementById('tabBookmarks');

  const mySection = document.getElementById('myPostsSection');
  const likedSection = document.getElementById('likedPostsSection');
  const followingsSection = document.getElementById('followingsSection');
  const blockedUsersSection = document.getElementById('blockedUsersSection');

  if (
    !tabMy ||
    !tabLiked ||
    !tabFollowings ||
    !tabBlockedUsers ||
    !mySection ||
    !likedSection ||
    !followingsSection ||
    !blockedUsersSection
  ) {
    return;
  }

  const isMyTab = target === 'my';
  const isLikedTab = target === 'liked';
  const isFollowingsTab = target === 'followings';
  const isBlockedTab = target === 'blocked';

  const syncTabState = (tabEl, sectionEl, isActive) => {
    tabEl.classList.toggle('is-active', isActive);
    tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tabEl.setAttribute('tabindex', isActive ? '0' : '-1');

    sectionEl.classList.toggle('gls-hidden', !isActive);
    sectionEl.hidden = !isActive;
    sectionEl.tabIndex = isActive ? 0 : -1;
  };

  syncTabState(tabMy, mySection, isMyTab);
  syncTabState(tabLiked, likedSection, isLikedTab);
  syncTabState(tabFollowings, followingsSection, isFollowingsTab);
  syncTabState(tabBlockedUsers, blockedUsersSection, isBlockedTab);

  if (tabBookmarks) {
    tabBookmarks.classList.remove('is-active');
  }
}

function renderPostCard(post, options = {}) {
  const { editable = false } = options;

  const postId = post && post.id != null ? String(post.id) : '';
  const dateText = safeEscape(formatDateTime(post && post.created_at));
  const categoryLabel = getCategoryLabel(post && post.category);
  if (typeof buildStandardPostCardHTML !== 'function') {
    console.error('[mypage] postCard SSOT is unavailable: buildStandardPostCardHTML');
    return '';
  }
  const cardHtml = buildStandardPostCardHTML(post, {
    showMoreButton: false,
    contentExpanded: true,
    showEngagementActions: false,
    cardClickable: false,
  });

  const actionsHtml = editable
    ? `
      <div class="mpd-post-actions" data-card-stop-nav="1">
        <button type="button" class="gls-btn gls-btn-secondary gls-btn-xs edit-post-btn">수정</button>
        <button type="button" class="gls-btn gls-btn-danger gls-btn-xs delete-post-btn">삭제</button>
      </div>
    `
    : `
      <a
        class="gls-btn gls-btn-secondary gls-btn-xs"
        href="/html/post.html?postId=${encodeURIComponent(postId)}"
        data-card-stop-nav="1"
      >
        상세 보기
      </a>
    `;

  return `
    <article class="mpd-post-card mypage-post-card" data-post-id="${safeEscape(postId)}">
      <div class="mpd-post-canvas">
        ${cardHtml}
      </div>
      <div class="mpd-post-foot">
        <span class="mpd-post-foot-meta">${dateText} · ${safeEscape(categoryLabel)}</span>
        ${actionsHtml}
      </div>
    </article>
  `;
}

function enhanceRenderedPostCards(container, posts) {
  if (!container || !Array.isArray(posts)) return;
  if (typeof enhanceStandardPostCard !== 'function') return;

  const postById = new Map(
    posts.map((post) => [String(post && post.id != null ? post.id : ''), post])
  );

  container.querySelectorAll('.mypage-post-card').forEach((wrapper) => {
    const postId = wrapper.getAttribute('data-post-id') || '';
    const post = postById.get(postId);
    if (!post) return;

    const cardEl = wrapper.querySelector('.gls-post-card');
    if (!cardEl) return;
    enhanceStandardPostCard(cardEl, post);
  });
}

function renderFollowingCard(user) {
  const userId = user && user.id != null ? String(user.id) : '';
  const displayName = getDisplayName(user);
  const maskedEmail = getMaskedEmail((user && user.email) || '');
  const bioHtml = user && user.bio
    ? `<p class="mpd-following-bio">${safeEscape(user.bio)}</p>`
    : '';
  const aboutHtml = user && user.about
    ? `<p class="mpd-following-about mypage-preserve-lines">${safeEscape(user.about)}</p>`
    : '';

  return `
    <article class="mpd-following-card mypage-following-card" data-user-id="${safeEscape(userId)}">
      <div class="mpd-following-main">
        <h6 class="gls-mb-1">${safeEscape(displayName)}</h6>
        <p class="mpd-following-email">${safeEscape(maskedEmail)}</p>
        ${bioHtml}
        ${aboutHtml}
        <p class="mpd-following-meta gls-mb-0">팔로워 ${Number((user && user.follower_count) || 0)}</p>
      </div>
      <div class="mpd-following-actions">
        <a
          class="gls-btn gls-btn-secondary gls-btn-xs"
          href="/html/author.html?userId=${encodeURIComponent(userId)}"
          data-card-stop-nav="1"
        >
          프로필 보기
        </a>
        <button
          type="button"
          class="gls-btn gls-btn-danger gls-btn-xs unfollow-btn"
          data-user-id="${safeEscape(userId)}"
        >
          언팔로우
        </button>
      </div>
    </article>
  `;
}

function renderBlockedUserCard(block) {
  const userId = block && block.user_id != null ? String(block.user_id) : '';
  const displayName = String(block?.display_name || block?.nickname || '알 수 없는 사용자').trim();
  const nickname =
    typeof block?.nickname === 'string' && block.nickname.trim().length > 0
      ? block.nickname.trim()
      : '';
  const createdAtText = formatDateTime(block?.created_at);
  const nicknameHtml =
    nickname && nickname !== displayName
      ? `<p class="mpd-blocked-nickname">@${safeEscape(nickname)}</p>`
      : '';

  return `
    <article class="mpd-blocked-card mypage-blocked-card" data-user-id="${safeEscape(userId)}">
      <div class="mpd-blocked-main">
        <h6 class="gls-mb-1">${safeEscape(displayName || '알 수 없는 사용자')}</h6>
        ${nicknameHtml}
        <p class="mpd-blocked-meta gls-mb-0">차단한 시각 · ${safeEscape(createdAtText)}</p>
        <p class="mpd-blocked-note gls-mb-0">차단을 해제하면 이 사용자의 글과 프로필이 다시 보일 수 있습니다.</p>
      </div>
      <div class="mpd-blocked-actions">
        <button
          type="button"
          class="gls-btn gls-btn-secondary gls-btn-xs unblock-user-btn"
          data-user-id="${safeEscape(userId)}"
        >
          차단 해제
        </button>
      </div>
    </article>
  `;
}

async function loadMyPosts() {
  const postsBox = document.getElementById('myPosts');
  if (!postsBox) return;

  postsBox.innerHTML = '<p class="gls-text-muted">글 목록을 불러오는 중입니다...</p>';

  try {
    const postsRes = await fetch('/api/posts/my', { cache: 'no-store' });
    if (!postsRes.ok) {
      postsBox.innerHTML = '<p class="text-danger">글 목록을 불러오는 중 오류가 발생했습니다.</p>';
      return;
    }

    const postsData = await postsRes.json().catch(() => ({}));
    if (!postsData.ok) {
      postsBox.innerHTML = `<p class="text-danger">${safeEscape(postsData.message || '글 목록을 불러오지 못했습니다.')}</p>`;
      return;
    }

    const posts = Array.isArray(postsData.posts) ? postsData.posts : [];
    if (!posts.length) {
      renderMyPostsEmptyState(postsBox, 'load');
      myPostsLoaded = true;
      return;
    }

    postsBox.innerHTML = `
      <div class="mpd-post-list">
        ${posts.map((post) => renderPostCard(post, { editable: true })).join('')}
      </div>
    `;
    enhanceRenderedPostCards(postsBox, posts);
    myPostsLoaded = true;
  } catch (error) {
    console.error(error);
    postsBox.innerHTML = '<p class="text-danger">글 목록을 불러오는 중 오류가 발생했습니다.</p>';
  }
}

async function loadLikedPosts() {
  const likedBox = document.getElementById('likedPosts');
  if (!likedBox) return;

  likedBox.innerHTML = '<p class="gls-text-muted">공감한 글을 불러오는 중입니다...</p>';

  try {
    const likedRes = await fetch('/api/posts/liked', { cache: 'no-store' });
    if (!likedRes.ok) {
      likedBox.innerHTML = '<p class="text-danger">공감한 글을 불러오는 중 오류가 발생했습니다.</p>';
      return;
    }

    const likedData = await likedRes.json().catch(() => ({}));
    if (!likedData.ok) {
      likedBox.innerHTML = `<p class="text-danger">${safeEscape(likedData.message || '공감한 글을 불러오지 못했습니다.')}</p>`;
      return;
    }

    const likedPosts = Array.isArray(likedData.posts) ? likedData.posts : [];
    if (!likedPosts.length) {
      likedBox.innerHTML = '<p class="mpd-empty-note gls-mb-0">아직 공감한 글이 없습니다.</p>';
      likedPostsLoaded = true;
      return;
    }

    likedBox.innerHTML = `
      <div class="mpd-post-list">
        ${likedPosts.map((post) => renderPostCard(post, { editable: false })).join('')}
      </div>
    `;
    enhanceRenderedPostCards(likedBox, likedPosts);
    likedPostsLoaded = true;
  } catch (error) {
    console.error(error);
    likedBox.innerHTML = '<p class="text-danger">공감한 글을 불러오는 중 오류가 발생했습니다.</p>';
  }
}

async function loadMyFollowings() {
  const followingsBox = document.getElementById('followingsList');
  if (!followingsBox) return;

  followingsBox.innerHTML = '<p class="gls-text-muted">팔로잉 목록을 불러오는 중입니다...</p>';

  try {
    const res = await fetch('/api/me/followings', { cache: 'no-store' });
    if (!res.ok) {
      followingsBox.innerHTML = '<p class="text-danger">팔로잉 목록을 불러오는 중 오류가 발생했습니다.</p>';
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      followingsBox.innerHTML = `<p class="text-danger">${safeEscape(data.message || '팔로잉 목록을 불러오지 못했습니다.')}</p>`;
      return;
    }

    const followings = Array.isArray(data.followings) ? data.followings : [];
    if (!followings.length) {
      renderFollowingsEmptyState(followingsBox);
      followingsLoaded = true;
      return;
    }

    followingsBox.innerHTML = `
      <div class="mpd-following-list">
        ${followings.map((user) => renderFollowingCard(user)).join('')}
      </div>
    `;
    followingsLoaded = true;
  } catch (error) {
    console.error(error);
    followingsBox.innerHTML = '<p class="text-danger">팔로잉 목록을 불러오는 중 오류가 발생했습니다.</p>';
  }
}

async function loadBlockedUsers() {
  const blockedUsersBox = document.getElementById('blockedUsersList');
  if (!blockedUsersBox) return;

  blockedUsersBox.innerHTML = '<p class="gls-text-muted">차단 목록을 불러오는 중입니다...</p>';

  try {
    const res = await fetch('/api/me/blocks', { cache: 'no-store' });
    if (!res.ok) {
      blockedUsersBox.innerHTML = '<p class="text-danger">차단 목록을 불러오는 중 오류가 발생했습니다.</p>';
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      blockedUsersBox.innerHTML = `<p class="text-danger">${safeEscape(data.message || '차단 목록을 불러오지 못했습니다.')}</p>`;
      return;
    }

    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    if (!blocks.length) {
      renderBlockedUsersEmptyState(blockedUsersBox);
      blockedUsersLoaded = true;
      return;
    }

    blockedUsersBox.innerHTML = `
      <div class="mpd-blocked-list">
        ${blocks.map((block) => renderBlockedUserCard(block)).join('')}
      </div>
    `;
    blockedUsersLoaded = true;
  } catch (error) {
    console.error(error);
    blockedUsersBox.innerHTML = '<p class="text-danger">차단 목록을 불러오는 중 오류가 발생했습니다.</p>';
  }
}

function setupMyPostCardEvents() {
  const postsBox = document.getElementById('myPosts');
  if (!postsBox || postsBox.dataset.bound === '1') return;

  postsBox.dataset.bound = '1';
  postsBox.addEventListener('click', async (event) => {
    const target = event.target;
    const card = target.closest('.mypage-post-card');
    if (!card) return;

    const postId = card.getAttribute('data-post-id');
    if (!postId) return;

    if (target.closest('.delete-post-btn')) {
      const ok = confirm('정말 이 글을 삭제하시겠습니까?');
      if (!ok) return;

      try {
        const delRes = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
        const delData = await delRes.json().catch(() => ({}));
        if (!delRes.ok || !delData.ok) {
          alert(delData.message || '글 삭제에 실패했습니다.');
          return;
        }

        card.remove();
        if (!postsBox.querySelector('.mypage-post-card')) {
          renderMyPostsEmptyState(postsBox, 'after_delete');
        }
      } catch (error) {
        console.error(error);
        alert('글 삭제 중 오류가 발생했습니다.');
      }
      return;
    }

    if (target.closest('.edit-post-btn')) {
      window.location.href = `/html/editor.html?postId=${postId}`;
      return;
    }

    if (target.closest('a, button, input, textarea, select, label, [role="button"], [data-card-stop-nav="1"]')) {
      return;
    }

    window.location.href = `/html/post.html?postId=${encodeURIComponent(postId)}`;
  });
}

function setupLikedPostCardEvents() {
  const likedBox = document.getElementById('likedPosts');
  if (!likedBox || likedBox.dataset.bound === '1') return;

  likedBox.dataset.bound = '1';
  likedBox.addEventListener('click', (event) => {
    const target = event.target;
    const card = target.closest('.mypage-post-card');
    if (!card) return;

    if (target.closest('a, button, input, textarea, select, label, [role="button"], [data-card-stop-nav="1"]')) {
      return;
    }

    const postId = card.getAttribute('data-post-id');
    if (!postId) return;
    window.location.href = `/html/post.html?postId=${encodeURIComponent(postId)}`;
  });
}

function setupFollowingListEvents() {
  const followingsBox = document.getElementById('followingsList');
  if (!followingsBox || followingsBox.dataset.bound === '1') return;

  followingsBox.dataset.bound = '1';
  followingsBox.addEventListener('click', async (event) => {
    const target = event.target;
    const actionBtn = target.closest('.unfollow-btn');
    if (!actionBtn) return;

    const userId = actionBtn.getAttribute('data-user-id');
    if (!userId) return;

    if (!confirm('이 사용자를 언팔로우하시겠어요?')) {
      return;
    }

    const originalText = actionBtn.textContent;
    actionBtn.disabled = true;
    actionBtn.textContent = '처리 중...';

    try {
      const res = await fetch(`/api/users/${userId}/follow`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        alert(data.message || '언팔로우 중 오류가 발생했습니다.');
        actionBtn.disabled = false;
        actionBtn.textContent = originalText;
        return;
      }

      const stillFollowing = !!data.following;
      const followingCountEl = document.getElementById('mypageFollowingCount');

      if (!stillFollowing) {
        const card = actionBtn.closest('.mypage-following-card');
        if (card) card.remove();

        if (followingCountEl) {
          const current = Number(followingCountEl.textContent) || 0;
          followingCountEl.textContent = String(Math.max(current - 1, 0));
        }

        if (!followingsBox.querySelector('.mypage-following-card')) {
          renderFollowingsEmptyState(followingsBox);
        }
      } else {
        actionBtn.disabled = false;
        actionBtn.textContent = originalText;
      }
    } catch (error) {
      console.error(error);
      alert('언팔로우 처리 중 오류가 발생했습니다.');
      actionBtn.disabled = false;
      actionBtn.textContent = originalText;
    }
  });
}

function setupBlockedUsersListEvents() {
  const blockedUsersBox = document.getElementById('blockedUsersList');
  if (!blockedUsersBox || blockedUsersBox.dataset.bound === '1') return;

  blockedUsersBox.dataset.bound = '1';
  blockedUsersBox.addEventListener('click', async (event) => {
    const target = event.target;
    const actionBtn = target.closest('.unblock-user-btn');
    if (!actionBtn) return;

    const userId = actionBtn.getAttribute('data-user-id');
    if (!userId) return;

    if (!confirm('이 사용자의 차단을 해제하시겠어요?')) {
      return;
    }

    const originalText = actionBtn.textContent;
    actionBtn.disabled = true;
    actionBtn.textContent = '처리 중...';

    try {
      const res = await fetch(`/api/users/${userId}/block`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        alert(data.message || '차단 해제 중 오류가 발생했습니다.');
        actionBtn.disabled = false;
        actionBtn.textContent = originalText;
        return;
      }

      const card = actionBtn.closest('.mypage-blocked-card');
      if (card) {
        card.remove();
      }

      if (!blockedUsersBox.querySelector('.mypage-blocked-card')) {
        renderBlockedUsersEmptyState(blockedUsersBox);
      }
    } catch (error) {
      console.error(error);
      alert('차단 해제 처리 중 오류가 발생했습니다.');
      actionBtn.disabled = false;
      actionBtn.textContent = originalText;
    }
  });
}

function setupUserEditForm() {
  const form = document.getElementById('userEditForm');
  const nicknameInput = document.getElementById('nicknameInput');
  const bioInput = document.getElementById('bioInput');
  const aboutInput = document.getElementById('aboutInput');
  const currentPwInput = document.getElementById('currentPwInput');
  const newPwInput = document.getElementById('newPwInput');
  const newPwConfirmInput = document.getElementById('newPwConfirmInput');
  const rememberLoginEnabledInput = document.getElementById('rememberLoginEnabledInput');
  const marketingEmailOptInInput = document.getElementById('marketingEmailOptInInput');
  const logoutAllBtn = document.getElementById('logoutAllSessionsBtn');
  const accountClosureOpenBtn = document.getElementById('accountClosureOpenBtn');
  const accountClosureBackBtn = document.getElementById('accountClosureBackBtn');
  const accountClosureNextBtn = document.getElementById('accountClosureNextBtn');
  const accountClosureSubmitBtn = document.getElementById('accountClosureSubmitBtn');
  const accountClosureCurrentPwInput = document.getElementById('accountClosureCurrentPwInput');
  const accountClosureConfirmInput = document.getElementById('accountClosureConfirmInput');
  const messageSpan = document.getElementById('userEditMessage');

  if (!form) return;

  if (logoutAllBtn && !logoutAllBtn.dataset.bound) {
    logoutAllBtn.dataset.bound = '1';
    logoutAllBtn.addEventListener('click', (event) => {
      event.preventDefault();
      logoutAllSessions();
    });
  }

  if (accountClosureOpenBtn && !accountClosureOpenBtn.dataset.bound) {
    accountClosureOpenBtn.dataset.bound = '1';
    accountClosureOpenBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openAccountClosureFlow(accountClosureOpenBtn);
    });
  }

  if (accountClosureBackBtn && !accountClosureBackBtn.dataset.bound) {
    accountClosureBackBtn.dataset.bound = '1';
    accountClosureBackBtn.addEventListener('click', (event) => {
      event.preventDefault();
      goToAccountClosureStep(1);
    });
  }

  if (accountClosureNextBtn && !accountClosureNextBtn.dataset.bound) {
    accountClosureNextBtn.dataset.bound = '1';
    accountClosureNextBtn.addEventListener('click', (event) => {
      event.preventDefault();
      goToAccountClosureStep(2);
    });
  }

  if (accountClosureSubmitBtn && !accountClosureSubmitBtn.dataset.bound) {
    accountClosureSubmitBtn.dataset.bound = '1';
    accountClosureSubmitBtn.addEventListener('click', (event) => {
      event.preventDefault();
      submitAccountClosure();
    });
  }

  [accountClosureCurrentPwInput, accountClosureConfirmInput].forEach((inputEl) => {
    if (!inputEl || inputEl.dataset.bound === '1') return;
    inputEl.dataset.bound = '1';
    inputEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (accountClosureFlowState.step === 1) {
        goToAccountClosureStep(2);
        return;
      }
      submitAccountClosure();
    });
  });

  document.querySelectorAll('.mpd-account-choice[data-mode]').forEach((choiceEl) => {
    if (choiceEl.dataset.bound === '1') return;
    choiceEl.dataset.bound = '1';
    choiceEl.addEventListener('click', (event) => {
      event.preventDefault();
      selectAccountClosureMode(choiceEl.getAttribute('data-mode'));
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const nickname = nicknameInput ? nicknameInput.value.trim() : '';
    const bio = bioInput ? bioInput.value.trim() : '';
    const about = aboutInput ? aboutInput.value : '';
    const currentPw = currentPwInput ? currentPwInput.value : '';
    const newPw = newPwInput ? newPwInput.value : '';
    const newPwConfirm = newPwConfirmInput ? newPwConfirmInput.value : '';

    const rememberLoginEnabled = rememberLoginEnabledInput
      ? !!rememberLoginEnabledInput.checked
      : false;
    const rememberPolicyChanged = rememberLoginEnabledInput
      ? rememberLoginEnabled !== rememberLoginEnabledInitial
      : false;
    const marketingEmailOptIn = marketingEmailOptInInput
      ? !!marketingEmailOptInInput.checked
      : false;
    const marketingPolicyChanged = marketingEmailOptInInput
      ? marketingEmailOptIn !== marketingEmailOptInInitial
      : false;

    if (messageSpan) {
      messageSpan.classList.remove('text-danger', 'text-success');
      messageSpan.textContent = '';
    }

    if (newPw || newPwConfirm) {
      if (!newPw || !newPwConfirm) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent = '새 비밀번호와 확인을 모두 입력해주세요.';
        }
        return;
      }

      if (newPw !== newPwConfirm) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent = '새 비밀번호가 서로 일치하지 않습니다.';
        }
        return;
      }

      if (!currentPw) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent = '비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.';
        }
        return;
      }

      if (newPw.length < 8 || !/[a-zA-Z]/.test(newPw) || !/\d/.test(newPw)) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent = '비밀번호는 8자 이상, 영문과 숫자를 포함해야 합니다.';
        }
        return;
      }
    }

    if (!nickname && !bio && !about && !newPw && !rememberPolicyChanged && !marketingPolicyChanged) {
      if (messageSpan) {
        messageSpan.classList.add('text-danger');
        messageSpan.textContent = '변경할 내용을 입력해주세요.';
      }
      return;
    }

    try {
      const payload = {
        nickname: nickname || null,
        currentPw: currentPw || null,
        newPw: newPw || null,
        bio,
        about,
      };

      if (rememberPolicyChanged) {
        payload.remember_login_enabled = rememberLoginEnabled;
      }
      if (marketingPolicyChanged) {
        payload.marketing_email_opt_in = marketingEmailOptIn;
      }

      const res = await fetch('/api/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (messageSpan) {
          messageSpan.classList.add('text-danger');
          messageSpan.textContent = (data && data.message) || '정보 수정에 실패했습니다.';
        }
        return;
      }

      if (messageSpan) {
        messageSpan.classList.add('text-success');
        messageSpan.textContent = data.message || '내 정보가 수정되었습니다.';
      }

      if (currentPwInput) currentPwInput.value = '';
      if (newPwInput) newPwInput.value = '';
      if (newPwConfirmInput) newPwConfirmInput.value = '';

      if (rememberPolicyChanged) {
        rememberLoginEnabledInitial = rememberLoginEnabled;
      }
      if (marketingPolicyChanged) {
        marketingEmailOptInInitial = marketingEmailOptIn;
      }

      closeUserEditModal();
      await loadMyPage();
    } catch (error) {
      console.error(error);
      if (messageSpan) {
        messageSpan.classList.add('text-danger');
        messageSpan.textContent = '정보 수정 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      }
    }
  });
}
