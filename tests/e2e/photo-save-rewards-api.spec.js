const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';

const TEST_USER_ID = 9911;
const TEST_PREMIUM_USER_ID = 9912;
const TEST_POST_ID = 9811;

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

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const signAuthToken = ({ id, name, nickname, email }) =>
  jwt.sign(
    {
      id,
      name,
      nickname,
      email,
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

const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'x-auth-legacy-now': '0',
});

const seedPhotoSaveFixtures = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, 0, 1)`,
    [TEST_USER_ID, 'Photo Saver', 'photo_saver', 'photo-saver@glsoop.test', 'password']
  );
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, 0, 1)`,
    [
      TEST_PREMIUM_USER_ID,
      'Premium Saver',
      'premium_saver',
      'premium-saver@glsoop.test',
      'password',
    ]
  );
  await dbRun(
    db,
    `INSERT OR REPLACE INTO posts (id, user_id, title, content, category, created_at)
     VALUES (?, ?, ?, ?, 'short', datetime('now'))`,
    [TEST_POST_ID, TEST_USER_ID, 'Photo Save Fixture', '사진 저장 테스트 글입니다.']
  );
  await dbRun(db, 'DELETE FROM photo_save_events WHERE user_id IN (?, ?)', [
    TEST_USER_ID,
    TEST_PREMIUM_USER_ID,
  ]);
  await dbRun(db, 'DELETE FROM photo_save_ad_rewards WHERE user_id IN (?, ?)', [
    TEST_USER_ID,
    TEST_PREMIUM_USER_ID,
  ]);
  await dbRun(db, 'DELETE FROM user_entitlements WHERE user_id IN (?, ?)', [
    TEST_USER_ID,
    TEST_PREMIUM_USER_ID,
  ]);
  await dbRun(
    db,
    `INSERT OR REPLACE INTO user_entitlements (
      user_id,
      entitlement_key,
      status,
      source,
      starts_at,
      ends_at,
      meta_json
    )
    VALUES (?, 'premium:glsoop', 'active', 'admin', CURRENT_TIMESTAMP, NULL, '{}')`,
    [TEST_PREMIUM_USER_ID]
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

test.describe('Photo Save Rewards API', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedPhotoSaveFixtures();
  });

  test('requires auth for policy', async ({ request }) => {
    const response = await request.get('/api/photo-save/policy?platform=android');
    expect(response.status()).toBe(401);
  });

  test('consumes free quota and then requires rewarded ad', async ({ request }) => {
    const token = signAuthToken({
      id: TEST_USER_ID,
      name: 'Photo Saver',
      nickname: 'photo_saver',
      email: 'photo-saver@glsoop.test',
    });

    const firstPolicy = await request.get('/api/photo-save/policy?platform=android', {
      headers: authHeaders(token),
    });
    expect(firstPolicy.status()).toBe(200);
    await expect(firstPolicy.json()).resolves.toMatchObject({
      ok: true,
      policy: {
        enabled: true,
        free_daily_limit: 1,
        free_remaining: 1,
        can_save_without_ad: true,
        requires_ad: false,
        rewarded_ad_unit_id: 'ca-app-pub-test/android-rewarded',
      },
    });

    const freeConsume = await request.post('/api/photo-save/consume', {
      headers: authHeaders(token),
      data: {
        post_id: TEST_POST_ID,
        platform: 'android',
        method: 'free',
        request_id: 'photo-save-free-1',
      },
    });
    expect(freeConsume.status()).toBe(200);
    await expect(freeConsume.json()).resolves.toMatchObject({
      ok: true,
      event: {
        post_id: TEST_POST_ID,
        access_type: 'free',
        platform: 'android',
      },
      policy: {
        free_remaining: 0,
        requires_ad: true,
      },
    });

    const secondFreeConsume = await request.post('/api/photo-save/consume', {
      headers: authHeaders(token),
      data: {
        post_id: TEST_POST_ID,
        platform: 'android',
        method: 'free',
        request_id: 'photo-save-free-2',
      },
    });
    expect(secondFreeConsume.status()).toBe(409);
    await expect(secondFreeConsume.json()).resolves.toMatchObject({
      ok: false,
      code: 'FREE_QUOTA_EXHAUSTED',
      policy: {
        free_remaining: 0,
        requires_ad: true,
      },
    });
  });

  test('records rewarded ad grant and consumes it for one save', async ({ request }) => {
    const token = signAuthToken({
      id: TEST_USER_ID,
      name: 'Photo Saver',
      nickname: 'photo_saver',
      email: 'photo-saver@glsoop.test',
    });

    const grantResponse = await request.post('/api/photo-save/rewarded-grants', {
      headers: authHeaders(token),
      data: {
        post_id: TEST_POST_ID,
        platform: 'android',
        ad_unit_id: 'ca-app-pub-test/android-rewarded',
        reward_type: 'photo_save',
        reward_amount: 1,
      },
    });
    expect(grantResponse.status()).toBe(200);
    const grantPayload = await grantResponse.json();
    expect(grantPayload).toMatchObject({
      ok: true,
      grant: {
        post_id: TEST_POST_ID,
        platform: 'android',
        status: 'earned',
      },
    });

    const consumeResponse = await request.post('/api/photo-save/consume', {
      headers: authHeaders(token),
      data: {
        post_id: TEST_POST_ID,
        platform: 'android',
        method: 'rewarded_ad',
        rewarded_grant_id: grantPayload.grant.id,
        request_id: 'photo-save-rewarded-1',
      },
    });
    expect(consumeResponse.status()).toBe(200);
    await expect(consumeResponse.json()).resolves.toMatchObject({
      ok: true,
      event: {
        post_id: TEST_POST_ID,
        access_type: 'rewarded_ad',
        platform: 'android',
      },
    });

    const duplicateConsume = await request.post('/api/photo-save/consume', {
      headers: authHeaders(token),
      data: {
        post_id: TEST_POST_ID,
        platform: 'android',
        method: 'rewarded_ad',
        rewarded_grant_id: grantPayload.grant.id,
        request_id: 'photo-save-rewarded-dup',
      },
    });
    expect(duplicateConsume.status()).toBe(409);
    await expect(duplicateConsume.json()).resolves.toMatchObject({
      ok: false,
      code: 'REWARD_GRANT_ALREADY_USED',
    });
  });

  test('premium entitlement bypasses the ad gate', async ({ request }) => {
    const token = signAuthToken({
      id: TEST_PREMIUM_USER_ID,
      name: 'Premium Saver',
      nickname: 'premium_saver',
      email: 'premium-saver@glsoop.test',
    });

    const policyResponse = await request.get('/api/photo-save/policy?platform=ios', {
      headers: authHeaders(token),
    });
    expect(policyResponse.status()).toBe(200);
    await expect(policyResponse.json()).resolves.toMatchObject({
      ok: true,
      policy: {
        is_premium: true,
        can_save_without_ad: true,
        requires_ad: false,
        premium_entitlement_key: 'premium:glsoop',
      },
    });

    const consumeResponse = await request.post('/api/photo-save/consume', {
      headers: authHeaders(token),
      data: {
        post_id: TEST_POST_ID,
        platform: 'ios',
        method: 'premium',
      },
    });
    expect(consumeResponse.status()).toBe(200);
    await expect(consumeResponse.json()).resolves.toMatchObject({
      ok: true,
      event: {
        access_type: 'premium',
        platform: 'ios',
      },
    });
  });
});
