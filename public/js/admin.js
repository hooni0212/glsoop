// public/js/admin.js
// 글숲 관리자 페이지 스크립트 (모듈 방식)

window.Glsoop = window.Glsoop || {};

Glsoop.AdminPage = (function () {
  const ADMIN_ACTIVE_TAB_KEY = 'gls-admin-active-tab';

  const overviewState = {
    days: 7,
    initialized: false,
    loading: false,
  };

  const usersState = {
    page: 1,
    limit: 50,
    search: '',
    filter: 'all',
    sort: 'newest',
  };

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
    operationalAlerts: [],
    operationalHealth: null,
    writingCampaign: null,
    writingCampaignPushDryRun: null,
    writingCampaignPushSending: false,
    autoClaimLimit: 100,
    autoClaimResult: null,
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

  const deviceAnalyticsState = {
    from: '',
    to: '',
    source: 'all',
    deviceClass: 'all',
    platformFamily: 'all',
    userType: 'all',
    initialized: false,
  };

  const pushState = {
    title: '오늘의 기록을 아직 남기지 않았다면',
    body: '짧은 문장 하나로 오늘의 마음을 남겨보세요.',
    targetPath: '/write',
    customTargetPath: '',
    includeAdLabel: true,
    dryRun: null,
    audience: null,
    campaigns: [],
    deliverySummary: null,
    deliveries: [],
    recipientSummary: null,
    recipients: [],
    initialized: false,
    sending: false,
  };

  const safetyState = {
    status: 'all',
    limit: 100,
    summaryLimit: 50,
    initialized: false,
  };

  const SAFETY_REPORT_ACTION_CONFIG = {
    reviewing: {
      status: 'reviewing',
      action: 'under_review',
      actionDetail: '관리자 신고 목록에서 검토 중으로 변경',
      successMessage: '신고를 검토 중으로 표시했습니다.',
    },
    actioned: {
      status: 'actioned',
      action: 'moderation_action',
      actionDetail: '관리자 신고 목록에서 조치 완료 처리',
      successMessage: '신고를 조치 완료로 처리했습니다.',
    },
    dismissed: {
      status: 'dismissed',
      action: 'no_violation',
      actionDetail: '관리자 신고 목록에서 기각 처리',
      successMessage: '신고를 기각했습니다.',
    },
  };

  const REPORTED_POST_ACTION_CONFIG = {
    reviewing: {
      status: 'reviewing',
      action: 'under_review',
      actionDetail: '관리자 누적 신고 글 목록에서 검토 중으로 변경',
      successMessage: '신고 글을 검토 중으로 표시했습니다.',
    },
    actioned: {
      status: 'actioned',
      action: 'moderation_action',
      actionDetail: '관리자 누적 신고 글 목록에서 조치 완료 처리',
      successMessage: '신고 글의 미처리 신고를 조치 완료로 처리했습니다.',
    },
    dismissed: {
      status: 'dismissed',
      action: 'no_violation',
      actionDetail: '관리자 누적 신고 글 목록에서 기각 처리',
      successMessage: '신고 글의 미처리 신고를 기각했습니다.',
    },
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
    PROMPT_POST_CREATED: '프롬프트 글쓰기',
  };

  const CAMPAIGN_TYPE_LABELS = {
    permanent: '상시',
    daily: '일일',
    weekly: '주간',
    season: '시즌',
    event: '이벤트',
  };

  const SEASON_REWARD_BADGE_KEYS = [
    'badge_spring_2026',
    'badge_summer_2026',
    'badge_autumn_2026',
    'badge_winter_2026',
  ];
  const AUTO_CLAIM_LIMIT_MIN = 1;
  const AUTO_CLAIM_LIMIT_MAX = 500;
  const PUSH_TARGET_PRESETS = [
    { value: '/write', label: '글쓰기' },
    { value: '/notifications', label: '알림함' },
    { value: '/', label: '홈' },
    { value: 'custom', label: '직접 입력' },
  ];

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
    const overviewBox = document.getElementById('adminOverview');
    const usersBox = document.getElementById('adminUsers');
    const postsBox = document.getElementById('adminPosts');
    const shareSummaryBox = document.getElementById('adminShareSummary');
    const deviceAnalyticsBox = document.getElementById('adminDeviceAnalytics');
    const pushBox = document.getElementById('adminPushControls');
    const safetyReportsBox = document.getElementById('adminSafetyReports');
    const reportedPostsBox = document.getElementById('adminReportedPosts');

    if (
      !statusBox ||
      !contentBox ||
      !overviewBox ||
      !usersBox ||
      !postsBox ||
      !shareSummaryBox ||
      !deviceAnalyticsBox ||
      !pushBox ||
      !safetyReportsBox ||
      !reportedPostsBox
    ) {
      console.error(
        'adminStatus / adminContent / adminOverview / adminUsers / adminPosts / adminShareSummary / adminDeviceAnalytics / adminPushControls / adminSafetyReports / adminReportedPosts 요소를 찾을 수 없습니다.'
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
        회원, 글, 신고, 퀘스트를 이 페이지에서 관리할 수 있습니다.
      </p>
    `;
    contentBox.classList.remove('is-hidden');

    setupOverviewUi(overviewBox);
    await loadOverview(overviewBox);
    setupUsersUi(usersBox);
    await loadUsers(usersBox);
    setupPostsUi(postsBox);
    await loadPosts(postsBox);
    setupSafetyUi(safetyReportsBox, reportedPostsBox);
    await loadSafetyDashboard(safetyReportsBox, reportedPostsBox);
    setupGrowthOperationalControls();
    await loadWritingCampaignProject();
    await loadGrowthOperationalStatus();
    await loadQuestTemplates();
    await loadQuestCampaigns();
    setupAchievementBackfillButton();
    setupShareSummaryUi(shareSummaryBox);
    setupDeviceAnalyticsUi(deviceAnalyticsBox);
    setupPushUi(pushBox);
    await loadPushDashboard(pushBox);
  }

  function setupOverviewUi(overviewBox) {
    if (overviewState.initialized) return;
    overviewState.initialized = true;

    document.querySelectorAll('[data-overview-days]').forEach((button) => {
      button.addEventListener('click', () => {
        const days = Number.parseInt(button.getAttribute('data-overview-days') || '', 10);
        if (![7, 30].includes(days) || days === overviewState.days) return;
        overviewState.days = days;
        syncOverviewPeriodButtons();
        loadOverview(overviewBox);
      });
    });

    document.getElementById('adminOverviewRefreshBtn')?.addEventListener('click', () => {
      loadOverview(overviewBox);
    });

    syncOverviewPeriodButtons();
  }

  function syncOverviewPeriodButtons() {
    document.querySelectorAll('[data-overview-days]').forEach((button) => {
      const isActive = Number(button.getAttribute('data-overview-days')) === overviewState.days;
      button.classList.toggle('gls-btn-primary', isActive);
      button.classList.toggle('gls-btn-secondary', !isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  async function loadOverview(overviewBox) {
    if (!overviewBox || overviewState.loading) return;
    overviewState.loading = true;
    const refreshButton = document.getElementById('adminOverviewRefreshBtn');
    if (refreshButton) refreshButton.disabled = true;
    overviewBox.innerHTML = '<p class="gls-text-muted">운영 요약을 불러오는 중입니다...</p>';

    try {
      const response = await fetch(`/api/admin/overview?days=${overviewState.days}`, {
        cache: 'no-store',
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || '운영 요약을 불러오지 못했습니다.');
      }

      setTabCount('overviewTab', Number(payload?.headline?.active_users?.current || 0));
      overviewBox.innerHTML = renderOverviewHtml(payload);
      bindOverviewPanelEvents(overviewBox);
    } catch (error) {
      console.error(error);
      setTabCount('overviewTab', '-');
      overviewBox.innerHTML = `
        <div class="admin-overview-error">
          <strong>운영 요약을 불러오지 못했습니다.</strong>
          <p class="gls-text-muted gls-text-small gls-mb-0">${escapeHtml(
            error.message || '잠시 후 다시 시도해 주세요.'
          )}</p>
        </div>
      `;
    } finally {
      overviewState.loading = false;
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  function renderOverviewHtml(payload) {
    const period = payload?.period || {};
    const headline = payload?.headline || {};
    const activation = payload?.activation || {};
    const writing = payload?.writing || {};
    const retention = payload?.retention || {};
    const operations = payload?.operations || {};
    const definitions = payload?.definitions || {};
    const periodLabel = `${period.current_start_date || '-'} ~ ${period.current_end_date || '-'}`;
    const comparisonLabel = `${period.previous_start_date || '-'} ~ ${period.previous_end_date || '-'}`;

    const headlineCards = [
      buildOverviewMetricCard('활성 사용자', headline.active_users, '명', '기간 내 로그인 행동 사용자'),
      buildOverviewMetricCard('가입 완료', headline.verified_users, '명', '가입 시각 기준'),
      buildOverviewRateCard(
        '24시간 내 첫 글',
        headline.activation_24h_rate,
        '가입 후 관찰 완료 코호트'
      ),
      buildOverviewMetricCard('작성된 글', headline.posts_created, '개', '관리자 작성 글 제외'),
      buildOverviewMetricCard('글쓴 사용자', headline.writers, '명', '기간 내 고유 작성자'),
      buildOverviewMetricCard('2회 이상 작성', headline.repeat_writers, '명', '글쓰기 습관 핵심 지표'),
      buildOverviewMetricCard(
        '콘텐츠 반응',
        headline.engagement_events,
        '회',
        '좋아요·저장·댓글·공유'
      ),
      buildOverviewMetricCard(
        '반응 참여자',
        headline.engagement_participants,
        '명',
        '로그인 고유 참여자'
      ),
    ].join('');

    return `
      <div class="admin-overview-period gls-mb-3">
        <div>
          <span class="admin-overview-period__label">현재</span>
          <strong>${escapeHtml(periodLabel)}</strong>
        </div>
        <div class="gls-text-muted gls-text-small">비교 기간 ${escapeHtml(comparisonLabel)} · 오늘 수치는 집계 중</div>
      </div>

      <section class="admin-overview-section" aria-labelledby="adminOverviewHeadlineTitle">
        <div class="admin-overview-section__heading">
          <div>
            <p class="gls-text-muted gls-text-small gls-mb-1">핵심 현황</p>
            <h4 id="adminOverviewHeadlineTitle" class="gls-mb-0">최근 ${Number(period.days || overviewState.days)}일</h4>
          </div>
        </div>
        <div class="admin-overview-metric-grid">${headlineCards}</div>
      </section>

      <div class="admin-overview-split">
        <section class="admin-overview-section admin-overview-card" aria-labelledby="adminOverviewActivationTitle">
          <div class="admin-overview-section__heading">
            <div>
              <p class="gls-text-muted gls-text-small gls-mb-1">Activation</p>
              <h4 id="adminOverviewActivationTitle" class="gls-mb-0">가입에서 첫 글까지</h4>
            </div>
            <strong class="admin-overview-rate">${formatOverviewRate(activation.first_post_24h_rate)}</strong>
          </div>
          ${buildOverviewFunnel(activation)}
          <p class="gls-text-muted gls-text-small gls-mb-0">최근 24시간에 가입한 사용자는 아직 관찰 중이므로 제외합니다.</p>
        </section>

        <section class="admin-overview-section admin-overview-card" aria-labelledby="adminOverviewWritingTitle">
          <div class="admin-overview-section__heading">
            <div>
              <p class="gls-text-muted gls-text-small gls-mb-1">Writing habit</p>
              <h4 id="adminOverviewWritingTitle" class="gls-mb-0">다시 쓰는 사용자</h4>
            </div>
            <strong class="admin-overview-rate">${formatOverviewRate(writing.returning_writer_rate)}</strong>
          </div>
          <div class="admin-overview-writing-stats">
            <div><strong>${formatOverviewNumber(writing.returning_writers)}</strong><span>이전에도 쓴 사용자</span></div>
            <div><strong>${formatOverviewNumber(writing.repeat_writers)}</strong><span>기간 내 2회 이상 작성</span></div>
            <div><strong>${formatOverviewNumber(writing.active_drafts_now)}</strong><span>서버 보관 초안 · ${formatOverviewNumber(writing.draft_writers_now)}명</span></div>
          </div>
          <p class="gls-text-muted gls-text-small gls-mb-0">재방문 작성률은 기간 내 작성자 중 과거 글이 있는 사용자의 비율입니다.</p>
        </section>
      </div>

      <section class="admin-overview-section" aria-labelledby="adminOverviewRetentionTitle">
        <div class="admin-overview-section__heading">
          <div>
            <p class="gls-text-muted gls-text-small gls-mb-1">Retention</p>
            <h4 id="adminOverviewRetentionTitle" class="gls-mb-0">관찰이 끝난 사용자 리텐션</h4>
          </div>
        </div>
        <div class="admin-overview-retention-grid">
          ${buildOverviewRetentionCard('D1 재방문', retention.d1, 'returned_count')}
          ${buildOverviewRetentionCard('D7 재방문', retention.d7, 'returned_count')}
          ${buildOverviewRetentionCard('7일 내 재작성', retention.rewrite_7d, 'rewritten_count')}
        </div>
      </section>

      ${buildOverviewOperations(operations)}
      ${buildOverviewDailyTrend(payload?.daily || [])}
      ${buildOverviewDefinitions(definitions)}
    `;
  }

  function buildOverviewMetricCard(label, metric, suffix, description) {
    const current = Number(metric?.current || 0);
    const previous = Number(metric?.previous || 0);
    const trend = buildOverviewTrend(metric?.delta, metric?.change_percent, current, previous, false);
    return `
      <article class="admin-overview-metric">
        <p class="admin-overview-metric__label">${escapeHtml(label)}</p>
        <div class="admin-overview-metric__value">${formatOverviewNumber(current)}<span>${escapeHtml(suffix)}</span></div>
        ${trend}
        <p class="gls-text-muted gls-text-small gls-mb-0">${escapeHtml(description)}</p>
      </article>
    `;
  }

  function buildOverviewRateCard(label, metric, description) {
    const current = Number(metric?.current || 0);
    const delta = Number(metric?.delta_percentage_points || 0);
    const tone = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral';
    const sign = delta > 0 ? '+' : '';
    return `
      <article class="admin-overview-metric">
        <p class="admin-overview-metric__label">${escapeHtml(label)}</p>
        <div class="admin-overview-metric__value">${formatOverviewRate(current)}</div>
        <div class="admin-overview-trend admin-overview-trend--${tone}">
          직전 기간 대비 ${sign}${delta.toFixed(1)}%p
        </div>
        <p class="gls-text-muted gls-text-small gls-mb-0">${escapeHtml(description)} ${formatOverviewNumber(metric?.current_base)}명</p>
      </article>
    `;
  }

  function buildOverviewTrend(deltaValue, changePercentValue, current, previous, inverse) {
    const delta = Number(deltaValue || 0);
    const changePercent = Number(changePercentValue);
    if (previous === 0 && current > 0) {
      return '<div class="admin-overview-trend admin-overview-trend--positive">직전 기간 0 · 신규 발생</div>';
    }

    const adjustedDelta = inverse ? -delta : delta;
    const tone = adjustedDelta > 0 ? 'positive' : adjustedDelta < 0 ? 'negative' : 'neutral';
    const sign = delta > 0 ? '+' : '';
    const percentText = Number.isFinite(changePercent) ? ` (${sign}${changePercent.toFixed(1)}%)` : '';
    return `
      <div class="admin-overview-trend admin-overview-trend--${tone}">
        직전 기간 대비 ${sign}${formatOverviewNumber(delta)}${percentText}
      </div>
    `;
  }

  function buildOverviewFunnel(activation) {
    const verified = Number(activation?.verified_users || 0);
    const firstPost = Number(activation?.first_post_24h_users || 0);
    const width = verified > 0 ? Math.max(4, Math.min(100, (firstPost * 100) / verified)) : 0;
    return `
      <div class="admin-overview-funnel">
        <div class="admin-overview-funnel__step">
          <div><span>가입 완료</span><strong>${formatOverviewNumber(verified)}명</strong></div>
          <div class="admin-overview-funnel__bar"><span style="width:100%"></span></div>
        </div>
        <div class="admin-overview-funnel__arrow" aria-hidden="true">↓</div>
        <div class="admin-overview-funnel__step">
          <div><span>24시간 내 첫 글</span><strong>${formatOverviewNumber(firstPost)}명</strong></div>
          <div class="admin-overview-funnel__bar"><span style="width:${width.toFixed(1)}%"></span></div>
        </div>
      </div>
    `;
  }

  function buildOverviewRetentionCard(label, value, resultKey) {
    const cohort = Number(value?.cohort_count || 0);
    const result = Number(value?.[resultKey] || 0);
    return `
      <article class="admin-overview-retention-card">
        <p class="gls-text-muted gls-text-small gls-mb-1">${escapeHtml(label)}</p>
        <strong>${formatOverviewRate(value?.rate)}</strong>
        <span>${formatOverviewNumber(result)}명 / 코호트 ${formatOverviewNumber(cohort)}명</span>
      </article>
    `;
  }

  function buildOverviewOperations(operations) {
    const safety = operations?.safety || {};
    const push = operations?.push || {};
    const publishing = operations?.publishing || {};
    const api = operations?.api || {};
    const safetyTone = Number(safety.overdue_24h_count || 0) > 0 ? 'danger' : Number(safety.open_count || 0) > 0 ? 'warning' : 'success';
    const pushTone = Number(push.period_failed || 0) > 0 ? 'danger' : Number(push.queued_now || 0) > 0 ? 'warning' : 'success';
    const publishingTone = Number(publishing.error_rate || 0) >= 5 ? 'danger' : Number(publishing.error_count || 0) > 0 ? 'warning' : 'success';
    const apiTone = Number(api.server_error_rate || 0) >= 1 ? 'danger' : Number(api.server_error_count || 0) > 0 ? 'warning' : 'success';

    return `
      <section class="admin-overview-section" aria-labelledby="adminOverviewOperationsTitle">
        <div class="admin-overview-section__heading">
          <div>
            <p class="gls-text-muted gls-text-small gls-mb-1">Operations</p>
            <h4 id="adminOverviewOperationsTitle" class="gls-mb-0">확인이 필요한 운영 상태</h4>
          </div>
        </div>
        <div class="admin-overview-operations-grid">
          <article class="admin-overview-operation admin-overview-operation--${safetyTone}">
            <div class="admin-overview-operation__head"><strong>신고</strong><span>${formatOverviewNumber(safety.open_count)}건 열림</span></div>
            <p>24시간 초과 ${formatOverviewNumber(safety.overdue_24h_count)}건 · 최장 ${formatOverviewNumber(safety.oldest_open_hours)}시간</p>
            <button class="gls-btn gls-btn-secondary gls-btn-xs" type="button" data-overview-target="safetyTab">신고 확인</button>
          </article>
          <article class="admin-overview-operation admin-overview-operation--${pushTone}">
            <div class="admin-overview-operation__head"><strong>푸시</strong><span>실패율 ${formatOverviewRate(push.failure_rate)}</span></div>
            <p>기간 실패 ${formatOverviewNumber(push.period_failed)}건 · 현재 대기 ${formatOverviewNumber(push.queued_now)}건</p>
            <button class="gls-btn gls-btn-secondary gls-btn-xs" type="button" data-overview-target="pushTab">푸시 확인</button>
          </article>
          <article class="admin-overview-operation admin-overview-operation--${publishingTone}">
            <div class="admin-overview-operation__head"><strong>웹 글 발행</strong><span>오류율 ${formatOverviewRate(publishing.error_rate)}</span></div>
            <p>웹 발행 시도 ${formatOverviewNumber(publishing.submit_count)}회 · 오류 ${formatOverviewNumber(publishing.error_count)}회</p>
            <button class="gls-btn gls-btn-secondary gls-btn-xs" type="button" data-overview-target="deviceAnalyticsTab">UX 상세</button>
          </article>
          <article class="admin-overview-operation admin-overview-operation--${apiTone}">
            <div class="admin-overview-operation__head"><strong>API</strong><span>서버 오류율 ${formatOverviewRate(api.server_error_rate)}</span></div>
            <p>${formatOverviewNumber(api.request_count)}회 · 평균 ${formatOverviewNumber(api.average_duration_ms)}ms · 최장 ${formatOverviewNumber(api.max_duration_ms)}ms</p>
            <span class="gls-text-muted gls-text-small">4xx ${formatOverviewNumber(api.client_error_count)}건 · 5xx ${formatOverviewNumber(api.server_error_count)}건</span>
          </article>
        </div>
      </section>
    `;
  }

  function buildOverviewDailyTrend(daily) {
    const rows = Array.isArray(daily) ? daily : [];
    const maxValue = Math.max(1, ...rows.map((row) => Math.max(Number(row.active_users || 0), Number(row.posts_created || 0))));
    const rowsHtml = rows
      .map((row) => {
        const active = Number(row.active_users || 0);
        const posts = Number(row.posts_created || 0);
        return `
          <div class="admin-overview-day-row">
            <time datetime="${escapeHtml(row.day || '')}">${escapeHtml(formatOverviewDay(row.day))}</time>
            <div class="admin-overview-day-bars">
              <div><span class="admin-overview-day-bars__active" style="width:${((active * 100) / maxValue).toFixed(1)}%"></span></div>
              <div><span class="admin-overview-day-bars__posts" style="width:${((posts * 100) / maxValue).toFixed(1)}%"></span></div>
            </div>
            <div class="admin-overview-day-values"><span>활성 ${formatOverviewNumber(active)}</span><span>글 ${formatOverviewNumber(posts)}</span></div>
          </div>
        `;
      })
      .join('');

    return `
      <section class="admin-overview-section admin-overview-card" aria-labelledby="adminOverviewDailyTitle">
        <div class="admin-overview-section__heading">
          <div>
            <p class="gls-text-muted gls-text-small gls-mb-1">Daily trend</p>
            <h4 id="adminOverviewDailyTitle" class="gls-mb-0">일별 활성 사용자와 글</h4>
          </div>
          <div class="admin-overview-legend"><span class="is-active">활성 사용자</span><span class="is-posts">작성 글</span></div>
        </div>
        <div class="admin-overview-days">${rowsHtml || '<p class="gls-text-muted gls-mb-0">표시할 데이터가 없습니다.</p>'}</div>
      </section>
    `;
  }

  function buildOverviewDefinitions(definitions) {
    const entries = Object.values(definitions || {}).filter(Boolean);
    if (!entries.length) return '';
    return `
      <details class="admin-overview-definitions">
        <summary>지표 기준 보기</summary>
        <ul>${entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>
      </details>
    `;
  }

  function bindOverviewPanelEvents(overviewBox) {
    overviewBox.querySelectorAll('[data-overview-target]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.getAttribute('data-overview-target');
        document.querySelector(`.admin-tabs .nav-link[data-target="${target}"]`)?.click();
      });
    });
  }

  function formatOverviewNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function formatOverviewRate(value) {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  function formatOverviewDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return value || '-';
    const [, month, day] = String(value).split('-');
    return `${Number(month)}월 ${Number(day)}일`;
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
    const themeCard = document.querySelector('.admin-theme-card');
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
      themeCard?.classList.toggle('gls-hidden', targetId === 'overviewTab');
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

  function formatAdminDateTime(value) {
    if (!value) return '-';
    if (typeof window.formatKoreanDateTime === 'function') {
      return window.formatKoreanDateTime(value) || '-';
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('ko-KR');
  }

  function resolveSafetyDisplayName(displayName, nickname, fallback = '-') {
    if (typeof displayName === 'string' && displayName.trim()) return displayName.trim();
    if (typeof nickname === 'string' && nickname.trim()) return nickname.trim();
    return fallback;
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
      const mode = input.dataset.confirmMode || 'token';
      const value = String(input.value || '').trim();
      confirmBtn.disabled =
        mode === 'admin-password' ? value.length === 0 : value.toUpperCase() !== DANGER_CONFIRM_TOKEN;
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
    const inputLabelEl = document.getElementById('adminDangerInputLabel');
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
    const confirmMode = options.confirmMode || 'token';
    const inputLabel =
      options.inputLabel ||
      (confirmMode === 'admin-password'
        ? '관리자 비밀번호를 입력하세요.'
        : '삭제하려면 DELETE 를 입력하세요.');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (inputLabelEl) inputLabelEl.textContent = inputLabel;
    confirmBtn.textContent = actionLabel;
    input.value = '';
    input.type = confirmMode === 'admin-password' ? 'password' : 'text';
    input.autocomplete = confirmMode === 'admin-password' ? 'current-password' : 'off';
    input.dataset.confirmMode = confirmMode;
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

    const inputValue = input ? String(input.value || '') : '';

    modal.classList.add('gls-hidden');
    modal.dataset.adminDangerConfirm = 'closed';
    document.body.dataset.adminDangerConfirm = 'closed';
    if (input) {
      input.value = '';
      input.type = 'text';
      input.autocomplete = 'off';
      input.dataset.confirmMode = 'token';
    }
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
      resolver({ confirmed: Boolean(confirmed), inputValue });
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
      confirmMode = 'token',
      inputLabel,
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
      confirmMode,
      inputLabel,
      triggerEl,
    });
    const confirmationResult =
      typeof confirmed === 'object' && confirmed !== null
        ? confirmed
        : { confirmed: Boolean(confirmed), inputValue: '' };
    if (!confirmationResult.confirmed) return false;
    if (inFlightDangerActions.has(actionKey)) return false;

    inFlightDangerActions.add(actionKey);
    const releaseTrigger = lockDangerTrigger(triggerEl, pendingLabel);
    try {
      await request({
        confirmationInput: confirmationResult.inputValue,
        adminPassword: confirmMode === 'admin-password' ? confirmationResult.inputValue : '',
      });
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



  function setupSafetyUi(safetyReportsBox, reportedPostsBox) {
    const filterBox = document.getElementById('adminSafetyFilters');
    if (!safetyReportsBox || !reportedPostsBox || !filterBox || safetyState.initialized) return;

    safetyState.initialized = true;
    renderSafetyFilters(filterBox);

    filterBox.addEventListener('click', (event) => {
      if (event.target.id !== 'adminSafetyApply') return;
      event.preventDefault();
      applySafetyFilters(filterBox);
      loadSafetyDashboard(safetyReportsBox, reportedPostsBox);
    });

    filterBox.addEventListener('submit', (event) => {
      if (event.target.id !== 'adminSafetyForm') return;
      event.preventDefault();
      applySafetyFilters(filterBox);
      loadSafetyDashboard(safetyReportsBox, reportedPostsBox);
    });

    safetyReportsBox.addEventListener('click', (event) => {
      const button = event.target.closest('[data-safety-report-action]');
      if (!button || button.disabled) return;
      event.preventDefault();
      handleSafetyReportAction(button, safetyReportsBox, reportedPostsBox);
    });

    reportedPostsBox.addEventListener('click', (event) => {
      const button = event.target.closest('[data-reported-post-action]');
      if (!button || button.disabled) return;
      event.preventDefault();
      handleReportedPostAction(button, safetyReportsBox, reportedPostsBox);
    });
  }

  function renderSafetyFilters(filterBox) {
    filterBox.innerHTML = [
      '<form id="adminSafetyForm" class="admin-toolbar admin-share-toolbar admin-safety-toolbar">',
      '  <label>상태<select class="gls-select gls-select-sm" id="adminSafetyStatus">' +
        buildSafetyStatusOptions(safetyState.status) +
        '</select></label>',
      '  <label>신고 수<input type="number" class="gls-input gls-input-sm" id="adminSafetyLimit" min="1" max="100" value="' +
        String(safetyState.limit) +
        '"></label>',
      '  <label>요약 수<input type="number" class="gls-input gls-input-sm" id="adminSafetySummaryLimit" min="1" max="100" value="' +
        String(safetyState.summaryLimit) +
        '"></label>',
      '  <div class="admin-share-toolbar__actions">',
      '    <button class="gls-btn gls-btn-primary gls-btn-sm" type="submit" id="adminSafetyApply">적용</button>',
      '  </div>',
      '</form>',
    ].join('');
  }

  function buildSafetyStatusOptions(selected) {
    const options = [
      { value: 'all', label: '전체' },
      { value: 'queued', label: '접수' },
      { value: 'reviewing', label: '검토 중' },
      { value: 'actioned', label: '조치 완료' },
      { value: 'dismissed', label: '기각' },
    ];

    return options
      .map((option) => {
        const selectedAttr = option.value === selected ? ' selected' : '';
        return '<option value="' + option.value + '"' + selectedAttr + '>' + option.label + '</option>';
      })
      .join('');
  }

  function applySafetyFilters(filterBox) {
    const statusInput = filterBox.querySelector('#adminSafetyStatus');
    const limitInput = filterBox.querySelector('#adminSafetyLimit');
    const summaryLimitInput = filterBox.querySelector('#adminSafetySummaryLimit');

    const nextStatus = String(statusInput?.value || 'all').trim().toLowerCase();
    safetyState.status = ['all', 'queued', 'reviewing', 'actioned', 'dismissed'].includes(nextStatus)
      ? nextStatus
      : 'all';
    safetyState.limit = clampShareLimit(limitInput?.value, 1, 100, 100);
    safetyState.summaryLimit = clampShareLimit(summaryLimitInput?.value, 1, 100, 50);
  }

  async function loadSafetyDashboard(safetyReportsBox, reportedPostsBox) {
    await Promise.all([
      loadSafetyReports(safetyReportsBox),
      loadReportedPosts(reportedPostsBox),
    ]);
  }

  async function loadSafetyReports(safetyReportsBox) {
    safetyReportsBox.innerHTML = '<p class="gls-text-muted">신고 목록을 불러오는 중입니다...</p>';

    try {
      const params = new URLSearchParams();
      params.set('limit', String(safetyState.limit));
      if (safetyState.status !== 'all') {
        params.set('status', safetyState.status);
      }

      const response = await fetch('/api/admin/safety/reports?' + params.toString(), {
        cache: 'no-store',
      });
      const payload = await parseJsonSafe(response);

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
        setTabCount('safetyTab', '-');
        const message =
          typeof payload?.message === 'string'
            ? payload.message
            : '신고 목록을 불러오지 못했습니다.';
        safetyReportsBox.innerHTML = '<p class="text-danger">' + escapeHtml(message) + '</p>';
        return;
      }

      const reports = Array.isArray(payload.reports) ? payload.reports : [];
      setTabCount('safetyTab', reports.length);
      safetyReportsBox.innerHTML = renderSafetyReportsHtml(reports);
    } catch (error) {
      console.error('safety reports 로드 실패:', error);
      setTabCount('safetyTab', '-');
      safetyReportsBox.innerHTML =
        '<p class="text-danger">신고 목록을 불러오는 중 오류가 발생했습니다.</p>';
    }
  }

  async function loadReportedPosts(reportedPostsBox) {
    reportedPostsBox.innerHTML = '<p class="gls-text-muted">누적 신고 글을 불러오는 중입니다...</p>';

    try {
      const params = new URLSearchParams({
        limit: String(safetyState.summaryLimit),
        threshold: '5',
      });
      const response = await fetch('/api/admin/safety/reported-posts?' + params.toString(), {
        cache: 'no-store',
      });
      const payload = await parseJsonSafe(response);

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
        const message =
          typeof payload?.message === 'string'
            ? payload.message
            : '누적 신고 글을 불러오지 못했습니다.';
        reportedPostsBox.innerHTML = '<p class="text-danger">' + escapeHtml(message) + '</p>';
        return;
      }

      const posts = Array.isArray(payload.posts) ? payload.posts : [];
      reportedPostsBox.innerHTML = renderReportedPostsHtml(posts);
    } catch (error) {
      console.error('reported posts 로드 실패:', error);
      reportedPostsBox.innerHTML =
        '<p class="text-danger">누적 신고 글을 불러오는 중 오류가 발생했습니다.</p>';
    }
  }

  async function handleSafetyReportAction(button, safetyReportsBox, reportedPostsBox) {
    const actionKey = button.getAttribute('data-safety-report-action');
    const postId = button.getAttribute('data-post-id');

    if (actionKey === 'open-post') {
      openPostDetail(postId);
      return;
    }

    const reportId = button.getAttribute('data-report-id');
    const config = SAFETY_REPORT_ACTION_CONFIG[actionKey];
    if (!reportId || !config) return;

    const release = lockDangerTrigger(button, '처리 중...');
    try {
      await postAdminJson(`/api/admin/safety/reports/${encodeURIComponent(reportId)}/resolve`, {
        status: config.status,
        action: config.action,
        action_detail: config.actionDetail,
      });
      showAdminNotice(config.successMessage, 'success');
      await loadSafetyDashboard(safetyReportsBox, reportedPostsBox);
    } catch (error) {
      console.error(error);
      showAdminNotice(error?.message || '신고 처리 중 오류가 발생했습니다.', 'error');
    } finally {
      release();
    }
  }

  async function handleReportedPostAction(button, safetyReportsBox, reportedPostsBox) {
    const actionKey = button.getAttribute('data-reported-post-action');
    const postId = button.getAttribute('data-post-id');
    if (!postId) return;

    if (actionKey === 'open-post') {
      openPostDetail(postId);
      return;
    }

    if (actionKey === 'delete-post') {
      await deleteReportedPostFromSafety(postId, button, safetyReportsBox, reportedPostsBox);
      return;
    }

    const config = REPORTED_POST_ACTION_CONFIG[actionKey];
    if (!config) return;

    const release = lockDangerTrigger(button, '처리 중...');
    try {
      await postAdminJson(
        `/api/admin/safety/reported-posts/${encodeURIComponent(postId)}/resolve`,
        {
          status: config.status,
          action: config.action,
          action_detail: config.actionDetail,
        }
      );
      showAdminNotice(config.successMessage, 'success');
      await loadSafetyDashboard(safetyReportsBox, reportedPostsBox);
    } catch (error) {
      console.error(error);
      showAdminNotice(error?.message || '신고 글 처리 중 오류가 발생했습니다.', 'error');
    } finally {
      release();
    }
  }

  async function deleteReportedPostFromSafety(postId, triggerEl, safetyReportsBox, reportedPostsBox) {
    await runDangerAction({
      actionKey: `delete-reported-post-${postId}`,
      title: '신고 글 삭제 확인',
      message: `글 ID ${postId}를 삭제하고 연결된 미처리 신고를 조치 완료로 처리합니다. 이 작업은 되돌릴 수 없습니다.`,
      triggerEl,
      pendingLabel: '삭제 중...',
      request: async () => {
        await postAdminJson(
          `/api/admin/safety/reported-posts/${encodeURIComponent(postId)}/delete`,
          {
            action_detail: '관리자 신고 글 처리 UI에서 삭제',
          }
        );
        removePostCardFromAdminGrid(postId);
        await loadSafetyDashboard(safetyReportsBox, reportedPostsBox);
      },
      successMessage: '신고 글을 삭제하고 신고를 조치 완료했습니다.',
      failMessage: '신고 글 삭제 중 오류가 발생했습니다.',
    });
  }

  async function postAdminJson(url, body = {}) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await parseJsonSafe(response);

    if (response.status === 401) {
      alert('로그인이 필요한 페이지입니다.');
      window.location.href = '/html/login.html?next=/admin';
      throw new Error('로그인이 필요합니다.');
    }

    if (response.status === 403) {
      alert('관리자 권한이 필요합니다.');
      window.location.href = '/index.html';
      throw new Error('관리자 권한이 필요합니다.');
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload?.message || '관리자 요청 처리 중 오류가 발생했습니다.');
    }

    return payload;
  }

  function openPostDetail(postId) {
    if (!postId) return;
    const targetUrl = `/html/post.html?postId=${encodeURIComponent(postId)}`;
    window.open(targetUrl, '_blank');
  }

  function removePostCardFromAdminGrid(postId) {
    const card = document.querySelector(`.admin-post-card[data-post-id="${postId}"]`);
    if (!card) return;

    card.remove();
    decreaseTabCount('postsTab', 1);

    const grid = document.getElementById('adminPostsGrid');
    if (grid && !grid.querySelector('.admin-post-card')) {
      grid.innerHTML = '<p class="gls-text-muted">등록된 글이 없습니다.</p>';
    }
  }

  function renderSafetyReportsHtml(reports) {
    if (!reports.length) {
      return '<p class="gls-text-muted gls-mb-0">조건에 맞는 신고가 없습니다.</p>';
    }

    function formatSafetySource(source) {
      if (String(source || '').trim().toLowerCase() === 'block') {
        return '차단 자동 접수';
      }
      return '사용자 신고';
    }

    const rowsHtml = reports
      .map((report) => {
        const reporter = resolveSafetyDisplayName(
          report.reporter_display_name,
          report.reporter_nickname,
          report.reporter_id ? `회원 #${report.reporter_id}` : '-'
        );
        const targetUser = resolveSafetyDisplayName(
          report.target_user_display_name,
          report.target_user_nickname,
          report.target_user_id ? `회원 #${report.target_user_id}` : '-'
        );
        const targetPost = report.target_post_title
          ? `${report.target_post_title} (#${report.target_post_id || '-'})`
          : report.target_post_id
            ? `글 #${report.target_post_id}`
            : '-';
        const detail = report.detail && String(report.detail).trim()
          ? escapeHtml(report.detail)
          : '<span class="gls-text-muted">-</span>';

        return [
          '<tr data-report-id="' + escapeHtml(report.id || '') + '">',
          '<td>' + escapeHtml(reporter) + '</td>',
          '<td>' + escapeHtml(targetUser) + '</td>',
          '<td>' + escapeHtml(targetPost) + '</td>',
          '<td><span class="admin-safety-pill">' + escapeHtml(formatSafetySource(report.source)) + '</span></td>',
          '<td><span class="admin-safety-pill">' + escapeHtml(report.reason_code || '-') + '</span></td>',
          '<td>' + detail + '</td>',
          '<td>' + escapeHtml(formatAdminDateTime(report.created_at)) + '</td>',
          '<td>' + buildSafetyStatusBadge(report.status) + '</td>',
          '<td>' + buildSafetyReportActions(report) + '</td>',
          '</tr>',
        ].join('');
      })
      .join('');

    return [
      '<div class="table-responsive">',
      '  <table class="table table-sm align-middle admin-safety-table">',
      '    <thead>',
      '      <tr>',
      '        <th>신고자</th>',
      '        <th>대상 사용자</th>',
      '        <th>대상 글</th>',
      '        <th>접수 경로</th>',
      '        <th>사유</th>',
      '        <th>상세</th>',
      '        <th>접수 시각</th>',
      '        <th>상태</th>',
      '        <th>처리</th>',
      '      </tr>',
      '    </thead>',
      '    <tbody>',
      rowsHtml,
      '    </tbody>',
      '  </table>',
      '</div>',
    ].join('');
  }

  function renderReportedPostsHtml(posts) {
    if (!posts.length) {
      return '<p class="gls-text-muted gls-mb-0">누적 신고 5건 이상인 글이 없습니다.</p>';
    }

    const rowsHtml = posts
      .map((post) => {
        const author = resolveSafetyDisplayName(
          post.target_user_display_name,
          post.target_user_nickname,
          post.target_user_id ? `회원 #${post.target_user_id}` : '-'
        );

        return [
          '<tr data-reported-post-id="' + escapeHtml(post.target_post_id || '') + '">',
          '<td>' + escapeHtml(post.target_post_title || `글 #${post.target_post_id || '-'}`) + '</td>',
          '<td>' + escapeHtml(author) + '</td>',
          '<td class="gls-text-end">' + formatCount(post.report_count) + '</td>',
          '<td class="gls-text-end">' + formatCount(post.unique_reporter_count) + '</td>',
          '<td>' + buildReportedPostStatusSummary(post) + '</td>',
          '<td>' + escapeHtml(formatAdminDateTime(post.latest_reported_at)) + '</td>',
          '<td>' + buildReportedPostActions(post) + '</td>',
          '</tr>',
        ].join('');
      })
      .join('');

    return [
      '<div class="table-responsive">',
      '  <table class="table table-sm align-middle admin-safety-summary-table">',
      '    <thead>',
      '      <tr>',
      '        <th>글 제목</th>',
      '        <th>작성자</th>',
      '        <th class="gls-text-end">신고</th>',
      '        <th class="gls-text-end">신고자</th>',
      '        <th>상태</th>',
      '        <th>최신 신고</th>',
      '        <th>처리</th>',
      '      </tr>',
      '    </thead>',
      '    <tbody>',
      rowsHtml,
      '    </tbody>',
      '  </table>',
      '</div>',
    ].join('');
  }

  function buildSafetyReportActions(report) {
    const reportId = report?.id ? String(report.id) : '';
    const postId = report?.target_post_id ? String(report.target_post_id) : '';
    const status = normalizeSafetyStatus(report?.status);
    const isResolved = status === 'actioned' || status === 'dismissed';
    const viewButton = postId
      ? '<button class="gls-btn gls-btn-secondary gls-btn-xs" type="button" data-safety-report-action="open-post" data-post-id="' +
        escapeHtml(postId) +
        '">보기</button>'
      : '';

    return [
      '<div class="admin-safety-actions">',
      viewButton,
      '<button class="gls-btn gls-btn-secondary gls-btn-xs" type="button" data-safety-report-action="reviewing" data-report-id="' +
        escapeHtml(reportId) +
        '"' +
        (status === 'reviewing' || isResolved ? ' disabled' : '') +
        '>검토</button>',
      '<button class="gls-btn gls-btn-primary gls-btn-xs" type="button" data-safety-report-action="actioned" data-report-id="' +
        escapeHtml(reportId) +
        '"' +
        (status === 'actioned' ? ' disabled' : '') +
        '>조치</button>',
      '<button class="gls-btn gls-btn-ghost gls-btn-xs" type="button" data-safety-report-action="dismissed" data-report-id="' +
        escapeHtml(reportId) +
        '"' +
        (status === 'dismissed' ? ' disabled' : '') +
        '>기각</button>',
      '</div>',
    ].join('');
  }

  function buildReportedPostStatusSummary(post) {
    const queuedCount = toCount(post?.queued_count);
    const reviewingCount = toCount(post?.reviewing_count);
    const pills = [];

    if (queuedCount > 0) {
      pills.push(
        '<span class="admin-safety-status admin-safety-status--queued">접수 ' +
          escapeHtml(formatCount(queuedCount)) +
          '</span>'
      );
    }
    if (reviewingCount > 0) {
      pills.push(
        '<span class="admin-safety-status admin-safety-status--reviewing">검토 ' +
          escapeHtml(formatCount(reviewingCount)) +
          '</span>'
      );
    }

    if (!pills.length) {
      pills.push('<span class="admin-safety-status admin-safety-status--queued">접수</span>');
    }

    return '<div class="admin-safety-status-list">' + pills.join('') + '</div>';
  }

  function buildReportedPostActions(post) {
    const postId = post?.target_post_id ? String(post.target_post_id) : '';
    const disabled = postId ? '' : ' disabled';

    return [
      '<div class="admin-safety-actions admin-safety-actions--reported-post">',
      '<button class="gls-btn gls-btn-secondary gls-btn-xs" type="button" data-reported-post-action="open-post" data-post-id="' +
        escapeHtml(postId) +
        '"' +
        disabled +
        '>보기</button>',
      '<button class="gls-btn gls-btn-secondary gls-btn-xs" type="button" data-reported-post-action="reviewing" data-post-id="' +
        escapeHtml(postId) +
        '"' +
        disabled +
        '>검토</button>',
      '<button class="gls-btn gls-btn-primary gls-btn-xs" type="button" data-reported-post-action="actioned" data-post-id="' +
        escapeHtml(postId) +
        '"' +
        disabled +
        '>조치</button>',
      '<button class="gls-btn gls-btn-ghost gls-btn-xs" type="button" data-reported-post-action="dismissed" data-post-id="' +
        escapeHtml(postId) +
        '"' +
        disabled +
        '>기각</button>',
      '<button class="gls-btn gls-btn-danger gls-btn-xs" type="button" data-reported-post-action="delete-post" data-post-id="' +
        escapeHtml(postId) +
        '"' +
        disabled +
        '>삭제</button>',
      '</div>',
    ].join('');
  }

  function normalizeSafetyStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();
    return ['queued', 'reviewing', 'actioned', 'dismissed'].includes(normalized)
      ? normalized
      : 'queued';
  }

  function buildSafetyStatusBadge(status) {
    const normalized = normalizeSafetyStatus(status);
    const labelMap = {
      queued: '접수',
      reviewing: '검토 중',
      actioned: '조치 완료',
      dismissed: '기각',
    };
    return '<span class="admin-safety-status admin-safety-status--' + normalized + '">' +
      escapeHtml(labelMap[normalized]) +
      '</span>';
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

  function setupDeviceAnalyticsUi(deviceAnalyticsBox) {
    const filterBox = document.getElementById('adminDeviceAnalyticsFilters');
    if (!deviceAnalyticsBox || !filterBox || deviceAnalyticsState.initialized) return;

    deviceAnalyticsState.initialized = true;
    renderDeviceAnalyticsFilters(filterBox);

    filterBox.addEventListener('submit', (e) => {
      if (e.target.id !== 'adminDeviceAnalyticsForm') return;
      e.preventDefault();
      applyDeviceAnalyticsFilters(filterBox);
      loadDeviceAnalytics(deviceAnalyticsBox);
    });

    filterBox.addEventListener('click', (e) => {
      if (e.target.id !== 'adminDeviceReset') return;
      e.preventDefault();
      resetDeviceAnalyticsFilters();
      renderDeviceAnalyticsFilters(filterBox);
      loadDeviceAnalytics(deviceAnalyticsBox);
    });

    loadDeviceAnalytics(deviceAnalyticsBox);
  }

  function renderDeviceAnalyticsFilters(filterBox) {
    filterBox.innerHTML = [
      '<form id="adminDeviceAnalyticsForm" class="admin-toolbar admin-share-toolbar">',
      '  <label>시작일<input type="date" class="gls-input gls-input-sm" id="adminDeviceFrom" value="' +
        escapeHtml(deviceAnalyticsState.from) +
        '"></label>',
      '  <label>종료일<input type="date" class="gls-input gls-input-sm" id="adminDeviceTo" value="' +
        escapeHtml(deviceAnalyticsState.to) +
        '"></label>',
      '  <label>접속 경로<select class="gls-select gls-select-sm" id="adminDeviceSource">' +
        buildAdminSelectOptions(
          [
            ['all', '전체'],
            ['web_client', '웹'],
            ['native_client', '네이티브 앱'],
          ],
          deviceAnalyticsState.source
        ) +
        '</select></label>',
      '  <label>기기<select class="gls-select gls-select-sm" id="adminDeviceClass">' +
        buildAdminSelectOptions(
          [
            ['all', '전체'],
            ['desktop', '데스크탑'],
            ['mobile', '모바일'],
            ['tablet', '태블릿'],
            ['unknown', '알 수 없음'],
          ],
          deviceAnalyticsState.deviceClass
        ) +
        '</select></label>',
      '  <label>운영체제<select class="gls-select gls-select-sm" id="adminPlatformFamily">' +
        buildAdminSelectOptions(
          [
            ['all', '전체'],
            ['ios', 'iOS/iPadOS'],
            ['android', 'Android'],
            ['windows', 'Windows'],
            ['macos', 'macOS'],
            ['linux', 'Linux'],
            ['chromeos', 'ChromeOS'],
            ['unknown', '알 수 없음'],
          ],
          deviceAnalyticsState.platformFamily
        ) +
        '</select></label>',
      '  <label>사용자<select class="gls-select gls-select-sm" id="adminDeviceUserType">' +
        buildAdminSelectOptions(
          [
            ['all', '전체'],
            ['authenticated', '로그인'],
            ['anonymous', '비로그인'],
          ],
          deviceAnalyticsState.userType
        ) +
        '</select></label>',
      '  <div class="admin-share-toolbar__actions">',
      '    <button class="gls-btn gls-btn-primary gls-btn-sm" type="submit" id="adminDeviceApply">적용</button>',
      '    <button class="gls-btn gls-btn-secondary gls-btn-sm" type="button" id="adminDeviceReset">초기화</button>',
      '  </div>',
      '</form>',
    ].join('');
  }

  function buildAdminSelectOptions(options, selected) {
    return options
      .map(([value, label]) => {
        const selectedAttr = value === selected ? ' selected' : '';
        return '<option value="' + value + '"' + selectedAttr + '>' + label + '</option>';
      })
      .join('');
  }

  function applyDeviceAnalyticsFilters(filterBox) {
    deviceAnalyticsState.from = filterBox.querySelector('#adminDeviceFrom')?.value?.trim() || '';
    deviceAnalyticsState.to = filterBox.querySelector('#adminDeviceTo')?.value?.trim() || '';
    deviceAnalyticsState.source = normalizeAdminFilterValue(
      filterBox.querySelector('#adminDeviceSource')?.value,
      ['all', 'web_client', 'native_client']
    );
    deviceAnalyticsState.deviceClass = normalizeAdminFilterValue(
      filterBox.querySelector('#adminDeviceClass')?.value,
      ['all', 'desktop', 'mobile', 'tablet', 'unknown']
    );
    deviceAnalyticsState.platformFamily = normalizeAdminFilterValue(
      filterBox.querySelector('#adminPlatformFamily')?.value,
      ['all', 'ios', 'android', 'windows', 'macos', 'linux', 'chromeos', 'unknown']
    );
    deviceAnalyticsState.userType = normalizeAdminFilterValue(
      filterBox.querySelector('#adminDeviceUserType')?.value,
      ['all', 'authenticated', 'anonymous']
    );
  }

  function normalizeAdminFilterValue(value, allowed) {
    const normalized = String(value || 'all').trim().toLowerCase();
    return allowed.includes(normalized) ? normalized : 'all';
  }

  function resetDeviceAnalyticsFilters() {
    deviceAnalyticsState.from = '';
    deviceAnalyticsState.to = '';
    deviceAnalyticsState.source = 'all';
    deviceAnalyticsState.deviceClass = 'all';
    deviceAnalyticsState.platformFamily = 'all';
    deviceAnalyticsState.userType = 'all';
  }

  async function loadDeviceAnalytics(deviceAnalyticsBox) {
    deviceAnalyticsBox.innerHTML = '<p class="gls-text-muted">접속 환경 통계를 불러오는 중입니다...</p>';

    try {
      const params = new URLSearchParams({
        source: deviceAnalyticsState.source,
        device_class: deviceAnalyticsState.deviceClass,
        platform_family: deviceAnalyticsState.platformFamily,
        user_type: deviceAnalyticsState.userType,
        top_limit: '10',
        daily_limit: '30',
      });
      if (deviceAnalyticsState.from) params.set('from', deviceAnalyticsState.from);
      if (deviceAnalyticsState.to) params.set('to', deviceAnalyticsState.to);

      const response = await fetch('/api/admin/ux-events/summary?' + params.toString(), {
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
        setTabCount('deviceAnalyticsTab', '-');
        const message =
          typeof payload.message === 'string'
            ? payload.message
            : '접속 환경 통계를 불러오지 못했습니다.';
        deviceAnalyticsBox.innerHTML = '<p class="text-danger">' + escapeHtml(message) + '</p>';
        return;
      }

      setTabCount('deviceAnalyticsTab', Number(payload?.summary?.unique_session_count || 0));
      deviceAnalyticsBox.innerHTML = renderDeviceAnalyticsHtml(payload);
    } catch (error) {
      console.error('device analytics 로드 실패:', error);
      setTabCount('deviceAnalyticsTab', '-');
      deviceAnalyticsBox.innerHTML =
        '<p class="text-danger">접속 환경 통계를 불러오는 중 오류가 발생했습니다.</p>';
    }
  }

  function renderDeviceAnalyticsHtml(payload) {
    const summary = payload?.summary || {};
    const bySource = Array.isArray(payload?.by_source) ? payload.by_source : [];
    const byDevice = Array.isArray(payload?.by_device) ? payload.by_device : [];
    const byPlatform = Array.isArray(payload?.by_platform) ? payload.by_platform : [];
    const daily = Array.isArray(payload?.daily) ? payload.daily : [];
    const totalDeviceSessions = byDevice.reduce(
      (sum, row) => sum + toCount(row?.unique_session_count),
      0
    );
    const totalPlatformSessions = byPlatform.reduce(
      (sum, row) => sum + toCount(row?.unique_session_count),
      0
    );
    const totalSourceSessions = bySource.reduce(
      (sum, row) => sum + toCount(row?.unique_session_count),
      0
    );

    const cardsHtml = [
      buildShareMetricCard('총 이벤트', formatCount(summary.total_count), '필터 조건 전체'),
      buildShareMetricCard('고유 세션', formatCount(summary.unique_session_count), '탭 배지 기준'),
      buildShareMetricCard('로그인 사용자', formatCount(summary.unique_user_count), '고유 회원 기준'),
      buildShareMetricCard('비로그인 이벤트', formatCount(summary.anonymous_count), '사용자 식별값 없음'),
    ].join('');

    const deviceRows = byDevice
      .map((row) => buildDeviceAnalyticsRow(row, 'device_class', totalDeviceSessions))
      .join('');
    const platformRows = byPlatform
      .map((row) => buildDeviceAnalyticsRow(row, 'platform_family', totalPlatformSessions))
      .join('');
    const sourceRows = bySource
      .map((row) => buildDeviceAnalyticsRow(row, 'source', totalSourceSessions))
      .join('');
    const dailyRows = daily
      .map((row) => {
        return (
          '<tr>' +
          '<td>' + escapeHtml(row?.day || '-') + '</td>' +
          '<td class="gls-text-end">' + formatCount(row?.unique_session_count) + '</td>' +
          '<td class="gls-text-end">' + formatCount(row?.unique_user_count) + '</td>' +
          '<td class="gls-text-end">' + formatCount(row?.total_count) + '</td>' +
          '</tr>'
        );
      })
      .join('');

    return [
      '<div class="admin-share-summary-grid gls-mb-3">' + cardsHtml + '</div>',
      '<div class="admin-share-table-grid">',
      buildDeviceAnalyticsTable('접속 경로별', '접속 경로', sourceRows),
      buildDeviceAnalyticsTable('기기 유형별', '기기', deviceRows),
      buildDeviceAnalyticsTable('운영체제별', '운영체제', platformRows),
      '</div>',
      '<section class="admin-share-table-card card glass-card gls-mt-3">',
      '  <div class="card-body">',
      '    <h5 class="gls-mb-2">일별 추이</h5>',
      '    <div class="table-responsive">',
      '      <table class="table table-sm align-middle">',
      '        <thead><tr><th>일자</th><th class="gls-text-end">세션</th><th class="gls-text-end">로그인 사용자</th><th class="gls-text-end">이벤트</th></tr></thead>',
      '        <tbody>' +
        (dailyRows ||
          '<tr><td colspan="4" class="gls-text-muted gls-text-center">데이터가 없습니다.</td></tr>') +
        '</tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '</section>',
    ].join('');
  }

  function buildDeviceAnalyticsTable(title, dimensionLabel, rows) {
    return [
      '<section class="admin-share-table-card card glass-card">',
      '  <div class="card-body">',
      '    <h5 class="gls-mb-2">' + escapeHtml(title) + '</h5>',
      '    <div class="table-responsive">',
      '      <table class="table table-sm align-middle">',
      '        <thead><tr><th>' +
        escapeHtml(dimensionLabel) +
        '</th><th class="gls-text-end">세션</th><th class="gls-text-end">비율</th><th class="gls-text-end">이벤트</th><th class="gls-text-end">회원</th></tr></thead>',
      '        <tbody>' +
        (rows ||
          '<tr><td colspan="5" class="gls-text-muted gls-text-center">데이터가 없습니다.</td></tr>') +
        '</tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '</section>',
    ].join('');
  }

  function buildDeviceAnalyticsRow(row, dimensionKey, totalSessions) {
    const rawValue = String(row?.[dimensionKey] || 'unknown').toLowerCase();
    const labels = {
      desktop: '데스크탑',
      mobile: '모바일',
      tablet: '태블릿',
      ios: 'iOS/iPadOS',
      android: 'Android',
      windows: 'Windows',
      macos: 'macOS',
      linux: 'Linux',
      chromeos: 'ChromeOS',
      web_client: '웹',
      native_client: '네이티브 앱',
      unknown: '알 수 없음',
    };
    const sessionCount = toCount(row?.unique_session_count);
    const rate = totalSessions > 0 ? ((sessionCount * 100) / totalSessions).toFixed(1) : '0.0';

    return (
      '<tr>' +
      '<td>' + escapeHtml(labels[rawValue] || rawValue) + '</td>' +
      '<td class="gls-text-end">' + formatCount(sessionCount) + '</td>' +
      '<td class="gls-text-end">' + escapeHtml(rate) + '%</td>' +
      '<td class="gls-text-end">' + formatCount(row?.event_count) + '</td>' +
      '<td class="gls-text-end">' + formatCount(row?.unique_user_count) + '</td>' +
      '</tr>'
    );
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

  function normalizeAdminPushTargetPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return '/write';
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/(auth)')) return '/write';
    return raw.slice(0, 300);
  }

  function setupPushUi(pushBox) {
    if (!pushBox) return;
    renderPushUi(pushBox);

    const refreshBtn = document.getElementById('adminPushRefreshBtn');
    if (refreshBtn && refreshBtn.dataset.bound !== 'true') {
      refreshBtn.dataset.bound = 'true';
      refreshBtn.addEventListener('click', () => {
        loadPushDashboard(pushBox);
      });
    }

    if (pushState.initialized) return;
    pushState.initialized = true;

    pushBox.addEventListener('input', (event) => {
      if (!event.target.closest?.('#adminPushForm')) return;
      syncPushStateFromForm(pushBox);
    });

    pushBox.addEventListener('change', (event) => {
      if (!event.target.closest?.('#adminPushForm')) return;
      syncPushStateFromForm(pushBox);
      if (event.target.id === 'adminPushTargetPreset') {
        renderPushUi(pushBox);
      }
    });

    pushBox.addEventListener('submit', (event) => {
      if (event.target.id !== 'adminPushForm') return;
      event.preventDefault();
      submitPushCampaign(pushBox, { dryRun: true });
    });

    pushBox.addEventListener('click', (event) => {
      const target = event.target;
      if (target.id === 'adminPushSendBtn') {
        event.preventDefault();
        submitPushCampaign(pushBox, { dryRun: false });
      }
    });
  }

  function syncPushStateFromForm(pushBox) {
    const form = pushBox?.querySelector?.('#adminPushForm');
    if (!form) return;

    const titleInput = form.querySelector('[name="title"]');
    const bodyInput = form.querySelector('[name="body"]');
    const presetInput = form.querySelector('[name="target_preset"]');
    const customTargetInput = form.querySelector('[name="custom_target_path"]');
    const includeAdLabelInput = form.querySelector('[name="include_ad_label"]');
    const preset = presetInput?.value || '/write';

    pushState.title = titleInput?.value || '';
    pushState.body = bodyInput?.value || '';
    pushState.includeAdLabel = includeAdLabelInput?.checked !== false;
    pushState.customTargetPath = customTargetInput?.value || '';
    pushState.targetPath =
      preset === 'custom'
        ? normalizeAdminPushTargetPath(pushState.customTargetPath)
        : normalizeAdminPushTargetPath(preset);
  }

  function buildPushTargetSelect() {
    const selectedPreset = PUSH_TARGET_PRESETS.some((item) => item.value === pushState.targetPath)
      ? pushState.targetPath
      : 'custom';
    return PUSH_TARGET_PRESETS.map(
      (item) =>
        `<option value="${escapeHtml(item.value)}" ${
          selectedPreset === item.value ? 'selected' : ''
        }>${escapeHtml(item.label)}</option>`
    ).join('');
  }

  function buildPushAudienceHtml() {
    const audience = pushState.dryRun || pushState.audience;
    if (!audience) {
      return `
        <div class="admin-push-summary-card">
          <p class="gls-text-muted gls-text-small gls-mb-1">현재 대상</p>
          <strong>대상 확인 전</strong>
          <p class="gls-text-muted gls-text-small gls-mb-0">발송 전 대상 확인을 먼저 실행하세요.</p>
        </div>
      `;
    }

    return `
      <div class="admin-push-summary-card">
        <p class="gls-text-muted gls-text-small gls-mb-1">수신 동의 사용자</p>
        <strong>${formatCount(audience.eligible_user_count)}명</strong>
        <p class="gls-text-muted gls-text-small gls-mb-0">활성 푸시 토큰 ${formatCount(
          audience.eligible_token_count
        )}개</p>
      </div>
    `;
  }

  function buildPushCampaignRows() {
    const rows = Array.isArray(pushState.campaigns) ? pushState.campaigns : [];
    if (!rows.length) {
      return '<tr><td colspan="5" class="gls-text-muted gls-text-center">최근 발송 예약이 없습니다.</td></tr>';
    }

    return rows
      .map((campaign) => {
        const kind =
          campaign.campaign_kind === 'evening_writing_reminder'
            ? '저녁 리마인더'
            : campaign.campaign_kind === 'daily_writing_project_prompt'
              ? '한달 글쓰기'
              : '수동 발송';
        return `
          <tr>
            <td>
              <strong>${escapeHtml(campaign.title || '-')}</strong>
              <div class="gls-text-muted gls-text-small">${escapeHtml(campaign.body || '')}</div>
            </td>
            <td><span class="admin-safety-pill">${escapeHtml(kind)}</span></td>
            <td>${escapeHtml(campaign.target_path || '/')}</td>
            <td class="gls-text-end">${formatCount(campaign.queued_count)}</td>
            <td>${escapeHtml(formatAdminDateTime(campaign.created_at))}</td>
          </tr>
        `;
      })
      .join('');
  }

  function formatPushStatus(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'queued') return '대기';
    if (normalized === 'sent') return '발송';
    if (normalized === 'failed') return '실패';
    if (normalized === 'skipped') return '제외';
    return status || '-';
  }

  function formatPushType(type, eventType) {
    const normalized = String(type || eventType || '').toLowerCase();
    if (normalized === 'marketing_campaign') return '마케팅';
    if (normalized === 'post_reaction' || normalized === 'post_liked') return '좋아요';
    if (normalized === 'post_comment' || normalized === 'comment_created') return '댓글';
    if (normalized === 'comment_reply' || normalized === 'comment_replied') return '답글';
    if (normalized === 'new_follower') return '팔로우';
    if (normalized === 'admin_operational_alert') return '운영';
    return normalized || '-';
  }

  function formatPushPlatforms(platforms) {
    const list = Array.isArray(platforms) ? platforms.filter(Boolean) : [];
    if (!list.length) return '-';
    return list.map((item) => String(item).toUpperCase()).join(', ');
  }

  function buildAdminUserSummary(user = {}) {
    const displayName = user.nickname || user.name || `#${user.id || '-'}`;
    const maskedEmail = maskEmail(user.email || '');
    return {
      displayName,
      secondary: maskedEmail || user.email || '',
    };
  }

  function buildPushDeliveryRows() {
    const rows = Array.isArray(pushState.deliveries) ? pushState.deliveries : [];
    if (!rows.length) {
      return '<tr><td colspan="5" class="gls-text-muted gls-text-center">최근 푸시 알림이 없습니다.</td></tr>';
    }

    return rows
      .map((delivery) => {
        const recipient = buildAdminUserSummary(delivery.recipient || {});
        const status = String(delivery.status || '').toLowerCase();
        const sentAt = delivery.sent_at || delivery.last_attempt_at || delivery.created_at;
        return `
          <tr>
            <td>
              <span class="admin-push-status admin-push-status--${escapeHtml(status || 'unknown')}">${escapeHtml(
          formatPushStatus(status)
        )}</span>
              <div class="gls-text-muted gls-text-small">시도 ${formatCount(delivery.attempt_count)}</div>
            </td>
            <td>
              <strong>${escapeHtml(delivery.title || '-')}</strong>
              <div class="gls-text-muted gls-text-small">${escapeHtml(delivery.body || '')}</div>
              ${
                delivery.last_error
                  ? `<div class="admin-push-error">${escapeHtml(delivery.last_error)}</div>`
                  : ''
              }
            </td>
            <td>
              <strong>${escapeHtml(recipient.displayName)}</strong>
              <div class="gls-text-muted gls-text-small">${escapeHtml(recipient.secondary)}</div>
            </td>
            <td>
              <span class="admin-safety-pill">${escapeHtml(
                formatPushType(delivery.type, delivery.event_type)
              )}</span>
              <div class="gls-text-muted gls-text-small">${escapeHtml(delivery.target_path || '/notifications')}</div>
            </td>
            <td>${escapeHtml(formatAdminDateTime(sentAt))}</td>
          </tr>
        `;
      })
      .join('');
  }

  function buildPushRecipientRows() {
    const rows = Array.isArray(pushState.recipients) ? pushState.recipients : [];
    if (!rows.length) {
      return '<tr><td colspan="5" class="gls-text-muted gls-text-center">수신 동의 사용자가 없습니다.</td></tr>';
    }

    return rows
      .map((recipient) => {
        const user = buildAdminUserSummary(recipient);
        return `
          <tr>
            <td>
              <strong>${escapeHtml(user.displayName)}</strong>
              <div class="gls-text-muted gls-text-small">ID ${escapeHtml(recipient.id || '-')}</div>
            </td>
            <td>${escapeHtml(user.secondary || '-')}</td>
            <td>${escapeHtml(formatAdminDateTime(recipient.marketing_push_opt_in_updated_at))}</td>
            <td class="gls-text-end">${formatCount(recipient.active_push_token_count)}</td>
            <td>
              <strong>${escapeHtml(formatPushPlatforms(recipient.platforms))}</strong>
              <div class="gls-text-muted gls-text-small">${escapeHtml(
                formatAdminDateTime(recipient.last_push_token_seen_at)
              )}</div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function renderPushUi(pushBox) {
    if (!pushBox) return;
    const selectedPreset = PUSH_TARGET_PRESETS.some((item) => item.value === pushState.targetPath)
      ? pushState.targetPath
      : 'custom';
    const customValue =
      selectedPreset === 'custom' ? pushState.targetPath : pushState.customTargetPath;
    const dryRunHtml = pushState.dryRun
      ? `
        <div class="admin-push-result admin-push-result--success">
          <strong>대상 확인 완료</strong>
          <span>${formatCount(pushState.dryRun.eligible_user_count)}명 · 토큰 ${formatCount(
          pushState.dryRun.eligible_token_count
        )}개</span>
        </div>
      `
      : '';
    const disabledAttr = pushState.sending ? 'disabled' : '';
    const deliverySummary = pushState.deliverySummary || {};
    const recipientSummary = pushState.recipientSummary || {};

    pushBox.innerHTML = `
      <div class="admin-push-grid">
        <form id="adminPushForm" class="admin-push-form">
          <div class="admin-push-form__header">
            <div>
              <p class="gls-text-muted gls-text-small gls-mb-1">수동 마케팅 푸시</p>
              <h4 class="gls-mb-1">대상 확인 후 발송 예약</h4>
              <p class="gls-text-muted gls-text-small gls-mb-0">광고성 발송이 아니라고 판단되는 경우 표기를 끌 수 있습니다.</p>
            </div>
            ${buildPushAudienceHtml()}
          </div>

          <label class="gls-label" for="adminPushTitle">제목</label>
          <input
            id="adminPushTitle"
            class="gls-input"
            name="title"
            maxlength="80"
            value="${escapeHtml(pushState.title)}"
            placeholder="오늘의 기록을 아직 남기지 않았다면"
            ${disabledAttr}
          />

          <label class="gls-label" for="adminPushBody">본문</label>
          <textarea
            id="adminPushBody"
            class="gls-input"
            name="body"
            rows="3"
            maxlength="180"
            placeholder="짧은 문장 하나로 오늘의 마음을 남겨보세요."
            ${disabledAttr}
          >${escapeHtml(pushState.body)}</textarea>

          <label class="admin-push-ad-row">
            <input
              class="gls-check-input"
              type="checkbox"
              name="include_ad_label"
              ${pushState.includeAdLabel ? 'checked' : ''}
              ${disabledAttr}
            />
            <span>
              <strong>(광고) 표기 붙이기</strong>
              <small>켜면 서버가 제목 맨 앞에 자동으로 붙입니다.</small>
            </span>
          </label>

          <div class="admin-push-target-row">
            <label class="gls-label" for="adminPushTargetPreset">이동 위치</label>
            <select id="adminPushTargetPreset" class="gls-select" name="target_preset" ${disabledAttr}>
              ${buildPushTargetSelect()}
            </select>
            <input
              class="gls-input"
              name="custom_target_path"
              value="${escapeHtml(customValue)}"
              placeholder="/write"
              ${selectedPreset === 'custom' && !pushState.sending ? '' : 'disabled'}
            />
          </div>

          ${dryRunHtml}

          <div class="admin-push-actions">
            <button class="gls-btn gls-btn-secondary" type="submit" ${disabledAttr}>대상 확인</button>
            <button class="gls-btn gls-btn-primary" id="adminPushSendBtn" type="button" ${disabledAttr}>${
              pushState.sending ? '처리 중...' : '발송 예약'
            }</button>
          </div>
        </form>

        <section class="admin-push-history">
          <div class="gls-flex gls-items-center gls-justify-between gls-gap-2 gls-mb-2">
            <div>
              <h4 class="gls-mb-0">최근 발송 예약</h4>
              <p class="gls-text-muted gls-text-small gls-mb-0">서버 큐에 들어간 최근 캠페인입니다.</p>
            </div>
          </div>
          <div class="table-responsive">
            <table class="table table-sm align-middle gls-mb-0 admin-push-table">
              <thead>
                <tr>
                  <th>내용</th>
                  <th>종류</th>
                  <th>이동</th>
                  <th class="gls-text-end">큐</th>
                  <th>생성</th>
                </tr>
              </thead>
              <tbody>${buildPushCampaignRows()}</tbody>
            </table>
          </div>
        </section>

        <section class="admin-push-history admin-push-wide">
          <div class="gls-flex gls-flex-wrap gls-items-center gls-justify-between gls-gap-2 gls-mb-2">
            <div>
              <h4 class="gls-mb-0">최근 푸시 알림</h4>
              <p class="gls-text-muted gls-text-small gls-mb-0">실제 발송 큐에 들어간 개별 푸시 알림입니다.</p>
            </div>
            <div class="admin-push-mini-stats">
              <span>전체 ${formatCount(deliverySummary.total_count)}</span>
              <span>대기 ${formatCount(deliverySummary.queued_count)}</span>
              <span>실패 ${formatCount(deliverySummary.failed_count)}</span>
            </div>
          </div>
          <div class="table-responsive">
            <table class="table table-sm align-middle gls-mb-0 admin-push-table admin-push-table--deliveries">
              <thead>
                <tr>
                  <th>상태</th>
                  <th>알림</th>
                  <th>수신자</th>
                  <th>종류/이동</th>
                  <th>시각</th>
                </tr>
              </thead>
              <tbody>${buildPushDeliveryRows()}</tbody>
            </table>
          </div>
        </section>

        <section class="admin-push-history admin-push-wide">
          <div class="gls-flex gls-flex-wrap gls-items-center gls-justify-between gls-gap-2 gls-mb-2">
            <div>
              <h4 class="gls-mb-0">수신 동의 사용자</h4>
              <p class="gls-text-muted gls-text-small gls-mb-0">마케팅 푸시 수신에 동의했고 계정이 활성 상태인 사용자입니다.</p>
            </div>
            <div class="admin-push-mini-stats">
              <span>동의 ${formatCount(recipientSummary.opted_in_user_count)}명</span>
              <span>활성 토큰 ${formatCount(recipientSummary.active_token_count)}개</span>
            </div>
          </div>
          <div class="table-responsive">
            <table class="table table-sm align-middle gls-mb-0 admin-push-table admin-push-table--recipients">
              <thead>
                <tr>
                  <th>사용자</th>
                  <th>이메일</th>
                  <th>동의일</th>
                  <th class="gls-text-end">활성 토큰</th>
                  <th>플랫폼/최근 토큰</th>
                </tr>
              </thead>
              <tbody>${buildPushRecipientRows()}</tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  async function loadPushDashboard(pushBox) {
    if (!pushBox) return;
    try {
      const [campaignResponse, deliveryResponse, recipientResponse] = await Promise.all([
        fetch('/api/admin/marketing-push-campaigns?limit=12', { cache: 'no-store' }),
        fetch('/api/admin/push-deliveries?limit=30', { cache: 'no-store' }),
        fetch('/api/admin/push-recipients?limit=50', { cache: 'no-store' }),
      ]);
      const [campaignData, deliveryData, recipientData] = await Promise.all([
        parseJsonSafe(campaignResponse),
        parseJsonSafe(deliveryResponse),
        parseJsonSafe(recipientResponse),
      ]);
      if (!campaignResponse.ok || !campaignData.ok) {
        throw new Error(campaignData.message || '푸시 캠페인 정보를 불러오지 못했습니다.');
      }
      if (!deliveryResponse.ok || !deliveryData.ok) {
        throw new Error(deliveryData.message || '푸시 발송 목록을 불러오지 못했습니다.');
      }
      if (!recipientResponse.ok || !recipientData.ok) {
        throw new Error(recipientData.message || '푸시 수신 동의자 목록을 불러오지 못했습니다.');
      }
      pushState.campaigns = Array.isArray(campaignData.campaigns) ? campaignData.campaigns : [];
      pushState.audience = campaignData.audience || null;
      pushState.deliveries = Array.isArray(deliveryData.deliveries) ? deliveryData.deliveries : [];
      pushState.deliverySummary = deliveryData.summary || null;
      pushState.recipients = Array.isArray(recipientData.recipients) ? recipientData.recipients : [];
      pushState.recipientSummary = recipientData.summary || null;
      setTabCount(
        'pushTab',
        pushState.recipientSummary?.opted_in_user_count ?? pushState.campaigns.length
      );
      renderPushUi(pushBox);
    } catch (error) {
      console.error(error);
      pushBox.innerHTML = '<p class="text-danger">푸시 운영 정보를 불러오지 못했습니다.</p>';
      setTabCount('pushTab', '-');
    }
  }

  async function submitPushCampaign(pushBox, options = {}) {
    if (!pushBox || pushState.sending) return;
    syncPushStateFromForm(pushBox);

    const title = pushState.title.trim();
    const body = pushState.body.trim();
    if (!title || !body) {
      showAdminNotice('푸시 제목과 본문을 입력하세요.', 'error');
      return;
    }

    const dryRun = options.dryRun !== false;
    if (!dryRun && !pushState.dryRun) {
      showAdminNotice('발송 예약 전에 대상 확인을 먼저 실행하세요.', 'error');
      return;
    }
    if (!dryRun && pushState.dryRun && Number(pushState.dryRun.eligible_token_count || 0) <= 0) {
      showAdminNotice('발송 가능한 푸시 토큰이 없습니다.', 'error');
      return;
    }
    if (
      !dryRun &&
      !window.confirm(
        `${formatCount(pushState.dryRun?.eligible_token_count)}개 기기에 푸시를 예약할까요?`
      )
    ) {
      return;
    }

    pushState.sending = true;
    renderPushUi(pushBox);
    try {
      const response = await fetch('/api/admin/marketing-push-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body,
          target_path: pushState.targetPath,
          include_ad_label: pushState.includeAdLabel,
          dry_run: dryRun,
        }),
      });
      const data = await parseJsonSafe(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.message || '푸시 작업에 실패했습니다.');
      }

      if (dryRun) {
        pushState.dryRun = {
          eligible_user_count: data.eligible_user_count || 0,
          eligible_token_count: data.eligible_token_count || 0,
        };
        showAdminNotice('푸시 대상을 확인했습니다.', 'success');
        renderPushUi(pushBox);
        return;
      }

      pushState.dryRun = null;
      showAdminNotice(`푸시 ${formatCount(data.queued_count)}건을 예약했습니다.`, 'success');
      await loadPushDashboard(pushBox);
    } catch (error) {
      console.error(error);
      showAdminNotice(error.message || '푸시 작업 중 오류가 발생했습니다.', 'error');
      renderPushUi(pushBox);
    } finally {
      pushState.sending = false;
      renderPushUi(pushBox);
    }
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

  function setupUsersUi(usersBox) {
    if (!usersBox) return;
    const filterBox = document.getElementById('adminUsersFilters');
    if (filterBox) {
      filterBox.innerHTML = `
        <form id="adminUsersForm" class="admin-toolbar">
          <input
            type="search"
            class="gls-input gls-input-sm"
            id="adminUsersSearch"
            placeholder="이름/닉네임/이메일 검색"
            value="${escapeHtml(usersState.search)}"
          />
          <select class="gls-select gls-select-sm" id="adminUsersFilter" aria-label="인증 상태">
            <option value="all" ${usersState.filter === 'all' ? 'selected' : ''}>전체</option>
            <option value="verified" ${usersState.filter === 'verified' ? 'selected' : ''}>인증완료</option>
            <option value="unverified" ${usersState.filter === 'unverified' ? 'selected' : ''}>미인증</option>
          </select>
          <select class="gls-select gls-select-sm" id="adminUsersSort" aria-label="정렬">
            <option value="newest" ${usersState.sort === 'newest' ? 'selected' : ''}>최신 가입순</option>
            <option value="oldest" ${usersState.sort === 'oldest' ? 'selected' : ''}>오래된 가입순</option>
            <option value="name" ${usersState.sort === 'name' ? 'selected' : ''}>이름순</option>
            <option value="email" ${usersState.sort === 'email' ? 'selected' : ''}>이메일순</option>
            <option value="verified" ${usersState.sort === 'verified' ? 'selected' : ''}>인증 상태순</option>
          </select>
          <select class="gls-select gls-select-sm" id="adminUsersLimit" aria-label="페이지 크기">
            <option value="20" ${usersState.limit === 20 ? 'selected' : ''}>20명씩</option>
            <option value="50" ${usersState.limit === 50 ? 'selected' : ''}>50명씩</option>
            <option value="100" ${usersState.limit === 100 ? 'selected' : ''}>100명씩</option>
            <option value="200" ${usersState.limit === 200 ? 'selected' : ''}>200명씩</option>
          </select>
          <button class="gls-btn gls-btn-primary gls-btn-sm" type="submit">적용</button>
          <button class="gls-btn gls-btn-secondary gls-btn-sm" type="button" id="adminUsersReset">초기화</button>
        </form>
      `;

      if (filterBox.dataset.adminUsersBound !== 'true') {
        filterBox.dataset.adminUsersBound = 'true';
        filterBox.addEventListener('submit', (e) => {
          if (e.target.id !== 'adminUsersForm') return;
          e.preventDefault();
          const searchInput = document.getElementById('adminUsersSearch');
          const filterInput = document.getElementById('adminUsersFilter');
          const sortInput = document.getElementById('adminUsersSort');
          const limitInput = document.getElementById('adminUsersLimit');
          usersState.search = searchInput?.value?.trim() || '';
          usersState.filter = filterInput?.value || 'all';
          usersState.sort = sortInput?.value || 'newest';
          usersState.limit = Number(limitInput?.value) || 50;
          usersState.page = 1;
          loadUsers(usersBox);
        });
        filterBox.addEventListener('click', (e) => {
          if (e.target.id !== 'adminUsersReset') return;
          usersState.search = '';
          usersState.filter = 'all';
          usersState.sort = 'newest';
          usersState.limit = 50;
          usersState.page = 1;
          setupUsersUi(usersBox);
          loadUsers(usersBox);
        });
      }
    }

    usersBox.innerHTML = `
      <div id="adminUsersTable">
        <p class="gls-text-muted">회원 목록을 불러오는 중입니다...</p>
      </div>
      <div id="adminUsersPagination" class="admin-pagination"></div>
    `;
  }

  async function loadUsers(usersBox) {
    const tableBox = usersBox?.querySelector('#adminUsersTable') || usersBox;
    const pagination = usersBox?.querySelector('#adminUsersPagination');
    if (!tableBox) return;

    tableBox.innerHTML = '<p class="gls-text-muted">회원 목록을 불러오는 중입니다...</p>';
    if (pagination) pagination.innerHTML = '';

    const params = new URLSearchParams({
      search: usersState.search,
      filter: usersState.filter,
      sort: usersState.sort,
      page: String(usersState.page),
      limit: String(usersState.limit),
    });

    try {
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/html/login.html?next=/admin';
        return;
      }
      if (!res.ok) {
        throw new Error('회원 목록을 불러오는 중 오류가 발생했습니다.');
      }

      const data = await res.json();
      if (!data.ok) {
        tableBox.innerHTML = `<p class="text-danger">${
          data.message || '회원 목록을 불러오지 못했습니다.'
        }</p>`;
        setTabCount('usersTab', '-');
        return;
      }

      const users = data.users || [];
      const total = Number.isFinite(Number(data.total)) ? Number(data.total) : users.length;
      const page = Number.isFinite(Number(data.page)) ? Number(data.page) : usersState.page;
      const pageSize = Number.isFinite(Number(data.page_size))
        ? Number(data.page_size)
        : usersState.limit;
      const totalPages = Math.max(Math.ceil(total / pageSize), 1);

      if (!users.length && total > 0 && page > totalPages) {
        usersState.page = totalPages;
        await loadUsers(usersBox);
        return;
      }

      usersState.page = page;
      usersState.limit = pageSize;
      setTabCount('usersTab', total);

      if (!users.length) {
        tableBox.innerHTML = '<p class="gls-text-muted">조건에 맞는 회원이 없습니다.</p>';
      } else {
        tableBox.innerHTML = buildUsersTableHtml(users);
        const tbody = tableBox.querySelector('tbody');
        tbody?.addEventListener('click', (e) => handleUserTableClick(e, usersBox));
      }

      if (pagination) {
        pagination.innerHTML = buildPagination(page, pageSize, total);
        pagination.onclick = handleUsersPaginationClick;
      }
    } catch (e) {
      console.error(e);
      setTabCount('usersTab', '-');
      tableBox.innerHTML =
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

  async function handleUserTableClick(e, usersBox) {
    const target = e.target;
    if (!target.classList.contains('admin-delete-user-btn')) return;
    const tr = target.closest('tr');
    if (!tr) return;
    const tbody = tr.closest('tbody');
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
        if (!tbody?.children.length) {
          if (usersState.page > 1) {
            usersState.page -= 1;
            await loadUsers(usersBox);
            return;
          }
          const tableBox = usersBox?.querySelector('#adminUsersTable') || usersBox;
          if (tableBox) {
            tableBox.innerHTML = '<p class="gls-text-muted">조건에 맞는 회원이 없습니다.</p>';
          }
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
            </div>
            <h5 class="admin-post-card__title">${escapeHtml(post.title)}</h5>
            <p class="admin-post-card__meta">${escapeHtml(author)} · ${dateStr}</p>
            <p class="admin-post-card__snippet">${escapeHtml(snippet)}${
          snippet.length >= 80 ? '…' : ''
        }</p>
            <div class="gls-spread admin-post-card__footer">
              <span class="gls-text-muted gls-text-small">❤ ${post.like_count || 0}</span>
              <div class="admin-post-card__actions">
                <button class="gls-btn gls-btn-secondary gls-btn-xs admin-post-card__preview" type="button">미리보기</button>
                <button class="gls-btn gls-btn-danger gls-btn-xs admin-post-card__delete" type="button">삭제</button>
              </div>
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

  function handleUsersPaginationClick(e) {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    const nextPage = Number(btn.getAttribute('data-page'));
    if (!Number.isFinite(nextPage) || nextPage < 1) return;
    usersState.page = nextPage;
    loadUsers(document.getElementById('adminUsers'));
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
      openPostDetail(postId);
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
      confirmMode: 'admin-password',
      inputLabel: '삭제하려면 관리자 비밀번호를 입력하세요.',
      pendingLabel: triggerEl?.id === 'adminPostModalDelete' ? '삭제 중...' : '',
      request: async ({ adminPassword }) => {
        const delRes = await fetch(`/api/admin/posts/${postId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admin_password: adminPassword }),
        });
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

  function setupGrowthOperationalControls() {
    const syncBtn = document.getElementById('growthOpsSyncBtn');
    syncBtn?.addEventListener('click', async () => {
      syncBtn.disabled = true;
      const originalText = syncBtn.textContent;
      syncBtn.textContent = '점검 중...';
      try {
        const res = await fetch('/api/admin/growth/operations/alerts/sync', { method: 'POST' });
        const data = await parseJsonSafe(res);
        if (!res.ok || !data.ok) {
          throw new Error(data.message || '운영 점검에 실패했습니다.');
        }
        await loadGrowthOperationalStatus();
      } catch (err) {
        console.error(err);
        alert(err.message || '성장 운영 점검 중 오류가 발생했습니다.');
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = originalText || '운영 점검';
      }
    });

    document.getElementById('addTemplateBtn')?.addEventListener('click', () => {
      const box = document.getElementById('questTemplates');
      if (!box) return;
      box.innerHTML = buildTemplateEditor();
      bindTemplateEvents();
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.getElementById('addCampaignBtn')?.addEventListener('click', () => {
      const box = document.getElementById('questCampaigns');
      if (!box) return;
      box.innerHTML = buildCampaignEditor();
      bindCampaignEvents();
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const writingCampaignRefreshBtn = document.getElementById('writingCampaignRefreshBtn');
    if (writingCampaignRefreshBtn && writingCampaignRefreshBtn.dataset.bound !== 'true') {
      writingCampaignRefreshBtn.dataset.bound = 'true';
      writingCampaignRefreshBtn.addEventListener('click', () => {
        loadWritingCampaignProject();
      });
    }
  }

  async function loadWritingCampaignProject() {
    const box = document.getElementById('writingCampaignProject');
    if (!box) return;
    box.innerHTML = '<p class="gls-text-muted">글쓰기 프로젝트 정보를 불러오는 중입니다...</p>';

    try {
      const res = await fetch('/api/admin/writing-campaigns/monthly-project', {
        cache: 'no-store',
      });
      const data = await parseJsonSafe(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.message || '글쓰기 프로젝트 정보를 불러오지 못했습니다.');
      }

      questState.writingCampaign = data;
      box.innerHTML = buildWritingCampaignProject();
      bindWritingCampaignProjectEvents();
    } catch (err) {
      console.error(err);
      box.innerHTML = '<p class="text-danger">글쓰기 프로젝트 정보를 불러오지 못했습니다.</p>';
    }
  }

  function buildWritingCampaignProject() {
    const data = questState.writingCampaign || {};
    const campaign = data.campaign || {};
    const todayPrompt = data.today_prompt || {};
    const prompts = Array.isArray(data.prompts) ? data.prompts : [];
    const steps = Array.isArray(data.progress_steps) ? data.progress_steps : [];
    const isActive = campaign.active !== false && Boolean(todayPrompt.key);
    const preset = isActive ? data.push_preset || {} : {};
    const dryRun = questState.writingCampaignPushDryRun;
    const sending = questState.writingCampaignPushSending;
    const disabledAttr = sending ? 'disabled' : '';
    const dryRunHtml = dryRun
      ? `
        <div class="writing-campaign-admin-push-result">
          <strong>대상 확인 완료</strong>
          <span>${formatCount(dryRun.eligible_user_count)}명 · 토큰 ${formatCount(
          dryRun.eligible_token_count
        )}개</span>
        </div>
      `
      : '<p class="gls-text-muted gls-text-small gls-mb-0">발송 예약 전 대상 확인을 먼저 실행하세요.</p>';

    if (!isActive) {
      return `
        <div class="writing-campaign-admin">
          <section class="writing-campaign-admin-hero">
            <div>
              <p class="gls-text-muted gls-text-small gls-mb-1">${escapeHtml(campaign.local_date_key || '')}</p>
              <h4 class="gls-mb-1">${escapeHtml(campaign.title || '글숲 한달 글쓰기 프로젝트')}</h4>
              <p class="gls-text-muted gls-text-small gls-mb-0">${escapeHtml(campaign.subtitle || '')}</p>
            </div>
            <div class="writing-campaign-admin-stat">
              <span>대기</span>
              <small>inactive</small>
            </div>
          </section>
          <section class="writing-campaign-admin-today">
            <div>
              <p class="gls-text-muted gls-text-small gls-mb-1">현재 진행 중인 프로젝트 없음</p>
              <h5 class="gls-mb-1">오늘 노출할 글감이 없습니다.</h5>
              <p class="gls-text-muted gls-text-small gls-mb-0">다음 글감 세트 시작일이 오면 자동으로 다시 표시됩니다.</p>
            </div>
          </section>
        </div>
      `;
    }

    return `
      <div class="writing-campaign-admin">
        <section class="writing-campaign-admin-hero">
          <div>
            <p class="gls-text-muted gls-text-small gls-mb-1">${escapeHtml(campaign.local_date_key || '')}</p>
            <h4 class="gls-mb-1">${escapeHtml(campaign.title || '글숲 한달 글쓰기 프로젝트')}</h4>
            <p class="gls-text-muted gls-text-small gls-mb-0">${escapeHtml(campaign.subtitle || '')}</p>
          </div>
          <div class="writing-campaign-admin-stat">
            <span>${formatCount(campaign.current_day)}/${formatCount(campaign.total_days)}</span>
            <small>${formatCount(campaign.progress_percent)}%</small>
          </div>
        </section>

        <section class="writing-campaign-admin-progress">
          ${buildWritingCampaignAdminSteps(steps)}
        </section>

        <section class="writing-campaign-admin-today">
          <div>
            <p class="gls-text-muted gls-text-small gls-mb-1">오늘의 주제 · ${formatCount(todayPrompt.day)}일차</p>
            <h5 class="gls-mb-1">${escapeHtml(todayPrompt.title || '')}</h5>
            <p class="gls-text-muted gls-text-small gls-mb-0">${escapeHtml(todayPrompt.body || '')}</p>
          </div>
          <a class="gls-btn gls-btn-secondary gls-btn-sm" href="${escapeHtml(todayPrompt.write_path || campaign.write_path || '/write')}" target="_blank" rel="noopener">글쓰기 링크 열기</a>
        </section>

        <section class="writing-campaign-admin-push">
          <div>
            <p class="gls-text-muted gls-text-small gls-mb-1">오늘 주제 푸시</p>
            <h5 class="gls-mb-1">${escapeHtml(preset.title || '')}</h5>
            <p class="gls-text-muted gls-text-small gls-mb-0">${escapeHtml(preset.body || '')}</p>
            <p class="gls-text-muted gls-text-small gls-mb-0">이동: ${escapeHtml(preset.target_path || '/write')}</p>
          </div>
          <div class="writing-campaign-admin-push__actions">
            ${dryRunHtml}
            <div class="gls-flex gls-gap-2 gls-flex-wrap">
              <button class="gls-btn gls-btn-secondary gls-btn-sm" id="writingCampaignPushPreviewBtn" type="button" ${disabledAttr}>
                대상 확인
              </button>
              <button class="gls-btn gls-btn-primary gls-btn-sm" id="writingCampaignPushSendBtn" type="button" ${disabledAttr}>
                ${sending ? '처리 중...' : '푸시 예약'}
              </button>
            </div>
          </div>
        </section>

        <details class="writing-campaign-admin-topic-details">
          <summary class="writing-campaign-admin-topic-summary">
            <span>30일 주제 목록</span>
            <span class="quest-ops-pill">총 ${formatCount(prompts.length)}개</span>
          </summary>
          <div class="table-responsive">
            <table class="table table-sm align-middle gls-mb-0 writing-campaign-admin-table">
              <thead>
                <tr>
                  <th>일차</th>
                  <th>주제</th>
                  <th>카테고리</th>
                  <th>태그</th>
                </tr>
              </thead>
              <tbody>${buildWritingCampaignPromptRows(prompts, campaign.current_day)}</tbody>
            </table>
          </div>
        </details>
      </div>
    `;
  }

  function buildWritingCampaignAdminSteps(steps) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    if (!safeSteps.length) {
      return '<p class="gls-text-muted gls-text-small gls-mb-0">진행 단계가 없습니다.</p>';
    }

    return safeSteps
      .map((step) => {
        const state = String(step.state || 'upcoming');
        return `
          <span class="writing-campaign-admin-step writing-campaign-admin-step--${escapeHtml(state)}" title="${escapeHtml(step.title || '')}">
            ${state === 'completed' ? '✓' : formatCount(step.day)}
          </span>
        `;
      })
      .join('');
  }

  function buildWritingCampaignPromptRows(prompts, currentDay) {
    const rows = Array.isArray(prompts) ? prompts : [];
    if (!rows.length) {
      return '<tr><td colspan="4" class="gls-text-muted gls-text-center">등록된 주제가 없습니다.</td></tr>';
    }

    return rows
      .map((prompt) => {
        const isToday = Number(prompt.day) === Number(currentDay);
        const tags = Array.isArray(prompt.suggestedHashtags)
          ? prompt.suggestedHashtags
          : Array.isArray(prompt.suggested_hashtags)
            ? prompt.suggested_hashtags
            : [];
        return `
          <tr class="${isToday ? 'writing-campaign-admin-table__today' : ''}">
            <td>
              <strong>${formatCount(prompt.day)}일차</strong>
              ${isToday ? '<div class="quest-ops-pill">오늘</div>' : ''}
            </td>
            <td>
              <strong>${escapeHtml(prompt.title || '')}</strong>
              <div class="gls-text-muted gls-text-small">${escapeHtml(prompt.body || '')}</div>
            </td>
            <td>${escapeHtml(prompt.defaultCategory || prompt.default_category || '-')}</td>
            <td>${escapeHtml(tags.join(', ') || '-')}</td>
          </tr>
        `;
      })
      .join('');
  }

  function bindWritingCampaignProjectEvents() {
    const box = document.getElementById('writingCampaignProject');
    if (!box) return;
    box.querySelector('#writingCampaignPushPreviewBtn')?.addEventListener('click', (event) => {
      submitWritingCampaignPush(true, event.currentTarget);
    });
    box.querySelector('#writingCampaignPushSendBtn')?.addEventListener('click', (event) => {
      submitWritingCampaignPush(false, event.currentTarget);
    });
  }

  async function submitWritingCampaignPush(dryRun, triggerEl) {
    const data = questState.writingCampaign || {};
    const preset = data.push_preset || {};
    if (!preset.title || !preset.body) {
      showAdminNotice('오늘 주제 푸시 프리셋을 찾을 수 없습니다.', 'error');
      return;
    }

    if (!dryRun && !questState.writingCampaignPushDryRun) {
      showAdminNotice('푸시 예약 전에 대상 확인을 먼저 실행하세요.', 'error');
      return;
    }
    if (
      !dryRun &&
      questState.writingCampaignPushDryRun &&
      Number(questState.writingCampaignPushDryRun.eligible_token_count || 0) <= 0
    ) {
      showAdminNotice('발송 가능한 푸시 토큰이 없습니다.', 'error');
      return;
    }
    if (
      !dryRun &&
      !window.confirm(
        `${formatCount(
          questState.writingCampaignPushDryRun?.eligible_token_count
        )}개 기기에 오늘 주제 푸시를 예약할까요?`
      )
    ) {
      return;
    }

    const originalText = triggerEl?.textContent || '';
    questState.writingCampaignPushSending = true;
    if (triggerEl) {
      triggerEl.disabled = true;
      triggerEl.textContent = dryRun ? '확인 중...' : '예약 중...';
    }
    const box = document.getElementById('writingCampaignProject');
    if (box) box.innerHTML = buildWritingCampaignProject();
    bindWritingCampaignProjectEvents();

    try {
      const res = await fetch('/api/admin/marketing-push-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: preset.title,
          body: preset.body,
          target_path: preset.target_path || '/write',
          include_ad_label: preset.include_ad_label === true,
          dry_run: Boolean(dryRun),
          campaign_key: preset.campaign_key,
          campaign_kind: preset.campaign_kind,
          scheduled_for_date: preset.scheduled_for_date,
          target_rule_json: {
            source: 'writing_campaign_admin',
            campaign_key: data.campaign?.key || null,
            local_date_key: data.campaign?.local_date_key || null,
            prompt_key: data.today_prompt?.key || null,
            prompt_day: data.today_prompt?.day || null,
          },
        }),
      });
      const result = await parseJsonSafe(res);
      if (!res.ok || !result.ok) {
        throw new Error(result.message || '오늘 주제 푸시 작업에 실패했습니다.');
      }

      if (dryRun) {
        questState.writingCampaignPushDryRun = {
          eligible_user_count: result.eligible_user_count || 0,
          eligible_token_count: result.eligible_token_count || 0,
        };
        showAdminNotice('오늘 주제 푸시 대상을 확인했습니다.', 'success');
      } else {
        questState.writingCampaignPushDryRun = null;
        showAdminNotice(
          result.skipped
            ? '이미 오늘 주제 푸시가 예약되어 있습니다.'
            : `오늘 주제 푸시 ${formatCount(result.queued_count)}건을 예약했습니다.`,
          'success'
        );
        const pushBox = document.getElementById('adminPushControls');
        if (pushBox) await loadPushDashboard(pushBox);
      }
    } catch (err) {
      console.error(err);
      showAdminNotice(err.message || '오늘 주제 푸시 처리 중 오류가 발생했습니다.', 'error');
    } finally {
      questState.writingCampaignPushSending = false;
      if (triggerEl && document.body.contains(triggerEl)) {
        triggerEl.disabled = false;
        triggerEl.textContent = originalText;
      }
      const nextBox = document.getElementById('writingCampaignProject');
      if (nextBox) {
        nextBox.innerHTML = buildWritingCampaignProject();
        bindWritingCampaignProjectEvents();
      }
    }
  }

  async function loadGrowthOperationalStatus() {
    const box = document.getElementById('growthOperationalStatus');
    if (!box) return;
    box.innerHTML = '<p class="gls-text-muted">운영 상태를 불러오는 중입니다...</p>';

    try {
      const [healthRes, alertsRes] = await Promise.all([
        fetch('/api/admin/growth/operations/health'),
        fetch('/api/admin/operational-alerts?status=open&limit=20'),
      ]);
      const healthData = await parseJsonSafe(healthRes);
      const alertsData = await parseJsonSafe(alertsRes);

      if (!healthRes.ok || !healthData.ok) {
        throw new Error(healthData.message || '성장 운영 상태를 불러오지 못했습니다.');
      }
      if (!alertsRes.ok || !alertsData.ok) {
        throw new Error(alertsData.message || '운영 알림을 불러오지 못했습니다.');
      }

      questState.operationalHealth = healthData.health || null;
      questState.operationalAlerts = (alertsData.alerts || []).filter((alert) =>
        ['growth', 'campaign'].includes(alert.domain)
      );
      box.innerHTML = buildGrowthOperationalStatus();
      bindGrowthOperationalStatusEvents();
    } catch (err) {
      console.error(err);
      box.innerHTML = '<p class="text-danger">성장 운영 상태를 불러오지 못했습니다.</p>';
    }
  }

  function buildGrowthOperationalStatus() {
    const health = questState.operationalHealth || {};
    const checks = Array.isArray(health.checks) ? health.checks : [];
    const alerts = Array.isArray(questState.operationalAlerts)
      ? questState.operationalAlerts
      : [];
    const problemCount = checks.filter((check) => check.status !== 'pass').length;

    const checksHtml = checks
      .map((check) => {
        const tone =
          check.status === 'error' ? 'danger' : check.status === 'warn' ? 'warning' : 'success';
        return `
          <tr>
            <td><span class="badge text-bg-${tone}">${escapeHtml(check.status || 'pass')}</span></td>
            <td>
              <strong>${escapeHtml(check.title || check.code || '')}</strong>
              <div class="gls-text-muted gls-text-small">${escapeHtml(check.message || '')}</div>
            </td>
            <td class="gls-text-end">${Number(check.count || 0)}</td>
          </tr>
        `;
      })
      .join('');

    const alertsHtml = alerts.length
      ? alerts
          .map((alert) => {
            const tone =
              alert.level === 'error' ? 'danger' : alert.level === 'warn' ? 'warning' : 'secondary';
            return `
              <div class="gls-flex gls-flex-col gls-md-flex-row gls-md-items-center gls-justify-between gls-gap-2 gls-py-2 border-top">
                <div>
                  <div class="gls-flex gls-gap-2 gls-items-center">
                    <span class="badge text-bg-${tone}">${escapeHtml(alert.level)}</span>
                    <strong>${escapeHtml(alert.title || '')}</strong>
                  </div>
                  <p class="gls-text-muted gls-text-small gls-mb-0">${escapeHtml(alert.message || '')}</p>
                </div>
                <button class="gls-btn gls-btn-secondary gls-btn-xs growth-alert-resolve" type="button" data-alert-id="${alert.id}">해결</button>
              </div>
            `;
          })
          .join('')
      : '<p class="gls-text-muted gls-text-small gls-mb-0">열린 성장 운영 알림이 없습니다.</p>';

    return `
      <div class="gls-grid gls-grid-12 gls-gap-3">
        <div class="gls-col-span-12 gls-lg-col-span-4">
          <div class="gls-p-3 rounded border bg-light">
            <p class="gls-text-muted gls-text-small gls-mb-1">운영 점검 결과</p>
            <h4 class="gls-mb-1">${problemCount === 0 ? '정상' : `${problemCount}건 확인 필요`}</h4>
            <p class="gls-text-muted gls-text-small gls-mb-0">열린 알림 ${Number(health.open_alert_count || 0)}건</p>
          </div>
        </div>
        <div class="gls-col-span-12 gls-lg-col-span-8">
          <div class="table-responsive">
            <table class="table table-sm align-middle gls-mb-0">
              <thead><tr><th>상태</th><th>점검</th><th class="gls-text-end">건수</th></tr></thead>
              <tbody>${checksHtml || '<tr><td colspan="3" class="gls-text-muted">점검 항목이 없습니다.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
      ${buildExpiredRewardAutoClaimPanel()}
      <div class="gls-mt-3">
        <h5 class="gls-mb-2">열린 운영 알림</h5>
        ${alertsHtml}
      </div>
    `;
  }

  function buildExpiredRewardAutoClaimPanel() {
    const limit = normalizeAutoClaimLimit(questState.autoClaimLimit);

    return `
      <div class="growth-auto-claim-panel gls-mt-3">
        <div class="growth-auto-claim-panel__header">
          <div>
            <p class="gls-text-muted gls-text-small gls-mb-1">시즌 종료 처리</p>
            <h5 class="gls-mb-1">미수령 완료 보상 자동 수령</h5>
            <p class="gls-text-muted gls-text-small gls-mb-0">
              종료된 시즌/이벤트에서 이미 완료했지만 받지 않은 보상만 처리합니다. 지급 검증은 일반 보상 수령과 같은 로직을 사용합니다.
            </p>
          </div>
          <div class="growth-auto-claim-controls">
            <label class="gls-label gls-mb-0" for="growthAutoClaimLimit">처리 한도</label>
            <input
              class="gls-input gls-input-sm"
              id="growthAutoClaimLimit"
              type="number"
              min="${AUTO_CLAIM_LIMIT_MIN}"
              max="${AUTO_CLAIM_LIMIT_MAX}"
              step="1"
              value="${limit}"
            />
            <button class="gls-btn gls-btn-secondary gls-btn-sm" id="growthAutoClaimPreviewBtn" type="button">
              대상 확인
            </button>
            <button class="gls-btn gls-btn-primary gls-btn-sm" id="growthAutoClaimRunBtn" type="button">
              자동 수령 실행
            </button>
          </div>
        </div>
        <div id="growthAutoClaimResult" class="growth-auto-claim-result">
          ${buildExpiredRewardAutoClaimResult(questState.autoClaimResult)}
        </div>
      </div>
    `;
  }

  function buildExpiredRewardAutoClaimResult(result) {
    if (!result) {
      return '<p class="gls-text-muted gls-text-small gls-mb-0">먼저 대상 확인을 실행하면 처리 후보를 볼 수 있습니다.</p>';
    }

    const candidateCount = Number(result.candidate_count || 0);
    const claimedCount = Number(result.claimed_count || 0);
    const skippedCount = Number(result.skipped_count || 0);
    const dryRun = Boolean(result.dry_run);
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const claimed = Array.isArray(result.claimed) ? result.claimed : [];
    const skipped = Array.isArray(result.skipped) ? result.skipped : [];

    return `
      <div class="growth-auto-claim-summary">
        <span class="quest-ops-pill">${dryRun ? '대상 확인' : '실행 완료'}</span>
        <span class="quest-ops-pill">대상 ${candidateCount}건</span>
        <span class="quest-ops-pill">수령 ${claimedCount}건</span>
        <span class="quest-ops-pill ${skippedCount > 0 ? 'quest-ops-pill--warn' : 'quest-ops-pill--muted'}">스킵 ${skippedCount}건</span>
      </div>
      ${
        dryRun
          ? buildAutoClaimRows('처리 후보', candidates, '자동 수령 후보가 없습니다.', 'candidate')
          : [
              buildAutoClaimRows('수령 완료', claimed, '수령 처리된 보상이 없습니다.', 'claimed'),
              buildAutoClaimRows('스킵', skipped, '스킵된 보상이 없습니다.', 'skipped'),
            ].join('')
      }
    `;
  }

  function buildAutoClaimRows(title, rows, emptyLabel, mode) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (safeRows.length === 0) {
      return `
        <div class="growth-auto-claim-table-wrap">
          <h6 class="gls-mb-1">${escapeHtml(title)}</h6>
          <p class="gls-text-muted gls-text-small gls-mb-0">${escapeHtml(emptyLabel)}</p>
        </div>
      `;
    }

    const visibleRows = safeRows.slice(0, 10);
    const extraCount = Math.max(0, safeRows.length - visibleRows.length);
    const rowsHtml = visibleRows
      .map((row) => {
        const stateId = row.state_id ?? row.stateId ?? '-';
        const userId = row.user_id ?? row.userId ?? '-';
        const campaignName = row.campaign_name || `캠페인 ${row.campaign_id || '-'}`;
        const endAt = formatAdminDateTime(row.end_at);
        const resultText =
          mode === 'claimed'
            ? `+${Number(row.gained_xp || 0)} XP · 코스메틱 ${Number(
                row.gained_cosmetics_count || 0
              )}개`
            : mode === 'skipped'
              ? `${row.code || 'SKIPPED'} · ${row.message || ''}`
              : '수령 가능';

        return `
          <tr>
            <td>${escapeHtml(stateId)}</td>
            <td>${escapeHtml(userId)}</td>
            <td>${escapeHtml(campaignName)}</td>
            <td>${escapeHtml(endAt)}</td>
            <td>${escapeHtml(resultText)}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <div class="growth-auto-claim-table-wrap">
        <h6 class="gls-mb-1">${escapeHtml(title)}</h6>
        <div class="table-responsive">
          <table class="table table-sm align-middle gls-mb-0 growth-auto-claim-table">
            <thead>
              <tr>
                <th>State</th>
                <th>User</th>
                <th>캠페인</th>
                <th>종료</th>
                <th>결과</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        ${
          extraCount > 0
            ? `<p class="gls-text-muted gls-text-small gls-mt-1 gls-mb-0">외 ${extraCount}건이 더 있습니다.</p>`
            : ''
        }
      </div>
    `;
  }

  function normalizeAutoClaimLimit(raw) {
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(parsed)) return 100;
    return Math.max(AUTO_CLAIM_LIMIT_MIN, Math.min(AUTO_CLAIM_LIMIT_MAX, parsed));
  }

  function readAutoClaimLimit() {
    const input = document.getElementById('growthAutoClaimLimit');
    const parsed = Number.parseInt(String(input?.value || ''), 10);
    if (!Number.isInteger(parsed) || parsed < AUTO_CLAIM_LIMIT_MIN || parsed > AUTO_CLAIM_LIMIT_MAX) {
      showAdminNotice(`처리 한도는 ${AUTO_CLAIM_LIMIT_MIN} 이상 ${AUTO_CLAIM_LIMIT_MAX} 이하로 입력하세요.`, 'error');
      return null;
    }
    questState.autoClaimLimit = parsed;
    return parsed;
  }

  async function runExpiredRewardAutoClaim(dryRun, triggerEl) {
    const limit = readAutoClaimLimit();
    if (!limit) return;

    if (!dryRun) {
      const confirmed = window.confirm(
        '종료된 시즌/이벤트의 완료 미수령 보상을 실제 지급합니다. 계속할까요?'
      );
      if (!confirmed) return;
    }

    const originalText = triggerEl?.textContent || '';
    if (triggerEl) {
      triggerEl.disabled = true;
      triggerEl.textContent = dryRun ? '확인 중...' : '처리 중...';
    }

    try {
      const res = await fetch('/api/admin/quests/auto-claim-expired-rewards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit, dry_run: Boolean(dryRun) }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.message || '자동 수령 처리에 실패했습니다.');
      }

      questState.autoClaimResult = data;
      showAdminNotice(
        dryRun
          ? `자동 수령 후보 ${Number(data.candidate_count || 0)}건을 확인했습니다.`
          : `자동 수령 ${Number(data.claimed_count || 0)}건을 처리했습니다.`,
        'success'
      );
      await loadGrowthOperationalStatus();
    } catch (err) {
      console.error(err);
      showAdminNotice(err.message || '자동 수령 처리 중 오류가 발생했습니다.', 'error');
    } finally {
      if (triggerEl && document.body.contains(triggerEl)) {
        triggerEl.disabled = false;
        triggerEl.textContent = originalText;
      }
    }
  }

  function bindGrowthOperationalStatusEvents() {
    const box = document.getElementById('growthOperationalStatus');
    if (!box) return;
    const limitInput = box.querySelector('#growthAutoClaimLimit');
    limitInput?.addEventListener('change', () => {
      const nextLimit = normalizeAutoClaimLimit(limitInput.value);
      questState.autoClaimLimit = nextLimit;
      limitInput.value = String(nextLimit);
    });
    box.querySelector('#growthAutoClaimPreviewBtn')?.addEventListener('click', (event) => {
      runExpiredRewardAutoClaim(true, event.currentTarget);
    });
    box.querySelector('#growthAutoClaimRunBtn')?.addEventListener('click', (event) => {
      runExpiredRewardAutoClaim(false, event.currentTarget);
    });
    box.querySelectorAll('.growth-alert-resolve').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const alertId = btn.getAttribute('data-alert-id');
        if (!alertId) return;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/admin/operational-alerts/${alertId}/resolve`, {
            method: 'POST',
          });
          const data = await parseJsonSafe(res);
          if (!res.ok || !data.ok) {
            throw new Error(data.message || '운영 알림 해결 처리에 실패했습니다.');
          }
          await loadGrowthOperationalStatus();
        } catch (err) {
          console.error(err);
          alert(err.message || '운영 알림 해결 처리 중 오류가 발생했습니다.');
          btn.disabled = false;
        }
      });
    });
  }

  function renderQuestOpsOverview() {
    const box = document.getElementById('questOpsOverview');
    if (!box) return;
    box.innerHTML = buildQuestOpsOverview();
  }

  function buildQuestOpsOverview() {
    const templates = Array.isArray(questState.templates) ? questState.templates : [];
    const campaigns = Array.isArray(questState.campaigns) ? questState.campaigns : [];
    const campaignItems = Array.isArray(questState.campaignItems) ? questState.campaignItems : [];
    const templateById = buildTemplateMap(templates);
    const linkedTemplateIds = new Set(campaignItems.map((item) => Number(item.template_id)));
    const activeTemplates = templates.filter((template) => Number(template.is_active) === 1);
    const promptTemplates = activeTemplates.filter(
      (template) => template.condition_type === 'PROMPT_POST_CREATED'
    );
    const rewardTemplates = activeTemplates.filter(
      (template) => parseQuestUiJson(template.ui_json).reward_cosmetics.length > 0
    );
    const activeCampaigns = campaigns.filter((campaign) => Number(campaign.is_active) === 1);
    const visibleCampaigns = activeCampaigns.filter((campaign) =>
      campaignItems.some((item) => Number(item.campaign_id) === Number(campaign.id))
    );
    const unlinkedTemplates = activeTemplates.filter(
      (template) =>
        String(template.template_kind || 'quest').toLowerCase() !== 'achievement' &&
        !linkedTemplateIds.has(Number(template.id))
    );
    const seasonCampaigns = campaigns.filter(
      (campaign) => String(campaign.campaign_type || '').toLowerCase() === 'season'
    );
    const seasonRewardCampaigns = seasonCampaigns.filter((campaign) => {
      const items = campaignItems.filter((item) => Number(item.campaign_id) === Number(campaign.id));
      return items.some((item) => {
        const template = templateById.get(Number(item.template_id));
        return parseQuestUiJson(template?.ui_json).reward_cosmetics.some((key) =>
          key.startsWith('badge_')
        );
      });
    });

    const steps = [
      {
        index: '1',
        title: '템플릿',
        value: `${activeTemplates.length}개 활성`,
        detail: `프롬프트 ${promptTemplates.length}개 · 보상 ${rewardTemplates.length}개`,
      },
      {
        index: '2',
        title: '캠페인 연결',
        value: `${visibleCampaigns.length}/${activeCampaigns.length}개 노출 준비`,
        detail:
          unlinkedTemplates.length > 0
            ? `미연결 활성 템플릿 ${unlinkedTemplates.length}개`
            : '활성 템플릿 연결 상태 정상',
        state: unlinkedTemplates.length > 0 ? 'warn' : 'ok',
      },
      {
        index: '3',
        title: '모바일 노출',
        value: `${campaignItems.length}개 연결`,
        detail: '성장 홈 미리보기와 퀘스트 탭에 캠페인을 노출합니다.',
      },
      {
        index: '4',
        title: '시즌 보상',
        value: `${seasonRewardCampaigns.length}/${seasonCampaigns.length}개 배지 보상`,
        detail:
          seasonCampaigns.length === 0
            ? '시즌 캠페인을 만들면 배지 보상을 연결할 수 있습니다.'
            : 'badge_* 키가 연결된 시즌 캠페인 수입니다.',
        state:
          seasonCampaigns.length > 0 && seasonRewardCampaigns.length === 0 ? 'warn' : 'ok',
      },
    ];

    const stepHtml = steps
      .map(
        (step) => `
        <div class="quest-ops-step quest-ops-step--${escapeHtml(step.state || 'normal')}">
          <span class="quest-ops-step__index">${escapeHtml(step.index)}</span>
          <div>
            <p class="quest-ops-step__title">${escapeHtml(step.title)}</p>
            <strong>${escapeHtml(step.value)}</strong>
            <p class="gls-text-muted gls-text-small gls-mb-0">${escapeHtml(step.detail)}</p>
          </div>
        </div>`
      )
      .join('');

    const campaignHtml = activeCampaigns.length
      ? activeCampaigns
          .slice(0, 6)
          .map((campaign) => buildQuestOpsCampaignCard(campaign, campaignItems, templateById))
          .join('')
      : '<p class="gls-text-muted gls-text-small gls-mb-0">활성 캠페인이 없습니다. 캠페인을 만들고 템플릿을 연결하세요.</p>';

    return `
      <div class="quest-ops-overview">
        <div class="quest-ops-steps">${stepHtml}</div>
        <div class="quest-ops-section">
          <div class="gls-spread gls-mb-2">
            <h5 class="gls-mb-0">활성 캠페인 흐름</h5>
            <span class="quest-ops-pill">시즌 배지 예: ${SEASON_REWARD_BADGE_KEYS.join(', ')}</span>
          </div>
          <div class="quest-ops-campaigns">${campaignHtml}</div>
        </div>
      </div>
    `;
  }

  function buildQuestOpsCampaignCard(campaign, campaignItems, templateById) {
    const items = campaignItems.filter((item) => Number(item.campaign_id) === Number(campaign.id));
    const templates = items
      .map((item) => templateById.get(Number(item.template_id)))
      .filter(Boolean);
    const rewardKeys = Array.from(
      new Set(
        templates.flatMap((template) => parseQuestUiJson(template.ui_json).reward_cosmetics)
      )
    );
    const promptCount = templates.filter(
      (template) => template.condition_type === 'PROMPT_POST_CREATED'
    ).length;
    const rewardHtml = rewardKeys.length
      ? rewardKeys.map((key) => `<span class="quest-ops-pill">${escapeHtml(key)}</span>`).join('')
      : '<span class="quest-ops-pill quest-ops-pill--muted">XP 보상만</span>';

    return `
      <div class="quest-ops-campaign-card">
        <div class="gls-spread gls-gap-2">
          <strong>${escapeHtml(campaign.name || `캠페인 ${campaign.id}`)}</strong>
          <span class="quest-ops-pill">${escapeHtml(
            CAMPAIGN_TYPE_LABELS[campaign.campaign_type] || campaign.campaign_type || '캠페인'
          )}</span>
        </div>
        <p class="gls-text-muted gls-text-small gls-mb-2">
          템플릿 ${templates.length}개 · 프롬프트 ${promptCount}개 · priority ${Number(
            campaign.priority || 1
          )}
        </p>
        <div class="quest-ops-rewards">${rewardHtml}</div>
      </div>
    `;
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
      renderQuestOpsOverview();
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
        await loadGrowthOperationalStatus();
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
    const promptValues = parsePromptUiJson(values.ui_json);
    const questUiValues = parseQuestUiJson(values.ui_json);
    const listHtml = questState.templates
      .map((t) => {
        const rewardSummary = buildQuestRewardSummary(t.ui_json);
        return `
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
          <td>${rewardSummary}</td>
          <td>${escapeHtml(t.code || '-')}</td>
          <td>${t.is_active ? '활성' : '비활성'}</td>
          <td class="gls-text-end">
            <button class="gls-btn gls-btn-secondary gls-btn-xs quest-template-edit" type="button">수정</button>
            <button class="gls-btn gls-btn-danger gls-btn-xs quest-template-delete" type="button">삭제</button>
          </td>
        </tr>`;
      })
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
          <div class="gls-col-span-12">
            <div class="quest-reward-panel">
              <div>
                <strong>잠금/시즌 보상</strong>
                <p class="gls-text-muted gls-text-small gls-mb-0">시즌 캠페인은 badge_spring_2026 같은 배지 키를 연결하면 보상 수령 시 지급됩니다.</p>
              </div>
              <div class="gls-grid gls-grid-12 gls-gap-2">
                <div class="gls-col-span-12 gls-md-col-span-5">
                  <label class="gls-label gls-text-small gls-mb-1">필요 권한</label>
                  <input class="gls-input gls-input-sm" name="required_entitlement" value="${escapeHtml(
                    questUiValues.required_entitlement || ''
                  )}" placeholder="pass:2026_spring" />
                </div>
                <div class="gls-col-span-12 gls-md-col-span-7">
                  <label class="gls-label gls-text-small gls-mb-1">보상 배지/스티커 키</label>
                  <input class="gls-input gls-input-sm" name="reward_cosmetics" value="${escapeHtml(
                    (questUiValues.reward_cosmetics || []).join(', ')
                  )}" placeholder="${SEASON_REWARD_BADGE_KEYS.join(', ')}, sticker_star" />
                </div>
              </div>
            </div>
          </div>
          <div class="gls-col-span-12">
            <div class="gls-p-3 border rounded bg-light">
              <div class="gls-spread gls-mb-2">
                <div>
                  <strong>프롬프트 글쓰기 퀘스트</strong>
                  <p class="gls-text-muted gls-text-small gls-mb-0">조건 타입이 프롬프트 글쓰기일 때 아래 입력값으로 UI 메타를 생성합니다.</p>
                </div>
              </div>
              <div class="gls-grid gls-grid-12 gls-gap-2">
                <div class="gls-col-span-12 gls-md-col-span-4">
                  <label class="gls-label gls-text-small gls-mb-1">프롬프트 키</label>
                  <input class="gls-input gls-input-sm" name="prompt_key" value="${escapeHtml(promptValues.key || '')}" placeholder="letter_to_past_love_202605" />
                </div>
                <div class="gls-col-span-12 gls-md-col-span-4">
                  <label class="gls-label gls-text-small gls-mb-1">CTA 문구</label>
                  <input class="gls-input gls-input-sm" name="prompt_cta_label" value="${escapeHtml(promptValues.cta_label || '이 주제로 글쓰기')}" />
                </div>
                <div class="gls-col-span-12 gls-md-col-span-4">
                  <label class="gls-label gls-text-small gls-mb-1">출처 URL/메모</label>
                  <input class="gls-input gls-input-sm" name="prompt_source_url" value="${escapeHtml(promptValues.source_url || '')}" placeholder="https://instagram.com/..." />
                </div>
                <div class="gls-col-span-12">
                  <label class="gls-label gls-text-small gls-mb-1">프롬프트 제목</label>
                  <input class="gls-input gls-input-sm" name="prompt_title" value="${escapeHtml(promptValues.title || values.name || '')}" placeholder="지나간 연인에게 편지를 써봐요" />
                </div>
                <div class="gls-col-span-12">
                  <label class="gls-label gls-text-small gls-mb-1">프롬프트 본문 가이드</label>
                  <textarea class="gls-input gls-input-sm" name="prompt_body" rows="2" placeholder="사용자에게 보여줄 글감 설명">${escapeHtml(promptValues.body || values.description || '')}</textarea>
                </div>
                <div class="gls-col-span-12 gls-md-col-span-4">
                  <label class="gls-label gls-text-small gls-mb-1">기본 카테고리</label>
                  <select class="gls-select gls-select-sm" name="prompt_default_category">
                    <option value="essay" ${promptValues.default_category === 'essay' ? 'selected' : ''}>에세이</option>
                    <option value="poem" ${promptValues.default_category === 'poem' ? 'selected' : ''}>시</option>
                    <option value="short" ${promptValues.default_category === 'short' ? 'selected' : ''}>짧은 구절</option>
                  </select>
                </div>
                <div class="gls-col-span-12 gls-md-col-span-8">
                  <label class="gls-label gls-text-small gls-mb-1">추천 해시태그</label>
                  <input class="gls-input gls-input-sm" name="prompt_suggested_hashtags" value="${escapeHtml((promptValues.suggested_hashtags || []).join(', '))}" placeholder="편지, 지난사랑, 글감" />
                </div>
              </div>
            </div>
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
          <thead><tr><th>제목</th><th>조건</th><th>목표</th><th>XP</th><th>종류</th><th>배지/잠금</th><th>코드</th><th>상태</th><th class="gls-text-end">관리</th></tr></thead>
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
      if (payload.condition_type === 'PROMPT_POST_CREATED') {
        const promptUiJson = buildPromptUiJsonFromForm(formData);
        if (!promptUiJson) {
          alert('프롬프트 글쓰기 퀘스트는 프롬프트 키와 제목이 필요합니다.');
          return;
        }
        payload.ui_json = promptUiJson;
        payload.template_kind = 'quest';
        payload.target_value = payload.target_value || '1';
      } else {
        payload.ui_json = buildQuestUiJsonFromForm(payload.ui_json, formData);
      }
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
        await loadGrowthOperationalStatus();
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
            await loadGrowthOperationalStatus();
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
      'PROMPT_POST_CREATED',
    ];
    return options
      .map(
        (opt) => `<option value="${opt}" ${selected === opt ? 'selected' : ''}>${
          CONDITION_LABELS[opt] || opt
        }</option>`
      )
      .join('');
  }

  function parsePromptUiJson(raw) {
    if (!raw || typeof raw !== 'string') return {};
    try {
      const parsed = JSON.parse(raw);
      const prompt = parsed?.prompt && typeof parsed.prompt === 'object' ? parsed.prompt : {};
      return {
        key: typeof prompt.key === 'string' ? prompt.key : '',
        title: typeof prompt.title === 'string' ? prompt.title : '',
        body: typeof prompt.body === 'string' ? prompt.body : '',
        cta_label: typeof prompt.cta_label === 'string' ? prompt.cta_label : '',
        default_category:
          prompt.default_category === 'poem' || prompt.default_category === 'short'
            ? prompt.default_category
            : 'essay',
        suggested_hashtags: Array.isArray(prompt.suggested_hashtags)
          ? prompt.suggested_hashtags.map(String).filter(Boolean)
          : [],
        source_url:
          typeof parsed.source_url === 'string'
            ? parsed.source_url
            : typeof prompt.source_url === 'string'
              ? prompt.source_url
              : '',
      };
    } catch {
      return {};
    }
  }

  function parseUiJsonObject(raw) {
    if (!raw || typeof raw !== 'string') return { ok: false, value: {} };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, value: {} };
      }
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, value: {} };
    }
  }

  function parseCommaList(raw) {
    return String(raw || '')
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseQuestUiJson(raw) {
    const parsed = parseUiJsonObject(raw);
    const meta = parsed.value || {};
    const rewards = meta.rewards && typeof meta.rewards === 'object' ? meta.rewards : {};
    return {
      required_entitlement:
        typeof meta.required_entitlement === 'string' ? meta.required_entitlement.trim() : '',
      reward_cosmetics: Array.isArray(rewards.cosmetics)
        ? rewards.cosmetics.map(String).map((key) => key.trim()).filter(Boolean)
        : [],
    };
  }

  function applyQuestRewardConfig(meta, formData) {
    const next = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {};
    const requiredEntitlement = String(formData.get('required_entitlement') || '').trim();
    const rewardCosmetics = parseCommaList(formData.get('reward_cosmetics')).slice(0, 12);

    if (requiredEntitlement) {
      next.required_entitlement = requiredEntitlement;
    } else {
      delete next.required_entitlement;
    }

    const rewards =
      next.rewards && typeof next.rewards === 'object' && !Array.isArray(next.rewards)
        ? { ...next.rewards }
        : {};
    if (rewardCosmetics.length > 0) {
      rewards.cosmetics = rewardCosmetics;
    } else {
      delete rewards.cosmetics;
    }

    if (Object.keys(rewards).length > 0) {
      next.rewards = rewards;
    } else {
      delete next.rewards;
    }

    return next;
  }

  function buildQuestUiJsonFromForm(rawUiJson, formData) {
    const raw = String(rawUiJson || '').trim();
    const parsed = parseUiJsonObject(raw);
    const hasRewardInputs =
      String(formData.get('required_entitlement') || '').trim() ||
      String(formData.get('reward_cosmetics') || '').trim();

    if (!parsed.ok && !hasRewardInputs) {
      return raw;
    }

    const next = applyQuestRewardConfig(parsed.ok ? parsed.value : {}, formData);
    return Object.keys(next).length > 0 ? JSON.stringify(next) : '';
  }

  function buildQuestRewardSummary(rawUiJson) {
    const config = parseQuestUiJson(rawUiJson);
    const chips = [];
    if (config.required_entitlement) {
      chips.push(
        `<span class="quest-reward-chip quest-reward-chip--lock">${escapeHtml(
          config.required_entitlement
        )}</span>`
      );
    }
    config.reward_cosmetics.forEach((key) => {
      const isBadge = key.startsWith('badge_');
      chips.push(
        `<span class="quest-reward-chip ${
          isBadge ? 'quest-reward-chip--badge' : 'quest-reward-chip--sticker'
        }">${escapeHtml(key)}</span>`
      );
    });
    return chips.length
      ? `<div class="quest-reward-chips">${chips.join('')}</div>`
      : '<span class="gls-text-muted gls-text-small">XP만</span>';
  }

  function buildTemplateMap(templates = questState.templates) {
    const map = new Map();
    (Array.isArray(templates) ? templates : []).forEach((template) => {
      map.set(Number(template.id), template);
    });
    return map;
  }

  function buildPromptUiJsonFromForm(formData) {
    const key = String(formData.get('prompt_key') || '').trim();
    const title = String(formData.get('prompt_title') || '').trim();
    if (!key || !title) return null;
    const body = String(formData.get('prompt_body') || '').trim();
    const ctaLabel = String(formData.get('prompt_cta_label') || '').trim() || '이 주제로 글쓰기';
    const defaultCategory = String(formData.get('prompt_default_category') || 'essay').trim();
    const hashtags = String(formData.get('prompt_suggested_hashtags') || '')
      .split(/[\s,]+/)
      .map((tag) => tag.trim().replace(/^#+/, ''))
      .filter(Boolean)
      .slice(0, 12);
    const sourceUrl = String(formData.get('prompt_source_url') || '').trim();
    const meta = applyQuestRewardConfig(
      {
        quest_kind: 'writing_prompt',
        prompt: {
          key,
          title,
          body,
          cta_label: ctaLabel,
          default_category: ['poem', 'essay', 'short'].includes(defaultCategory)
            ? defaultCategory
            : 'essay',
          suggested_hashtags: hashtags,
        },
        source: 'instagram',
        ...(sourceUrl ? { source_url: sourceUrl } : {}),
      },
      formData
    );
    return JSON.stringify(meta);
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
      renderQuestOpsOverview();
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
    const templateById = buildTemplateMap();
    const selectedItems = itemsByCampaign[values.id] || [];
    const selection = questState.templates
      .map((t) => {
        const found = selectedItems.find((i) => Number(i.template_id) === Number(t.id));
        const rewardConfig = parseQuestUiJson(t.ui_json);
        const rewardLabel = rewardConfig.reward_cosmetics.length
          ? ` · 보상 ${rewardConfig.reward_cosmetics.length}개`
          : '';
        return `
          <div class="gls-check gls-check-inline gls-mb-1">
            <input class="gls-check-input quest-campaign-template" type="checkbox" data-template-id="${t.id}" id="campaignTpl${t.id}" ${
          found ? 'checked' : ''
        } />
            <label class="gls-check-label quest-template-select__label" for="campaignTpl${t.id}">
              <span>${escapeHtml(t.name)}</span>
              <small>${escapeHtml(t.template_kind || 'quest')}${escapeHtml(rewardLabel)}</small>
            </label>
            <input type="number" class="gls-input gls-input-sm gls-ms-2 admin-template-order-input" placeholder="순서" data-template-order="${t.id}" value="${
          found ? found.sort_order || 0 : ''
        }" />
          </div>`;
      })
      .join('');

    const listHtml = questState.campaigns
      .map((c) => {
        const linkedItems = itemsByCampaign[c.id] || [];
        const linkedTemplates = linkedItems
          .map((item) => templateById.get(Number(item.template_id)))
          .filter(Boolean);
        const rewardCount = linkedTemplates.filter(
          (template) => parseQuestUiJson(template.ui_json).reward_cosmetics.length > 0
        ).length;
        return `
        <tr data-campaign-id="${c.id}">
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(CAMPAIGN_TYPE_LABELS[c.campaign_type] || c.campaign_type || '')}</td>
          <td>${c.start_at || '-'} ~ ${c.end_at || '-'}</td>
          <td>${linkedTemplates.length}개${
          rewardCount ? ` <span class="quest-ops-pill">${rewardCount}개 보상</span>` : ''
        }</td>
          <td>${c.is_active ? '활성' : '비활성'} (priority ${c.priority || 1})</td>
          <td class="gls-text-end">
            <button class="gls-btn gls-btn-secondary gls-btn-xs quest-campaign-edit" type="button">편집</button>
            <button class="gls-btn gls-btn-danger gls-btn-xs quest-campaign-delete" type="button">삭제</button>
          </td>
        </tr>`;
      })
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
          <thead><tr><th>이름</th><th>유형</th><th>기간</th><th>연결</th><th>상태</th><th class="gls-text-end">관리</th></tr></thead>
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
        const campaignId = isEdit ? payload.id : data.campaign_id;
        if (campaignId) {
          await saveCampaignItems(campaignId, form);
        }
        await loadQuestCampaigns();
        await loadQuestTemplates();
        await loadGrowthOperationalStatus();
      } catch (err) {
        console.error(err);
        alert(err.message || '캠페인 저장 중 오류가 발생했습니다.');
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
            await loadGrowthOperationalStatus();
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
      const res = await fetch(`/api/admin/quest-campaigns/${campaignId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selectedTemplates }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.message || '캠페인 템플릿 저장에 실패했습니다.');
      }
    } catch (err) {
      console.error(err);
      throw err;
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
