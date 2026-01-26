const db = require('../db');

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function getNowKstDate() {
  const now = new Date();
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  return new Date(now.getTime() + kstOffsetMs);
}

function toKstIsoString(date) {
  const tzOffsetMinutes = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - tzOffsetMinutes * 60 * 1000);
  return adjusted.toISOString();
}

function toKstIsoOrNull(dateLike) {
  if (!dateLike) return null;
  const dateObj = new Date(dateLike);
  if (Number.isNaN(dateObj.getTime())) return null;
  return toKstIsoString(dateObj);
}

function getKstWeekKey(date) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const yearStart = new Date(day.getFullYear(), 0, 1);
  const pastDays = Math.floor((day - yearStart) / (24 * 60 * 60 * 1000));
  const week = Math.ceil((pastDays + yearStart.getDay() + 1) / 7);
  return `${day.getFullYear()}-W${week}`;
}

function buildResetKey(campaignType) {
  const now = getNowKstDate();
  if (campaignType === 'daily') {
    return toKstIsoString(now).slice(0, 10);
  }
  if (campaignType === 'weekly') {
    return getKstWeekKey(now);
  }
  if (campaignType === 'permanent') {
    return 'permanent';
  }
  if (campaignType === 'season') {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `season:${now.getFullYear()}-${month}`;
  }
  return 'event';
}

async function computeUserMetrics(userId) {
  const [postCount, postCountsByCat, likesGiven, likesReceived, bookmarksGiven, bookmarksReceived, userRow] = await Promise.all([
    getAsync('SELECT COUNT(*) AS cnt FROM posts WHERE user_id = ?', [userId]),
    allAsync('SELECT category, COUNT(*) AS cnt FROM posts WHERE user_id = ? GROUP BY category', [userId]),
    getAsync('SELECT COUNT(*) AS cnt FROM likes WHERE user_id = ?', [userId]),
    getAsync(
      `SELECT COUNT(*) AS cnt
       FROM likes l
       JOIN posts p ON p.id = l.post_id
       WHERE p.user_id = ?`,
      [userId]
    ),
    getAsync(
      `SELECT COUNT(*) AS cnt
       FROM bookmark_items bi
       JOIN bookmark_lists bl ON bl.id = bi.list_id
       WHERE bl.user_id = ?`,
      [userId]
    ),
    getAsync(
      `SELECT COUNT(*) AS cnt
       FROM bookmark_items bi
       JOIN posts p ON p.id = bi.post_id
       WHERE p.user_id = ?`,
      [userId]
    ),
    getAsync('SELECT streak_days FROM users WHERE id = ?', [userId]),
  ]);

  const catMap = {};
  (postCountsByCat || []).forEach((row) => {
    catMap[row.category || ''] = row.cnt;
  });

  return {
    postCount: postCount?.cnt || 0,
    postCountByCategory: catMap,
    likesGiven: likesGiven?.cnt || 0,
    likesReceived: likesReceived?.cnt || 0,
    bookmarksGiven: bookmarksGiven?.cnt || 0,
    bookmarksReceived: bookmarksReceived?.cnt || 0,
    streakDays: userRow?.streak_days || 0,
  };
}

function calculateProgress(template, metrics) {
  switch (template.condition_type) {
    case 'POST_COUNT_TOTAL':
      return metrics.postCount;
    case 'POST_COUNT_BY_CATEGORY':
      return metrics.postCountByCategory[template.category || ''] || 0;
    case 'LIKE_GIVEN':
      return metrics.likesGiven;
    case 'LIKE_RECEIVED':
      return metrics.likesReceived;
    case 'BOOKMARK_GIVEN':
      return metrics.bookmarksGiven;
    case 'BOOKMARK_RECEIVED':
      return metrics.bookmarksReceived;
    case 'STREAK_DAYS':
      return metrics.streakDays;
    default:
      return 0;
  }
}

async function fetchActiveCampaigns() {
  const nowIso = toKstIsoString(getNowKstDate());
  const rows = await allAsync(
    `SELECT * FROM quest_campaigns
     WHERE is_active = 1
       AND (start_at IS NULL OR start_at <= ?)
       AND (end_at IS NULL OR end_at >= ?)
     ORDER BY priority DESC, start_at DESC NULLS LAST, id DESC`,
    [nowIso, nowIso]
  );

  return rows.map((row) => ({
    ...row,
    start_at_kst: toKstIsoOrNull(row.start_at),
    end_at_kst: toKstIsoOrNull(row.end_at),
  }));
}

async function fetchCampaignTemplates(campaignId) {
  return allAsync(
    `SELECT qc.id as campaign_id, qt.* , qci.sort_order
     FROM quest_campaign_items qci
     JOIN quest_templates qt ON qt.id = qci.template_id
     JOIN quest_campaigns qc ON qc.id = qci.campaign_id
     WHERE qci.campaign_id = ? AND qt.is_active = 1
     ORDER BY qci.sort_order ASC, qt.id ASC`,
    [campaignId]
  );
}

async function syncUserQuestState(userId, campaign, template, progress, resetKey) {
  const existing = await getAsync(
    `SELECT * FROM user_quest_state WHERE user_id = ? AND campaign_id = ? AND template_id = ? AND reset_key = ?`,
    [userId, campaign.id, template.id, resetKey]
  );
  const completed = progress >= (template.target_value || 0);
  let stateId = existing?.id || null;
  if (!existing) {
    const result = await runAsync(
      `INSERT INTO user_quest_state (user_id, campaign_id, template_id, progress, reset_key, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)` ,
      [userId, campaign.id, template.id, progress, resetKey, completed ? getNowKstDate().toISOString() : null]
    );
    stateId = result?.lastID || null;
  } else {
    await runAsync(
      `UPDATE user_quest_state
       SET progress = ?, completed_at = COALESCE(completed_at, ?)
       WHERE id = ?` ,
      [progress, completed ? getNowKstDate().toISOString() : null, existing.id]
    );
  }
  const state = stateId
    ? await getAsync(
        'SELECT id, completed_at, reward_claimed_at FROM user_quest_state WHERE id = ?',
        [stateId]
      )
    : null;
  return { completed, state };
}

async function getActiveQuestsForUser(userId) {
  const campaigns = await fetchActiveCampaigns();
  const metrics = await computeUserMetrics(userId);
  const results = [];

  for (const campaign of campaigns) {
    const campaignType = (campaign.campaign_type || '').toLowerCase();
    const resetKey = buildResetKey(campaignType);
    const templates = await fetchCampaignTemplates(campaign.id);
    const quests = [];
    for (const template of templates) {
      const progress = calculateProgress(template, metrics);
      const stateResult = await syncUserQuestState(userId, campaign, template, progress, resetKey);
      const completed = stateResult?.completed;
      const state = stateResult?.state || {};
      quests.push({
        id: template.id,
        stateId: state?.id || null,
        name: template.name,
        description: template.description,
        conditionType: template.condition_type,
        category: template.category,
        target: template.target_value,
        rewardXp: template.reward_xp,
        status: completed ? 'completed' : progress > 0 ? 'in_progress' : 'locked',
        progress,
        positionIndex: template.position_index || template.sort_order || 0,
        campaignId: campaign.id,
        campaignType,
        templateKind: template.template_kind,
        code: template.code,
        uiJson: template.ui_json,
        completedAt: state?.completed_at || null,
        rewardClaimedAt: state?.reward_claimed_at || null,
      });
    }
    results.push({
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      campaignType,
      startAt: campaign.start_at_kst || campaign.start_at,
      endAt: campaign.end_at_kst || campaign.end_at,
      quests,
    });
  }

  return results;
}

module.exports = {
  allAsync,
  getAsync,
  runAsync,
  getActiveQuestsForUser,
  fetchActiveCampaigns,
  fetchCampaignTemplates,
};
