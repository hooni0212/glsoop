const db = require('../db');
const { addXp } = require('./growth-service');
const {
  hasActiveEntitlement,
  listActiveEntitlementKeys,
} = require('./entitlements');
const { mapCosmeticItem } = require('./profileCosmetics');

const LOCK_REASON_ENTITLEMENT_REQUIRED = 'SEASON_PASS_REQUIRED';
const AUTO_CLAIM_SOURCE = 'quest_auto_claim';

class QuestRewardClaimError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'QuestRewardClaimError';
    this.status = status;
    this.code = code;
  }
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
      resolve(rows || []);
    });
  });
}

function parseUiJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
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

function parseQuestRewardConfig(rawUiJson) {
  const parsed = parseUiJson(rawUiJson);
  return {
    required_entitlement: normalizeEntitlementKey(parsed?.required_entitlement),
    reward_cosmetic_keys: normalizeRewardCosmeticKeys(parsed?.rewards?.cosmetics),
  };
}

function collectRewardCosmeticKeys(items = [], getUiJson = (item) => item?.uiJson) {
  const unique = new Set();
  const keys = [];

  for (const item of items || []) {
    const config = parseQuestRewardConfig(getUiJson(item));
    for (const key of config.reward_cosmetic_keys) {
      if (unique.has(key)) continue;
      unique.add(key);
      keys.push(key);
    }
  }

  return keys;
}

async function fetchActiveEntitlementKeySet(userId) {
  const keys = await listActiveEntitlementKeys(userId);

  const keySet = new Set();
  for (const rawKey of keys) {
    const key = normalizeEntitlementKey(rawKey);
    if (key) {
      keySet.add(key);
    }
  }
  return keySet;
}

function buildQuestLockState(quest, entitlementKeySet = new Set()) {
  const rawUiJson = quest?.uiJson ?? quest?.ui_json;
  const config = parseQuestRewardConfig(rawUiJson);
  const requiredEntitlement = config.required_entitlement || null;
  const isLocked =
    !!requiredEntitlement && !entitlementKeySet.has(requiredEntitlement);

  return {
    is_locked: isLocked,
    required_entitlement: requiredEntitlement,
    lock_reason: isLocked ? LOCK_REASON_ENTITLEMENT_REQUIRED : null,
  };
}

async function fetchCosmeticRowsByKeys(keys = []) {
  const uniqueKeys = collectUniqueKeys(keys);
  if (uniqueKeys.length === 0) {
    return [];
  }

  const placeholders = uniqueKeys.map(() => '?').join(', ');
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
        AND is_active = 1
    `,
    uniqueKeys
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
    uniqueKeys
  );
  return [...cosmeticRows, ...backgroundRows];
}

async function fetchRewardCosmeticMap(keys = []) {
  const rows = await fetchCosmeticRowsByKeys(keys);
  const itemByKey = new Map();

  for (const row of rows) {
    if (!row?.key || itemByKey.has(row.key)) continue;
    itemByKey.set(row.key, mapCosmeticItem(row));
  }

  return itemByKey;
}

function getRewardCosmeticPayload(rawUiJson, rewardCosmeticByKey = new Map()) {
  const rewardCosmeticKeys = parseQuestRewardConfig(rawUiJson).reward_cosmetic_keys;
  return {
    reward_cosmetic_keys: rewardCosmeticKeys,
    reward_cosmetics: rewardCosmeticKeys
      .map((key) => rewardCosmeticByKey.get(key))
      .filter(Boolean),
  };
}

async function grantQuestRewardCosmetics(userId, cosmeticKeys = [], source = 'quest') {
  const uniqueKeys = collectUniqueKeys(cosmeticKeys);
  if (uniqueKeys.length === 0) {
    return [];
  }

  const rows = await fetchCosmeticRowsByKeys(uniqueKeys);
  const itemByKey = new Map();
  for (const row of rows) {
    if (!row?.key) continue;
    if (!itemByKey.has(row.key)) {
      itemByKey.set(row.key, row);
    }
  }

  const gained = [];
  for (const key of uniqueKeys) {
    const item = itemByKey.get(key);
    if (!item) continue;
    if (item.type !== 'badge' && item.type !== 'sticker' && item.type !== 'background') {
      continue;
    }

    const result =
      item.type === 'background'
        ? await runAsync(
            `
              INSERT OR IGNORE INTO user_profile_backgrounds (user_id, background_id, source)
              VALUES (?, ?, ?)
            `,
            [userId, item.id, source]
          )
        : await runAsync(
            `
              INSERT OR IGNORE INTO user_cosmetics (user_id, cosmetic_id, source)
              VALUES (?, ?, ?)
            `,
            [userId, item.id, source]
          );

    if (Number(result?.changes || 0) > 0) {
      gained.push(mapCosmeticItem(item));
    }
  }

  return gained;
}

function collectUniqueKeys(keys = []) {
  if (!Array.isArray(keys)) return [];
  const unique = new Set();
  const normalized = [];

  for (const raw of keys) {
    if (typeof raw !== 'string') continue;
    const key = raw.trim();
    if (!key || unique.has(key)) continue;
    unique.add(key);
    normalized.push(key);
  }

  return normalized;
}

function assertPositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new QuestRewardClaimError(400, 'INVALID_REQUEST', `${fieldName}가 올바르지 않습니다.`);
  }
  return parsed;
}

async function claimQuestReward({ stateId, userId, source = 'manual' }) {
  const normalizedStateId = assertPositiveInteger(stateId, 'stateId');
  const normalizedUserId = assertPositiveInteger(userId, 'userId');
  const nowIso = new Date().toISOString();
  let committed = false;

  try {
    await runAsync('BEGIN IMMEDIATE;');
    const state = await getAsync(
      `SELECT uqs.id, uqs.user_id, uqs.completed_at, uqs.reward_claimed_at, uqs.template_id, uqs.campaign_id,
              qt.reward_xp, qt.ui_json
       FROM user_quest_state uqs
       JOIN quest_templates qt ON qt.id = uqs.template_id
       WHERE uqs.id = ? AND uqs.user_id = ?`,
      [normalizedStateId, normalizedUserId]
    );

    if (!state) {
      throw new QuestRewardClaimError(404, 'RESOURCE_NOT_FOUND', '퀘스트 상태를 찾을 수 없습니다.');
    }
    if (!state.completed_at) {
      throw new QuestRewardClaimError(400, 'INVALID_REQUEST', '아직 완료되지 않은 퀘스트입니다.');
    }
    if (state.reward_claimed_at) {
      throw new QuestRewardClaimError(409, 'CONFLICT', '이미 보상을 받았습니다.');
    }

    const config = parseQuestRewardConfig(state.ui_json);
    if (config.required_entitlement) {
      const entitlementActive = await hasActiveEntitlement(
        normalizedUserId,
        config.required_entitlement
      );

      if (!entitlementActive) {
        throw new QuestRewardClaimError(403, 'ENTITLEMENT_REQUIRED', '시즌 패스가 필요합니다.');
      }
    }

    await runAsync(
      'UPDATE user_quest_state SET reward_claimed_at = ? WHERE id = ?',
      [nowIso, normalizedStateId]
    );

    const rewardXp = Number(state.reward_xp) || 0;
    const gainedXp =
      rewardXp > 0
        ? await addXp(normalizedUserId, rewardXp, 'QUEST_REWARD', {
            stateId: normalizedStateId,
            templateId: state.template_id,
            campaignId: state.campaign_id,
            source,
          })
        : 0;

    const updated = await getAsync('SELECT xp FROM users WHERE id = ?', [normalizedUserId]);
    const newXp = updated?.xp || 0;
    const gainedCosmetics = await grantQuestRewardCosmetics(
      normalizedUserId,
      config.reward_cosmetic_keys,
      source === 'auto_season_close' ? AUTO_CLAIM_SOURCE : 'quest'
    );

    await runAsync('COMMIT;');
    committed = true;

    return {
      reward_claimed_at: nowIso,
      gained_xp: gainedXp,
      new_xp: newXp,
      gained_cosmetics: gainedCosmetics,
    };
  } catch (error) {
    if (!committed) {
      try {
        await runAsync('ROLLBACK;');
      } catch (rollbackError) {
        console.error('quest reward claim rollback failed:', rollbackError);
      }
    }
    throw error;
  }
}

function normalizeAutoClaimLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed <= 0) return 100;
  return Math.min(parsed, 500);
}

async function autoClaimExpiredQuestRewards({ limit = 100, dryRun = false } = {}) {
  const safeLimit = normalizeAutoClaimLimit(limit);
  const candidates = await allAsync(
    `
      SELECT
        uqs.id AS state_id,
        uqs.user_id,
        uqs.template_id,
        uqs.campaign_id,
        qc.name AS campaign_name,
        qc.campaign_type,
        qc.end_at
      FROM user_quest_state uqs
      JOIN quest_campaigns qc ON qc.id = uqs.campaign_id
      WHERE uqs.completed_at IS NOT NULL
        AND uqs.reward_claimed_at IS NULL
        AND qc.end_at IS NOT NULL
        AND datetime(qc.end_at) < datetime('now')
        AND LOWER(COALESCE(qc.campaign_type, '')) IN ('season', 'event')
      ORDER BY datetime(qc.end_at) ASC, uqs.id ASC
      LIMIT ?
    `,
    [safeLimit]
  );

  if (dryRun) {
    return {
      dry_run: true,
      limit: safeLimit,
      candidate_count: candidates.length,
      claimed_count: 0,
      skipped_count: 0,
      candidates,
      claimed: [],
      skipped: [],
    };
  }

  const claimed = [];
  const skipped = [];

  for (const candidate of candidates) {
    try {
      const result = await claimQuestReward({
        stateId: candidate.state_id,
        userId: candidate.user_id,
        source: 'auto_season_close',
      });
      claimed.push({
        ...candidate,
        reward_claimed_at: result.reward_claimed_at,
        gained_xp: result.gained_xp,
        gained_cosmetics_count: result.gained_cosmetics.length,
      });
    } catch (error) {
      if (error instanceof QuestRewardClaimError) {
        skipped.push({
          ...candidate,
          code: error.code,
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }

  return {
    dry_run: false,
    limit: safeLimit,
    candidate_count: candidates.length,
    claimed_count: claimed.length,
    skipped_count: skipped.length,
    candidates: [],
    claimed,
    skipped,
  };
}

module.exports = {
  LOCK_REASON_ENTITLEMENT_REQUIRED,
  QuestRewardClaimError,
  autoClaimExpiredQuestRewards,
  buildQuestLockState,
  claimQuestReward,
  collectRewardCosmeticKeys,
  fetchActiveEntitlementKeySet,
  fetchCosmeticRowsByKeys,
  fetchRewardCosmeticMap,
  getRewardCosmeticPayload,
  grantQuestRewardCosmetics,
  normalizeRewardCosmeticKeys,
  parseQuestRewardConfig,
};
