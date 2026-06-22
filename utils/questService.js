const db = require('../db');
const { hasActiveEntitlement: hasEffectiveEntitlement } = require('./entitlements');

const CONDITION_PROMPT_POST_CREATED = 'PROMPT_POST_CREATED';

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

class QuestContextError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'QuestContextError';
    this.status = status;
    this.code = code;
  }
}

function parseJsonObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePromptKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  return trimmed;
}

function normalizeEntitlementKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  return trimmed;
}

function parseQuestPromptConfig(rawUiJson) {
  const parsed = parseJsonObject(rawUiJson);
  const prompt = parsed?.prompt && typeof parsed.prompt === 'object' ? parsed.prompt : null;
  return {
    quest_kind: typeof parsed?.quest_kind === 'string' ? parsed.quest_kind : null,
    prompt_key: normalizePromptKey(prompt?.key),
    required_entitlement: normalizeEntitlementKey(parsed?.required_entitlement),
  };
}

function normalizeQuestContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const stateId = Number(input.state_id ?? input.stateId);
  const promptKey = normalizePromptKey(input.prompt_key ?? input.promptKey);
  if (!Number.isInteger(stateId) || stateId <= 0 || !promptKey) {
    throw new QuestContextError(400, 'INVALID_QUEST_CONTEXT', '퀘스트 문맥이 올바르지 않습니다.');
  }
  return { stateId, promptKey };
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
  const [
    postCount,
    postCountsByCat,
    promptSubmissionCounts,
    likesGiven,
    likesReceived,
    bookmarksGiven,
    bookmarksReceived,
    userRow,
  ] = await Promise.all([
    getAsync('SELECT COUNT(*) AS cnt FROM posts WHERE user_id = ?', [userId]),
    allAsync('SELECT category, COUNT(*) AS cnt FROM posts WHERE user_id = ? GROUP BY category', [userId]),
    allAsync(
      `SELECT campaign_id, template_id, COUNT(*) AS cnt
       FROM quest_post_submissions
       WHERE user_id = ?
       GROUP BY campaign_id, template_id`,
      [userId]
    ),
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
  const promptSubmissionMap = {};
  (promptSubmissionCounts || []).forEach((row) => {
    promptSubmissionMap[`${row.campaign_id}:${row.template_id}`] = row.cnt;
  });

  return {
    postCount: postCount?.cnt || 0,
    postCountByCategory: catMap,
    promptPostCreated: promptSubmissionMap,
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
    case CONDITION_PROMPT_POST_CREATED:
      return metrics.promptPostCreated[`${template.campaign_id}:${template.id}`] || 0;
    default:
      return 0;
  }
}

async function hasActiveEntitlement(userId, entitlementKey) {
  const normalized = normalizeEntitlementKey(entitlementKey);
  if (!normalized) return true;
  return hasEffectiveEntitlement(userId, normalized);
}

function ensureActiveCampaign(row) {
  if (!row?.campaign_is_active) {
    throw new QuestContextError(409, 'QUEST_CAMPAIGN_INACTIVE', '진행 중인 퀘스트가 아닙니다.');
  }
  const nowIso = toKstIsoString(getNowKstDate());
  if (row.start_at && row.start_at > nowIso) {
    throw new QuestContextError(409, 'QUEST_CAMPAIGN_INACTIVE', '아직 시작되지 않은 퀘스트입니다.');
  }
  if (row.end_at && row.end_at < nowIso) {
    throw new QuestContextError(409, 'QUEST_CAMPAIGN_ENDED', '이미 종료된 퀘스트입니다.');
  }
}

async function completePromptPostQuest(userId, postId, rawQuestContext) {
  const questContext = normalizeQuestContext(rawQuestContext);
  const row = await getAsync(
    `
    SELECT
      uqs.id AS state_id,
      uqs.user_id,
      uqs.campaign_id,
      uqs.template_id,
      uqs.completed_at,
      qc.is_active AS campaign_is_active,
      qc.start_at,
      qc.end_at,
      qt.condition_type,
      qt.target_value,
      qt.is_active AS template_is_active,
      qt.ui_json
    FROM user_quest_state uqs
    JOIN quest_campaigns qc ON qc.id = uqs.campaign_id
    JOIN quest_templates qt ON qt.id = uqs.template_id
    WHERE uqs.id = ?
    LIMIT 1
    `,
    [questContext.stateId]
  );

  if (!row) {
    throw new QuestContextError(404, 'RESOURCE_NOT_FOUND', '퀘스트 상태를 찾을 수 없습니다.');
  }
  if (Number(row.user_id) !== Number(userId)) {
    throw new QuestContextError(403, 'FORBIDDEN', '이 퀘스트를 완료할 권한이 없습니다.');
  }
  if (row.condition_type !== CONDITION_PROMPT_POST_CREATED) {
    throw new QuestContextError(400, 'INVALID_QUEST_CONTEXT', '프롬프트 글쓰기 퀘스트가 아닙니다.');
  }
  if (!row.template_is_active) {
    throw new QuestContextError(409, 'QUEST_TEMPLATE_INACTIVE', '비활성화된 퀘스트입니다.');
  }
  ensureActiveCampaign(row);

  const promptConfig = parseQuestPromptConfig(row.ui_json);
  if (promptConfig.quest_kind !== 'writing_prompt') {
    throw new QuestContextError(400, 'INVALID_QUEST_CONTEXT', '글쓰기 프롬프트 설정이 올바르지 않습니다.');
  }
  if (!promptConfig.prompt_key || promptConfig.prompt_key !== questContext.promptKey) {
    throw new QuestContextError(400, 'PROMPT_KEY_MISMATCH', '프롬프트 정보가 일치하지 않습니다.');
  }
  if (!(await hasActiveEntitlement(userId, promptConfig.required_entitlement))) {
    throw new QuestContextError(403, 'ENTITLEMENT_REQUIRED', '시즌 패스가 필요합니다.');
  }

  await runAsync(
    `
    INSERT OR IGNORE INTO quest_post_submissions
      (user_id, post_id, state_id, campaign_id, template_id, prompt_key)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      postId,
      row.state_id,
      row.campaign_id,
      row.template_id,
      questContext.promptKey,
    ]
  );

  const progressRow = await getAsync(
    `
    SELECT COUNT(*) AS cnt
    FROM quest_post_submissions
    WHERE user_id = ? AND campaign_id = ? AND template_id = ?
    `,
    [userId, row.campaign_id, row.template_id]
  );
  const progress = Number(progressRow?.cnt || 0);
  const target = Math.max(1, Number(row.target_value || 1));
  const newlyCompleted = progress >= target && !row.completed_at;
  const completedAt = newlyCompleted ? getNowKstDate().toISOString() : null;

  await runAsync(
    `UPDATE user_quest_state
     SET progress = ?, completed_at = COALESCE(completed_at, ?)
     WHERE id = ?`,
    [progress, completedAt, row.state_id]
  );

  const updated = await getAsync(
    'SELECT completed_at FROM user_quest_state WHERE id = ? LIMIT 1',
    [row.state_id]
  );

  return {
    state_id: row.state_id,
    template_id: row.template_id,
    campaign_id: row.campaign_id,
    prompt_key: questContext.promptKey,
    progress,
    target,
    status: row.completed_at ? 'already_completed' : newlyCompleted ? 'completed' : 'in_progress',
    completed_at: updated?.completed_at || null,
  };
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
        status:
          completed || state?.completed_at
            ? 'completed'
            : template.condition_type === CONDITION_PROMPT_POST_CREATED
              ? 'in_progress'
              : progress > 0
                ? 'in_progress'
                : 'locked',
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
  CONDITION_PROMPT_POST_CREATED,
  QuestContextError,
  allAsync,
  getAsync,
  runAsync,
  completePromptPostQuest,
  getActiveQuestsForUser,
  fetchActiveCampaigns,
  fetchCampaignTemplates,
  parseQuestPromptConfig,
};
