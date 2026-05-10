const express = require('express');

const db = require('../db');
const { authRequired } = require('../middleware/auth');
const {
  DEFAULT_BADGE_KEY,
  DEFAULT_BACKGROUND_KEY,
  ALLOWED_PROFILE_STICKER_SLOTS,
  MAX_SHOWCASE_BADGES,
  MAX_HEADER_STICKERS,
  normalizeCosmeticKey,
  parseStoredProfileCosmetics,
  sanitizeEquippedProfileCosmetics,
  serializeProfileCosmetics,
  extractProfileCosmeticKeys,
  mapCosmeticItem,
  makeKeyedCosmeticMap,
  buildExpandedProfileCosmetics,
} = require('../utils/profileCosmetics');

const router = express.Router();

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

function sendCosmeticsError(res, status, message) {
  return res.status(status).json({ ok: false, message });
}

function mapInventoryRows(rows = []) {
  const badges = [];
  const stickers = [];
  const backgrounds = [];

  for (const row of rows) {
    const mapped = mapCosmeticItem(row);
    if (row.type === 'badge') {
      badges.push(mapped);
    } else if (row.type === 'sticker') {
      stickers.push(mapped);
    } else if (row.type === 'background') {
      backgrounds.push(mapped);
    }
  }

  return { badges, stickers, backgrounds };
}

function parseProfileUpdatePayload(body = {}) {
  const hasPrimary = Object.prototype.hasOwnProperty.call(body, 'primary_badge_key');
  const hasBackground = Object.prototype.hasOwnProperty.call(body, 'profile_background_key');
  const hasShowcase = Object.prototype.hasOwnProperty.call(body, 'showcase_badge_keys');
  const hasHeader = Object.prototype.hasOwnProperty.call(body, 'header_stickers');

  if (!hasPrimary || !hasShowcase || !hasHeader) {
    return {
      error:
        'primary_badge_key, showcase_badge_keys, header_stickers를 모두 전달해야 합니다.',
    };
  }

  let primaryBadgeKey = null;
  if (body.primary_badge_key !== null) {
    primaryBadgeKey = normalizeCosmeticKey(body.primary_badge_key);
    if (!primaryBadgeKey) {
      return { error: 'primary_badge_key는 문자열 또는 null 이어야 합니다.' };
    }
  }

  let profileBackgroundKey = undefined;
  if (hasBackground) {
    profileBackgroundKey = null;
    if (body.profile_background_key !== null) {
      profileBackgroundKey = normalizeCosmeticKey(body.profile_background_key);
      if (!profileBackgroundKey) {
        return { error: 'profile_background_key는 문자열 또는 null 이어야 합니다.' };
      }
    }
  }

  if (!Array.isArray(body.showcase_badge_keys)) {
    return { error: 'showcase_badge_keys는 배열이어야 합니다.' };
  }
  if (body.showcase_badge_keys.length > MAX_SHOWCASE_BADGES) {
    return {
      error: `showcase_badge_keys는 최대 ${MAX_SHOWCASE_BADGES}개까지 설정할 수 있습니다.`,
    };
  }

  const showcaseBadges = [];
  const showcaseSeen = new Set();
  for (const value of body.showcase_badge_keys) {
    const key = normalizeCosmeticKey(value);
    if (!key) {
      return { error: 'showcase_badge_keys의 모든 원소는 문자열이어야 합니다.' };
    }
    if (showcaseSeen.has(key)) {
      return { error: 'showcase_badge_keys에는 중복 키를 넣을 수 없습니다.' };
    }
    showcaseSeen.add(key);
    showcaseBadges.push(key);
  }

  if (!Array.isArray(body.header_stickers)) {
    return { error: 'header_stickers는 배열이어야 합니다.' };
  }
  if (body.header_stickers.length > MAX_HEADER_STICKERS) {
    return {
      error: `header_stickers는 최대 ${MAX_HEADER_STICKERS}개까지 설정할 수 있습니다.`,
    };
  }

  const headerStickers = [];
  const usedSlots = new Set();
  for (const entry of body.header_stickers) {
    if (!entry || typeof entry !== 'object') {
      return { error: 'header_stickers의 각 원소는 {slot, key} 객체여야 합니다.' };
    }

    const slot =
      typeof entry.slot === 'string' ? entry.slot.trim().toLowerCase() : null;
    if (!slot || !ALLOWED_PROFILE_STICKER_SLOTS.has(slot)) {
      return { error: "header_stickers.slot은 'tl', 'tr', 'br' 중 하나여야 합니다." };
    }
    if (usedSlots.has(slot)) {
      return { error: 'header_stickers.slot은 중복될 수 없습니다.' };
    }

    const key = normalizeCosmeticKey(entry.key);
    if (!key) {
      return { error: 'header_stickers.key는 문자열이어야 합니다.' };
    }

    usedSlots.add(slot);
    headerStickers.push({ slot, key });
  }

  return {
    primary_badge_key: primaryBadgeKey,
    profile_background_key: profileBackgroundKey,
    showcase_badge_keys: showcaseBadges,
    header_stickers: headerStickers,
  };
}

async function fetchOwnedCosmetics(userId) {
  const cosmeticRows = await dbAll(
    `
    SELECT
      ci.key,
      ci.type,
      ci.name,
      ci.icon_emoji,
      COALESCE(ci.rarity, 'common') AS rarity,
      ci.season,
      ci.meta_json
    FROM user_cosmetics uc
    JOIN cosmetic_items ci ON ci.id = uc.cosmetic_id
    WHERE uc.user_id = ?
    ORDER BY
      CASE ci.type WHEN 'badge' THEN 0 ELSE 1 END,
      uc.earned_at ASC,
      ci.id ASC
    `,
    [userId]
  );
  const backgroundRows = await dbAll(
    `
    SELECT
      pbi.key,
      'background' AS type,
      pbi.name,
      pbi.icon_emoji,
      COALESCE(pbi.rarity, 'common') AS rarity,
      pbi.season,
      pbi.meta_json
    FROM user_profile_backgrounds upb
    JOIN profile_background_items pbi ON pbi.id = upb.background_id
    WHERE upb.user_id = ?
      AND pbi.is_active = 1
    ORDER BY upb.earned_at ASC, pbi.id ASC
    `,
    [userId]
  );
  return [...cosmeticRows, ...backgroundRows];
}

async function fetchProfileRow(userId) {
  return dbGet(
    `
    SELECT
      user_id,
      primary_badge_key,
      profile_background_key,
      showcase_badge_keys_json,
      header_stickers_json
    FROM user_profile_cosmetics
    WHERE user_id = ?
    LIMIT 1
    `,
    [userId]
  );
}

async function ensureDefaultProfileCosmetics(userId) {
  await dbRun(
    `
    INSERT OR IGNORE INTO user_cosmetics (user_id, cosmetic_id, source)
    SELECT ?, ci.id, 'default'
    FROM cosmetic_items ci
    WHERE ci.key = ?
    `,
    [userId, DEFAULT_BADGE_KEY]
  );
  await dbRun(
    `
    INSERT OR IGNORE INTO user_profile_backgrounds (user_id, background_id, source)
    SELECT ?, pbi.id, 'default'
    FROM profile_background_items pbi
    WHERE pbi.key = ?
    `,
    [userId, DEFAULT_BACKGROUND_KEY]
  );
  await dbRun(
    `
    INSERT INTO user_profile_cosmetics (
      user_id,
      primary_badge_key,
      profile_background_key,
      showcase_badge_keys_json,
      header_stickers_json,
      updated_at
    )
    VALUES (?, ?, ?, '[]', '[]', CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      showcase_badge_keys_json = CASE
        WHEN showcase_badge_keys_json IS NULL OR TRIM(showcase_badge_keys_json) = '' THEN '[]'
        ELSE showcase_badge_keys_json
      END,
      header_stickers_json = CASE
        WHEN header_stickers_json IS NULL OR TRIM(header_stickers_json) = '' THEN '[]'
        ELSE header_stickers_json
      END
    `,
    [userId, DEFAULT_BADGE_KEY, DEFAULT_BACKGROUND_KEY]
  );
}

async function fetchItemsWithOwnershipByKeys(userId, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return [];
  const placeholders = keys.map(() => '?').join(', ');
  const cosmeticRows = await dbAll(
    `
    SELECT
      ci.id,
      ci.key,
      ci.type,
      ci.name,
      ci.icon_emoji,
      COALESCE(ci.rarity, 'common') AS rarity,
      ci.season,
      ci.meta_json,
      CASE WHEN uc.id IS NOT NULL THEN 1 ELSE 0 END AS owned
    FROM cosmetic_items ci
    LEFT JOIN user_cosmetics uc
      ON uc.cosmetic_id = ci.id
     AND uc.user_id = ?
    WHERE ci.key IN (${placeholders})
    `,
    [userId, ...keys]
  );
  const backgroundRows = await dbAll(
    `
    SELECT
      pbi.id,
      pbi.key,
      'background' AS type,
      pbi.name,
      pbi.icon_emoji,
      COALESCE(pbi.rarity, 'common') AS rarity,
      pbi.season,
      pbi.meta_json,
      CASE WHEN upb.id IS NOT NULL THEN 1 ELSE 0 END AS owned
    FROM profile_background_items pbi
    LEFT JOIN user_profile_backgrounds upb
      ON upb.background_id = pbi.id
     AND upb.user_id = ?
    WHERE pbi.key IN (${placeholders})
      AND pbi.is_active = 1
    `,
    [userId, ...keys]
  );
  return [...cosmeticRows, ...backgroundRows];
}

router.get('/cosmetics/me', authRequired, async (req, res) => {
  const userId = req.user.id;

  try {
    await ensureDefaultProfileCosmetics(userId);
    const [ownedRows, profileRow] = await Promise.all([
      fetchOwnedCosmetics(userId),
      fetchProfileRow(userId),
    ]);

    const inventory = mapInventoryRows(ownedRows);
    const ownedTypeByKey = new Map(
      ownedRows.map((row) => [row.key, row.type]).filter((entry) => !!entry[0])
    );
    const parsedProfile = parseStoredProfileCosmetics(profileRow);
    const profile = sanitizeEquippedProfileCosmetics(parsedProfile, ownedTypeByKey, {
      fallbackDefaultBadge: !profileRow && ownedTypeByKey.has(DEFAULT_BADGE_KEY),
      fallbackDefaultBackground:
        !profileRow && ownedTypeByKey.has(DEFAULT_BACKGROUND_KEY),
    });

    return res.json({
      ok: true,
      message: '내 코스메틱 정보를 불러왔습니다.',
      inventory,
      profile,
    });
  } catch (error) {
    console.error('[cosmetics/me] failed:', error);
    return sendCosmeticsError(
      res,
      500,
      '코스메틱 정보를 불러오는 중 오류가 발생했습니다.'
    );
  }
});

router.put('/me/profile-cosmetics', authRequired, async (req, res) => {
  const userId = req.user.id;
  const parsed = parseProfileUpdatePayload(req.body || {});
  if (parsed.error) {
    return sendCosmeticsError(res, 400, parsed.error);
  }

  const requestedProfile = {
    primary_badge_key: parsed.primary_badge_key,
    profile_background_key: parsed.profile_background_key,
    showcase_badge_keys: parsed.showcase_badge_keys,
    header_stickers: parsed.header_stickers,
  };

  try {
    await ensureDefaultProfileCosmetics(userId);
    if (parsed.profile_background_key === undefined) {
      const existingProfile = parseStoredProfileCosmetics(await fetchProfileRow(userId));
      requestedProfile.profile_background_key = existingProfile.profile_background_key;
    }
    const allKeys = extractProfileCosmeticKeys(requestedProfile);
    const itemRows = await fetchItemsWithOwnershipByKeys(userId, allKeys);
    const itemByKey = makeKeyedCosmeticMap(itemRows);

    for (const key of allKeys) {
      const item = itemByKey.get(key);
      if (!item) {
        return sendCosmeticsError(
          res,
          404,
          `존재하지 않는 cosmetic_key 입니다: ${key}`
        );
      }
      if (Number(item.owned) !== 1) {
        return sendCosmeticsError(
          res,
          403,
          `소유하지 않은 코스메틱은 장착할 수 없습니다: ${key}`
        );
      }
    }

    if (requestedProfile.primary_badge_key) {
      const primaryItem = itemByKey.get(requestedProfile.primary_badge_key);
      if (!primaryItem || primaryItem.type !== 'badge') {
        return sendCosmeticsError(res, 400, 'primary_badge_key는 badge 타입이어야 합니다.');
      }
    }

    if (requestedProfile.profile_background_key) {
      const backgroundItem = itemByKey.get(requestedProfile.profile_background_key);
      if (!backgroundItem || backgroundItem.type !== 'background') {
        return sendCosmeticsError(
          res,
          400,
          'profile_background_key는 background 타입이어야 합니다.'
        );
      }
    }

    for (const key of requestedProfile.showcase_badge_keys) {
      const item = itemByKey.get(key);
      if (!item || item.type !== 'badge') {
        return sendCosmeticsError(
          res,
          400,
          'showcase_badge_keys에는 badge 타입만 설정할 수 있습니다.'
        );
      }
    }

    for (const sticker of requestedProfile.header_stickers) {
      const item = itemByKey.get(sticker.key);
      if (!item || item.type !== 'sticker') {
        return sendCosmeticsError(
          res,
          400,
          'header_stickers에는 sticker 타입만 설정할 수 있습니다.'
        );
      }
    }

    const serialized = serializeProfileCosmetics(requestedProfile);
    await dbRun(
      `
      INSERT INTO user_profile_cosmetics (
        user_id,
        primary_badge_key,
        profile_background_key,
        showcase_badge_keys_json,
        header_stickers_json,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        primary_badge_key = excluded.primary_badge_key,
        profile_background_key = excluded.profile_background_key,
        showcase_badge_keys_json = excluded.showcase_badge_keys_json,
        header_stickers_json = excluded.header_stickers_json,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        userId,
        requestedProfile.primary_badge_key,
        requestedProfile.profile_background_key,
        serialized.showcase_badge_keys_json,
        serialized.header_stickers_json,
      ]
    );

    return res.json({
      ok: true,
      message: '프로필 코스메틱이 업데이트되었습니다.',
      profile_cosmetics: buildExpandedProfileCosmetics(requestedProfile, itemByKey),
    });
  } catch (error) {
    console.error('[me/profile-cosmetics] failed:', error);
    return sendCosmeticsError(
      res,
      500,
      '프로필 코스메틱 업데이트 중 오류가 발생했습니다.'
    );
  }
});

module.exports = router;
