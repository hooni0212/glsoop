const SECTION_IDS = {
  summary: 'growthSummarySection',
  quests: 'growthQuestSection',
  achievementQuests: 'growthAchievementQuestSection',
  forest: 'growthForestSection',
  achievements: 'growthAchievementListSection',
};

const claimInFlight = new Set();
let noticeTimer = null;
let achievementCache = [];

function getLevelEmoji(level) {
  const n = Number(level) || 0;
  if (n <= 0) return '🌰';
  if (n <= 5) return '🌰';
  if (n <= 10) return '🌱';
  if (n <= 15) return '🌿';
  if (n <= 20) return '🌳';
  return '🌲';
}

document.addEventListener('DOMContentLoaded', async () => {
  bindAchievementFilters();

  try {
    await ensureAuthenticated();
  } catch (error) {
    console.error(error);
    return;
  }

  renderInitialLoadingState();
  await Promise.allSettled([
    loadGrowthSummary(),
    loadGrowthAchievements(),
    loadActiveQuests(),
  ]);
});

function setSectionLoading(sectionId, isLoading) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.classList.toggle('is-loading', Boolean(isLoading));
  section.setAttribute('aria-busy', isLoading ? 'true' : 'false');
}

function showNotice(message, tone = 'info') {
  const notice = document.getElementById('growthNotice');
  if (!notice) return;

  notice.classList.remove('gls-hidden', 'is-info', 'is-success', 'is-error');
  notice.classList.add(`is-${tone}`);
  notice.textContent = message;
  notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');

  if (noticeTimer) {
    clearTimeout(noticeTimer);
  }
  noticeTimer = setTimeout(() => {
    notice.classList.add('gls-hidden');
  }, tone === 'error' ? 6000 : 3500);
}

function renderInitialLoadingState() {
  setSectionLoading(SECTION_IDS.summary, true);
  setSectionLoading(SECTION_IDS.quests, true);
  setSectionLoading(SECTION_IDS.achievementQuests, true);
  setSectionLoading(SECTION_IDS.forest, true);
  setSectionLoading(SECTION_IDS.achievements, true);

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
    renderAchievementGrid('all');
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
        <div class="forest-map-detail-progress-bar" style="width: ${progressPercent}%"></div>
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

function renderAchievementGrid(filter = 'all') {
  const grid = document.getElementById('achievementGrid');
  if (!grid) return;

  grid.innerHTML = '';
  const filtered = achievementCache.filter(
    (item) => filter === 'all' || item.status === filter
  );

  if (!filtered.length) {
    grid.innerHTML = '<p class="gls-text-muted">해당 조건의 업적이 없습니다.</p>';
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
        <div class="achievement-progress-bar" style="width: ${progressPercent}%"></div>
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
  filters.forEach((btn) => {
    btn.addEventListener('click', () => {
      filters.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const filter = btn.dataset.filter || 'all';
      renderAchievementGrid(filter);
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

  const addCampaignCard = (campaign) => {
    if (!campaignStack) return;

    const card = document.createElement('div');
    card.className = `campaign-card ${campaign.campaignType || ''}`;
    card.innerHTML = `
      <h5>${campaign.name || '이름 없는 캠페인'} <span class="campaign-type">${campaign.campaignTypeLabel || ''}</span></h5>
      <div class="campaign-meta">
        <span>${campaign.dateLabel || ''}</span>
        <span>${(campaign.quests || []).length}개 퀘스트</span>
      </div>
      ${campaign.description ? `<p class="campaign-desc gls-text-muted gls-mb-0">${campaign.description}</p>` : ''}
    `;

    campaignStack.appendChild(card);
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
        ${quest.description ? `<span class="gls-text-muted">${quest.description}</span>` : ''}
      </div>
      <div class="quest-card-progress"><div class="quest-card-progress-bar" style="width: ${progressPercent}%"></div></div>
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
        <div class="achievement-quest-progress-bar" style="width:${progressPercent}%"></div>
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

  if (!campaigns.length) {
    if (questToday) {
      questToday.innerHTML = '<div class="quest-card gls-text-muted">현재 진행 중인 퀘스트가 없습니다.</div>';
    }
    if (questWeek) {
      questWeek.innerHTML = '<div class="quest-card gls-text-muted">현재 진행 중인 퀘스트가 없습니다.</div>';
    }
    if (campaignStack) {
      campaignStack.innerHTML = '<div class="campaign-card gls-text-muted gls-text-small">활성 캠페인이 없습니다.</div>';
    }
    if (achievementList) {
      achievementList.innerHTML = '<div class="achievement-quest-card gls-text-muted">표시할 업적이 없습니다.</div>';
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

    addCampaignCard({
      ...campaign,
      campaignTypeLabel: campaign.campaignTypeLabel || campaign.campaignType || '',
      dateLabel: campaign.dateLabel || '',
    });

    if (!bucket) return;
    normalQuests.forEach((quest) => {
      addQuestItem(bucket, quest, campaign.name, campaign.campaignTypeLabel);
    });
  });
}

function renderQuestGroupsError() {
  const questToday = document.getElementById('growthQuestListToday');
  const questWeek = document.getElementById('growthQuestListWeek');
  const campaignStack = document.getElementById('campaignStack');
  const achievementList = document.getElementById('achievementQuestList');

  if (questToday) {
    questToday.innerHTML = '<div class="quest-card gls-text-muted">퀘스트 정보를 불러오지 못했습니다.</div>';
  }
  if (questWeek) {
    questWeek.innerHTML = '<div class="quest-card gls-text-muted">퀘스트 정보를 불러오지 못했습니다.</div>';
  }
  if (campaignStack) {
    campaignStack.innerHTML = '<div class="campaign-card gls-text-muted gls-text-small">캠페인 정보를 불러오지 못했습니다.</div>';
  }
  if (achievementList) {
    achievementList.innerHTML = '<div class="achievement-quest-card gls-text-muted">업적 퀘스트 정보를 불러오지 못했습니다.</div>';
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
