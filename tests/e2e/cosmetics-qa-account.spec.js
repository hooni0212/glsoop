const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';
const AUTH_HEADER_NOW = '2026-03-01T00:00:00+09:00';

const QA_EMAIL = 'cosmetics_qa@glsoop.test';
const QA_PASSWORD = 'CosmeticsQaPass123!';
const QA_NICKNAME = 'cosmetics_qa';

const V1_BADGE_KEYS = [
  'badge_default_seedling',
  'badge_spring_2026',
  'badge_winter_2026',
  'badge_summer_2026',
  'badge_autumn_2026',
  'badge_first_post',
  'badge_posts_10',
  'badge_posts_50',
  'badge_first_like',
  'badge_loved_post',
  'badge_streak_3',
  'badge_streak_7',
  'badge_streak_30',
  'badge_first_bookmark',
];
const V1_STICKER_KEYS = ['sticker_leaf', 'sticker_star', 'sticker_moon'];
const V1_BACKGROUND_KEYS = [
  'background_default_paper',
  'background_writer_grove',
  'background_deep_forest',
  'background_prompt_letters',
];

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

let qaAccount = null;

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const dbAll = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });

const signAuthToken = ({ id, name, nickname, email }) =>
  jwt.sign(
    {
      id,
      name,
      nickname,
      email,
      isAdmin: false,
      isVerified: true,
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

async function fetchActiveCatalogKeys() {
  const db = new sqlite3.Database(DB_PATH);
  const cosmeticRows = await dbAll(
    db,
    `
    SELECT key, type
    FROM cosmetic_items
    WHERE COALESCE(is_active, 1) = 1
    ORDER BY id ASC
    `
  );
  const backgroundRows = await dbAll(
    db,
    `
    SELECT key, 'background' AS type
    FROM profile_background_items
    WHERE COALESCE(is_active, 1) = 1
    ORDER BY id ASC
    `
  );
  await new Promise((resolve) => db.close(resolve));
  return {
    badges: cosmeticRows.filter((row) => row.type === 'badge').map((row) => row.key),
    stickers: cosmeticRows.filter((row) => row.type === 'sticker').map((row) => row.key),
    backgrounds: backgroundRows.map((row) => row.key),
  };
}

test.describe('Cosmetics QA account', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    await waitForFile(DB_PATH, 20000);

    const scriptPath = path.join(REPO_ROOT, 'scripts/create-cosmetics-qa-account.js');
    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        '--db',
        DB_PATH,
        '--email',
        QA_EMAIL,
        '--password',
        QA_PASSWORD,
        '--name',
        'Cosmetics QA',
        '--nickname',
        QA_NICKNAME,
        '--reset-profile',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    qaAccount = JSON.parse(output);
  });

  test('script grants the full v1 cosmetics catalog to the QA account', async ({ request }) => {
    expect(qaAccount).toMatchObject({
      ok: true,
      email: QA_EMAIL,
      nickname: QA_NICKNAME,
      catalog: {
        badges: V1_BADGE_KEYS.length,
        stickers: V1_STICKER_KEYS.length,
        backgrounds: V1_BACKGROUND_KEYS.length,
      },
      granted: {
        badges: V1_BADGE_KEYS.length,
        stickers: V1_STICKER_KEYS.length,
        backgrounds: V1_BACKGROUND_KEYS.length,
      },
    });

    const activeCatalog = await fetchActiveCatalogKeys();
    expect(activeCatalog.badges).toEqual(expect.arrayContaining(V1_BADGE_KEYS));
    expect(activeCatalog.stickers).toEqual(expect.arrayContaining(V1_STICKER_KEYS));
    expect(activeCatalog.backgrounds).toEqual(expect.arrayContaining(V1_BACKGROUND_KEYS));

    const qaToken = signAuthToken({
      id: qaAccount.user_id,
      name: 'Cosmetics QA',
      nickname: QA_NICKNAME,
      email: QA_EMAIL,
    });
    const response = await request.get('/api/cosmetics/me', {
      headers: buildAuthHeaders(qaToken),
    });
    expect(response.status()).toBe(200);

    const payload = await response.json();
    const badgeKeys = payload.inventory.badges.map((item) => item.key);
    const stickerKeys = payload.inventory.stickers.map((item) => item.key);
    const backgroundKeys = payload.inventory.backgrounds.map((item) => item.key);

    expect(badgeKeys).toEqual(expect.arrayContaining(V1_BADGE_KEYS));
    expect(stickerKeys).toEqual(expect.arrayContaining(V1_STICKER_KEYS));
    expect(backgroundKeys).toEqual(expect.arrayContaining(V1_BACKGROUND_KEYS));
    expect(payload.profile).toMatchObject({
      primary_badge_key: 'badge_streak_30',
      profile_background_key: 'background_deep_forest',
      showcase_badge_keys: [
        'badge_first_post',
        'badge_posts_10',
        'badge_posts_50',
        'badge_first_like',
        'badge_loved_post',
        'badge_streak_30',
      ],
      header_stickers: [
        { slot: 'tl', key: 'sticker_leaf' },
        { slot: 'tr', key: 'sticker_star' },
        { slot: 'br', key: 'sticker_moon' },
      ],
    });
  });

  test('QA account can save a complete cosmetics profile and expose it publicly', async ({
    request,
  }) => {
    const qaToken = signAuthToken({
      id: qaAccount.user_id,
      name: 'Cosmetics QA',
      nickname: QA_NICKNAME,
      email: QA_EMAIL,
    });
    const expectedProfile = {
      primary_badge_key: 'badge_loved_post',
      profile_background_key: 'background_prompt_letters',
      showcase_badge_keys: [
        'badge_first_post',
        'badge_posts_10',
        'badge_posts_50',
        'badge_streak_3',
        'badge_streak_7',
        'badge_streak_30',
      ],
      header_stickers: [
        { slot: 'tl', key: 'sticker_leaf' },
        { slot: 'tr', key: 'sticker_star' },
        { slot: 'br', key: 'sticker_moon' },
      ],
    };

    const putResponse = await request.put('/api/me/profile-cosmetics', {
      headers: buildAuthHeaders(qaToken),
      data: expectedProfile,
    });
    expect(putResponse.status()).toBe(200);
    const putPayload = await putResponse.json();
    expect(putPayload.ok).toBe(true);
    expect(putPayload.profile_cosmetics).toMatchObject({
      primary_badge: expect.objectContaining({ key: expectedProfile.primary_badge_key }),
      profile_background: expect.objectContaining({
        key: expectedProfile.profile_background_key,
      }),
      showcase_badges: expect.arrayContaining(
        expectedProfile.showcase_badge_keys.map((key) => expect.objectContaining({ key }))
      ),
      header_stickers: expect.arrayContaining(
        expectedProfile.header_stickers.map((entry) =>
          expect.objectContaining({
            slot: entry.slot,
            sticker: expect.objectContaining({ key: entry.key }),
          })
        )
      ),
    });

    const meResponse = await request.get('/api/cosmetics/me', {
      headers: buildAuthHeaders(qaToken),
    });
    expect(meResponse.status()).toBe(200);
    const mePayload = await meResponse.json();
    expect(mePayload.profile).toEqual(expectedProfile);

    const publicResponse = await request.get(`/api/users/${qaAccount.user_id}/profile`);
    expect(publicResponse.status()).toBe(200);
    const publicPayload = await publicResponse.json();
    expect(publicPayload.user.profile_cosmetics).toMatchObject({
      primary_badge: expect.objectContaining({ key: expectedProfile.primary_badge_key }),
      profile_background: expect.objectContaining({
        key: expectedProfile.profile_background_key,
      }),
    });
    expect(publicPayload.user.profile_cosmetics.showcase_badges).toHaveLength(6);
    expect(publicPayload.user.profile_cosmetics.header_stickers).toHaveLength(3);
  });
});
