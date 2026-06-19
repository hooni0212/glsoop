const SECTION_IDS = {
  summary: 'growthSummarySection',
  quests: 'growthQuestSection',
  achievementQuests: 'growthAchievementQuestSection',
  forest: 'growthForestSection',
  achievements: 'growthAchievementListSection',
};

const STORAGE_KEYS = {
  achievementFilter: 'glsoop:growth:achievement-filter',
  mobilePanel: 'glsoop:growth:mobile-panel',
};

const VALID_ACHIEVEMENT_FILTERS = new Set(['all', 'in_progress', 'completed', 'locked']);
const VALID_MOBILE_PANELS = new Set(['forest', 'achievements']);
const WRITING_EVENT_KEY = 'glsoop-monthly-writing-project-prototype';

const claimInFlight = new Set();
let noticeTimer = null;
let achievementCache = [];
let selectedAchievementFilter = readStoredAchievementFilter();
let selectedMobilePanel = readStoredMobilePanel();

function trackUxEvent(eventName, properties = {}, options = {}) {
  if (!window.glsoopAnalytics || typeof window.glsoopAnalytics.trackEvent !== 'function') {
    return;
  }
  window.glsoopAnalytics.trackEvent(eventName, properties, options);
}

function getLevelEmoji(level) {
  const n = Number(level) || 0;
  if (n <= 0) return '🌰';
  if (n <= 5) return '🌰';
  if (n <= 10) return '🌱';
  if (n <= 15) return '🌿';
  if (n <= 20) return '🌳';
  return '🌲';
}

function readStorageValue(key) {
  try {
    if (!window?.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeStorageValue(key, value) {
  try {
    if (!window?.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch (error) {
    // no-op: storage는 best effort
  }
}

function normalizeAchievementFilter(filter) {
  if (VALID_ACHIEVEMENT_FILTERS.has(filter)) return filter;
  return 'all';
}

function normalizeMobilePanel(panel) {
  if (VALID_MOBILE_PANELS.has(panel)) return panel;
  return 'forest';
}

function readStoredAchievementFilter() {
  const stored = readStorageValue(STORAGE_KEYS.achievementFilter);
  return normalizeAchievementFilter(stored || 'all');
}

function readStoredMobilePanel() {
  const stored = readStorageValue(STORAGE_KEYS.mobilePanel);
  return normalizeMobilePanel(stored || 'forest');
}

document.addEventListener('DOMContentLoaded', async () => {
  bindAchievementFilters();
  bindGrowthViewTabs();
  applyGrowthViewPanel(selectedMobilePanel, { persist: false });

  try {
    await ensureAuthenticated();
  } catch (error) {
    console.error(error);
    return;
  }

  renderInitialLoadingState();
  await Promise.all([
    loadGrowthDashboard({ showLoading: false, fallback: true }),
    loadWritingCampaign(),
  ]);
});

async function loadWritingCampaign() {
  const mount = document.getElementById('growthWritingCampaign');
  if (!mount) return;

  try {
    const [eventResponse, postsResponse] = await Promise.all([
      fetch(`/api/writing-events/${encodeURIComponent(WRITING_EVENT_KEY)}`, { cache: 'no-store' }),
      fetch(`/api/writing-events/${encodeURIComponent(WRITING_EVENT_KEY)}/me/posts?limit=30`, {
        cache: 'no-store',
      }),
    ]);
    const eventData = await eventResponse.json().catch(() => ({}));
    const postsData = await postsResponse.json().catch(() => ({}));
    if (!eventResponse.ok || !eventData.ok) {
      throw new Error(eventData.message || '글쓰기 프로젝트를 불러오지 못했습니다.');
    }

    renderWritingCampaign(eventData, postsResponse.ok && postsData.ok ? postsData.posts : []);
  } catch (error) {
    console.error(error);
    mount.innerHTML = '<p class="gls-text-muted gls-mb-0">글쓰기 프로젝트를 불러오지 못했습니다.</p>';
  }
}

function renderWritingCampaign(data, posts = []) {
  const mount = document.getElementById('growthWritingCampaign');
  if (!mount) return;
  const event = data.event || {};
  const prompt = data.today_prompt || {};
  const steps = Array.isArray(data.progress_steps) ? data.progress_steps : [];
  const postByPromptKey = new Map(
    (Array.isArray(posts) ? posts : []).map((post) => [String(post.prompt_key || ''), post])
  );
  const progress = Math.max(0, Math.min(100, Number(event.progress_percent) || 0));
  const completedCount = postByPromptKey.size;
  const stepHtml = steps
    .map((step) => {
      const post = postByPromptKey.get(String(step.key || ''));
      const state = post ? 'written' : String(step.state || 'upcoming');
      const label = post ? `${step.day}일차 작성 완료` : `${step.day}일차 ${step.title || ''}`;
      return post
        ? `<a class="growth-writing-campaign__step is-${state}" href="/posts/${encodeURIComponent(post.id)}" title="${escapeHtml(label)}">${escapeHtml(step.day)}</a>`
        : `<span class="growth-writing-campaign__step is-${state}" title="${escapeHtml(label)}">${escapeHtml(step.day)}</span>`;
    })
    .join('');
  const postsHtml = (Array.isArray(posts) ? posts : [])
    .map(
      (post) => `
        <a class="growth-writing-campaign__post" href="/posts/${encodeURIComponent(post.id)}">
          <span>${escapeHtml(`${post.prompt_day || '-'}일차`)}</span>
          <strong>${escapeHtml(post.title || '제목 없는 글')}</strong>
          <small>${escapeHtml(post.prompt_title || '')}</small>
        </a>
      `
    )
    .join('');

  mount.innerHTML = `
    <div class="growth-writing-campaign__header">
      <div>
        <p class="gls-text-muted gls-text-small gls-mb-1">30개의 글감으로 쌓는 기록</p>
        <h3 class="growth-section-title gls-mb-1" id="growthWritingCampaignTitle">${escapeHtml(event.title || '글숲 한달 글쓰기 프로젝트')}</h3>
        <p class="gls-text-muted gls-mb-0">${escapeHtml(event.subtitle || '')}</p>
      </div>
      <div class="growth-writing-campaign__score">
        <strong>${escapeHtml(`${event.current_day || 0}/${event.total_days || 30}`)}</strong>
        <span>작성 ${completedCount}개</span>
      </div>
    </div>
    <div class="growth-writing-campaign__bar" aria-label="날짜 진행률 ${progress}%"><span style="width:${progress}%"></span></div>
    <div class="growth-writing-campaign__steps" aria-label="30일 글감 목록">${stepHtml}</div>
    <div class="growth-writing-campaign__today">
      <div>
        <p>${escapeHtml(`${prompt.day || event.current_day || '-'}일차 · ${event.prompt_label || '오늘의 글감'}`)}</p>
        <h4>${escapeHtml(prompt.title || '')}</h4>
        <span>${escapeHtml(prompt.body || '')}</span>
      </div>
      <a class="gls-btn gls-btn-primary" href="${escapeHtml(prompt.write_path || event.write_path || '/write')}">오늘 주제로 쓰기</a>
    </div>
    <div class="growth-writing-campaign__posts">
      <h4>내 프로젝트 글</h4>
      ${postsHtml || '<p class="gls-text-muted gls-mb-0">아직 프로젝트로 작성한 글이 없습니다.</p>'}
    </div>
  `;
}

function setSectionLoading(sectionId, isLoading) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.classList.toggle('is-loading', Boolean(isLoading));
  section.setAttribute('aria-busy', isLoading ? 'true' : 'false');
}

function setAllGrowthSectionsLoading(isLoading) {
  setSectionLoading(SECTION_IDS.summary, isLoading);
  setSectionLoading(SECTION_IDS.quests, isLoading);
  setSectionLoading(SECTION_IDS.achievementQuests, isLoading);
  setSectionLoading(SECTION_IDS.forest, isLoading);
  setSectionLoading(SECTION_IDS.achievements, isLoading);
}

function syncGrowthViewTabButtons() {
  const tabs = document.querySelectorAll('#growthViewTabs .growth-view-tab');
  tabs.forEach((tab) => {
    const view = normalizeMobilePanel(tab.dataset.view || 'forest');
    const isActive = view === selectedMobilePanel;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function applyGrowthViewPanel(panel, options = {}) {
  const { persist = true, source = 'system' } = options;
  selectedMobilePanel = normalizeMobilePanel(panel);

  if (persist) {
    writeStorageValue(STORAGE_KEYS.mobilePanel, selectedMobilePanel);
  }

  const isMobile = window.matchMedia('(max-width: 991.98px)').matches;
  const forestSection = document.getElementById(SECTION_IDS.forest);
  const achievementSection = document.getElementById(SECTION_IDS.achievements);

  if (forestSection) {
    forestSection.classList.toggle(
      'is-mobile-hidden',
      isMobile && selectedMobilePanel !== 'forest'
    );
  }

  if (achievementSection) {
    achievementSection.classList.toggle(
      'is-mobile-hidden',
      isMobile && selectedMobilePanel !== 'achievements'
    );
  }

  syncGrowthViewTabButtons();
  if (source === 'user') {
    trackUxEvent('growth_panel_switch', {
      panel: selectedMobilePanel,
      mobile: window.matchMedia('(max-width: 991.98px)').matches,
    });
  }
}

function bindGrowthViewTabs() {
  const tabs = document.querySelectorAll('#growthViewTabs .growth-view-tab');
  if (!tabs.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const panel = normalizeMobilePanel(tab.dataset.view || 'forest');
      applyGrowthViewPanel(panel, { source: 'user' });
    });
  });

  window.addEventListener('resize', () => {
    applyGrowthViewPanel(selectedMobilePanel, { persist: false });
  });
}

function showNotice(message, tone = 'info') {
  const notice = document.getElementById('growthNotice');
  if (!notice) return;

  notice.classList.remove('gls-hidden', 'is-info', 'is-success', 'is-error');
  notice.classList.add(`is-${tone}`);
  notice.textContent = message;
  notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  notice.setAttribute('tabindex', '-1');

  try {
    notice.focus({ preventScroll: true });
  } catch (error) {
    notice.focus();
  }

  if (noticeTimer) {
    clearTimeout(noticeTimer);
  }
  noticeTimer = setTimeout(() => {
    notice.classList.add('gls-hidden');
  }, tone === 'error' ? 6000 : 3500);
}

function renderInitialLoadingState() {
  setAllGrowthSectionsLoading(true);

  const levelXp = document.getElementById('growthLevelXp');
  if (levelXp) levelXp.textContent = '불러오는 중...';

  renderQuestLoadingSkeleton();
  renderAchievementQuestLoadingSkeleton();
  renderForestLoadingSkeleton();
  renderAchievementGridLoadingSkeleton();
}

function renderQuestLoadingSkeleton() {
  const questToday = document.getElementById('growthQuestListToday');
  const questWeek = document.getElementById('growthQuestListWeek');
  const campaignStack = document.getElementById('campaignStack');

  const skeletonCard = `
    <div class="quest-card is-skeleton" aria-hidden="true">
      <div class="skeleton-line skeleton-line-lg"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line-sm"></div>
    </div>
  `;

  if (questToday) questToday.innerHTML = `${skeletonCard}${skeletonCard}`;
  if (questWeek) questWeek.innerHTML = `${skeletonCard}${skeletonCard}`;
  if (campaignStack) {
    campaignStack.innerHTML = `
      <div class="campaign-card is-skeleton" aria-hidden="true">
        <div class="skeleton-line skeleton-line-lg"></div>
        <div class="skeleton-line"></div>
      </div>
      <div class="campaign-card is-skeleton" aria-hidden="true">
        <div class="skeleton-line skeleton-line-lg"></div>
        <div class="skeleton-line"></div>
      </div>
    `;
  }
}

function renderAchievementQuestLoadingSkeleton() {
  const achievementList = document.getElementById('achievementQuestList');
  if (!achievementList) return;

  achievementList.innerHTML = `
    <div class="achievement-quest-card is-skeleton" aria-hidden="true">
      <div class="skeleton-line skeleton-line-lg"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line-sm"></div>
    </div>
    <div class="achievement-quest-card is-skeleton" aria-hidden="true">
      <div class="skeleton-line skeleton-line-lg"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line-sm"></div>
    </div>
  `;
}

function renderForestLoadingSkeleton() {
  const map = document.getElementById('forestMapAchievements');
  if (!map) return;

  map.innerHTML = `
    <div class="forest-map-node is-skeleton" aria-hidden="true">
      <div class="skeleton-line skeleton-line-lg"></div>
      <div class="skeleton-line skeleton-line-sm"></div>
    </div>
    <div class="forest-map-node is-skeleton" aria-hidden="true">
      <div class="skeleton-line skeleton-line-lg"></div>
      <div class="skeleton-line skeleton-line-sm"></div>
    </div>
  `;
}

function renderAchievementGridLoadingSkeleton() {
  const grid = document.getElementById('achievementGrid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="achievement-card is-skeleton" aria-hidden="true">
      <div class="skeleton-line skeleton-line-lg"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line-sm"></div>
    </div>
    <div class="achievement-card is-skeleton" aria-hidden="true">
      <div class="skeleton-line skeleton-line-lg"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line-sm"></div>
    </div>
  `;
}

async function ensureAuthenticated() {
  const res = await fetch('/api/me', { cache: 'no-store' });
  if (!res.ok) {
    window.location.href = '/html/login.html?next=/html/growth.html';
    throw new Error('Unauthenticated');
  }

  const data = await res.json();
  if (!data.ok) {
    window.location.href = '/html/login.html?next=/html/growth.html';
    throw new Error('Unauthenticated');
  }
}

async function loadGrowthDashboard(options = {}) {
  const { showLoading = true, fallback = true } = options;

  if (showLoading) {
    renderInitialLoadingState();
  }

  try {
    const res = await fetch('/api/growth/dashboard', { cache: 'no-store' });
    if (!res.ok) throw new Error('growth dashboard request failed');

    const data = await res.json();
    if (
      !data.ok ||
      !data.summary ||
      !Array.isArray(data.achievements) ||
      !Array.isArray(data.campaigns)
    ) {
      throw new Error('invalid growth dashboard response');
    }

    renderGrowthSummary(data.summary);

    achievementCache = data.achievements;
    renderForestMapNodes(achievementCache);
    renderAchievementGrid(selectedAchievementFilter);

    if (achievementCache.length > 0) {
      renderAchievementDetail(achievementCache[0]);
    } else {
      const detail = document.getElementById('forestMapDetail');
      if (detail) {
        detail.innerHTML = '<p class="gls-text-muted gls-mb-0">아직 표시할 업적이 없습니다.</p>';
      }
    }

    renderQuestGroups(formatCampaignMeta(data.campaigns));
    setAllGrowthSectionsLoading(false);
    return true;
  } catch (error) {
    console.error(error);

    if (!fallback) {
      renderGrowthSummaryFallback();
      renderQuestGroupsError();

      const map = document.getElementById('forestMapAchievements');
      if (map) {
        map.innerHTML = '<p class="gls-text-muted">업적 정보를 불러오지 못했습니다.</p>';
      }

      const grid = document.getElementById('achievementGrid');
      if (grid) {
        grid.innerHTML = '<p class="gls-text-muted">업적 정보를 불러오지 못했습니다.</p>';
      }

      const detail = document.getElementById('forestMapDetail');
      if (detail) {
        detail.innerHTML = '<p class="gls-text-muted gls-mb-0">업적 상세 정보를 표시할 수 없습니다.</p>';
      }

      setAllGrowthSectionsLoading(false);
      showNotice('성장 대시보드 정보를 불러오지 못했습니다.', 'error');
      return false;
    }

    await Promise.allSettled([
      loadGrowthSummary({ showLoading: true }),
      loadGrowthAchievements({ showLoading: true }),
      loadActiveQuests({ showLoading: true }),
    ]);

    return false;
  }
}

async function loadActiveQuests(options = {}) {
  const { showLoading = true } = options;
  if (showLoading) {
    setSectionLoading(SECTION_IDS.quests, true);
    setSectionLoading(SECTION_IDS.achievementQuests, true);
  }

  try {
    const res = await fetch('/api/quests/active', { cache: 'no-store' });
    if (!res.ok) throw new Error('active quests request failed');

    const data = await res.json();
    if (!data.ok || !Array.isArray(data.campaigns)) {
      throw new Error('invalid active quests response');
    }

    renderQuestGroups(formatCampaignMeta(data.campaigns));
  } catch (error) {
    console.error(error);
    renderQuestGroupsError();
    showNotice('퀘스트 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
  } finally {
    if (showLoading) {
      setSectionLoading(SECTION_IDS.quests, false);
      setSectionLoading(SECTION_IDS.achievementQuests, false);
    }
  }
}

function formatCampaignMeta(campaigns = []) {
  const typeLabel = (type) => {
    const normalized = (type || '').toLowerCase();
    if (normalized === 'permanent') return '상시';
    if (normalized === 'weekly') return '주간';
    if (normalized === 'season') return '시즌';
    if (normalized === 'daily') return '일일';
    if (normalized === 'event') return '이벤트';
    return '캠페인';
  };

  const formatKstRange = (start, end) => {
    if (!start && !end) return '';
    const opts = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' };
    const startText = start ? new Date(start).toLocaleDateString('ko-KR', opts) : '';
    const endText = end ? new Date(end).toLocaleDateString('ko-KR', opts) : '';
    if (startText && endText) return `${startText} ~ ${endText}`;
    return startText || endText;
  };

  return campaigns.map((c) => ({
    ...c,
    campaignType: (c.campaign_type || c.campaignType || '').toLowerCase(),
    campaignTypeLabel: typeLabel(c.campaign_type || c.campaignType),
    dateLabel: formatKstRange(c.start_at || c.start_at_kst, c.end_at || c.end_at_kst),
  }));
}

function parseUiMeta(uiJson) {
  if (!uiJson) return {};
  try {
    return JSON.parse(uiJson);
  } catch (error) {
    return {};
  }
}

function conditionLabelFromType(condition, category) {
  switch ((condition || '').toUpperCase()) {
    case 'POST_COUNT_TOTAL':
      return '글 작성 수';
    case 'POST_COUNT_BY_CATEGORY':
      if (category === 'poem') return '시 작성';
      if (category === 'essay') return '에세이 작성';
      if (category === 'short') return '짧은 구절 작성';
      return '카테고리별 작성';
    case 'LIKE_GIVEN':
      return '공감 남기기';
    case 'LIKE_RECEIVED':
      return '공감 받기';
    case 'BOOKMARK_GIVEN':
      return '북마크 저장';
    case 'BOOKMARK_RECEIVED':
      return '북마크 받기';
    case 'STREAK_DAYS':
      return '연속 글쓰기';
    default:
      return '퀘스트';
  }
}

async function loadGrowthSummary(options = {}) {
  const { showLoading = true } = options;
  if (showLoading) {
    setSectionLoading(SECTION_IDS.summary, true);
  }

  try {
    const res = await fetch('/api/growth/summary', { cache: 'no-store' });
    if (!res.ok) throw new Error('summary request failed');

    const data = await res.json();
    if (!data.ok || !data.summary) throw new Error('invalid summary response');

    renderGrowthSummary(data.summary);
  } catch (error) {
    console.error(error);
    renderGrowthSummaryFallback();
    showNotice('성장 요약을 불러오지 못했습니다.', 'error');
  } finally {
    if (showLoading) {
      setSectionLoading(SECTION_IDS.summary, false);
    }
  }
}

function renderGrowthSummary(summary) {
  const levelLabel = document.getElementById('growthLevelLabel');
  const levelTitle = document.getElementById('growthLevelTitle');
  const levelXp = document.getElementById('growthLevelXp');
  const ring = document.querySelector('.growth-level-ring');
  const progressBar = document.querySelector('.growth-level-progress-bar');
  const levelNumber = document.querySelector('.growth-level-number');
  const levelLeaf = document.querySelector('.growth-level-leaf');
  const todayXp = document.getElementById('growthTodayXp');
  const todayXpDetail = document.getElementById('growthTodayXpDetail');
  const streakLabel = document.getElementById('growthStreakLabel');
  const streakDetail = document.getElementById('growthStreakDetail');
  const weeklyPosts = document.getElementById('growthWeeklyPosts');
  const maxStreak = document.getElementById('growthMaxStreak');
  const nextLevelBar = document.getElementById('growthNextLevelBar');
  const nextLevelLabel = document.getElementById('growthNextLevelLabel');
  const streakBar = document.getElementById('growthStreakBar');
  const streakMaxLabel = document.getElementById('growthStreakMaxLabel');

  const levelText = `Lv.${summary.level}`;
  const levelEmoji = getLevelEmoji(summary.level);
  const percent =
    summary.next_level_xp > 0
      ? Math.min(1, summary.current_xp / summary.next_level_xp)
      : 0;
  const degree = `${Math.round(percent * 360)}deg`;
  const percentLabel = `${summary.current_xp} / ${summary.next_level_xp} XP`;
  const remainingXp = Math.max(0, summary.next_level_xp - summary.current_xp);
  const streakPercent =
    summary.max_streak_days > 0
      ? Math.min(1, (summary.streak_days || 0) / summary.max_streak_days)
      : 0;

  if (levelLabel) levelLabel.textContent = levelText;
  if (levelNumber) levelNumber.textContent = levelText;
  if (levelLeaf) {
    levelLeaf.textContent = levelEmoji;
    levelLeaf.setAttribute('aria-label', `레벨 ${summary.level} (${levelEmoji})`);
  }
  if (levelTitle) levelTitle.textContent = summary.title || '새싹';
  if (levelXp) levelXp.textContent = percentLabel;
  if (ring) {
    ring.style.setProperty('--xp-progress', degree);
    ring.setAttribute('aria-valuenow', String(Math.round(percent * 100)));
    ring.setAttribute('aria-valuemin', '0');
    ring.setAttribute('aria-valuemax', '100');
    ring.setAttribute('aria-valuetext', percentLabel);
  }
  if (progressBar) animateProgressWidth(progressBar, Math.round(percent * 100));
  if (todayXp) todayXp.textContent = `+${summary.today_xp || 0}`;
  if (todayXpDetail) todayXpDetail.textContent = `+${summary.today_xp || 0}`;
  if (streakLabel) streakLabel.textContent = `연속 ${summary.streak_days || 0}일째`;
  if (streakDetail) streakDetail.textContent = `${summary.streak_days || 0}일째`;
  if (weeklyPosts) weeklyPosts.textContent = `이번 주 ${summary.weekly_posts || 0}개`;
  if (maxStreak) maxStreak.textContent = `${summary.max_streak_days || 0}일`;
  if (nextLevelBar) animateProgressWidth(nextLevelBar, Math.round(percent * 100));
  if (nextLevelLabel) nextLevelLabel.textContent = `${remainingXp} XP 남음`;
  if (streakBar) animateProgressWidth(streakBar, Math.round(streakPercent * 100));
  if (streakMaxLabel) streakMaxLabel.textContent = `최장 ${summary.max_streak_days || 0}일`;
}

function renderGrowthSummaryFallback() {
  const todayList = document.getElementById('growthTodayList');
  const levelXp = document.getElementById('growthLevelXp');
  const ring = document.querySelector('.growth-level-ring');

  if (levelXp) levelXp.textContent = '요약 정보를 불러오지 못했습니다.';
  if (ring) ring.style.setProperty('--xp-progress', '0deg');
  if (todayList) {
    todayList.innerHTML = '<li class="gls-text-muted">성장 요약 정보를 불러오지 못했습니다.</li>';
  }
}

async function loadGrowthAchievements(options = {}) {
  const { showLoading = true } = options;
  if (showLoading) {
    setSectionLoading(SECTION_IDS.forest, true);
    setSectionLoading(SECTION_IDS.achievements, true);
  }

  try {
    const res = await fetch('/api/growth/achievements', { cache: 'no-store' });
    if (!res.ok) throw new Error('achievements request failed');

    const data = await res.json();
    if (!data.ok || !Array.isArray(data.achievements)) {
      throw new Error('invalid achievement response');
    }

    achievementCache = data.achievements;
    renderForestMapNodes(achievementCache);
    renderAchievementGrid(selectedAchievementFilter);
    renderAchievementDetail(achievementCache[0]);
  } catch (error) {
    console.error(error);

    const map = document.getElementById('forestMapAchievements');
    if (map) {
      map.innerHTML = '<p class="gls-text-muted">업적 정보를 불러오지 못했습니다.</p>';
    }

    const grid = document.getElementById('achievementGrid');
    if (grid) {
      grid.innerHTML = '<p class="gls-text-muted">업적 정보를 불러오지 못했습니다.</p>';
    }

    const detail = document.getElementById('forestMapDetail');
    if (detail) {
      detail.innerHTML = '<p class="gls-text-muted gls-mb-0">업적 상세 정보를 표시할 수 없습니다.</p>';
    }

    showNotice('업적 정보를 불러오지 못했습니다.', 'error');
  } finally {
    if (showLoading) {
      setSectionLoading(SECTION_IDS.forest, false);
      setSectionLoading(SECTION_IDS.achievements, false);
    }
  }
}

function renderForestMapNodes(list = []) {
  const container = document.getElementById('forestMapAchievements');
  if (!container) return;

  container.innerHTML = '';
  const sorted = [...list].sort(
    (a, b) => (a.position_index || 0) - (b.position_index || 0)
  );

  sorted.forEach((achievement, index) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `forest-map-node ${statusClass(achievement.status)}`;
    if (index === 0) node.classList.add('is-selected');
    node.dataset.achievementId = achievement.id;
    node.innerHTML = `
      <div class="forest-map-icon">${achievement.icon || '🌿'}</div>
      <div class="forest-map-node-name">${achievement.name}</div>
      <div class="forest-map-node-progress">${achievement.progress || 0} / ${achievement.target || 0}</div>
    `;
    node.addEventListener('click', () => {
      renderAchievementDetail(achievement);
      container
        .querySelectorAll('.forest-map-node')
        .forEach((btn) => btn.classList.remove('is-selected'));
      node.classList.add('is-selected');
    });
    container.appendChild(node);
  });
}

function renderAchievementDetail(achievement) {
  const detail = document.getElementById('forestMapDetail');
  if (!detail || !achievement) return;

  const progressPercent = achievement.target
    ? Math.min(100, Math.round((achievement.progress / achievement.target) * 100))
    : 0;

  detail.innerHTML = `
    <div class="forest-map-detail">
      <div class="forest-map-detail-label">선택한 업적</div>
      <div class="gls-flex gls-items-center gls-gap-3 gls-mb-2">
        <div class="forest-map-detail-icon">${achievement.icon || '🌿'}</div>
        <div>
          <p class="gls-text-muted gls-text-small forest-map-detail-category gls-mb-1">${achievement.category || ''}</p>
          <h4 class="gls-mb-1 forest-map-detail-title">${achievement.name}</h4>
          <p class="gls-mb-0 gls-text-muted forest-map-detail-desc">${achievement.description || ''}</p>
        </div>
      </div>
      <div class="forest-map-detail-progress" role="progressbar" aria-valuenow="${progressPercent}" aria-valuemin="0" aria-valuemax="100">
        <div class="forest-map-detail-progress-bar" data-progress="${progressPercent}"></div>
      </div>
      <div class="gls-flex gls-justify-between gls-items-center gls-mt-2 gls-text-small gls-text-muted">
        <span>${achievement.progress || 0} / ${achievement.target || 0}</span>
        <span>${renderStatusLabel(achievement.status)}</span>
      </div>
    </div>
  `;

  const bar = detail.querySelector('.forest-map-detail-progress-bar');
  animateProgressWidth(bar, progressPercent);
}

function syncAchievementFilterButtons() {
  const filters = document.querySelectorAll('#achievementFilters .achievement-filter-btn');
  filters.forEach((btn) => {
    const filter = normalizeAchievementFilter(btn.dataset.filter || 'all');
    const isActive = filter === selectedAchievementFilter;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function setAchievementFilter(filter, options = {}) {
  const { persist = true, render = true } = options;
  selectedAchievementFilter = normalizeAchievementFilter(filter);

  if (persist) {
    writeStorageValue(STORAGE_KEYS.achievementFilter, selectedAchievementFilter);
  }

  syncAchievementFilterButtons();
  if (render) {
    renderAchievementGrid(selectedAchievementFilter);
  }
}

function renderAchievementGrid(filter = selectedAchievementFilter) {
  const grid = document.getElementById('achievementGrid');
  if (!grid) return;

  selectedAchievementFilter = normalizeAchievementFilter(filter);
  syncAchievementFilterButtons();

  grid.innerHTML = '';
  const filtered = achievementCache.filter(
    (item) => selectedAchievementFilter === 'all' || item.status === selectedAchievementFilter
  );

  if (!filtered.length) {
    if (selectedAchievementFilter === 'all') {
      grid.innerHTML = `
        <div class="growth-empty-state">
          <p class="gls-text-muted gls-mb-2">아직 노출할 업적이 없습니다.</p>
          <div class="growth-empty-actions">
            <a class="gls-btn gls-btn-secondary gls-btn-xs" href="/html/editor.html">첫 글 쓰러 가기</a>
          </div>
        </div>
      `;
      return;
    }

    grid.innerHTML = `
      <div class="growth-empty-state">
        <p class="gls-text-muted gls-mb-2">선택한 필터에 해당하는 업적이 없습니다.</p>
        <div class="growth-empty-actions">
          <button type="button" class="gls-btn gls-btn-secondary gls-btn-xs" data-reset-achievement-filter>전체 보기</button>
        </div>
      </div>
    `;

    const resetBtn = grid.querySelector('[data-reset-achievement-filter]');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        setAchievementFilter('all');
      });
    }
    return;
  }

  filtered.forEach((achievement) => {
    const progressPercent = achievement.target
      ? Math.min(100, Math.round((achievement.progress / achievement.target) * 100))
      : 0;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `achievement-card ${statusClass(achievement.status)}`;
    card.innerHTML = `
      <div class="achievement-card-header">
        <div class="achievement-icon">${achievement.icon || '🌿'}</div>
        <span class="achievement-status">${renderStatusLabel(achievement.status)}</span>
      </div>
      <h5>${achievement.name}</h5>
      <p class="gls-text-muted">${achievement.description || ''}</p>
      <div class="achievement-progress">
        <div class="achievement-progress-bar" data-progress="${progressPercent}"></div>
      </div>
      <div class="achievement-progress-label">${achievement.progress || 0} / ${achievement.target || 0}</div>
    `;

    card.addEventListener('click', () => renderAchievementDetail(achievement));
    grid.appendChild(card);

    const bar = card.querySelector('.achievement-progress-bar');
    animateProgressWidth(bar, progressPercent);
  });
}

function bindAchievementFilters() {
  const filters = document.querySelectorAll('#achievementFilters .achievement-filter-btn');
  syncAchievementFilterButtons();

  filters.forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = normalizeAchievementFilter(btn.dataset.filter || 'all');
      setAchievementFilter(filter);
    });
  });
}

function animateProgressWidth(element, percent) {
  if (!element) return;
  element.style.width = '0%';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      element.style.width = `${percent}%`;
    });
  });
}

function renderQuestGroups(campaigns = []) {
  const questToday = document.getElementById('growthQuestListToday');
  const questWeek = document.getElementById('growthQuestListWeek');
  const campaignStack = document.getElementById('campaignStack');
  const achievementList = document.getElementById('achievementQuestList');

  if (questToday) questToday.innerHTML = '';
  if (questWeek) questWeek.innerHTML = '';
  if (campaignStack) campaignStack.innerHTML = '';
  if (achievementList) achievementList.innerHTML = '';

  let hasCampaignCards = false;
  let hasTodayQuests = false;
  let hasWeekQuests = false;
  let hasAchievementQuests = false;

  const addCampaignCard = (campaign, visibleQuestCount) => {
    if (!campaignStack) return;

    const card = document.createElement('div');
    card.className = `campaign-card ${campaign.campaignType || ''}`;
    card.innerHTML = `
      <h5>${campaign.name || '이름 없는 캠페인'} <span class="campaign-type">${campaign.campaignTypeLabel || ''}</span></h5>
      <div class="campaign-meta">
        ${campaign.dateLabel ? `<span>${campaign.dateLabel}</span>` : ''}
        <span>${visibleQuestCount}개 퀘스트</span>
      </div>
      ${campaign.description ? `<p class="campaign-desc gls-text-muted gls-mb-0">${campaign.description}</p>` : ''}
    `;

    campaignStack.appendChild(card);
    hasCampaignCards = true;
  };

  const addQuestItem = (parent, quest, campaignName, campaignTypeLabel) => {
    const card = document.createElement('div');
    card.className = `quest-card ${statusClass(quest.status)}`;

    const progressPercent = quest.target
      ? Math.min(100, Math.round((quest.progress / quest.target) * 100))
      : 0;

    const conditionLabel =
      quest.condition_type_label ||
      conditionLabelFromType(quest.condition_type, quest.category) ||
      '';

    card.innerHTML = `
      <div class="quest-card-header">
        <span class="quest-card-title">${quest.name}</span>
        <span class="quest-card-status">${renderStatusLabel(quest.status)}</span>
      </div>
      <div class="quest-card-meta">
        <span>${quest.progress || 0} / ${quest.target || 0}</span>
        <span>${campaignName || ''}${campaignTypeLabel ? ` · ${campaignTypeLabel}` : ''}</span>
      </div>
      <div class="quest-card-meta quest-card-meta-secondary">
        <span>${conditionLabel}</span>
        ${quest.reward_xp ? `<span>보상 ${quest.reward_xp} XP</span>` : ''}
      </div>
      ${quest.description ? `<p class="quest-card-desc gls-text-muted gls-mb-0">${quest.description}</p>` : ''}
      <div class="quest-card-progress"><div class="quest-card-progress-bar" data-progress="${progressPercent}"></div></div>
    `;

    parent.appendChild(card);
    const bar = card.querySelector('.quest-card-progress-bar');
    animateProgressWidth(bar, progressPercent);
  };

  const addAchievementItem = (quest, campaign) => {
    if (!achievementList) return;

    const uiMeta = parseUiMeta(quest.ui_json || quest.uiJson);
    const icon = uiMeta.icon || '🏆';
    const label = uiMeta.label || campaign?.name || '업적';
    const progressPercent = quest.target
      ? Math.min(100, Math.round((quest.progress / quest.target) * 100))
      : 0;
    const claimed = Boolean(quest.reward_claimed_at || quest.rewardClaimedAt);
    const canClaim = quest.status === 'completed' && !claimed;

    const card = document.createElement('div');
    card.className = `achievement-quest-card ${statusClass(quest.status)}`;
    hasAchievementQuests = true;
    card.innerHTML = `
      <div class="achievement-quest-header">
        <div class="achievement-quest-icon">${icon}</div>
        <div class="achievement-quest-titles">
          <span class="achievement-quest-label">${label}</span>
          <strong>${quest.name}</strong>
        </div>
        <span class="achievement-quest-status">${claimed ? '받음' : renderStatusLabel(quest.status)}</span>
      </div>
      <p class="gls-text-muted gls-mb-2">${quest.description || ''}</p>
      <div class="achievement-quest-progress">
        <div class="achievement-quest-progress-bar" data-progress="${progressPercent}"></div>
      </div>
      <div class="achievement-quest-meta">
        <span>${quest.progress || 0} / ${quest.target || 0}</span>
        ${quest.reward_xp ? `<span>보상 ${quest.reward_xp} XP</span>` : ''}
      </div>
      <div class="achievement-quest-actions">
        ${canClaim ? `<button class="gls-btn gls-btn-primary gls-btn-xs" data-claim-id="${quest.state_id || quest.stateId}">보상 받기</button>` : ''}
        ${claimed ? '<span class="gls-text-muted gls-text-small">보상 지급 완료</span>' : ''}
      </div>
    `;

    const bar = card.querySelector('.achievement-quest-progress-bar');
    animateProgressWidth(bar, progressPercent);

    const claimBtn = card.querySelector('[data-claim-id]');
    if (claimBtn) {
      claimBtn.addEventListener('click', async () => {
        const stateId = claimBtn.getAttribute('data-claim-id');
        if (!stateId) return;
        await claimQuestReward(stateId, claimBtn);
      });
    }

    achievementList.appendChild(card);
  };

  const renderEmptyQuestBucket = (bucket, message, actionHtml = '') => {
    if (!bucket) return;
    bucket.innerHTML = `
      <div class="quest-card growth-empty-state">
        <p class="gls-text-muted gls-mb-0">${message}</p>
        ${actionHtml ? `<div class="growth-empty-actions">${actionHtml}</div>` : ''}
      </div>
    `;
  };

  if (!campaigns.length) {
    renderEmptyQuestBucket(
      questToday,
      '오늘 진행 중인 퀘스트가 없습니다.',
      '<a class="gls-btn gls-btn-secondary gls-btn-xs" href="/html/editor.html">오늘 글 쓰러 가기</a>'
    );
    renderEmptyQuestBucket(questWeek, '주간/시즌/이벤트 퀘스트가 없습니다.');
    if (campaignStack) {
      campaignStack.innerHTML = `
        <div class="campaign-card growth-empty-state">
          <p class="gls-text-muted gls-text-small gls-mb-0">활성 캠페인이 없습니다.</p>
        </div>
      `;
    }
    if (achievementList) {
      achievementList.innerHTML = `
        <div class="achievement-quest-card growth-empty-state">
          <p class="gls-text-muted gls-mb-2">표시할 업적 퀘스트가 없습니다.</p>
          <div class="growth-empty-actions">
            <a class="gls-btn gls-btn-secondary gls-btn-xs" href="/html/editor.html">글 작성으로 진행도 올리기</a>
          </div>
        </div>
      `;
    }
    return;
  }

  campaigns.forEach((campaign) => {
    const achievementQuests = (campaign.quests || []).filter(
      (quest) =>
        (quest.template_kind || quest.templateKind) === 'achievement' ||
        (campaign.campaignType === 'permanent' && (quest.template_kind || quest.templateKind))
    );
    achievementQuests.forEach((quest) => addAchievementItem(quest, campaign));

    const normalQuests = (campaign.quests || []).filter(
      (quest) => (quest.template_kind || quest.templateKind) !== 'achievement'
    );

    const bucket =
      campaign.campaignType === 'weekly' ||
      campaign.campaignType === 'season' ||
      campaign.campaignType === 'event'
        ? questWeek
        : questToday;

    if (normalQuests.length > 0) {
      addCampaignCard(
        {
          ...campaign,
          campaignTypeLabel: campaign.campaignTypeLabel || campaign.campaignType || '',
          dateLabel: campaign.dateLabel || '',
        },
        normalQuests.length
      );
    }

    if (!bucket) return;
    normalQuests.forEach((quest) => {
      if (bucket === questWeek) {
        hasWeekQuests = true;
      } else {
        hasTodayQuests = true;
      }
      addQuestItem(bucket, quest, campaign.name, campaign.campaignTypeLabel);
    });
  });

  if (!hasCampaignCards && campaignStack) {
    campaignStack.innerHTML = `
      <div class="campaign-card growth-empty-state">
        <p class="gls-text-muted gls-text-small gls-mb-0">표시할 일반 퀘스트 캠페인이 없습니다.</p>
      </div>
    `;
  }
  if (!hasTodayQuests) {
    renderEmptyQuestBucket(questToday, '오늘 진행 중인 퀘스트가 없습니다.');
  }
  if (!hasWeekQuests) {
    renderEmptyQuestBucket(questWeek, '주간/시즌/이벤트 퀘스트가 없습니다.');
  }
  if (!hasAchievementQuests && achievementList) {
    achievementList.innerHTML = `
      <div class="achievement-quest-card growth-empty-state">
        <p class="gls-text-muted gls-mb-0">표시할 업적 퀘스트가 없습니다.</p>
      </div>
    `;
  }
}

function renderQuestGroupsError() {
  const questToday = document.getElementById('growthQuestListToday');
  const questWeek = document.getElementById('growthQuestListWeek');
  const campaignStack = document.getElementById('campaignStack');
  const achievementList = document.getElementById('achievementQuestList');

  if (questToday) {
    questToday.innerHTML = `
      <div class="quest-card growth-empty-state">
        <p class="gls-text-muted gls-mb-0">퀘스트 정보를 불러오지 못했습니다.</p>
      </div>
    `;
  }
  if (questWeek) {
    questWeek.innerHTML = `
      <div class="quest-card growth-empty-state">
        <p class="gls-text-muted gls-mb-0">퀘스트 정보를 불러오지 못했습니다.</p>
      </div>
    `;
  }
  if (campaignStack) {
    campaignStack.innerHTML = `
      <div class="campaign-card growth-empty-state">
        <p class="gls-text-muted gls-text-small gls-mb-0">캠페인 정보를 불러오지 못했습니다.</p>
      </div>
    `;
  }
  if (achievementList) {
    achievementList.innerHTML = `
      <div class="achievement-quest-card growth-empty-state">
        <p class="gls-text-muted gls-mb-0">업적 퀘스트 정보를 불러오지 못했습니다.</p>
      </div>
    `;
  }
}

function setButtonBusy(button, busy, busyLabel = '처리 중...') {
  if (!button || !button.isConnected) return;

  if (busy) {
    button.dataset.originalLabel = button.textContent || '';
    button.textContent = busyLabel;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    return;
  }

  const originalLabel = button.dataset.originalLabel || '보상 받기';
  button.textContent = originalLabel;
  button.disabled = false;
  button.removeAttribute('aria-busy');
}

async function claimQuestReward(stateId, triggerButton) {
  const key = String(stateId);
  if (claimInFlight.has(key)) return;

  claimInFlight.add(key);
  setButtonBusy(triggerButton, true, '지급 중...');

  try {
    const res = await fetch(`/api/quests/${stateId}/claim`, { method: 'POST' });
    let data = null;
    try {
      data = await res.json();
    } catch (parseError) {
      data = null;
    }

    if (!res.ok || !data?.ok) {
      showNotice(data?.message || '보상 지급에 실패했습니다.', 'error');
      return;
    }

    const xp = Number(data.gained_xp) || 0;
    const successMessage = xp > 0 ? `보상 지급 완료 (+${xp} XP)` : '보상 지급 완료';
    showNotice(successMessage, 'success');

    await Promise.allSettled([
      loadGrowthSummary({ showLoading: false }),
      loadActiveQuests({ showLoading: false }),
    ]);
  } catch (error) {
    console.error(error);
    showNotice('보상 지급 중 오류가 발생했습니다.', 'error');
  } finally {
    claimInFlight.delete(key);
    setButtonBusy(triggerButton, false);
  }
}

function statusClass(status) {
  if (status === 'completed') return 'is-completed';
  if (status === 'in_progress') return 'is-in-progress';
  return 'is-locked';
}

function renderStatusLabel(status) {
  switch (status) {
    case 'completed':
      return '완료';
    case 'in_progress':
      return '진행 중';
    default:
      return '잠금';
  }
}
