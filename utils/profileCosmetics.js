const DEFAULT_BADGE_KEY = 'badge_default_seedling';
const DEFAULT_BACKGROUND_KEY = 'background_default_paper';
const ALLOWED_PROFILE_STICKER_SLOTS = new Set(['tl', 'tr', 'br']);
const MAX_SHOWCASE_BADGES = 6;
const MAX_HEADER_STICKERS = 3;

function normalizeCosmeticKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeStickerSlot(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!ALLOWED_PROFILE_STICKER_SLOTS.has(trimmed)) return null;
  return trimmed;
}

function parseJsonArray(raw) {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function parseJsonObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function parseShowcaseBadgeKeys(rawValue) {
  const rawArray = Array.isArray(rawValue) ? rawValue : parseJsonArray(rawValue);
  const keys = [];
  const seen = new Set();

  for (const value of rawArray) {
    const key = normalizeCosmeticKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= MAX_SHOWCASE_BADGES) break;
  }

  return keys;
}

function parseHeaderStickers(rawValue) {
  const rawArray = Array.isArray(rawValue) ? rawValue : parseJsonArray(rawValue);
  const stickers = [];
  const usedSlots = new Set();

  for (const entry of rawArray) {
    if (!entry || typeof entry !== 'object') continue;
    const slot = normalizeStickerSlot(entry.slot);
    const key = normalizeCosmeticKey(entry.key);
    if (!slot || !key || usedSlots.has(slot)) continue;
    usedSlots.add(slot);
    stickers.push({ slot, key });
    if (stickers.length >= MAX_HEADER_STICKERS) break;
  }

  return stickers;
}

function parseStoredProfileCosmetics(row) {
  return {
    primary_badge_key: normalizeCosmeticKey(row?.primary_badge_key) || null,
    profile_background_key: normalizeCosmeticKey(row?.profile_background_key) || null,
    showcase_badge_keys: parseShowcaseBadgeKeys(row?.showcase_badge_keys_json),
    header_stickers: parseHeaderStickers(row?.header_stickers_json),
  };
}

function sanitizeEquippedProfileCosmetics(
  profile,
  ownedTypeByKey = new Map(),
  options = {}
) {
  const fallbackDefaultBadge = !!options.fallbackDefaultBadge;
  const fallbackDefaultBackground = !!options.fallbackDefaultBackground;
  let primaryBadgeKey = normalizeCosmeticKey(profile?.primary_badge_key);
  let profileBackgroundKey = normalizeCosmeticKey(profile?.profile_background_key);

  if (primaryBadgeKey && ownedTypeByKey.get(primaryBadgeKey) !== 'badge') {
    primaryBadgeKey = null;
  }
  if (profileBackgroundKey && ownedTypeByKey.get(profileBackgroundKey) !== 'background') {
    profileBackgroundKey = null;
  }

  if (
    !primaryBadgeKey &&
    fallbackDefaultBadge &&
    ownedTypeByKey.get(DEFAULT_BADGE_KEY) === 'badge'
  ) {
    primaryBadgeKey = DEFAULT_BADGE_KEY;
  }
  if (
    !profileBackgroundKey &&
    fallbackDefaultBackground &&
    ownedTypeByKey.get(DEFAULT_BACKGROUND_KEY) === 'background'
  ) {
    profileBackgroundKey = DEFAULT_BACKGROUND_KEY;
  }

  const showcaseBadges = [];
  const showcaseSeen = new Set();
  const rawShowcase = Array.isArray(profile?.showcase_badge_keys)
    ? profile.showcase_badge_keys
    : [];
  for (const value of rawShowcase) {
    const key = normalizeCosmeticKey(value);
    if (!key || showcaseSeen.has(key)) continue;
    if (ownedTypeByKey.get(key) !== 'badge') continue;
    showcaseSeen.add(key);
    showcaseBadges.push(key);
    if (showcaseBadges.length >= MAX_SHOWCASE_BADGES) break;
  }

  const headerStickers = [];
  const slotSeen = new Set();
  const rawStickers = Array.isArray(profile?.header_stickers)
    ? profile.header_stickers
    : [];
  for (const entry of rawStickers) {
    if (!entry || typeof entry !== 'object') continue;
    const slot = normalizeStickerSlot(entry.slot);
    const key = normalizeCosmeticKey(entry.key);
    if (!slot || !key || slotSeen.has(slot)) continue;
    if (ownedTypeByKey.get(key) !== 'sticker') continue;
    slotSeen.add(slot);
    headerStickers.push({ slot, key });
    if (headerStickers.length >= MAX_HEADER_STICKERS) break;
  }

  return {
    primary_badge_key: primaryBadgeKey,
    profile_background_key: profileBackgroundKey,
    showcase_badge_keys: showcaseBadges,
    header_stickers: headerStickers,
  };
}

function serializeProfileCosmetics(profile) {
  const showcase = Array.isArray(profile?.showcase_badge_keys)
    ? profile.showcase_badge_keys
    : [];
  const stickers = Array.isArray(profile?.header_stickers)
    ? profile.header_stickers
    : [];

  return {
    showcase_badge_keys_json: JSON.stringify(showcase),
    header_stickers_json: JSON.stringify(stickers),
    profile_background_key: normalizeCosmeticKey(profile?.profile_background_key) || null,
  };
}

function extractProfileCosmeticKeys(profile) {
  const unique = new Set();
  const primary = normalizeCosmeticKey(profile?.primary_badge_key);
  if (primary) unique.add(primary);
  const background = normalizeCosmeticKey(profile?.profile_background_key);
  if (background) unique.add(background);

  const showcase = Array.isArray(profile?.showcase_badge_keys)
    ? profile.showcase_badge_keys
    : [];
  for (const key of showcase) {
    const normalized = normalizeCosmeticKey(key);
    if (normalized) unique.add(normalized);
  }

  const stickers = Array.isArray(profile?.header_stickers)
    ? profile.header_stickers
    : [];
  for (const entry of stickers) {
    const normalized = normalizeCosmeticKey(entry?.key);
    if (normalized) unique.add(normalized);
  }

  return Array.from(unique);
}

function mapCosmeticItem(row) {
  return {
    key: row.key,
    type: row.type || null,
    name: row.name,
    icon_emoji: row.icon_emoji || null,
    rarity: row.rarity || 'common',
    season: row.season || null,
    meta: parseJsonObject(row.meta_json),
  };
}

function makeKeyedCosmeticMap(rows = []) {
  const itemByKey = new Map();
  for (const row of rows) {
    if (!row?.key) continue;
    if (!itemByKey.has(row.key)) {
      itemByKey.set(row.key, row);
    }
  }
  return itemByKey;
}

function buildExpandedProfileCosmetics(profile, itemByKey = new Map()) {
  const primaryRow = profile?.primary_badge_key
    ? itemByKey.get(profile.primary_badge_key)
    : null;
  const backgroundRow = profile?.profile_background_key
    ? itemByKey.get(profile.profile_background_key)
    : null;

  const showcaseRows = [];
  const showcase = Array.isArray(profile?.showcase_badge_keys)
    ? profile.showcase_badge_keys
    : [];
  for (const key of showcase) {
    const row = itemByKey.get(key);
    if (row && row.type === 'badge') {
      showcaseRows.push(mapCosmeticItem(row));
    }
  }

  const stickerRows = [];
  const stickers = Array.isArray(profile?.header_stickers)
    ? profile.header_stickers
    : [];
  for (const entry of stickers) {
    const row = itemByKey.get(entry?.key);
    if (!row || row.type !== 'sticker') continue;
    const slot = normalizeStickerSlot(entry.slot);
    if (!slot) continue;
    stickerRows.push({
      slot,
      sticker: mapCosmeticItem(row),
    });
  }

  return {
    primary_badge:
      primaryRow && primaryRow.type === 'badge' ? mapCosmeticItem(primaryRow) : null,
    profile_background:
      backgroundRow && backgroundRow.type === 'background' ? mapCosmeticItem(backgroundRow) : null,
    showcase_badges: showcaseRows,
    header_stickers: stickerRows,
  };
}

module.exports = {
  DEFAULT_BADGE_KEY,
  DEFAULT_BACKGROUND_KEY,
  ALLOWED_PROFILE_STICKER_SLOTS,
  MAX_SHOWCASE_BADGES,
  MAX_HEADER_STICKERS,
  normalizeCosmeticKey,
  parseShowcaseBadgeKeys,
  parseHeaderStickers,
  parseStoredProfileCosmetics,
  sanitizeEquippedProfileCosmetics,
  serializeProfileCosmetics,
  extractProfileCosmeticKeys,
  mapCosmeticItem,
  makeKeyedCosmeticMap,
  buildExpandedProfileCosmetics,
};
