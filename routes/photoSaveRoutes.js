const express = require('express');

const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_PLATFORMS = new Set(['ios', 'android']);
const ALLOWED_CONSUME_METHODS = new Set(['free', 'rewarded_ad', 'premium']);
const MAX_AD_UNIT_ID_LENGTH = 120;
const MAX_REWARD_TYPE_LENGTH = 80;
const MAX_REQUEST_ID_LENGTH = 120;
const MAX_META_JSON_LENGTH = 4000;

const DEFAULT_FREE_DAILY_LIMIT = 3;
const DEFAULT_REWARDED_GRANT_TTL_MINUTES = 30;
const DEFAULT_PREMIUM_ENTITLEMENT_KEY = 'premium:glsoop';

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

function sendPhotoSaveError(res, status, code, message, extra = undefined) {
  return res.status(status).json({
    ok: false,
    code,
    message,
    ...(extra && typeof extra === 'object' ? extra : {}),
  });
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizePlatform(value) {
  const normalized = normalizeText(value, 20)?.toLowerCase();
  if (!normalized || !ALLOWED_PLATFORMS.has(normalized)) return null;
  return normalized;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parsePositiveIntegerWithFallback(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeMetaJson(value) {
  if (value === undefined || value === null) return null;
  try {
    const serialized = typeof value === 'string' ? value.trim() : JSON.stringify(value);
    if (!serialized || serialized.length > MAX_META_JSON_LENGTH) return null;
    return serialized;
  } catch {
    return null;
  }
}

function getPhotoSaveConfig(platform) {
  const adsEnabled = parseBooleanEnv(process.env.PHOTO_SAVE_ADS_ENABLED, false);
  const freeDailyLimit = parseNonNegativeInteger(
    process.env.PHOTO_SAVE_FREE_DAILY_LIMIT,
    DEFAULT_FREE_DAILY_LIMIT
  );
  const rewardedGrantTtlMinutes = parsePositiveIntegerWithFallback(
    process.env.PHOTO_SAVE_REWARDED_GRANT_TTL_MINUTES,
    DEFAULT_REWARDED_GRANT_TTL_MINUTES
  );
  const premiumEntitlementKey =
    normalizeText(process.env.PHOTO_SAVE_PREMIUM_ENTITLEMENT_KEY, 120) ||
    DEFAULT_PREMIUM_ENTITLEMENT_KEY;
  const rewardedAdUnitId =
    platform === 'ios'
      ? normalizeText(process.env.PHOTO_SAVE_ADMOB_IOS_REWARDED_UNIT_ID, MAX_AD_UNIT_ID_LENGTH)
      : normalizeText(
          process.env.PHOTO_SAVE_ADMOB_ANDROID_REWARDED_UNIT_ID,
          MAX_AD_UNIT_ID_LENGTH
        );

  const gateActive = adsEnabled && Boolean(rewardedAdUnitId);

  return {
    adsEnabled,
    gateActive,
    freeDailyLimit,
    rewardedGrantTtlMinutes,
    premiumEntitlementKey,
    rewardedAdUnitId,
  };
}

async function countFreeSavesToday(userId) {
  const row = await dbGet(
    `
    SELECT COUNT(*) AS count
    FROM photo_save_events
    WHERE user_id = ?
      AND access_type = 'free'
      AND date(created_at, '+9 hours') = date('now', '+9 hours')
    `,
    [userId]
  );
  return Number(row?.count || 0);
}

async function hasPremiumEntitlement(userId, entitlementKey) {
  const row = await dbGet(
    `
    SELECT 1 AS present
    FROM user_entitlements
    WHERE user_id = ?
      AND entitlement_key = ?
      AND status = 'active'
      AND (ends_at IS NULL OR datetime(ends_at) > datetime('now'))
    LIMIT 1
    `,
    [userId, entitlementKey]
  );
  return Boolean(row?.present);
}

async function buildPhotoSavePolicy({ userId, platform }) {
  const config = getPhotoSaveConfig(platform);
  const isPremium = await hasPremiumEntitlement(userId, config.premiumEntitlementKey);

  if (!config.gateActive || isPremium) {
    return {
      enabled: config.gateActive,
      platform,
      premium_entitlement_key: config.premiumEntitlementKey,
      is_premium: isPremium,
      free_daily_limit: config.gateActive ? config.freeDailyLimit : null,
      free_used_today: config.gateActive ? await countFreeSavesToday(userId) : null,
      free_remaining: config.gateActive ? config.freeDailyLimit : null,
      can_save_without_ad: true,
      requires_ad: false,
      rewarded_ad_unit_id: config.rewardedAdUnitId,
      rewarded_grant_ttl_minutes: config.rewardedGrantTtlMinutes,
      fallback_reason: config.gateActive
        ? null
        : config.adsEnabled
          ? 'missing_rewarded_ad_unit_id'
          : 'photo_save_ads_disabled',
      server_time: new Date().toISOString(),
    };
  }

  const freeUsedToday = await countFreeSavesToday(userId);
  const freeRemaining = Math.max(config.freeDailyLimit - freeUsedToday, 0);

  return {
    enabled: true,
    platform,
    premium_entitlement_key: config.premiumEntitlementKey,
    is_premium: false,
    free_daily_limit: config.freeDailyLimit,
    free_used_today: freeUsedToday,
    free_remaining: freeRemaining,
    can_save_without_ad: freeRemaining > 0,
    requires_ad: freeRemaining <= 0,
    rewarded_ad_unit_id: config.rewardedAdUnitId,
    rewarded_grant_ttl_minutes: config.rewardedGrantTtlMinutes,
    fallback_reason: null,
    server_time: new Date().toISOString(),
  };
}

async function findPostOrNull(postId) {
  return dbGet('SELECT id FROM posts WHERE id = ? LIMIT 1', [postId]);
}

function parsePolicyQuery(query = {}) {
  const platform = normalizePlatform(query.platform);
  if (!platform) {
    return { error: 'platform은 ios 또는 android 여야 합니다.' };
  }
  return { platform };
}

function parseRewardGrantPayload(body = {}) {
  const postId = parsePositiveInteger(body.post_id);
  if (!postId) return { error: '유효한 post_id가 필요합니다.' };

  const platform = normalizePlatform(body.platform);
  if (!platform) return { error: 'platform은 ios 또는 android 여야 합니다.' };

  const adUnitId = normalizeText(body.ad_unit_id, MAX_AD_UNIT_ID_LENGTH);
  if (!adUnitId) return { error: 'ad_unit_id가 필요합니다.' };

  const rewardType = normalizeText(body.reward_type, MAX_REWARD_TYPE_LENGTH) || 'photo_save';
  const rewardAmount = parsePositiveIntegerWithFallback(body.reward_amount, 1);

  return {
    post_id: postId,
    platform,
    ad_unit_id: adUnitId,
    reward_type: rewardType,
    reward_amount: rewardAmount,
    raw_json: normalizeMetaJson(body.meta),
  };
}

function parseConsumePayload(body = {}) {
  const postId = parsePositiveInteger(body.post_id);
  if (!postId) return { error: '유효한 post_id가 필요합니다.' };

  const platform = normalizePlatform(body.platform);
  if (!platform) return { error: 'platform은 ios 또는 android 여야 합니다.' };

  const method = normalizeText(body.method, 30)?.toLowerCase();
  if (!method || !ALLOWED_CONSUME_METHODS.has(method)) {
    return { error: 'method는 free, rewarded_ad, premium 중 하나여야 합니다.' };
  }

  const rewardedGrantId =
    body.rewarded_grant_id === undefined || body.rewarded_grant_id === null
      ? null
      : parsePositiveInteger(body.rewarded_grant_id);
  if (method === 'rewarded_ad' && !rewardedGrantId) {
    return { error: 'rewarded_ad 저장에는 rewarded_grant_id가 필요합니다.' };
  }

  const requestId =
    body.request_id === undefined || body.request_id === null
      ? null
      : normalizeText(body.request_id, MAX_REQUEST_ID_LENGTH);
  if (body.request_id !== undefined && body.request_id !== null && !requestId) {
    return { error: `request_id는 1~${MAX_REQUEST_ID_LENGTH}자여야 합니다.` };
  }

  return {
    post_id: postId,
    platform,
    method,
    rewarded_grant_id: rewardedGrantId,
    request_id: requestId,
    meta_json: normalizeMetaJson(body.meta),
  };
}

router.get('/photo-save/policy', authRequired, async (req, res) => {
  const parsed = parsePolicyQuery(req.query || {});
  if (parsed.error) {
    return sendPhotoSaveError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  try {
    const policy = await buildPhotoSavePolicy({
      userId: req.user.id,
      platform: parsed.platform,
    });
    return res.json({
      ok: true,
      message: '사진 저장 정책을 불러왔습니다.',
      policy,
    });
  } catch (error) {
    console.error('[photo-save/policy] failed:', error);
    return sendPhotoSaveError(
      res,
      500,
      'INTERNAL_ERROR',
      '사진 저장 정책 조회 중 오류가 발생했습니다.'
    );
  }
});

router.post('/photo-save/rewarded-grants', authRequired, async (req, res) => {
  const parsed = parseRewardGrantPayload(req.body || {});
  if (parsed.error) {
    return sendPhotoSaveError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  try {
    const post = await findPostOrNull(parsed.post_id);
    if (!post) {
      return sendPhotoSaveError(res, 404, 'RESOURCE_NOT_FOUND', '해당 글을 찾을 수 없습니다.');
    }

    const config = getPhotoSaveConfig(parsed.platform);
    if (!config.gateActive) {
      return sendPhotoSaveError(
        res,
        409,
        'PHOTO_SAVE_AD_GATE_INACTIVE',
        '사진 저장 광고가 활성화되어 있지 않습니다.'
      );
    }

    if (parsed.ad_unit_id !== config.rewardedAdUnitId) {
      return sendPhotoSaveError(
        res,
        400,
        'INVALID_AD_UNIT',
        '현재 플랫폼의 보상형 광고 단위가 아닙니다.'
      );
    }

    const expiresAtModifier = `+${config.rewardedGrantTtlMinutes} minutes`;
    const result = await dbRun(
      `
      INSERT INTO photo_save_ad_rewards (
        user_id,
        post_id,
        platform,
        ad_unit_id,
        reward_type,
        reward_amount,
        status,
        expires_at,
        raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, 'earned', datetime('now', ?), ?)
      `,
      [
        req.user.id,
        parsed.post_id,
        parsed.platform,
        parsed.ad_unit_id,
        parsed.reward_type,
        parsed.reward_amount,
        expiresAtModifier,
        parsed.raw_json,
      ]
    );

    return res.json({
      ok: true,
      message: '사진 저장 광고 보상을 기록했습니다.',
      grant: {
        id: result.lastID,
        post_id: parsed.post_id,
        platform: parsed.platform,
        status: 'earned',
        expires_in_minutes: config.rewardedGrantTtlMinutes,
      },
    });
  } catch (error) {
    console.error('[photo-save/rewarded-grants] failed:', error);
    return sendPhotoSaveError(
      res,
      500,
      'INTERNAL_ERROR',
      '사진 저장 광고 보상 처리 중 오류가 발생했습니다.'
    );
  }
});

router.post('/photo-save/consume', authRequired, async (req, res) => {
  const parsed = parseConsumePayload(req.body || {});
  if (parsed.error) {
    return sendPhotoSaveError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  const userId = req.user.id;

  try {
    const post = await findPostOrNull(parsed.post_id);
    if (!post) {
      return sendPhotoSaveError(res, 404, 'RESOURCE_NOT_FOUND', '해당 글을 찾을 수 없습니다.');
    }

    const config = getPhotoSaveConfig(parsed.platform);
    const isPremium = await hasPremiumEntitlement(userId, config.premiumEntitlementKey);
    const gateActive = config.gateActive && !isPremium;
    const accessType = !gateActive ? (isPremium ? 'premium' : 'free') : parsed.method;

    const savepointName = `photo_save_consume_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}`;
    const rollbackConsume = async () => {
      await dbRun(`ROLLBACK TO ${savepointName}`).catch(() => {});
      await dbRun(`RELEASE ${savepointName}`).catch(() => {});
    };

    await dbRun(`SAVEPOINT ${savepointName}`);
    try {
      if (gateActive && accessType === 'premium' && !isPremium) {
        await rollbackConsume();
        return sendPhotoSaveError(
          res,
          403,
          'PREMIUM_REQUIRED',
          '프리미엄 권한이 필요합니다.'
        );
      }

      if (gateActive && accessType === 'free') {
        const freeUsedToday = await countFreeSavesToday(userId);
        if (freeUsedToday >= config.freeDailyLimit) {
          await rollbackConsume();
          const policy = await buildPhotoSavePolicy({ userId, platform: parsed.platform });
          return sendPhotoSaveError(
            res,
            409,
            'FREE_QUOTA_EXHAUSTED',
            '오늘 무료 사진 저장 횟수를 모두 사용했습니다.',
            { policy }
          );
        }
      }

      if (gateActive && accessType === 'rewarded_ad') {
        const reward = await dbGet(
          `
          SELECT id, post_id, status, expires_at
          FROM photo_save_ad_rewards
          WHERE id = ?
            AND user_id = ?
          LIMIT 1
          `,
          [parsed.rewarded_grant_id, userId]
        );

        if (!reward) {
          await rollbackConsume();
          return sendPhotoSaveError(
            res,
            404,
            'REWARD_GRANT_NOT_FOUND',
            '사진 저장 광고 보상을 찾을 수 없습니다.'
          );
        }

        if (reward.status !== 'earned') {
          await rollbackConsume();
          return sendPhotoSaveError(
            res,
            409,
            'REWARD_GRANT_ALREADY_USED',
            '이미 사용된 사진 저장 광고 보상입니다.'
          );
        }

        const expired = await dbGet(
          `
          SELECT CASE WHEN datetime(?) <= CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS expired
          `,
          [reward.expires_at]
        );
        if (Number(expired?.expired || 0) === 1) {
          await dbRun(
            `
            UPDATE photo_save_ad_rewards
            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
            [reward.id]
          );
          await rollbackConsume();
          return sendPhotoSaveError(
            res,
            409,
            'REWARD_GRANT_EXPIRED',
            '사진 저장 광고 보상이 만료되었습니다.'
          );
        }

        if (Number(reward.post_id) !== Number(parsed.post_id)) {
          await rollbackConsume();
          return sendPhotoSaveError(
            res,
            409,
            'REWARD_GRANT_POST_MISMATCH',
            '다른 글에 발급된 사진 저장 광고 보상입니다.'
          );
        }

        await dbRun(
          `
          UPDATE photo_save_ad_rewards
          SET status = 'consumed',
              consumed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          `,
          [reward.id]
        );
      }

      const eventResult = await dbRun(
        `
        INSERT INTO photo_save_events (
          user_id,
          post_id,
          access_type,
          platform,
          rewarded_grant_id,
          request_id,
          meta_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          userId,
          parsed.post_id,
          accessType,
          parsed.platform,
          accessType === 'rewarded_ad' ? parsed.rewarded_grant_id : null,
          parsed.request_id,
          parsed.meta_json,
        ]
      );

      await dbRun(`RELEASE ${savepointName}`);

      const policy = await buildPhotoSavePolicy({ userId, platform: parsed.platform });
      return res.json({
        ok: true,
        message: '사진 저장 사용을 기록했습니다.',
        event: {
          id: eventResult.lastID,
          post_id: parsed.post_id,
          access_type: accessType,
          platform: parsed.platform,
        },
        policy,
      });
    } catch (error) {
      try {
        await rollbackConsume();
      } catch (rollbackError) {
        console.error('[photo-save/consume] rollback failed:', rollbackError);
      }
      throw error;
    }
  } catch (error) {
    console.error('[photo-save/consume] failed:', error);
    return sendPhotoSaveError(
      res,
      500,
      'INTERNAL_ERROR',
      '사진 저장 사용 처리 중 오류가 발생했습니다.'
    );
  }
});

module.exports = router;
