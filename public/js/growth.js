let achievementCache = [];

document.addEventListener('DOMContentLoaded', async () => {
  await ensureAuthenticated();
  await loadGrowthSummary();
  await loadGrowthAchievements();
  bindAchievementFilters();
});

async function ensureAuthenticated() {
  const res = await fetch('/api/me', { cache: 'no-store' });
  if (!res.ok) {
    alert('로그인이 필요합니다. 로그인 페이지로 이동합니다.');
    window.location.href = '/html/login.html';
    throw new Error('Unauthenticated');
  }
  const data = await res.json();
  if (!data.ok) {
    alert('로그인이 필요합니다. 로그인 페이지로 이동합니다.');
    window.location.href = '/html/login.html';
    throw new Error('Unauthenticated');
  }
}

async function loadGrowthSummary() {
  try {
    const res = await fetch('/api/growth/summary', { cache: 'no-store' });
    if (!res.ok) throw new Error('summary request failed');
    const data = await res.json();
    if (!data.ok || !data.summary) throw new Error('invalid summary response');
    renderGrowthSummary(data.summary);
  } catch (error) {
    console.error(error);
    renderGrowthSummaryFallback();
  }
}

function renderGrowthSummary(summary) {
  const levelLabel = document.getElementById('growthLevelLabel');
  const levelTitle = document.getElementById('growthLevelTitle');
  const levelXp = document.getElementById('growthLevelXp');
  const ring = document.querySelector('.growth-level-ring');
  const progressBar = document.querySelector('.growth-level-progress-bar');
  const levelNumber = document.querySelector('.growth-level-number');
  const todayXp = document.getElementById('growthTodayXp');
  const todayXpDetail = document.getElementById('growthTodayXpDetail');
  const streakLabel = document.getElementById('growthStreakLabel');
  const streakDetail = document.getElementById('growthStreakDetail');
  const weeklyPosts = document.getElementById('growthWeeklyPosts');
  const maxStreak = document.getElementById('growthMaxStreak');

  const levelText = `Lv.${summary.level}`;
  const percent = summary.nextLevelXp > 0 ? Math.min(1, summary.currentXp / summary.nextLevelXp) : 0;
  const degree = `${Math.round(percent * 360)}deg`;
  const percentLabel = `${summary.currentXp} / ${summary.nextLevelXp} XP`;

  if (levelLabel) levelLabel.textContent = levelText;
  if (levelNumber) levelNumber.textContent = levelText;
  if (levelTitle) levelTitle.textContent = summary.title || '새싹';
  if (levelXp) levelXp.textContent = percentLabel;
  if (ring) ring.style.setProperty('--xp-progress', degree);
  if (progressBar) animateProgressWidth(progressBar, Math.round(percent * 100));
  if (todayXp) todayXp.textContent = `+${summary.todayXp || 0}`;
  if (todayXpDetail) todayXpDetail.textContent = `+${summary.todayXp || 0}`;
  if (streakLabel) streakLabel.textContent = `연속 ${summary.streakDays || 0}일째`;
  if (streakDetail) streakDetail.textContent = `${summary.streakDays || 0}일째`;
  if (weeklyPosts) weeklyPosts.textContent = `이번 주 작성 글: ${summary.weeklyPosts || 0}개`;
  if (maxStreak) maxStreak.textContent = `${summary.maxStreakDays || 0}일`;
}

function renderGrowthSummaryFallback() {
  const todayList = document.getElementById('growthTodayList');
  if (todayList) {
    todayList.innerHTML = '<li class="text-danger">성장 요약 정보를 불러오지 못했습니다.</li>';
  }
}

async function loadGrowthAchievements() {
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
    hydrateQuestListFromAchievements();
  } catch (error) {
    console.error(error);
    const map = document.getElementById('forestMapAchievements');
    if (map) {
      map.innerHTML = '<p class="text-danger">업적 정보를 불러오지 못했습니다.</p>';
    }
    const grid = document.getElementById('achievementGrid');
    if (grid) {
      grid.innerHTML = '<p class="text-danger">업적 정보를 불러오지 못했습니다.</p>';
    }
  }
}

function renderForestMapNodes(list = []) {
  const container = document.getElementById('forestMapAchievements');
  if (!container) return;
  container.innerHTML = '';
  const sorted = [...list].sort((a, b) => (a.positionIndex || 0) - (b.positionIndex || 0));
  sorted.forEach((achievement) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `forest-map-node ${statusClass(achievement.status)}`;
    node.dataset.achievementId = achievement.id;
    node.innerHTML = `
      <div class="forest-map-icon">${achievement.icon || '🌿'}</div>
      <div class="forest-map-node-name">${achievement.name}</div>
      <div class="forest-map-node-progress">${achievement.progress || 0} / ${achievement.target || 0}</div>
    `;
    node.addEventListener('click', () => {
      renderAchievementDetail(achievement);
      container.querySelectorAll('.forest-map-node').forEach((btn) => btn.classList.remove('is-selected'));
      node.classList.add('is-selected');
    });
    container.appendChild(node);
  });
}

function renderAchievementDetail(achievement) {
  const detail = document.getElementById('forestMapDetail');
  if (!detail || !achievement) return;
  const progressPercent = achievement.target ? Math.min(100, Math.round((achievement.progress / achievement.target) * 100)) : 0;
  detail.innerHTML = `
    <div class="forest-map-detail">
      <div class="forest-map-detail-label">선택한 업적</div>
      <div class="d-flex align-items-center gap-3 mb-2">
        <div class="forest-map-detail-icon">${achievement.icon || '🌿'}</div>
        <div>
          <p class="text-muted small forest-map-detail-category mb-1">${achievement.category || ''}</p>
          <h4 class="mb-1 forest-map-detail-title">${achievement.name}</h4>
          <p class="mb-0 text-muted forest-map-detail-desc">${achievement.description || ''}</p>
        </div>
      </div>
      <div class="forest-map-detail-progress" role="progressbar" aria-valuenow="${progressPercent}" aria-valuemin="0" aria-valuemax="100">
        <div class="forest-map-detail-progress-bar" style="width: ${progressPercent}%"></div>
      </div>
      <div class="d-flex justify-content-between align-items-center mt-2 small text-muted">
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
  const filtered = achievementCache.filter((item) => filter === 'all' || item.status === filter);
  if (!filtered.length) {
    grid.innerHTML = '<p class="text-muted">해당 조건의 업적이 없습니다.</p>';
    return;
  }
  filtered.forEach((achievement) => {
    const progressPercent = achievement.target ? Math.min(100, Math.round((achievement.progress / achievement.target) * 100)) : 0;
    const card = document.createElement('div');
    card.className = `achievement-card ${statusClass(achievement.status)}`;
    card.innerHTML = `
      <div class="achievement-card-header">
        <div class="achievement-icon">${achievement.icon || '🌿'}</div>
        <span class="achievement-status">${renderStatusLabel(achievement.status)}</span>
      </div>
      <h5>${achievement.name}</h5>
      <p class="text-muted">${achievement.description || ''}</p>
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

function hydrateQuestListFromAchievements() {
  const questToday = document.getElementById('growthQuestListToday');
  const questWeek = document.getElementById('growthQuestListWeek');
  if ((!questToday && !questWeek) || !achievementCache.length) return;

  const todayItems = achievementCache.slice(0, 2);
  const weekItems = achievementCache.slice(2, 5);

  if (questToday) {
    questToday.innerHTML = '';
    todayItems.forEach((achievement) => {
      const li = document.createElement('li');
      li.className = `quest-item ${achievement.status === 'completed' ? 'is-completed' : ''}`;
      li.textContent = achievement.name;
      questToday.appendChild(li);
    });
  }

  if (questWeek) {
    questWeek.innerHTML = '';
    weekItems.forEach((achievement) => {
      const li = document.createElement('li');
      li.className = `quest-item ${achievement.status === 'completed' ? 'is-completed' : ''}`;
      li.textContent = achievement.name;
      questWeek.appendChild(li);
    });
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
