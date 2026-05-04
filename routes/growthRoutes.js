const express = require('express');
const { authRequired } = require('../middleware/auth');
const {
  addXp,
  fetchGrowthSummary,
  fetchUserAchievements,
} = require('../utils/growth-service');
const { buildPublicDisplayName } = require('../utils/accountLifecycle');
const { getActiveQuestsForUser } = require('../utils/questService');
const { buildPostExcerpt } = require('../utils/postPreview');
const { mapCosmeticItem } = require('../utils/profileCosmetics');
const { normalizeUtcDateTime } = require('../utils/dateTime');
const db = require('../db');

const LOCK_REASON_ENTITLEMENT_REQUIRED = 'SEASON_PASS_REQUIRED';

function sendGrowthError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
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

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function parseUiJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') {
    return raw;
  }
  if (typeof raw !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function normalizeEntitlementKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) return null;
  return trimmed;
}

function normalizeRewardCosmeticKeys(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Set();
  const keys = [];

  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || unique.has(trimmed)) continue;
    unique.add(trimmed);
    keys.push(trimmed);
  }

  return keys;
}

function parseQuestMonetizationConfig(rawUiJson) {
  const parsed = parseUiJson(rawUiJson);
  const requiredEntitlement = normalizeEntitlementKey(parsed?.required_entitlement);
  const rewardCosmeticKeys = normalizeRewardCosmeticKeys(parsed?.rewards?.cosmetics);
  return {
    required_entitlement: requiredEntitlement,
    reward_cosmetic_keys: rewardCosmeticKeys,
  };
}

async function fetchActiveEntitlementKeySet(userId) {
  const rows = await allAsync(
    `
      SELECT entitlement_key
      FROM user_entitlements
      WHERE user_id = ?
        AND status = 'active'
        AND (ends_at IS NULL OR datetime(ends_at) > datetime('now'))
    `,
    [userId]
  );

  const keys = new Set();
  for (const row of rows) {
    const key = normalizeEntitlementKey(row?.entitlement_key);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function buildQuestLockState(quest, entitlementKeySet = new Set()) {
  const monetization = parseQuestMonetizationConfig(quest?.uiJson);
  const requiredEntitlement = monetization.required_entitlement || null;
  const isLocked =
    !!requiredEntitlement && !entitlementKeySet.has(requiredEntitlement);

  return {
    is_locked: isLocked,
    required_entitlement: requiredEntitlement,
    lock_reason: isLocked ? LOCK_REASON_ENTITLEMENT_REQUIRED : null,
  };
}

async function fetchCosmeticRowsByKeys(keys = []) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return [];
  }

  const placeholders = keys.map(() => '?').join(', ');
  const cosmeticRows = await allAsync(
    `
      SELECT
        'cosmetic_items' AS source_table,
        id,
        key,
        type,
        name,
        icon_emoji,
        COALESCE(rarity, 'common') AS rarity,
        season,
        meta_json
      FROM cosmetic_items
      WHERE key IN (${placeholders})
    `,
    keys
  );
  const backgroundRows = await allAsync(
    `
      SELECT
        'profile_background_items' AS source_table,
        id,
        key,
        'background' AS type,
        name,
        icon_emoji,
        COALESCE(rarity, 'common') AS rarity,
        season,
        meta_json
      FROM profile_background_items
      WHERE key IN (${placeholders})
        AND is_active = 1
    `,
    keys
  );
  return [...cosmeticRows, ...backgroundRows];
}

async function grantQuestRewardCosmetics(userId, cosmeticKeys = []) {
  if (!Array.isArray(cosmeticKeys) || cosmeticKeys.length === 0) {
    return [];
  }

  const rows = await fetchCosmeticRowsByKeys(cosmeticKeys);
  const itemByKey = new Map();
  for (const row of rows) {
    if (!row?.key) continue;
    if (!itemByKey.has(row.key)) {
      itemByKey.set(row.key, row);
    }
  }

  const gained = [];
  for (const key of cosmeticKeys) {
    const item = itemByKey.get(key);
    if (!item) {
      continue;
    }
    if (item.type !== 'badge' && item.type !== 'sticker' && item.type !== 'background') {
      continue;
    }

    const result =
      item.type === 'background'
        ? await runAsync(
            `
              INSERT OR IGNORE INTO user_profile_backgrounds (user_id, background_id, source)
              VALUES (?, ?, 'quest')
            `,
            [userId, item.id]
          )
        : await runAsync(
            `
              INSERT OR IGNORE INTO user_cosmetics (user_id, cosmetic_id, source)
              VALUES (?, ?, 'quest')
            `,
            [userId, item.id]
          );

    if (Number(result?.changes || 0) > 0) {
      gained.push(mapCosmeticItem(item));
    }
  }

  return gained;
}

function mapSummary(summary) {
  return {
    level: summary.level,
    current_xp: summary.currentXp,
    next_level_xp: summary.nextLevelXp,
    today_xp: summary.todayXp,
    weekly_posts: summary.weeklyPosts,
    streak_days: summary.streakDays,
    max_streak_days: summary.maxStreakDays,
    title: summary.title,
  };
}

function mapAchievements(achievements = []) {
  return achievements.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    description: item.description,
    category: item.category,
    status: item.status,
    progress: item.progress,
    target: item.target,
    state_id: item.stateId,
    unlocked_at: item.unlockedAt,
    reward_claimed_at: item.rewardClaimedAt,
    position_index: item.positionIndex,
    icon: item.icon,
    ui_json: item.uiJson,
  }));
}

function mapCampaigns(campaigns = [], entitlementKeySet = new Set()) {
  return campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    campaign_type: campaign.campaignType,
    start_at: campaign.startAt,
    end_at: campaign.endAt,
    quests: (campaign.quests || []).map((quest) => ({
      ...buildQuestLockState(quest, entitlementKeySet),
      id: quest.id,
      state_id: quest.stateId,
      name: quest.name,
      description: quest.description,
      condition_type: quest.conditionType,
      category: quest.category,
      target: quest.target,
      reward_xp: quest.rewardXp,
      status: quest.status,
      progress: quest.progress,
      position_index: quest.positionIndex,
      campaign_id: quest.campaignId,
      campaign_type: quest.campaignType,
      template_kind: quest.templateKind,
      code: quest.code,
      ui_json: quest.uiJson,
      completed_at: quest.completedAt,
      reward_claimed_at: quest.rewardClaimedAt,
    })),
  }));
}

function normalizeTopPostCategory(category) {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'poem' || normalized === 'essay' || normalized === 'short') {
    return normalized;
  }
  return 'short';
}

function mapTopPosts(posts = []) {
  return posts.map((item) => ({
    id: item.id,
    title: item.title,
    excerpt: buildPostExcerpt(item.content, 100),
    author_display_name: buildPublicDisplayName(
      item.author_nickname,
      item.author_account_status
    ),
    author_name: buildPublicDisplayName(
      item.author_nickname,
      item.author_account_status
    ),
    category: normalizeTopPostCategory(item.category),
    created_at: item.created_at ? normalizeUtcDateTime(item.created_at) : null,
    like_count: Number(item.like_count) || 0,
    bookmark_count: Number(item.bookmark_count) || 0,
  }));
}

async function fetchGrowthTopPosts(limit = 3) {
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(10, Math.floor(parsedLimit))
    : 3;

  return allAsync(
    `
      SELECT
        p.id,
        p.title,
        p.content,
        p.category,
        p.created_at,
        u.nickname AS author_nickname,
        COALESCE(u.account_status, 'active') AS author_account_status,
        IFNULL(lc.like_count, 0) AS like_count,
        IFNULL(bc.bookmark_count, 0) AS bookmark_count
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN (
        SELECT post_id, COUNT(*) AS like_count
        FROM likes
        GROUP BY post_id
      ) lc ON lc.post_id = p.id
      LEFT JOIN (
        SELECT bi.post_id, COUNT(DISTINCT bl.user_id) AS bookmark_count
        FROM bookmark_items bi
        JOIN bookmark_lists bl ON bl.id = bi.list_id
        GROUP BY bi.post_id
      ) bc ON bc.post_id = p.id
      ORDER BY IFNULL(lc.like_count, 0) DESC, IFNULL(bc.bookmark_count, 0) DESC, p.created_at DESC
      LIMIT ?
    `,
    [safeLimit]
  );
}

const router = express.Router();

router.get('/growth/dashboard', authRequired, async (req, res) => {
  try {
    const [summary, achievements, campaigns, topPosts, entitlementKeySet] =
      await Promise.all([
        fetchGrowthSummary(req.user.id),
        fetchUserAchievements(req.user.id),
        getActiveQuestsForUser(req.user.id),
        fetchGrowthTopPosts(),
        fetchActiveEntitlementKeySet(req.user.id),
      ]);

    return res.json({
      ok: true,
      message: '성장 대시보드 정보를 불러왔습니다.',
      summary: mapSummary(summary),
      achievements: mapAchievements(achievements),
      campaigns: mapCampaigns(campaigns, entitlementKeySet),
      top_posts: mapTopPosts(topPosts),
    });
  } catch (error) {
    console.error('growth dashboard error:', error);
    return sendGrowthError(
      res,
      500,
      'INTERNAL_ERROR',
      '성장 대시보드 정보를 불러오지 못했습니다.'
    );
  }
});

router.get('/growth/top-posts', authRequired, async (req, res) => {
  try {
    const topPosts = await fetchGrowthTopPosts(req.query.limit || 3);
    return res.json({
      ok: true,
      message: '인기 글 정보를 불러왔습니다.',
      top_posts: mapTopPosts(topPosts),
    });
  } catch (error) {
    console.error('growth top posts error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '인기 글 정보를 불러오지 못했습니다.');
  }
});

router.get('/growth/summary', authRequired, async (req, res) => {
  try {
    const summary = await fetchGrowthSummary(req.user.id);
    return res.json({
      ok: true,
      message: '성장 요약 정보를 불러왔습니다.',
      summary: mapSummary(summary),
    });
  } catch (error) {
    console.error('growth summary error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '성장 요약 정보를 불러오지 못했습니다.');
  }
});

router.get('/growth/achievements', authRequired, async (req, res) => {
  try {
    const achievements = await fetchUserAchievements(req.user.id);
    return res.json({
      ok: true,
      message: '업적 정보를 불러왔습니다.',
      achievements: mapAchievements(achievements),
    });
  } catch (error) {
    console.error('growth achievements error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '업적 정보를 불러오지 못했습니다.');
  }
});

router.get('/quests/active', authRequired, async (req, res) => {
  try {
    const [campaigns, entitlementKeySet] = await Promise.all([
      getActiveQuestsForUser(req.user.id),
      fetchActiveEntitlementKeySet(req.user.id),
    ]);

    return res.json({
      ok: true,
      message: '활성 퀘스트를 불러왔습니다.',
      campaigns: mapCampaigns(campaigns, entitlementKeySet),
    });
  } catch (error) {
    console.error('active quests error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '활성 퀘스트를 불러오지 못했습니다.');
  }
});

router.post('/quests/:stateId/claim', authRequired, async (req, res) => {
  const stateId = Number(req.params.stateId);
  if (!Number.isFinite(stateId)) {
    return sendGrowthError(res, 400, 'INVALID_REQUEST', '올바르지 않은 stateId입니다.');
  }

  const nowIso = new Date().toISOString();
  try {
    await runAsync('BEGIN IMMEDIATE;');
    const state = await getAsync(
      `SELECT uqs.id, uqs.user_id, uqs.completed_at, uqs.reward_claimed_at, uqs.template_id, uqs.campaign_id,
              qt.reward_xp, qt.ui_json
       FROM user_quest_state uqs
       JOIN quest_templates qt ON qt.id = uqs.template_id
       WHERE uqs.id = ? AND uqs.user_id = ?`,
      [stateId, req.user.id]
    );

    if (!state) {
      await runAsync('ROLLBACK;');
      return sendGrowthError(res, 404, 'RESOURCE_NOT_FOUND', '퀘스트 상태를 찾을 수 없습니다.');
    }

    if (!state.completed_at) {
      await runAsync('ROLLBACK;');
      return sendGrowthError(
        res,
        400,
        'INVALID_REQUEST',
        '아직 완료되지 않은 퀘스트입니다.'
      );
    }

    if (state.reward_claimed_at) {
      await runAsync('ROLLBACK;');
      return sendGrowthError(res, 409, 'CONFLICT', '이미 보상을 받았습니다.');
    }

    const monetization = parseQuestMonetizationConfig(state.ui_json);
    if (monetization.required_entitlement) {
      const entitlement = await getAsync(
        `
        SELECT entitlement_key
        FROM user_entitlements
        WHERE user_id = ?
          AND entitlement_key = ?
          AND status = 'active'
          AND (ends_at IS NULL OR datetime(ends_at) > datetime('now'))
        LIMIT 1
        `,
        [req.user.id, monetization.required_entitlement]
      );

      if (!entitlement) {
        await runAsync('ROLLBACK;');
        return sendGrowthError(
          res,
          403,
          'ENTITLEMENT_REQUIRED',
          '시즌 패스가 필요합니다.'
        );
      }
    }

    await runAsync(
      'UPDATE user_quest_state SET reward_claimed_at = ? WHERE id = ?',
      [nowIso, stateId]
    );

    const rewardXp = Number(state.reward_xp) || 0;
    const gainedXp =
      rewardXp > 0
        ? await addXp(req.user.id, rewardXp, 'QUEST_REWARD', {
            stateId,
            templateId: state.template_id,
            campaignId: state.campaign_id,
          })
        : 0;

    const updated = await getAsync('SELECT xp FROM users WHERE id = ?', [req.user.id]);
    const newXp = updated?.xp || 0;
    const gainedCosmetics = await grantQuestRewardCosmetics(
      req.user.id,
      monetization.reward_cosmetic_keys
    );

    await runAsync('COMMIT;');
    return res.json({
      ok: true,
      reward_claimed_at: nowIso,
      gained_xp: gainedXp,
      new_xp: newXp,
      gained_cosmetics: gainedCosmetics,
    });
  } catch (error) {
    try {
      await runAsync('ROLLBACK;');
    } catch (rollbackError) {
      console.error('claim rollback failed:', rollbackError);
    }
    console.error('claim reward error:', error);
    return sendGrowthError(res, 500, 'INTERNAL_ERROR', '보상 지급 중 오류가 발생했습니다.');
  }
});

module.exports = router;
