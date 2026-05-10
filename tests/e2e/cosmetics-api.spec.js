const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';
const AUTH_HEADER_NOW = '2026-03-01T00:00:00+09:00';

const ADMIN_ID = 9801;
const USER_A_ID = 9802;
const USER_B_ID = 9803;

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });

const dbGet = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const signAuthToken = ({
  id,
  name,
  nickname,
  email,
  isAdmin = false,
  isVerified = true,
}) =>
  jwt.sign(
    {
      id,
      name,
      nickname,
      email,
      isAdmin,
      isVerified,
    },
    E2E_JWT_SECRET,
    {
      algorithm: E2E_JWT_ALGORITHM,
      issuer: E2E_JWT_ISSUER,
      audience: E2E_JWT_AUDIENCE,
      expiresIn: '1h',
    }
  );

const buildAuthHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'x-auth-legacy-now': AUTH_HEADER_NOW,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function grantCosmetic(request, adminToken, userId, cosmeticKey) {
  let lastResponse = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lastResponse = await request.post('/api/admin/cosmetics/grant', {
      headers: buildAuthHeaders(adminToken),
      data: {
        user_id: userId,
        cosmetic_key: cosmeticKey,
      },
    });
    if (lastResponse.status() === 200) {
      return lastResponse;
    }
    await sleep(80 * (attempt + 1));
  }
  return lastResponse;
}

const seedCosmeticFixtures = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [ADMIN_ID, 'Admin Cosmetic', 'admin_cosmetic', 'admin-cosmetic@glsoop.test', 'password', 1, 1]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [USER_A_ID, 'Writer Cosmetic A', 'writer_cosmetic_a', 'writer-cosmetic-a@glsoop.test', 'password', 0, 1]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [USER_B_ID, 'Writer Cosmetic B', 'writer_cosmetic_b', 'writer-cosmetic-b@glsoop.test', 'password', 0, 1]
  );

  await dbRun(
    db,
    'DELETE FROM user_profile_cosmetics WHERE user_id IN (?, ?, ?)',
    [ADMIN_ID, USER_A_ID, USER_B_ID]
  );
  await dbRun(
    db,
    'DELETE FROM user_profile_backgrounds WHERE user_id IN (?, ?, ?)',
    [ADMIN_ID, USER_A_ID, USER_B_ID]
  );
  await dbRun(
    db,
    'DELETE FROM user_cosmetics WHERE user_id IN (?, ?, ?)',
    [ADMIN_ID, USER_A_ID, USER_B_ID]
  );

  await dbRun(
    db,
    `INSERT OR IGNORE INTO user_cosmetics (user_id, cosmetic_id, source)
     SELECT ?, ci.id, 'default'
     FROM cosmetic_items ci
     WHERE ci.key = 'badge_default_seedling'`,
    [USER_A_ID]
  );

  await dbRun(
    db,
    `INSERT OR IGNORE INTO user_cosmetics (user_id, cosmetic_id, source)
     SELECT ?, ci.id, 'default'
     FROM cosmetic_items ci
     WHERE ci.key = 'badge_default_seedling'`,
    [USER_B_ID]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO user_profile_cosmetics
      (user_id, primary_badge_key, profile_background_key, showcase_badge_keys_json, header_stickers_json)
     VALUES (?, 'badge_default_seedling', 'background_default_paper', '[]', '[]')`,
    [USER_A_ID]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO user_profile_cosmetics
      (user_id, primary_badge_key, profile_background_key, showcase_badge_keys_json, header_stickers_json)
     VALUES (?, 'badge_default_seedling', 'background_default_paper', '[]', '[]')`,
    [USER_B_ID]
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

test.describe('Cosmetics API', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedCosmeticFixtures();
  });

  test('admin grants sticker and user inventory includes the item', async ({ request }) => {
    const adminToken = signAuthToken({
      id: ADMIN_ID,
      name: 'Admin Cosmetic',
      nickname: 'admin_cosmetic',
      email: 'admin-cosmetic@glsoop.test',
      isAdmin: true,
    });
    const userAToken = signAuthToken({
      id: USER_A_ID,
      name: 'Writer Cosmetic A',
      nickname: 'writer_cosmetic_a',
      email: 'writer-cosmetic-a@glsoop.test',
    });

    const grantResponse = await grantCosmetic(request, adminToken, USER_A_ID, 'sticker_star');

    expect(grantResponse.status()).toBe(200);
    const grantPayload = await grantResponse.json();
    expect(grantPayload.ok).toBe(true);
    expect(grantPayload.granted).toMatchObject({
      user_id: USER_A_ID,
      cosmetic: {
        key: 'sticker_star',
        type: 'sticker',
      },
    });

    const meResponse = await request.get('/api/cosmetics/me', {
      headers: {
        ...buildAuthHeaders(userAToken),
      },
    });
    expect(meResponse.status()).toBe(200);
    const mePayload = await meResponse.json();
    expect(mePayload.ok).toBe(true);
    expect(mePayload.inventory.stickers).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'sticker_star' })])
    );
    expect(mePayload.inventory.backgrounds).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'background_default_paper' })])
    );
  });

  test('owned items can be equipped and are exposed on public profile', async ({
    request,
  }) => {
    const adminToken = signAuthToken({
      id: ADMIN_ID,
      name: 'Admin Cosmetic',
      nickname: 'admin_cosmetic',
      email: 'admin-cosmetic@glsoop.test',
      isAdmin: true,
    });
    const userAToken = signAuthToken({
      id: USER_A_ID,
      name: 'Writer Cosmetic A',
      nickname: 'writer_cosmetic_a',
      email: 'writer-cosmetic-a@glsoop.test',
    });
    const userBToken = signAuthToken({
      id: USER_B_ID,
      name: 'Writer Cosmetic B',
      nickname: 'writer_cosmetic_b',
      email: 'writer-cosmetic-b@glsoop.test',
    });

    expect((await grantCosmetic(request, adminToken, USER_A_ID, 'badge_spring_2026')).status()).toBe(200);
    expect((await grantCosmetic(request, adminToken, USER_A_ID, 'sticker_star')).status()).toBe(200);
    expect((await grantCosmetic(request, adminToken, USER_A_ID, 'background_writer_grove')).status()).toBe(200);

    const putResponse = await request.put('/api/me/profile-cosmetics', {
      headers: {
        ...buildAuthHeaders(userAToken),
      },
      data: {
        primary_badge_key: 'badge_spring_2026',
        profile_background_key: 'background_writer_grove',
        showcase_badge_keys: ['badge_default_seedling'],
        header_stickers: [{ slot: 'tr', key: 'sticker_star' }],
      },
    });
    expect(putResponse.status()).toBe(200);
    const putPayload = await putResponse.json();
    expect(putPayload.ok).toBe(true);
    expect(putPayload.profile_cosmetics.primary_badge).toMatchObject({
      key: 'badge_spring_2026',
    });
    expect(putPayload.profile_cosmetics.profile_background).toMatchObject({
      key: 'background_writer_grove',
    });

    const profileResponse = await request.get(`/api/users/${USER_A_ID}/profile`, {
      headers: {
        ...buildAuthHeaders(userBToken),
      },
    });
    expect(profileResponse.status()).toBe(200);
    const profilePayload = await profileResponse.json();
    expect(profilePayload.ok).toBe(true);
    expect(profilePayload.user.profile_cosmetics).toMatchObject({
      primary_badge: expect.objectContaining({ key: 'badge_spring_2026' }),
      profile_background: expect.objectContaining({ key: 'background_writer_grove' }),
      showcase_badges: expect.arrayContaining([
        expect.objectContaining({ key: 'badge_default_seedling' }),
      ]),
      header_stickers: expect.arrayContaining([
        expect.objectContaining({
          slot: 'tr',
          sticker: expect.objectContaining({ key: 'sticker_star' }),
        }),
      ]),
    });
  });

  test('cleared primary badge persists after cosmetics refresh and public profile fetch', async ({
    request,
  }) => {
    const userAToken = signAuthToken({
      id: USER_A_ID,
      name: 'Writer Cosmetic A',
      nickname: 'writer_cosmetic_a',
      email: 'writer-cosmetic-a@glsoop.test',
    });
    const userBToken = signAuthToken({
      id: USER_B_ID,
      name: 'Writer Cosmetic B',
      nickname: 'writer_cosmetic_b',
      email: 'writer-cosmetic-b@glsoop.test',
    });

    const clearResponse = await request.put('/api/me/profile-cosmetics', {
      headers: {
        ...buildAuthHeaders(userAToken),
      },
      data: {
        primary_badge_key: null,
        profile_background_key: 'background_writer_grove',
        showcase_badge_keys: ['badge_default_seedling'],
        header_stickers: [{ slot: 'tr', key: 'sticker_star' }],
      },
    });
    expect(clearResponse.status()).toBe(200);
    const clearPayload = await clearResponse.json();
    expect(clearPayload.ok).toBe(true);
    expect(clearPayload.profile_cosmetics.primary_badge).toBeNull();

    const meResponse = await request.get('/api/cosmetics/me', {
      headers: {
        ...buildAuthHeaders(userAToken),
      },
    });
    expect(meResponse.status()).toBe(200);
    const mePayload = await meResponse.json();
    expect(mePayload.ok).toBe(true);
    expect(mePayload.profile.primary_badge_key).toBeNull();

    const secondMeResponse = await request.get('/api/cosmetics/me', {
      headers: {
        ...buildAuthHeaders(userAToken),
      },
    });
    expect(secondMeResponse.status()).toBe(200);
    const secondMePayload = await secondMeResponse.json();
    expect(secondMePayload.profile.primary_badge_key).toBeNull();

    const profileResponse = await request.get(`/api/users/${USER_A_ID}/profile`, {
      headers: {
        ...buildAuthHeaders(userBToken),
      },
    });
    expect(profileResponse.status()).toBe(200);
    const profilePayload = await profileResponse.json();
    expect(profilePayload.ok).toBe(true);
    expect(profilePayload.user.profile_cosmetics.primary_badge).toBeNull();
  });

  test('returns 403 when user tries to equip unowned cosmetic', async ({ request }) => {
    const db = new sqlite3.Database(DB_PATH);
    await dbRun(
      db,
      `DELETE FROM user_cosmetics
       WHERE user_id = ?
         AND cosmetic_id IN (SELECT id FROM cosmetic_items WHERE key = 'badge_winter_2026')`,
      [USER_A_ID]
    );
    await new Promise((resolve) => db.close(resolve));

    const userAToken = signAuthToken({
      id: USER_A_ID,
      name: 'Writer Cosmetic A',
      nickname: 'writer_cosmetic_a',
      email: 'writer-cosmetic-a@glsoop.test',
    });

    const response = await request.put('/api/me/profile-cosmetics', {
      headers: {
        ...buildAuthHeaders(userAToken),
      },
      data: {
        primary_badge_key: 'badge_winter_2026',
        profile_background_key: 'background_default_paper',
        showcase_badge_keys: [],
        header_stickers: [],
      },
    });

    expect(response.status()).toBe(403);
    const payload = await response.json();
    expect(payload.ok).toBe(false);
  });

  test('public profile does not expose unowned equipped cosmetics', async ({
    request,
  }) => {
    const db = new sqlite3.Database(DB_PATH);
    await dbRun(
      db,
      `DELETE FROM user_cosmetics
       WHERE user_id = ?
         AND cosmetic_id IN (
           SELECT id
           FROM cosmetic_items
           WHERE key IN ('badge_winter_2026', 'sticker_leaf')
         )`,
      [USER_A_ID]
    );
    await dbRun(
      db,
      `INSERT OR REPLACE INTO user_profile_cosmetics
       (user_id, primary_badge_key, profile_background_key, showcase_badge_keys_json, header_stickers_json)
       VALUES (?, ?, ?, ?, ?)`,
      [
        USER_A_ID,
        'badge_winter_2026',
        'background_default_paper',
        JSON.stringify(['badge_winter_2026', 'badge_default_seedling']),
        JSON.stringify([
          { slot: 'tl', key: 'sticker_leaf' },
          { slot: 'tr', key: 'sticker_star' },
        ]),
      ]
    );
    await new Promise((resolve) => db.close(resolve));

    const response = await request.get(`/api/users/${USER_A_ID}/profile`);
    expect(response.status()).toBe(200);
    const payload = await response.json();
    const cosmetics = payload.user.profile_cosmetics;

    expect(cosmetics.primary_badge).toBeNull();
    expect(cosmetics.showcase_badges.some((item) => item.key === 'badge_winter_2026')).toBe(
      false
    );
    expect(cosmetics.showcase_badges).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'badge_default_seedling' })])
    );
    expect(cosmetics.header_stickers.some((item) => item.sticker.key === 'sticker_leaf')).toBe(
      false
    );
  });

  test('new signup receives default badge ownership and equipped profile', async ({
    request,
  }) => {
    const db = new sqlite3.Database(DB_PATH);
    const otpCode = '246810';
    const otpHash = await bcrypt.hash(otpCode, 10);
    const pendingEmail = `pending-cosmetics-${Date.now()}@glsoop.test`;

    const pendingInsert = await dbRun(
      db,
      `INSERT INTO pending_signups
        (name, nickname, email, pw_hash, age_confirmed, terms_version, privacy_version, expires_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, datetime('now', '+1 day'))`,
      [
        'Pending Cosmetic',
        'pending_cosmetic',
        pendingEmail,
        'hashed_pw',
        '2026-02-27.terms.v1',
        '2026-02-27.privacy.v1',
      ]
    );
    const pendingId = pendingInsert.lastID;

    await dbRun(
      db,
      `INSERT INTO pending_otp_verifications (pending_id, code_hash, expires_at, attempts)
       VALUES (?, ?, datetime('now', '+10 minutes'), 0)`,
      [pendingId, otpHash]
    );
    await new Promise((resolve) => db.close(resolve));

    const verifyResponse = await request.post('/api/verify-email', {
      data: {
        pending_id: pendingId,
        verification_code: otpCode,
      },
    });

    expect(verifyResponse.status()).toBe(200);
    const verifyPayload = await verifyResponse.json();
    expect(verifyPayload.ok).toBe(true);

    const checkDb = new sqlite3.Database(DB_PATH);
    const userId = verifyPayload.user_id;
    const ownedDefault = await dbGet(
      checkDb,
      `SELECT COUNT(*) AS count
       FROM user_cosmetics uc
       JOIN cosmetic_items ci ON ci.id = uc.cosmetic_id
       WHERE uc.user_id = ? AND ci.key = 'badge_default_seedling'`,
      [userId]
    );
    const ownedDefaultBackground = await dbGet(
      checkDb,
      `SELECT COUNT(*) AS count
       FROM user_profile_backgrounds upb
       JOIN profile_background_items pbi ON pbi.id = upb.background_id
       WHERE upb.user_id = ? AND pbi.key = 'background_default_paper'`,
      [userId]
    );
    const profileRow = await dbGet(
      checkDb,
      `SELECT primary_badge_key, profile_background_key, showcase_badge_keys_json, header_stickers_json
       FROM user_profile_cosmetics
       WHERE user_id = ?`,
      [userId]
    );
    await new Promise((resolve) => checkDb.close(resolve));

    expect(ownedDefault.count).toBe(1);
    expect(ownedDefaultBackground.count).toBe(1);
    expect(profileRow).toMatchObject({
      primary_badge_key: 'badge_default_seedling',
      profile_background_key: 'background_default_paper',
      showcase_badge_keys_json: '[]',
      header_stickers_json: '[]',
    });
  });
});
