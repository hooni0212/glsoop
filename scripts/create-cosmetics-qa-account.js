const path = require('path');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const DEFAULT_EMAIL = 'cosmetics_qa@glsoop.test';
const DEFAULT_NAME = '코스메틱 QA';
const DEFAULT_NICKNAME = 'cosmetics_qa';

const SHOWCASE_BADGE_PRIORITY = [
  'badge_first_post',
  'badge_posts_10',
  'badge_posts_50',
  'badge_first_like',
  'badge_loved_post',
  'badge_streak_30',
];
const PRIMARY_BADGE_PRIORITY = ['badge_streak_30', 'badge_spring_2026', 'badge_default_seedling'];
const BACKGROUND_PRIORITY = [
  'background_deep_forest',
  'background_writer_grove',
  'background_default_paper',
];
const STICKER_PRIORITY = ['sticker_leaf', 'sticker_star', 'sticker_moon'];
const STICKER_SLOTS = ['tl', 'tr', 'br'];

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const eqIndex = token.indexOf('=');
    if (eqIndex >= 0) {
      parsed[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    i += 1;
  }

  return parsed;
}

function printUsage() {
  console.log(
    [
      'Usage:',
      '  node scripts/create-cosmetics-qa-account.js --db data/dev.sqlite --password "StrongPass123!" [--email cosmetics_qa@glsoop.test] [--name "코스메틱 QA"] [--nickname cosmetics_qa] [--reset-profile]',
      '',
      'Notes:',
      '  - --db is required. DB_PATH fallback is intentionally not supported.',
      '  - Existing users with the same email are updated in-place.',
      '  - All active badge, sticker, and profile background cosmetics are granted with INSERT OR IGNORE.',
      '  - --reset-profile equips a deterministic QA profile using owned v1 cosmetics.',
    ].join('\n')
  );
}

function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (error) => {
      if (error) reject(error);
      else resolve(db);
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows || []);
    });
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function getTableColumns(db, tableName) {
  const rows = await dbAll(db, `PRAGMA table_info(${tableName})`);
  return new Set(rows.map((row) => row.name));
}

async function assertRequiredSchema(db) {
  const requiredTables = [
    'users',
    'cosmetic_items',
    'user_cosmetics',
    'profile_background_items',
    'user_profile_backgrounds',
    'user_profile_cosmetics',
  ];

  for (const tableName of requiredTables) {
    const row = await dbGet(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName]
    );
    if (!row) {
      throw new Error(`Missing required table: ${tableName}. Run migrations first.`);
    }
  }

  const userColumns = await getTableColumns(db, 'users');
  if (!userColumns.has('email') || !userColumns.has('pw')) {
    throw new Error('users table is missing required auth columns: email, pw.');
  }

  const profileColumns = await getTableColumns(db, 'user_profile_cosmetics');
  if (!profileColumns.has('profile_background_key')) {
    throw new Error(
      'user_profile_cosmetics.profile_background_key is missing. Run migration 0029 first.'
    );
  }
}

function normalizeRequiredText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function pickFirstAvailable(keys, rows) {
  const available = new Set(rows.map((row) => row.key));
  return keys.find((key) => available.has(key)) || rows[0]?.key || null;
}

function pickUniqueKeys(priorityKeys, rows, limit) {
  const available = new Map(rows.map((row) => [row.key, row]));
  const picked = [];

  for (const key of priorityKeys) {
    if (available.has(key) && !picked.includes(key)) picked.push(key);
    if (picked.length >= limit) return picked;
  }

  for (const row of rows) {
    if (!picked.includes(row.key)) picked.push(row.key);
    if (picked.length >= limit) return picked;
  }

  return picked;
}

async function createOrUpdateQaAccount({ db, email, password, name, nickname }) {
  const columns = await getTableColumns(db, 'users');
  const passwordHash = await bcrypt.hash(password, 10);
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await dbGet(db, 'SELECT id FROM users WHERE email = ?', [normalizedEmail]);
  const now = new Date().toISOString();

  const insertValues = {
    name,
    nickname,
    email: normalizedEmail,
    pw: passwordHash,
    is_admin: 0,
    is_verified: 1,
    verification_token: null,
    verification_expires: null,
    reset_token: null,
    reset_expires: null,
    level: 8,
    xp: 1635,
    streak_days: 1,
    max_streak_days: 7,
    remember_login_enabled: 0,
    marketing_email_opt_in: 0,
    marketing_opt_in_updated_at: now,
    account_status: 'active',
    deactivated_at: null,
    scheduled_purge_at: null,
  };

  if (!existing) {
    const entries = Object.entries(insertValues).filter(([key]) => columns.has(key));
    const result = await dbRun(
      db,
      `
      INSERT INTO users (${entries.map(([key]) => key).join(', ')})
      VALUES (${entries.map(() => '?').join(', ')})
      `,
      entries.map(([, value]) => value)
    );
    return { action: 'created', userId: result.lastID };
  }

  const updateValues = {
    name,
    nickname,
    pw: passwordHash,
    is_admin: 0,
    is_verified: 1,
    verification_token: null,
    verification_expires: null,
    reset_token: null,
    reset_expires: null,
    remember_login_enabled: 0,
    account_status: 'active',
    deactivated_at: null,
    scheduled_purge_at: null,
  };
  const entries = Object.entries(updateValues).filter(([key]) => columns.has(key));
  await dbRun(
    db,
    `
    UPDATE users
    SET ${entries.map(([key]) => `${key} = ?`).join(', ')}
    WHERE id = ?
    `,
    [...entries.map(([, value]) => value), existing.id]
  );
  return { action: 'updated', userId: existing.id };
}

async function fetchActiveCatalog(db) {
  const cosmeticRows = await dbAll(
    db,
    `
    SELECT id, key, type, name, COALESCE(rarity, 'common') AS rarity, season
    FROM cosmetic_items
    WHERE COALESCE(is_active, 1) = 1
    ORDER BY
      CASE type WHEN 'badge' THEN 0 WHEN 'sticker' THEN 1 ELSE 2 END,
      id ASC
    `
  );
  const backgroundRows = await dbAll(
    db,
    `
    SELECT id, key, 'background' AS type, name, COALESCE(rarity, 'common') AS rarity, season
    FROM profile_background_items
    WHERE COALESCE(is_active, 1) = 1
    ORDER BY id ASC
    `
  );
  return {
    badges: cosmeticRows.filter((row) => row.type === 'badge'),
    stickers: cosmeticRows.filter((row) => row.type === 'sticker'),
    backgrounds: backgroundRows,
  };
}

async function grantAllActiveCosmetics(db, userId) {
  await dbRun(
    db,
    `
    INSERT OR IGNORE INTO user_cosmetics (user_id, cosmetic_id, source)
    SELECT ?, id, 'qa_seed'
    FROM cosmetic_items
    WHERE COALESCE(is_active, 1) = 1
    `,
    [userId]
  );
  await dbRun(
    db,
    `
    INSERT OR IGNORE INTO user_profile_backgrounds (user_id, background_id, source)
    SELECT ?, id, 'qa_seed'
    FROM profile_background_items
    WHERE COALESCE(is_active, 1) = 1
    `,
    [userId]
  );

  const [badges, stickers, backgrounds] = await Promise.all([
    dbGet(
      db,
      `
      SELECT COUNT(*) AS count
      FROM user_cosmetics uc
      JOIN cosmetic_items ci ON ci.id = uc.cosmetic_id
      WHERE uc.user_id = ? AND ci.type = 'badge' AND COALESCE(ci.is_active, 1) = 1
      `,
      [userId]
    ),
    dbGet(
      db,
      `
      SELECT COUNT(*) AS count
      FROM user_cosmetics uc
      JOIN cosmetic_items ci ON ci.id = uc.cosmetic_id
      WHERE uc.user_id = ? AND ci.type = 'sticker' AND COALESCE(ci.is_active, 1) = 1
      `,
      [userId]
    ),
    dbGet(
      db,
      `
      SELECT COUNT(*) AS count
      FROM user_profile_backgrounds upb
      JOIN profile_background_items pbi ON pbi.id = upb.background_id
      WHERE upb.user_id = ? AND COALESCE(pbi.is_active, 1) = 1
      `,
      [userId]
    ),
  ]);

  return {
    badges: Number(badges?.count || 0),
    stickers: Number(stickers?.count || 0),
    backgrounds: Number(backgrounds?.count || 0),
  };
}

async function resetProfileCosmetics(db, userId, catalog) {
  const primaryBadgeKey = pickFirstAvailable(PRIMARY_BADGE_PRIORITY, catalog.badges);
  const profileBackgroundKey = pickFirstAvailable(BACKGROUND_PRIORITY, catalog.backgrounds);
  const showcaseBadgeKeys = pickUniqueKeys(SHOWCASE_BADGE_PRIORITY, catalog.badges, 6);
  const stickerKeys = pickUniqueKeys(STICKER_PRIORITY, catalog.stickers, 3);
  const headerStickers = stickerKeys.map((key, index) => ({
    slot: STICKER_SLOTS[index],
    key,
  }));

  if (!primaryBadgeKey || !profileBackgroundKey) {
    throw new Error('Cannot reset profile without at least one active badge and background.');
  }

  await dbRun(
    db,
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
      primaryBadgeKey,
      profileBackgroundKey,
      JSON.stringify(showcaseBadgeKeys),
      JSON.stringify(headerStickers),
    ]
  );

  return {
    primary_badge_key: primaryBadgeKey,
    profile_background_key: profileBackgroundKey,
    showcase_badge_keys: showcaseBadgeKeys,
    header_stickers: headerStickers,
  };
}

async function createCosmeticsQaAccount({
  db,
  email,
  password,
  name,
  nickname,
  resetProfile,
}) {
  await assertRequiredSchema(db);
  const account = await createOrUpdateQaAccount({
    db,
    email,
    password,
    name,
    nickname,
  });
  const catalog = await fetchActiveCatalog(db);
  const granted = await grantAllActiveCosmetics(db, account.userId);
  const profile = resetProfile
    ? await resetProfileCosmetics(db, account.userId, catalog)
    : null;

  return {
    ok: true,
    action: account.action,
    user_id: account.userId,
    email: email.trim().toLowerCase(),
    nickname,
    catalog: {
      badges: catalog.badges.length,
      stickers: catalog.stickers.length,
      backgrounds: catalog.backgrounds.length,
    },
    granted,
    profile,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (!args.db || typeof args.db !== 'string') {
    console.error('--db is required.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  const password = typeof args.password === 'string' ? args.password : '';
  if (!password) {
    console.error('--password is required.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  const dbPath = path.resolve(process.cwd(), args.db);
  const email = normalizeRequiredText(args.email, DEFAULT_EMAIL);
  const name = normalizeRequiredText(args.name, DEFAULT_NAME);
  const nickname = normalizeRequiredText(args.nickname, DEFAULT_NICKNAME);
  const resetProfile = args['reset-profile'] === true || args.resetProfile === true;

  let db;
  try {
    db = await openDb(dbPath);
    const result = await createCosmeticsQaAccount({
      db,
      email,
      password,
      name,
      nickname,
      resetProfile,
    });

    console.log(
      JSON.stringify(
        {
          ...result,
          db_path: dbPath,
        },
        null,
        2
      )
    );
  } finally {
    if (db) await closeDb(db);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[create-cosmetics-qa-account] failed:', error.message || error);
    process.exit(1);
  });
}

module.exports = {
  createCosmeticsQaAccount,
  parseArgs,
};
