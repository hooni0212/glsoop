// public/js/admin.js
// 글숲 관리자 페이지 스크립트 (모듈 방식)

window.Glsoop = window.Glsoop || {};

Glsoop.AdminPage = (function () {
  const ADMIN_ACTIVE_TAB_KEY = 'gls-admin-active-tab';

  const postsState = {
    page: 1,
    limit: 48,
    search: '',
    category: 'all',
    sort: 'recent',
    range: 'all',
  };

  const questState = {
    templates: [],
    campaigns: [],
    campaignItems: [],
  };

  const shareSummaryState = {
    from: '',
    to: '',
    platform: 'all',
    surface: '',
    channel: '',
    topLimit: 10,
    dailyLimit: 30,
    initialized: false,
  };

  const THEME_LABELS = {
    default: '기본',
    spring: '봄',
    summer: '여름',
    autumn: '가을',
    winter: '겨울',
  };

  const CONDITION_LABELS = {
    POST_COUNT_TOTAL: '총 글 작성',
    POST_COUNT_BY_CATEGORY: '카테고리별 글 작성',
    LIKE_GIVEN: '공감 남기기',
    LIKE_RECEIVED: '공감 받기',
    BOOKMARK_GIVEN: '북마크 추가',
    BOOKMARK_RECEIVED: '북마크 받기',
    STREAK_DAYS: '연속 글쓰기',
  };

  const CAMPAIGN_TYPE_LABELS = {
    permanent: '상시',
    daily: '일일',
    weekly: '주간',
    season: '시즌',
    event: '이벤트',
  };

  const DANGER_CONFIRM_TOKEN = 'DELETE';
  const inFlightDangerActions = new Set();
  const dangerModalState = {
    bound: false,
    resolver: null,
    actionKey: '',
    triggerEl: null,
  };

  /**
   * 엔트리 포인트
   */
  async function init() {
    const statusBox = document.getElementById('adminStatus');
    const contentBox = document.getElementById('adminContent');
    const usersBox = document.getElementById('adminUsers');
    const postsBox = document.getElementById('adminPosts');
    const shareSummaryBox = document.getElementById('adminShareSummary');

    if (!statusBox || !contentBox || !usersBox || !postsBox || !shareSummaryBox) {
      console.error(
        'adminStatus / adminContent / adminUsers / adminPosts / adminShareSummary 요소를 찾을 수 없습니다.'
      );
      return;
    }

    setupThemeControls();
    setupTabSwitching();
    setupModalEvents();
    setupDangerConfirmModal();

    const me = await fetchMeAsAdmin();
    if (!me) return;

    statusBox.innerHTML = `
      <p class="gls-mb-1">
        <strong>${escapeHtml(me.name)}</strong> 님, 관리자 권한으로 접속했습니다.
      </p>
      <p class="gls-text-muted gls-mb-0">
        회원과 게시글, 퀘스트를 이 페이지에서 관리할 수 있습니다.
      </p>
    `;
    contentBox.classList.remove('is-hidden');

    await loadUsers(usersBox);
    setupPostsUi(postsBox);
    await loadPosts(postsBox);
    await loadQuestTemplates();
    await loadQuestCampaigns();
    setupAchievementBackfillButton();
    setupShareSummaryUi(shareSummaryBox);
  }

  function setupThemeControls() {
    const radios = document.querySelectorAll('input[name="adminTheme"]');
    const preview = document.querySelector('.admin-theme-preview');
    const applyBtn = document.getElementById('applyThemeBtn');
    if (!radios.length) return;

    const themeApi = window.Glsoop?.Theme;
    const allowed = themeApi?.ALLOWED_THEMES || ['default', 'spring', 'summer', 'autumn', 'winter'];
    const defaultTheme = themeApi?.DEFAULT_THEME || 'default';

    let appliedTheme = themeApi?.readTheme ? themeApi.readTheme() : readThemeLegacy();
    appliedTheme = allowed.includes(appliedTheme) ? appliedTheme : defaultTheme;
    let pendingTheme = appliedTheme;

    applyPreview(appliedTheme, false);

    radios.forEach((radio) => {
      radio.checked = radio.value === appliedTheme;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        pendingTheme = radio.value;
        applyPreview(pendingTheme, pendingTheme !== appliedTheme);
      });
    });

    applyBtn?.addEventListener('click', () => {
      const next = applyPreview(pendingTheme, false);
      appliedTheme = next;
      persistTheme(next);
    });

    function applyPreview(theme, showPending) {
      const safeTheme = allowed.includes(theme) ? theme : defaultTheme;
      const applied = themeApi?.applyTheme
        ? themeApi.applyTheme(safeTheme)
        : legacyApplyTheme(safeTheme, allowed);

      if (preview) {
        preview.textContent = showPending
          ? `미리보기: ${THEME_LABELS[applied] || applied} (적용 버튼을 눌러 저장)`
          : `현재 테마: ${THEME_LABELS[applied] || applied}`;
      }

      return applied;
    }

    function persistTheme(theme) {
      if (themeApi?.persistTheme) {
        themeApi.persistTheme(theme);
        return;
      }
      try {
        localStorage.setItem('gls-admin-theme', theme);
      } catch (e) {
        console.warn('테마를 로컬스토리지에 저장할 수 없습니다.', e);
      }
    }

    function readThemeLegacy() {
      try {
        return localStorage.getItem('gls-admin-theme') || defaultTheme;
      } catch (e) {
        console.warn('테마를 로컬스토리지에서 읽을 수 없습니다.', e);
        return defaultTheme;
      }
    }
  }

  function legacyApplyTheme(theme, allowed) {
    const body = document.body;
    allowed.forEach((t) => body.classList.remove(`${t}-theme`));
    body.classList.add(`${theme}-theme`);
    return theme;
  }

  function setupTabSwitching() {
    const tabButtons = document.querySelectorAll('.admin-tabs .nav-link');
    const panels = document.querySelectorAll('.tab-panel');
    if (!tabButtons.length || !panels.length) return;

    const buttonById = new Map();
    tabButtons.forEach((btn) => {
      const targetId = btn.getAttribute('data-target');
      if (targetId) buttonById.set(targetId, btn);
    });

    const activateTab = (targetId) => {
      if (!targetId || !buttonById.has(targetId)) return;
      tabButtons.forEach((btn) => {
        const isActive = btn.getAttribute('data-target') === targetId;
        btn.classList.toggle('active', isActive);
      });
      panels.forEach((panel) => {
        panel.classList.toggle('gls-hidden', panel.id !== targetId);
      });
      persistActiveTab(targetId);
    };

    const savedTab = readActiveTab();
    if (savedTab && buttonById.has(savedTab)) {
      activateTab(savedTab);
    } else {
      const firstTarget = tabButtons[0].getAttribute('data-target');
      if (firstTarget) activateTab(firstTarget);
    }

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        activateTab(targetId);
      });
    });
  }

  function persistActiveTab(targetId) {
    try {
      localStorage.setItem(ADMIN_ACTIVE_TAB_KEY, String(targetId || ''));
    } catch (e) {
      console.warn('활성 탭 저장에 실패했습니다.', e);
    }
  }

  function readActiveTab() {
    try {
      return localStorage.getItem(ADMIN_ACTIVE_TAB_KEY) || '';
    } catch (e) {
      console.warn('활성 탭 복원에 실패했습니다.', e);
      return '';
    }
  }

  function setTabCount(targetId, value) {
    const badge = document.querySelector(`.admin-tab-count[data-tab-count="${targetId}"]`);
    if (!badge) return;

    if (value === null || value === undefined || value === '') {
      badge.textContent = '-';
      return;
    }

    const num = Number(value);
    if (Number.isFinite(num)) {
      badge.textContent = num > 999 ? '999+' : String(Math.max(0, Math.floor(num)));
      return;
    }

    badge.textContent = String(value);
  }

  function decreaseTabCount(targetId, amount = 1) {
    const badge = document.querySelector(`.admin-tab-count[data-tab-count="${targetId}"]`);
    if (!badge) return;
    const current = Number.parseInt(String(badge.textContent || ''), 10);
    if (!Number.isFinite(current)) return;
    setTabCount(targetId, Math.max(0, current - Math.max(1, amount)));
  }

  function updateQuestTabCount() {
    const templateCount = Array.isArray(questState.templates) ? questState.templates.length : 0;
    const campaignCount = Array.isArray(questState.campaigns) ? questState.campaigns.length : 0;
    setTabCount('questsTab', templateCount + campaignCount);
  }

  function setupModalEvents() {
    document.body.addEventListener('click', (e) => {
      const dismissTarget = e.target.getAttribute?.('data-dismiss');
      if (dismissTarget === 'adminPostModal') {
        closePostModal();
      }
      if (dismissTarget === 'adminDangerConfirmModal') {
        closeDangerConfirm(false);
      }
      if (e.target.id === 'adminDangerCancelBtn' || e.target.id === 'adminDangerCancelTop') {
        closeDangerConfirm(false);
      }
      if (e.target.id === 'adminPostModalDelete') {
        const modal = document.getElementById('adminPostModal');
        const postId = modal?.dataset?.postId;
        const card = document.querySelector(`.admin-post-card[data-post-id="${postId}"]`);
        confirmAndDeletePost(postId, card, e.target);
      }
    });
  }

  function trackUxEvent(eventName, properties = {}, options = {}) {
    if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') {
      return;
    }
    window.glsoopAnalytics.trackEvent(eventName, properties, options);
  }

  function showAdminNotice(message, type = 'info') {
    if (!message) return;
    if (window.glsoopUi && typeof window.glsoopUi.showPageNotice === 'function') {
      window.glsoopUi.showPageNotice(message, {
        type,
        autoHideMs: type === 'error' ? 3200 : 2400,
      });
      return;
    }
    alert(message);
  }

  function parseJsonSafe(response) {
    return response.json().catch(() => ({}));
  }

  function setupDangerConfirmModal() {
    if (dangerModalState.bound) return;

    const modal = document.getElementById('adminDangerConfirmModal');
    const confirmBtn = document.getElementById('adminDangerConfirmBtn');
    const input = document.getElementById('adminDangerInput');
    if (!modal || !confirmBtn || !input) return;

    dangerModalState.bound = true;
    modal.dataset.adminDangerConfirm = 'closed';
    document.body.dataset.adminDangerConfirm = 'closed';

    const sync = () => {
      const isTokenMatched = String(input.value || '').trim().toUpperCase() === DANGER_CONFIRM_TOKEN;
      confirmBtn.disabled = !isTokenMatched;
    };

    input.addEventListener('input', sync);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (confirmBtn.disabled) return;
      event.preventDefault();
      confirmBtn.click();
    });

    confirmBtn.addEventListener('click', () => {
      if (confirmBtn.disabled) return;
      closeDangerConfirm(true);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (modal.classList.contains('gls-hidden')) return;
      closeDangerConfirm(false);
    });
  }

  function openDangerConfirm(options = {}) {
    const modal = document.getElementById('adminDangerConfirmModal');
    const titleEl = document.getElementById('adminDangerTitle');
    const messageEl = document.getElementById('adminDangerMessage');
    const input = document.getElementById('adminDangerInput');
    const confirmBtn = document.getElementById('adminDangerConfirmBtn');
    if (!modal || !input || !confirmBtn) return Promise.resolve(false);

    if (dangerModalState.resolver) {
      const previousResolver = dangerModalState.resolver;
      dangerModalState.resolver = null;
      previousResolver(false);
    }

    const title = options.title || '삭제 확인';
    const message = options.message || '이 작업은 되돌릴 수 없습니다.';
    const actionLabel = options.confirmLabel || '삭제 실행';

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    confirmBtn.textContent = actionLabel;
    input.value = '';
    confirmBtn.disabled = true;

    modal.classList.remove('gls-hidden');
    modal.dataset.adminDangerConfirm = 'open';
    document.body.dataset.adminDangerConfirm = 'open';
    dangerModalState.actionKey = options.actionKey || '';
    dangerModalState.triggerEl = options.triggerEl || null;

    window.requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
    });

    return new Promise((resolve) => {
      dangerModalState.resolver = resolve;
    });
  }

  function closeDangerConfirm(confirmed) {
    const modal = document.getElementById('adminDangerConfirmModal');
    const input = document.getElementById('adminDangerInput');
    const confirmBtn = document.getElementById('adminDangerConfirmBtn');
    if (!modal) return;

    modal.classList.add('gls-hidden');
    modal.dataset.adminDangerConfirm = 'closed';
    document.body.dataset.adminDangerConfirm = 'closed';
    if (input) input.value = '';
    if (confirmBtn) confirmBtn.disabled = true;

    const actionKey = dangerModalState.actionKey;
    const triggerEl = dangerModalState.triggerEl;
    const resolver = dangerModalState.resolver;
    dangerModalState.actionKey = '';
    dangerModalState.triggerEl = null;
    dangerModalState.resolver = null;

    if (triggerEl && typeof triggerEl.focus === 'function') {
      triggerEl.focus({ preventScroll: true });
    }
    if (actionKey) {
      trackUxEvent('admin_danger_confirm', {
        action: actionKey,
        confirmed: Boolean(confirmed),
      });
    }
    if (resolver) {
      resolver(Boolean(confirmed));
    }
  }

  function lockDangerTrigger(triggerEl, busyLabel = '처리 중...') {
    if (!triggerEl || typeof triggerEl !== 'object') {
      return () => {};
    }
    const originalLabel = triggerEl.textContent;
    triggerEl.disabled = true;
    triggerEl.dataset.pending = '1';
    if (busyLabel) {
      triggerEl.textContent = busyLabel;
    }
    return () => {
      triggerEl.disabled = false;
      triggerEl.dataset.pending = '0';
      if (originalLabel !== undefined) {
        triggerEl.textContent = originalLabel;
      }
    };
  }

  async function runDangerAction(options = {}) {
    const {
      actionKey,
      title,
      message,
      triggerEl = null,
      confirmLabel = '삭제 실행',
      pendingLabel = '삭제 중...',
      request,
      successMessage = '작업이 완료되었습니다.',
      failMessage = '작업 중 오류가 발생했습니다.',
    } = options;

    if (!actionKey || typeof request !== 'function') return false;
    if (inFlightDangerActions.has(actionKey)) return false;

    const confirmed = await openDangerConfirm({
      actionKey,
      title,
      message,
      confirmLabel,
      triggerEl,
    });
    if (!confirmed) return false;
    if (inFlightDangerActions.has(actionKey)) return false;

    inFlightDangerActions.add(actionKey);
    const releaseTrigger = lockDangerTrigger(triggerEl, pendingLabel);
    try {
      await request();
      showAdminNotice(successMessage, 'success');
      return true;
    } catch (error) {
      console.error(error);
      const parsedMessage =
        typeof error?.message === 'string' && error.message.trim().length
          ? error.message
          : failMessage;
      showAdminNotice(parsedMessage, 'error');
      return false;
    } finally {
      inFlightDangerActions.delete(actionKey);
      releaseTrigger();
    }
  }



  function setupShareSummaryUi(shareSummaryBox) {
    const filterBox = document.getElementById('adminShareSummaryFilters');
    if (!shareSummaryBox || !filterBox || shareSummaryState.initialized) return;

    shareSummaryState.initialized = true;
    renderShareSummaryFilters(filterBox);

    filterBox.addEventListener('click', (e) => {
      if (e.target.id === 'adminShareApply') {
        e.preventDefault();
        applyShareSummaryFilters(filterBox);
        loadShareSummary(shareSummaryBox);
      }
      if (e.target.id === 'adminShareReset') {
        e.preventDefault();
        resetShareSummaryFilters();
        renderShareSummaryFilters(filterBox);
        loadShareSummary(shareSummaryBox);
      }
    });

    filterBox.addEventListener('submit', (e) => {
      if (e.target.id !== 'adminShareSummaryForm') return;
      e.preventDefault();
      applyShareSummaryFilters(filterBox);
      loadShareSummary(shareSummaryBox);
    });

    loadShareSummary(shareSummaryBox);
  }

  function renderShareSummaryFilters(filterBox) {
    filterBox.innerHTML = [
      '<form id="adminShareSummaryForm" class="admin-toolbar admin-share-toolbar">',
      '  <label>시작일<input type="date" class="gls-input gls-input-sm" id="adminShareFrom" value="' +
        escapeHtml(shareSummaryState.from) +
        '"></label>',
      '  <label>종료일<input type="date" class="gls-input gls-input-sm" id="adminShareTo" value="' +
        escapeHtml(shareSummaryState.to) +
        '"></label>',
      '  <label>플랫폼<select class="gls-select gls-select-sm" id="adminSharePlatform">' +
        buildSharePlatformOptions(shareSummaryState.platform) +
        '</select></label>',
      '  <label>Surface<input type="search" class="gls-input gls-input-sm" id="adminShareSurface" placeholder="예: post-detail" value="' +
        escapeHtml(shareSummaryState.surface) +
        '"></label>',
      '  <label>Channel<input type="search" class="gls-input gls-input-sm" id="adminShareChannel" placeholder="예: native-share-sheet" value="' +
        escapeHtml(shareSummaryState.channel) +
        '"></label>',
      '  <label>Top N<input type="number" class="gls-input gls-input-sm" id="adminShareTopLimit" min="1" max="50" value="' +
        String(shareSummaryState.topLimit) +
        '"></label>',
      '  <label>Daily N<input type="number" class="gls-input gls-input-sm" id="adminShareDailyLimit" min="1" max="120" value="' +
        String(shareSummaryState.dailyLimit) +
        '"></label>',
      '  <div class="admin-share-toolbar__actions">',
      '    <button class="gls-btn gls-btn-primary gls-btn-sm" type="submit" id="adminShareApply">적용</button>',
      '    <button class="gls-btn gls-btn-secondary gls-btn-sm" type="button" id="adminShareReset">초기화</button>',
      '  </div>',
      '</form>',
    ].join('');
  }

  function buildSharePlatformOptions(selected) {
    const options = [
      { value: 'all', label: '전체' },
      { value: 'mobile', label: '모바일' },
      { value: 'web', label: '웹' },
    ];
    return options
      .map((option) => {
        const selectedAttr = option.value === selected ? ' selected' : '';
        return '<option value="' + option.value + '"' + selectedAttr + '>' + option.label + '</option>';
      })
      .join('');
  }

  function applyShareSummaryFilters(filterBox) {
    const fromInput = filterBox.querySelector('#adminShareFrom');
    const toInput = filterBox.querySelector('#adminShareTo');
    const platformInput = filterBox.querySelector('#adminSharePlatform');
    const surfaceInput = filterBox.querySelector('#adminShareSurface');
    const channelInput = filterBox.querySelector('#adminShareChannel');
    const topLimitInput = filterBox.querySelector('#adminShareTopLimit');
    const dailyLimitInput = filterBox.querySelector('#adminShareDailyLimit');

    shareSummaryState.from = fromInput?.value?.trim() || '';
    shareSummaryState.to = toInput?.value?.trim() || '';

    const selectedPlatform = (platformInput?.value || 'all').trim().toLowerCase();
    shareSummaryState.platform = ['all', 'mobile', 'web'].includes(selectedPlatform)
      ? selectedPlatform
      : 'all';

    shareSummaryState.surface = (surfaceInput?.value || '').trim();
    shareSummaryState.channel = (channelInput?.value || '').trim();
    shareSummaryState.topLimit = clampShareLimit(topLimitInput?.value, 1, 50, 10);
    shareSummaryState.dailyLimit = clampShareLimit(dailyLimitInput?.value, 1, 120, 30);
  }

  function resetShareSummaryFilters() {
    shareSummaryState.from = '';
    shareSummaryState.to = '';
    shareSummaryState.platform = 'all';
    shareSummaryState.surface = '';
    shareSummaryState.channel = '';
    shareSummaryState.topLimit = 10;
    shareSummaryState.dailyLimit = 30;
  }

  function clampShareLimit(raw, min, max, fallback) {
    const parsed = Number.parseInt(String(raw || ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  async function loadShareSummary(shareSummaryBox) {
    shareSummaryBox.innerHTML = '<p class="gls-text-muted">공유 이벤트 통계를 불러오는 중입니다...</p>';

    try {
      const params = new URLSearchParams();
      if (shareSummaryState.from) params.set('from', shareSummaryState.from);
      if (shareSummaryState.to) params.set('to', shareSummaryState.to);
      if (shareSummaryState.platform) params.set('platform', shareSummaryState.platform);
      if (shareSummaryState.surface) params.set('surface', shareSummaryState.surface);
      if (shareSummaryState.channel) params.set('channel', shareSummaryState.channel);
      params.set('top_limit', String(shareSummaryState.topLimit));
      params.set('daily_limit', String(shareSummaryState.dailyLimit));

      const response = await fetch('/api/admin/share-events/summary?' + params.toString(), {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) {
        alert('로그인이 필요한 페이지입니다.');
        window.location.href = '/html/login.html?next=/admin';
        return;
      }

      if (response.status === 403) {
        alert('관리자 권한이 필요합니다.');
        window.location.href = '/index.html';
        return;
      }

      if (!response.ok || !payload.ok) {
        setTabCount('shareSummaryTab', '-');
        const message =
          typeof payload.message === 'string'
            ? payload.message
            : '공유 이벤트 요약을 불러오지 못했습니다.';
        shareSummaryBox.innerHTML = '<p class="text-danger">' + escapeHtml(message) + '</p>';
        return;
      }

      setTabCount('shareSummaryTab', Number(payload?.summary?.total_count || 0));
      shareSummaryBox.innerHTML = renderShareSummaryHtml(payload);
    } catch (error) {
      console.error('share summary 로드 실패:', error);
      setTabCount('shareSummaryTab', '-');
      shareSummaryBox.innerHTML =
        '<p class="text-danger">공유 이벤트 요약을 불러오는 중 오류가 발생했습니다.</p>';
    }
  }

  function renderShareSummaryHtml(payload) {
    const summary = payload?.summary || {};
    const byChannel = Array.isArray(payload?.by_channel) ? payload.by_channel : [];
    const bySurface = Array.isArray(payload?.by_surface) ? payload.by_surface : [];
    const daily = Array.isArray(payload?.daily) ? payload.daily : [];

    const totalCount = toCount(summary.total_count);
    const sharedCount = toCount(summary.shared_count);
    const dismissedCount = toCount(summary.dismissed_count);
    const failedCount = toCount(summary.failed_count);
    const uniqueUserCount = toCount(summary.unique_user_count);
    const uniquePostCount = toCount(summary.unique_post_count);
    const shareRate = totalCount > 0 ? ((sharedCount / totalCount) * 100).toFixed(1) : '0.0';

    const cardsHtml = [
      buildShareMetricCard('총 이벤트', formatCount(totalCount), '필터 조건 전체'),
      buildShareMetricCard('공유 성공', formatCount(sharedCount), '성공률 ' + shareRate + '%'),
      buildShareMetricCard('닫힘/취소', formatCount(dismissedCount), '사용자 취소 포함'),
      buildShareMetricCard('실패', formatCount(failedCount), '에러/실패 응답'),
      buildShareMetricCard('고유 사용자', formatCount(uniqueUserCount), '로그인 사용자 기준'),
      buildShareMetricCard('고유 글', formatCount(uniquePostCount), 'post_id 기준'),
    ].join('');

    const channelRows = byChannel
      .map((row) => {
        return (
          '<tr>' +
          '<td>' + escapeHtml(row?.channel || '-') + '</td>' +
          '<td class="gls-text-end">' + formatCount(toCount(row?.event_count)) + '</td>' +
          '</tr>'
        );
      })
      .join('');

    const surfaceRows = bySurface
      .map((row) => {
        return (
          '<tr>' +
          '<td>' + escapeHtml(row?.surface || '-') + '</td>' +
          '<td class="gls-text-end">' + formatCount(toCount(row?.event_count)) + '</td>' +
          '</tr>'
        );
      })
      .join('');

    const dailyRows = daily
      .map((row) => {
        return (
          '<tr>' +
          '<td>' + escapeHtml(row?.day || '-') + '</td>' +
          '<td class="gls-text-end">' + formatCount(toCount(row?.total_count)) + '</td>' +
          '<td class="gls-text-end">' + formatCount(toCount(row?.shared_count)) + '</td>' +
          '<td class="gls-text-end">' + formatCount(toCount(row?.dismissed_count)) + '</td>' +
          '<td class="gls-text-end">' + formatCount(toCount(row?.failed_count)) + '</td>' +
          '</tr>'
        );
      })
      .join('');

    return [
      '<div class="admin-share-summary-grid gls-mb-3">' + cardsHtml + '</div>',
      '<div class="admin-share-table-grid">',
      '  <section class="admin-share-table-card card glass-card">',
      '    <div class="card-body">',
      '      <h5 class="gls-mb-2">채널별 이벤트</h5>',
      '      <div class="table-responsive">',
      '        <table class="table table-sm align-middle">',
      '          <thead><tr><th>채널</th><th class="gls-text-end">이벤트 수</th></tr></thead>',
      '          <tbody>' +
        (channelRows ||
          '<tr><td colspan="2" class="gls-text-muted gls-text-center">데이터가 없습니다.</td></tr>') +
        '</tbody>',
      '        </table>',
      '      </div>',
      '    </div>',
      '  </section>',
      '  <section class="admin-share-table-card card glass-card">',
      '    <div class="card-body">',
      '      <h5 class="gls-mb-2">Surface별 이벤트</h5>',
      '      <div class="table-responsive">',
      '        <table class="table table-sm align-middle">',
      '          <thead><tr><th>Surface</th><th class="gls-text-end">이벤트 수</th></tr></thead>',
      '          <tbody>' +
        (surfaceRows ||
          '<tr><td colspan="2" class="gls-text-muted gls-text-center">데이터가 없습니다.</td></tr>') +
        '</tbody>',
      '        </table>',
      '      </div>',
      '    </div>',
      '  </section>',
      '</div>',
      '<section class="admin-share-table-card card glass-card gls-mt-3">',
      '  <div class="card-body">',
      '    <h5 class="gls-mb-2">일별 추이</h5>',
      '    <div class="table-responsive">',
      '      <table class="table table-sm align-middle">',
      '        <thead>',
      '          <tr>',
      '            <th>일자</th>',
      '            <th class="gls-text-end">총 이벤트</th>',
      '            <th class="gls-text-end">공유 성공</th>',
      '            <th class="gls-text-end">닫힘/취소</th>',
      '            <th class="gls-text-end">실패</th>',
      '          </tr>',
      '        </thead>',
      '        <tbody>' +
        (dailyRows ||
          '<tr><td colspan="5" class="gls-text-muted gls-text-center">데이터가 없습니다.</td></tr>') +
        '</tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '</section>',
    ].join('');
  }

  function buildShareMetricCard(title, value, hint) {
    return [
      '<article class="admin-share-metric card glass-card">',
      '  <div class="card-body">',
      '    <p class="gls-text-muted gls-text-small gls-mb-1">' + escapeHtml(title) + '</p>',
      '    <p class="admin-share-metric__value gls-mb-1">' + escapeHtml(value) + '</p>',
      '    <p class="gls-text-muted gls-text-small gls-mb-0">' + escapeHtml(hint) + '</p>',
      '  </div>',
      '</article>',
    ].join('');
  }

  function toCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
  }

  function formatCount(value) {
    return toCount(value).toLocaleString('ko-KR');
  }

  async function fetchMeAsAdmin() {
    try {
      const meRes = await fetch('/api/me');
      if (!meRes.ok) {
        alert('로그인이 필요한 페이지입니다.');
        window.location.href = '/html/login.html?next=/admin';
        return null;
      }
      const meData = await meRes.json();
      if (!meData.ok) {
        alert('로그인이 필요한 페이지입니다.');
        window.location.href = '/html/login.html?next=/admin';
        return null;
      }
      if (!meData.is_admin) {
        alert('관리자만 접근할 수 있는 페이지입니다.');
        window.location.href = '/index.html';
        return null;
      }
      return meData;
    } catch (e) {
      console.error(e);
      alert('접근 권한 확인 중 오류가 발생했습니다.');
      window.location.href = '/index.html';
      return null;
    }
  }

  async function loadUsers(usersBox) {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        setTabCount('usersTab', '-');
        usersBox.innerHTML =
          '<p class="text-danger">회원 목록을 불러오는 중 오류가 발생했습니다.</p>';
        return;
      }
      const data = await res.json();
      if (!data.ok) {
        setTabCount('usersTab', '-');
        usersBox.innerHTML = `<p class="text-danger">${
          data.message || '회원 목록을 불러오지 못했습니다.'
        }</p>`;
        return;
      }
      const users = data.users || [];
      setTabCount('usersTab', users.length);
      if (!users.length) {
        usersBox.innerHTML = '<p class="gls-text-muted">현재 가입된 회원이 없습니다.</p>';
        return;
      }
      usersBox.innerHTML = buildUsersTableHtml(users);
      const tbody = usersBox.querySelector('tbody');
      tbody?.addEventListener('click', (e) => handleUserTableClick(e, tbody, usersBox));
    } catch (e) {
      console.error(e);
      setTabCount('usersTab', '-');
      usersBox.innerHTML =
        '<p class="text-danger">회원 목록을 불러오는 중 오류가 발생했습니다.</p>';
    }
  }

  function buildUsersTableHtml(users) {
    const rowsHtml = users
      .map((u) => {
        const isAdminBadge = u.is_admin
          ? '<span class="gls-badge gls-badge--danger gls-ms-1">관리자</span>'
          : '';
        const isVerifiedBadge =
          u.is_verified && Number(u.is_verified) === 1
            ? '<span class="gls-badge gls-badge--success gls-ms-1">인증완료</span>'
            : '<span class="gls-badge gls-badge--muted gls-ms-1">미인증</span>';
        const nicknameText =
          u.nickname && String(u.nickname).trim().length > 0
            ? escapeHtml(u.nickname)
            : '<span class="gls-text-muted">-</span>';
        const maskedEmail = maskEmail(u.email);
        return `
          <tr data-user-id="${u.id}">
            <td data-label="ID">${u.id}</td>
            <td data-label="이름">${escapeHtml(u.name)}${isAdminBadge}</td>
            <td data-label="닉네임">${nicknameText}</td>
            <td data-label="이메일">${escapeHtml(maskedEmail || u.email || '')}</td>
            <td data-label="인증 상태">${isVerifiedBadge}</td>
            <td data-label="관리">
              <button
                type="button"
                class="gls-btn gls-btn-danger gls-btn-xs admin-delete-user-btn"
              >
                삭제
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    return `
      <div class="table-responsive">
        <table class="table align-middle admin-users-table">
          <thead>
            <tr>
              <th class="admin-col-id">ID</th>
              <th class="admin-col-name">이름</th>
              <th class="admin-col-nickname">닉네임</th>
              <th>이메일</th>
              <th class="admin-col-status">인증 상태</th>
              <th class="admin-col-actions">관리</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }

  async function handleUserTableClick(e, tbody, usersBox) {
    const target = e.target;
    if (!target.classList.contains('admin-delete-user-btn')) return;
    const tr = target.closest('tr');
    if (!tr) return;
    const userId = tr.getAttribute('data-user-id');
    if (!userId) return;
    await runDangerAction({
      actionKey: `delete-user-${userId}`,
      title: '회원 삭제 확인',
      message: '이 회원을 삭제하면 관련 글과 공감 데이터도 함께 삭제됩니다.',
      triggerEl: target,
      request: async () => {
        const delRes = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        const delData = await parseJsonSafe(delRes);
        if (!delRes.ok || !delData.ok) {
          throw new Error(delData.message || '회원 삭제에 실패했습니다.');
        }
        tr.remove();
        decreaseTabCount('usersTab', 1);
        if (!tbody.children.length) {
          usersBox.innerHTML = '<p class="gls-text-muted">현재 가입된 회원이 없습니다.</p>';
        }
      },
      successMessage: '회원을 삭제했습니다.',
      failMessage: '회원 삭제 중 오류가 발생했습니다.',
    });
  }

  function setupPostsUi(postsBox) {
    if (!postsBox) return;
    const filterBox = document.getElementById('adminPostsFilters');
    if (filterBox) {
      filterBox.innerHTML = `
        <div class="admin-toolbar">
          <input type="search" class="gls-input gls-input-sm" id="adminPostsSearch" placeholder="제목/작성자 검색" value="${
            postsState.search
          }" />
          <select class="gls-select gls-select-sm" id="adminPostsCategory">
            <option value="all">전체</option>
            <option value="poem">시</option>
            <option value="essay">에세이</option>
            <option value="short">짧은 구절</option>
          </select>
          <select class="gls-select gls-select-sm" id="adminPostsRange">
            <option value="all">전체 기간</option>
            <option value="7">최근 7일</option>
            <option value="30">최근 30일</option>
          </select>
          <select class="gls-select gls-select-sm" id="adminPostsSort">
            <option value="recent">최신순</option>
            <option value="oldest">오래된순</option>
            <option value="likes">공감 많은순</option>
          </select>
          <select class="gls-select gls-select-sm" id="adminPostsLimit">
            <option value="24">24개씩</option>
            <option value="48" selected>48개씩</option>
            <option value="96">96개씩</option>
          </select>
          <button class="gls-btn gls-btn-primary gls-btn-sm" id="adminPostsApply" type="button">적용</button>
        </div>
      `;
      filterBox.addEventListener('click', (e) => {
        if (e.target.id === 'adminPostsApply') {
          const searchInput = document.getElementById('adminPostsSearch');
          const category = document.getElementById('adminPostsCategory');
          const sort = document.getElementById('adminPostsSort');
          const range = document.getElementById('adminPostsRange');
          const limit = document.getElementById('adminPostsLimit');
          postsState.search = searchInput?.value?.trim() || '';
          postsState.category = category?.value || 'all';
          postsState.sort = sort?.value || 'recent';
          postsState.range = range?.value || 'all';
          postsState.limit = Number(limit?.value) || 48;
          postsState.page = 1;
          loadPosts(postsBox);
        }
      });
    }

    postsBox.innerHTML = `
      <div id="adminPostsGrid" class="admin-posts-grid"></div>
      <div id="adminPostsPagination" class="admin-pagination"></div>
    `;
  }

  async function loadPosts(postsBox) {
    const grid = postsBox?.querySelector('#adminPostsGrid');
    const pagination = postsBox?.querySelector('#adminPostsPagination');
    if (!grid) return;
    grid.innerHTML = '<p class="gls-text-muted">글 목록을 불러오는 중입니다...</p>';
    if (pagination) pagination.innerHTML = '';

    const params = new URLSearchParams({
      search: postsState.search,
      category: postsState.category,
      sort: postsState.sort,
      range: postsState.range,
      page: postsState.page,
      limit: postsState.limit,
    });

    try {
      const res = await fetch(`/api/admin/posts?${params.toString()}`);
      if (res.status === 401 || res.status === 403) {
        const txt = await res.text();
        alert(txt || '로그인/권한을 다시 확인해주세요.');
        window.location.href = '/html/login.html?next=/admin';
        return;
      }
      if (res.status === 404) {
        const txt = await res.text();
        throw new Error(`관리자 글 API를 찾을 수 없습니다. status=404 body=${txt.slice(0, 200)}`);
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`status=${res.status} body=${txt.slice(0, 200)}`);
      }

      const data = await res.json();
      if (!data?.ok) {
        grid.innerHTML = `<p class="text-danger">${
          data?.message || '글 목록을 불러오는 중 오류가 발생했습니다.'
        }</p>`;
        return;
      }

      const posts = data.items || data.posts || [];
      setTabCount(
        'postsTab',
        Number.isFinite(Number(data.total)) ? Number(data.total) : posts.length
      );
      if (!posts.length) {
        grid.innerHTML = '<p class="gls-text-muted">등록된 글이 없습니다.</p>';
      } else {
        grid.innerHTML = buildPostsHtml(posts);
      }

      if (pagination) {
        pagination.innerHTML = buildPagination(data.page, data.page_size, data.total);
        pagination.onclick = handlePaginationClick;
      }

      grid.onclick = (e) => handlePostGridClick(e, grid);
    } catch (e) {
      console.error('admin posts 로드 실패:', e);
      setTabCount('postsTab', '-');
      const msg = typeof e?.message === 'string' ? e.message : '글 목록을 불러오는 중 오류가 발생했습니다.';
      grid.innerHTML = `<p class="text-danger">${escapeHtml(msg)}</p>`;
    }
  }

  function buildPostsHtml(posts) {
    return posts
      .map((post) => {
        const dateStr = post.created_at
          ? String(post.created_at).replace('T', ' ').slice(0, 16)
          : '';
        const nickname =
          post.author_nickname && post.author_nickname.trim().length > 0
            ? post.author_nickname.trim()
            : '';
        const baseName =
          nickname ||
          (post.author_name && post.author_name.trim().length > 0
            ? post.author_name.trim()
            : '익명');
        const maskedEmail = maskEmail(post.author_email);
        const author = maskedEmail ? `${baseName} (${maskedEmail})` : baseName;
        const snippet = (post.content || '').replace(/<[^>]+>/g, '').slice(0, 80);
        return `
          <article class="admin-post-card" data-post-id="${post.id}">
            <div class="admin-post-card__top">
              <span class="gls-badge gls-badge-soft admin-post-card__category">${
                post.category || '카테고리 없음'
              }</span>
              <button class="gls-btn gls-btn-ghost gls-btn-xs admin-post-card__delete" type="button" aria-label="삭제" title="삭제">
                ×
              </button>
            </div>
            <h5 class="admin-post-card__title">${escapeHtml(post.title)}</h5>
            <p class="admin-post-card__meta">${escapeHtml(author)} · ${dateStr}</p>
            <p class="admin-post-card__snippet">${escapeHtml(snippet)}${
          snippet.length >= 80 ? '…' : ''
        }</p>
            <div class="gls-spread admin-post-card__footer">
              <span class="gls-text-muted gls-text-small">❤ ${post.like_count || 0}</span>
              <button class="gls-btn gls-btn-secondary gls-btn-xs admin-post-card__preview" type="button">미리보기</button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function buildPagination(page, pageSize, total) {
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const prevDisabled = page <= 1 ? 'disabled' : '';
    const nextDisabled = page >= totalPages ? 'disabled' : '';
    return `
      <div class="gls-spread gls-w-100">
        <button class="gls-btn gls-btn-secondary gls-btn-xs" data-page="${page - 1}" ${prevDisabled}>이전</button>
        <span class="gls-text-muted gls-text-small">${page} / ${totalPages} 페이지 · 총 ${total}건</span>
        <button class="gls-btn gls-btn-secondary gls-btn-xs" data-page="${page + 1}" ${nextDisabled}>다음</button>
      </div>
    `;
  }

  function handlePaginationClick(e) {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    const nextPage = Number(btn.getAttribute('data-page'));
    if (!Number.isFinite(nextPage) || nextPage < 1) return;
    postsState.page = nextPage;
    loadPosts(document.getElementById('adminPosts'));
  }

  function handlePostGridClick(e) {
    const deleteBtn = e.target.closest('.admin-post-card__delete');
    const previewBtn = e.target.closest('.admin-post-card__preview');
    const card = e.target.closest('.admin-post-card');
    if (!card) return;
    const postId = card.getAttribute('data-post-id');

    if (deleteBtn) {
      confirmAndDeletePost(postId, card, deleteBtn);
      return;
    }
    if (previewBtn) {
      const targetUrl = `/html/post.html?id=${encodeURIComponent(postId)}`;
      window.open(targetUrl, '_blank');
    }
  }

  async function openPostModal(postId) {
    if (!postId) return;
    const modal = document.getElementById('adminPostModal');
    if (!modal) return;
    try {
      const res = await fetch(`/api/admin/posts/${postId}`);
      if (res.status === 401 || res.status === 403) {
        const txt = await res.text();
        alert(txt || '관리자 권한을 다시 확인해주세요.');
        window.location.href = '/html/login.html?next=/admin';
        return;
      }
      if (res.status === 404) {
        const txt = await res.text();
        throw new Error(`관리자 템플릿 API가 없습니다. status=404 body=${txt.slice(0, 200)}`);
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`status=${res.status} body=${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      if (!data.ok || !data.post) {
        alert(data?.message || '글 정보를 불러오지 못했습니다.');
        return;
      }
      const post = data.post;
      modal.dataset.postId = postId;
      document.getElementById('adminPostModalTitle').innerText = post.title || '';
      const maskedEmail = maskEmail(post.author_email);
      const authorLine = maskedEmail
        ? `${post.author_nickname || post.author_name || '익명'} (${maskedEmail})`
        : post.author_nickname || post.author_name || '익명';
      const meta = `${authorLine} · ${
        post.created_at ? String(post.created_at).replace('T', ' ').slice(0, 16) : ''
      } · ${post.category || ''}`;
      document.getElementById('adminPostModalMeta').innerText = meta;
      document.getElementById('adminPostModalBody').innerHTML = sanitizePostHtml(post.content || '');
      modal.classList.remove('gls-hidden');
    } catch (err) {
      console.error(err);
      alert('글 정보를 불러오는 중 오류가 발생했습니다.');
    }
  }

  function closePostModal() {
    const modal = document.getElementById('adminPostModal');
    if (!modal) return;
    modal.classList.add('gls-hidden');
    modal.dataset.postId = '';
  }

  async function confirmAndDeletePost(postId, card, triggerEl = null) {
    if (!postId) return;
    await runDangerAction({
      actionKey: `delete-post-${postId}`,
      title: '글 삭제 확인',
      message: `글 ID ${postId}를 삭제합니다. 이 작업은 되돌릴 수 없습니다.`,
      triggerEl,
      pendingLabel: triggerEl?.id === 'adminPostModalDelete' ? '삭제 중...' : '',
      request: async () => {
        const delRes = await fetch(`/api/admin/posts/${postId}`, { method: 'DELETE' });
        const delData = await parseJsonSafe(delRes);
        if (!delRes.ok || !delData.ok) {
          throw new Error(delData.message || '글 삭제에 실패했습니다.');
        }
        if (card) card.remove();
        decreaseTabCount('postsTab', 1);
        const grid = document.getElementById('adminPostsGrid');
        if (grid && !grid.querySelector('.admin-post-card')) {
          grid.innerHTML = '<p class="gls-text-muted">등록된 글이 없습니다.</p>';
        }
        closePostModal();
      },
      successMessage: '글을 삭제했습니다.',
      failMessage: '글 삭제 중 오류가 발생했습니다.',
    });
  }

  async function loadQuestTemplates() {
      const box = document.getElementById('questTemplates');
      if (!box) return;
      box.innerHTML = '<p class="gls-text-muted">템플릿을 불러오는 중입니다...</p>';
      try {
        const res = await fetch('/api/admin/quest-templates');
        if (res.status === 401 || res.status === 403) {
          const txt = await res.text();
          box.innerHTML = `<p class="text-danger">${txt || '권한을 다시 확인해주세요.'}</p>`;
          return;
        }
        if (res.status === 404) {
          const txt = await res.text();
          throw new Error(`관리자 템플릿 API가 없습니다. status=404 body=${txt.slice(0, 200)}`);
        }
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`status=${res.status} body=${txt.slice(0, 200)}`);
        }
        const data = await res.json();
        if (!data.ok) {
          setTabCount('questsTab', '-');
          box.innerHTML = `<p class="text-danger">${
            data?.message || '템플릿 조회에 실패했습니다.'
          }</p>`;
          return;
        }
        questState.templates = data.items || data.templates || [];
        updateQuestTabCount();
        box.innerHTML = buildTemplateEditor();
        bindTemplateEvents();
      } catch (err) {
      console.error(err);
      setTabCount('questsTab', '-');
      box.innerHTML = '<p class="text-danger">템플릿 조회 중 오류가 발생했습니다.</p>';
    }
  }

  function setupAchievementBackfillButton() {
    const btn = document.getElementById('achievementBackfillBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!confirm('현재 업적 템플릿을 모든 유저에게 부여하시겠습니까?')) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/admin/quests/achievements/backfill', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert(data.message || '업적 backfill에 실패했습니다.');
          return;
        }
        alert(`업적 backfill 완료: ${data.inserted || 0}건`);
      } catch (err) {
        console.error(err);
        alert('업적 backfill 중 오류가 발생했습니다.');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function buildTemplateEditor(editingId = '') {
    const target = questState.templates.find((t) => String(t.id) === String(editingId));
    const values = target || {};
    const listHtml = questState.templates
      .map(
        (t) => `
        <tr data-template-id="${t.id}">
          <td>${escapeHtml(t.name)}</td>
          <td><span class="gls-badge gls-badge-soft">${escapeHtml(
            CONDITION_LABELS[t.condition_type] || t.condition_type
          )}</span> ${
            t.category ? `<span class="gls-badge gls-badge--muted gls-ms-1">${escapeHtml(t.category)}</span>` : ''
          }</td>
          <td>${t.target_value}</td>
          <td>${t.reward_xp || 0} XP</td>
          <td>${escapeHtml(t.template_kind || 'quest')}</td>
          <td>${escapeHtml(t.code || '-')}</td>
          <td>${t.is_active ? '활성' : '비활성'}</td>
          <td class="gls-text-end">
            <button class="gls-btn gls-btn-secondary gls-btn-xs quest-template-edit" type="button">수정</button>
            <button class="gls-btn gls-btn-danger gls-btn-xs quest-template-delete" type="button">삭제</button>
          </td>
        </tr>`
      )
      .join('');

    return `
      <form id="questTemplateForm" class="quest-form card gls-mb-3 gls-p-3">
        <div class="gls-spread gls-mb-2">
          <h5 class="gls-mb-0">${editingId ? '템플릿 수정' : '새 템플릿 추가'}</h5>
          <button class="gls-btn gls-btn-secondary gls-btn-xs" type="button" id="questTemplateReset">초기화</button>
        </div>
        <div class="gls-grid gls-grid-12 gls-gap-2">
          <div class="gls-col-span-12 gls-md-col-span-4">
            <label class="gls-label gls-text-small gls-mb-1">제목</label>
            <input class="gls-input gls-input-sm" name="name" value="${escapeHtml(
              values.name || ''
            )}" required />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-4">
            <label class="gls-label gls-text-small gls-mb-1">조건 타입</label>
            <select class="gls-select gls-select-sm" name="condition_type" required>
              ${buildConditionOptions(values.condition_type)}
            </select>
          </div>
          <div class="gls-col-span-12 gls-md-col-span-4">
            <label class="gls-label gls-text-small gls-mb-1">카테고리(선택)</label>
            <select class="gls-select gls-select-sm" name="category">
              <option value="">(전체)</option>
              <option value="poem" ${values.category === 'poem' ? 'selected' : ''}>시</option>
              <option value="essay" ${values.category === 'essay' ? 'selected' : ''}>에세이</option>
              <option value="short" ${values.category === 'short' ? 'selected' : ''}>짧은 구절</option>
            </select>
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">목표</label>
            <input type="number" min="1" class="gls-input gls-input-sm" name="target_value" value="${
              values.target_value || ''
            }" required />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">템플릿 종류</label>
            <select class="gls-select gls-select-sm" name="template_kind">
              <option value="quest" ${values.template_kind !== 'achievement' ? 'selected' : ''}>퀘스트</option>
              <option value="achievement" ${values.template_kind === 'achievement' ? 'selected' : ''}>업적</option>
            </select>
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">보상 XP</label>
            <input type="number" min="0" class="gls-input gls-input-sm" name="reward_xp" value="${
              values.reward_xp || 0
            }" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-6">
            <label class="gls-label gls-text-small gls-mb-1">설명</label>
            <input class="gls-input gls-input-sm" name="description" value="${escapeHtml(
              values.description || ''
            )}" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">코드(선택)</label>
            <input class="gls-input gls-input-sm" name="code" value="${escapeHtml(values.code || '')}" />
          </div>
          <div class="gls-col-span-12">
            <label class="gls-label gls-text-small gls-mb-1">UI 메타(JSON)</label>
            <textarea class="gls-input gls-input-sm" name="ui_json" rows="2" placeholder='{"icon":"🌟","label":"업적"}'>${escapeHtml(
              values.ui_json || ''
            )}</textarea>
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3 gls-flex gls-items-end">
            <div class="gls-check">
              <input class="gls-check-input" type="checkbox" name="is_active" id="templateActive" ${
                values.is_active || editingId === '' ? 'checked' : ''
              } />
              <label class="gls-check-label" for="templateActive">활성</label>
            </div>
          </div>
        </div>
        <div class="gls-text-end gls-mt-3">
          <input type="hidden" name="id" value="${editingId}" />
          <button class="gls-btn gls-btn-primary gls-btn-sm" type="submit">${editingId ? '수정 저장' : '추가'}</button>
        </div>
      </form>
      <div class="table-responsive">
        <table class="table align-middle table-sm">
          <thead><tr><th>제목</th><th>조건</th><th>목표</th><th>보상</th><th>종류</th><th>코드</th><th>상태</th><th class="gls-text-end">관리</th></tr></thead>
          <tbody>${listHtml}</tbody>
        </table>
      </div>
    `;
  }

  function bindTemplateEvents() {
    const box = document.getElementById('questTemplates');
    if (!box) return;
    const form = box.querySelector('#questTemplateForm');
    const resetBtn = box.querySelector('#questTemplateReset');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      payload.is_active = formData.get('is_active') ? 1 : 0;
      const isEdit = payload.id;
      const method = isEdit ? 'PUT' : 'POST';
      const url = isEdit
        ? `/api/admin/quest-templates/${payload.id}`
        : '/api/admin/quest-templates';
      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert(data.message || '저장에 실패했습니다.');
          return;
        }
        await loadQuestTemplates();
        await loadQuestCampaigns();
      } catch (err) {
        console.error(err);
        alert('템플릿 저장 중 오류가 발생했습니다.');
      }
    });

    resetBtn?.addEventListener('click', () => {
      box.innerHTML = buildTemplateEditor();
      bindTemplateEvents();
    });

    box.querySelectorAll('.quest-template-edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr')?.dataset?.templateId;
        box.innerHTML = buildTemplateEditor(id);
        bindTemplateEvents();
      });
    });
    box.querySelectorAll('.quest-template-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.closest('tr')?.dataset?.templateId;
        if (!id) return;
        await runDangerAction({
          actionKey: `delete-quest-template-${id}`,
          title: '퀘스트 템플릿 삭제',
          message: '이 템플릿을 삭제하면 연결된 캠페인 구성이 영향을 받을 수 있습니다.',
          triggerEl: e.currentTarget,
          request: async () => {
            const res = await fetch(`/api/admin/quest-templates/${id}`, { method: 'DELETE' });
            const data = await parseJsonSafe(res);
            if (!res.ok || !data.ok) {
              throw new Error(data.message || '삭제에 실패했습니다.');
            }
            await loadQuestTemplates();
            await loadQuestCampaigns();
          },
          successMessage: '템플릿을 삭제했습니다.',
          failMessage: '템플릿 삭제 중 오류가 발생했습니다.',
        });
      });
    });
  }

  function buildConditionOptions(selected) {
    const options = [
      'POST_COUNT_TOTAL',
      'POST_COUNT_BY_CATEGORY',
      'LIKE_GIVEN',
      'LIKE_RECEIVED',
      'BOOKMARK_GIVEN',
      'BOOKMARK_RECEIVED',
      'STREAK_DAYS',
    ];
    return options
      .map(
        (opt) => `<option value="${opt}" ${selected === opt ? 'selected' : ''}>${
          CONDITION_LABELS[opt] || opt
        }</option>`
      )
      .join('');
  }

  async function loadQuestCampaigns() {
    const box = document.getElementById('questCampaigns');
    if (!box) return;
    box.innerHTML = '<p class="gls-text-muted">캠페인을 불러오는 중입니다...</p>';
    try {
      const res = await fetch('/api/admin/quest-campaigns');
      if (res.status === 401 || res.status === 403) {
        const txt = await res.text();
        box.innerHTML = `<p class="text-danger">${txt || '권한을 다시 확인해주세요.'}</p>`;
        return;
      }
      if (res.status === 404) {
        const txt = await res.text();
        throw new Error(`관리자 캠페인 API가 없습니다. status=404 body=${txt.slice(0, 200)}`);
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`status=${res.status} body=${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      if (!data.ok) {
        setTabCount('questsTab', '-');
        box.innerHTML = `<p class="text-danger">${
          data?.message || '캠페인 조회에 실패했습니다.'
        }</p>`;
        return;
      }
      questState.campaigns = data.items || data.campaigns || [];
      questState.campaignItems = data.campaign_items || [];
      updateQuestTabCount();
      box.innerHTML = buildCampaignEditor();
      bindCampaignEvents();
      } catch (err) {
      console.error(err);
      setTabCount('questsTab', '-');
      box.innerHTML = '<p class="text-danger">캠페인 조회 중 오류가 발생했습니다.</p>';
    }
  }

  function buildCampaignEditor(editingId = '') {
    const target = questState.campaigns.find((c) => String(c.id) === String(editingId));
    const values = target || {};
    const typeOptions = ['permanent', 'daily', 'weekly', 'season', 'event'];
    const itemsByCampaign = questState.campaignItems.reduce((acc, cur) => {
      acc[cur.campaign_id] = acc[cur.campaign_id] || [];
      acc[cur.campaign_id].push(cur);
      return acc;
    }, {});
    const selectedItems = itemsByCampaign[values.id] || [];
    const selection = questState.templates
      .map((t) => {
        const found = selectedItems.find((i) => Number(i.template_id) === Number(t.id));
        return `
          <div class="gls-check gls-check-inline gls-mb-1">
            <input class="gls-check-input quest-campaign-template" type="checkbox" data-template-id="${t.id}" id="campaignTpl${t.id}" ${
          found ? 'checked' : ''
        } />
            <label class="gls-check-label" for="campaignTpl${t.id}">${escapeHtml(t.name)}</label>
            <input type="number" class="gls-input gls-input-sm gls-ms-2 admin-template-order-input" placeholder="순서" data-template-order="${t.id}" value="${
          found ? found.sort_order || 0 : ''
        }" />
          </div>`;
      })
      .join('');

    const listHtml = questState.campaigns
      .map(
        (c) => `
        <tr data-campaign-id="${c.id}">
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(CAMPAIGN_TYPE_LABELS[c.campaign_type] || c.campaign_type || '')}</td>
          <td>${c.start_at || '-'} ~ ${c.end_at || '-'}</td>
          <td>${c.is_active ? '활성' : '비활성'} (priority ${c.priority || 1})</td>
          <td class="gls-text-end">
            <button class="gls-btn gls-btn-secondary gls-btn-xs quest-campaign-edit" type="button">편집</button>
            <button class="gls-btn gls-btn-danger gls-btn-xs quest-campaign-delete" type="button">삭제</button>
          </td>
        </tr>`
      )
      .join('');

    return `
      <form id="questCampaignForm" class="quest-form card gls-mb-3 gls-p-3">
        <div class="gls-spread gls-mb-2">
          <h5 class="gls-mb-0">${editingId ? '캠페인 수정' : '새 캠페인 추가'}</h5>
          <button class="gls-btn gls-btn-secondary gls-btn-xs" type="button" id="questCampaignReset">초기화</button>
        </div>
        <div class="gls-grid gls-grid-12 gls-gap-2">
          <div class="gls-col-span-12 gls-md-col-span-4">
            <label class="gls-label gls-text-small gls-mb-1">이름</label>
            <input class="gls-input gls-input-sm" name="name" value="${escapeHtml(
              values.name || ''
            )}" required />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">유형</label>
            <select class="gls-select gls-select-sm" name="campaign_type">
              ${typeOptions
                .map(
                  (t) => `<option value="${t}" ${
                    (values.campaign_type || 'event') === t ? 'selected' : ''
                  }>${CAMPAIGN_TYPE_LABELS[t] || t}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">시작</label>
            <input type="datetime-local" class="gls-input gls-input-sm" name="start_at" value="${
              values.start_at ? values.start_at.replace(' ', 'T') : ''
            }" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-3">
            <label class="gls-label gls-text-small gls-mb-1">종료</label>
            <input type="datetime-local" class="gls-input gls-input-sm" name="end_at" value="${
              values.end_at ? values.end_at.replace(' ', 'T') : ''
            }" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-2">
            <label class="gls-label gls-text-small gls-mb-1">우선순위</label>
            <input type="number" class="gls-input gls-input-sm" name="priority" value="${
              values.priority || 1
            }" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-4">
            <label class="gls-label gls-text-small gls-mb-1">설명</label>
            <input class="gls-input gls-input-sm" name="description" value="${escapeHtml(
              values.description || ''
            )}" />
          </div>
          <div class="gls-col-span-12 gls-md-col-span-2 gls-flex gls-items-end">
            <div class="gls-check">
              <input class="gls-check-input" type="checkbox" name="is_active" id="campaignActive" ${
                values.is_active ? 'checked' : ''
              } />
              <label class="gls-check-label" for="campaignActive">활성</label>
            </div>
          </div>
        </div>
        <div class="gls-mt-3">
          <p class="gls-text-small gls-text-muted gls-mb-1">캠페인에 포함할 템플릿을 선택하고 정렬 순서를 지정하세요.</p>
          <div class="quest-template-select">
            ${selection || '<p class="gls-text-muted">등록된 템플릿이 없습니다.</p>'}
          </div>
        </div>
        <div class="gls-text-end gls-mt-3">
          <input type="hidden" name="id" value="${editingId}" />
          <button class="gls-btn gls-btn-primary gls-btn-sm" type="submit">${editingId ? '수정 저장' : '추가'}</button>
        </div>
      </form>
      <div class="table-responsive">
        <table class="table align-middle table-sm">
          <thead><tr><th>이름</th><th>유형</th><th>기간</th><th>상태</th><th class="gls-text-end">관리</th></tr></thead>
          <tbody>${listHtml}</tbody>
        </table>
      </div>
    `;
  }

  function bindCampaignEvents() {
    const box = document.getElementById('questCampaigns');
    if (!box) return;
    const form = box.querySelector('#questCampaignForm');
    const resetBtn = box.querySelector('#questCampaignReset');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      payload.is_active = formData.get('is_active') ? 1 : 0;
      const isEdit = payload.id;
      const method = isEdit ? 'PUT' : 'POST';
      const url = isEdit
        ? `/api/admin/quest-campaigns/${payload.id}`
        : '/api/admin/quest-campaigns';
      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert(data.message || '캠페인 저장에 실패했습니다.');
          return;
        }
        if (isEdit) {
          await saveCampaignItems(payload.id, form);
        }
        await loadQuestCampaigns();
        await loadQuestTemplates();
      } catch (err) {
        console.error(err);
        alert('캠페인 저장 중 오류가 발생했습니다.');
      }
    });

    resetBtn?.addEventListener('click', () => {
      box.innerHTML = buildCampaignEditor();
      bindCampaignEvents();
    });

    box.querySelectorAll('.quest-campaign-edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr')?.dataset?.campaignId;
        box.innerHTML = buildCampaignEditor(id);
        bindCampaignEvents();
      });
    });
    box.querySelectorAll('.quest-campaign-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.closest('tr')?.dataset?.campaignId;
        if (!id) return;
        await runDangerAction({
          actionKey: `delete-quest-campaign-${id}`,
          title: '퀘스트 캠페인 삭제',
          message: '이 캠페인을 삭제하면 포함된 진행 상태가 정리됩니다.',
          triggerEl: e.currentTarget,
          request: async () => {
            const res = await fetch(`/api/admin/quest-campaigns/${id}`, { method: 'DELETE' });
            const data = await parseJsonSafe(res);
            if (!res.ok || !data.ok) {
              throw new Error(data.message || '삭제에 실패했습니다.');
            }
            await loadQuestCampaigns();
          },
          successMessage: '캠페인을 삭제했습니다.',
          failMessage: '캠페인 삭제 중 오류가 발생했습니다.',
        });
      });
    });
  }

  async function saveCampaignItems(campaignId, formEl) {
    const selectedTemplates = Array.from(
      formEl.querySelectorAll('.quest-template-select .quest-campaign-template')
    )
      .filter((el) => el.checked)
      .map((el) => {
        const templateId = el.getAttribute('data-template-id');
        const orderInput = formEl.querySelector(
          `input[data-template-order="${templateId}"]`
        );
        return {
          template_id: Number(templateId),
          sort_order: Number(orderInput?.value || 0),
        };
      });
    try {
      await fetch(`/api/admin/quest-campaigns/${campaignId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selectedTemplates }),
      });
    } catch (err) {
      console.error(err);
    }
  }

  function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function maskEmail(email) {
    if (!email || typeof email !== 'string') return '';
    const [user, domain] = email.split('@');
    if (!domain) return email;
    const maskedUser = user.length <= 2 ? user[0] + '*' : user.slice(0, 2) + '***';
    return `${maskedUser}@${domain}`;
  }

  return {
    init,
  };
})();

// DOMContentLoaded 시점에 모듈 init 호출
document.addEventListener('DOMContentLoaded', () => {
  if (
    window.Glsoop &&
    Glsoop.AdminPage &&
    typeof Glsoop.AdminPage.init === 'function'
  ) {
    Glsoop.AdminPage.init();
  }
});
