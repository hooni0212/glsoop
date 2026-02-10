const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';

const TEST_USER_ID = 9901;
const TEST_USER_REFUND_ID = 9902;
const ADMIN_USER_ID = 9903;

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

const signAuthToken = ({ id, name, nickname, email, isAdmin = false, isVerified = true }) =>
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

const seedMonetizationFixtures = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [TEST_USER_ID, 'Buyer Fixture', 'buyer_fixture', 'buyer-fixture@glsoop.test', 'password', 0, 1]
  );
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      TEST_USER_REFUND_ID,
      'Buyer Refund Fixture',
      'buyer_refund_fixture',
      'buyer-refund-fixture@glsoop.test',
      'password',
      0,
      1,
    ]
  );
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      ADMIN_USER_ID,
      'Admin Fixture',
      'admin_fixture',
      'admin-fixture@glsoop.test',
      'password',
      1,
      1,
    ]
  );

  await dbRun(
    db,
    `INSERT OR IGNORE INTO products (
      platform,
      store_sku,
      product_type,
      entitlement_key,
      title,
      description,
      season,
      meta_json,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      'apple',
      'pass_2026_spring',
      'non_consumable',
      'pass:2026_spring',
      '2026 봄 시즌 패스',
      '프리미엄 퀘스트와 한정 보상을 획득하세요.',
      '2026_spring',
      '{"benefits":["premium_campaign_unlock","cosmetic_rewards"]}',
    ]
  );

  await dbRun(
    db,
    'DELETE FROM purchases WHERE user_id = ?',
    [TEST_USER_ID]
  );
  await dbRun(
    db,
    'DELETE FROM purchases WHERE user_id = ?',
    [TEST_USER_REFUND_ID]
  );
  await dbRun(
    db,
    'DELETE FROM user_entitlements WHERE user_id = ?',
    [TEST_USER_ID]
  );
  await dbRun(
    db,
    'DELETE FROM user_entitlements WHERE user_id = ?',
    [TEST_USER_REFUND_ID]
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

test.describe('Monetization API', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedMonetizationFixtures();
  });

  test('returns active store catalog', async ({ request }) => {
    const response = await request.get('/api/store/catalog');
    expect(response.status()).toBe(200);

    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.products)).toBe(true);
    expect(payload.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'apple',
          store_sku: 'pass_2026_spring',
          entitlement_key: 'pass:2026_spring',
          is_active: 1,
        }),
      ])
    );
  });

  test('requires auth for entitlements/me', async ({ request }) => {
    const response = await request.get('/api/entitlements/me');
    expect(response.status()).toBe(401);

    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      code: 'AUTH_REQUIRED',
    });
  });

  test('accepts verify request in pending mode and creates inactive entitlement', async ({
    request,
  }) => {
    const token = signAuthToken({
      id: TEST_USER_ID,
      name: 'Buyer Fixture',
      nickname: 'buyer_fixture',
      email: 'buyer-fixture@glsoop.test',
    });
    const txId = `apple-tx-${Date.now()}`;

    const response = await request.post('/api/purchases/verify', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      data: {
        platform: 'apple',
        store_sku: 'pass_2026_spring',
        transaction_id: txId,
        receipt_data: 'base64-test-receipt',
      },
    });

    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.purchase).toMatchObject({
      platform: 'apple',
      store_sku: 'pass_2026_spring',
      status: 'pending',
    });
    expect(payload.entitlements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entitlement_key: 'pass:2026_spring',
          status: 'inactive',
          source: 'iap',
        }),
      ])
    );

    const db = new sqlite3.Database(DB_PATH);
    const purchaseRow = await dbGet(
      db,
      'SELECT status FROM purchases WHERE platform = ? AND transaction_id = ? LIMIT 1',
      ['apple', txId]
    );
    const entitlementRow = await dbGet(
      db,
      'SELECT status, source FROM user_entitlements WHERE user_id = ? AND entitlement_key = ? LIMIT 1',
      [TEST_USER_ID, 'pass:2026_spring']
    );
    await new Promise((resolve) => db.close(resolve));

    expect(purchaseRow).toMatchObject({ status: 'pending' });
    expect(entitlementRow).toMatchObject({ status: 'inactive', source: 'iap' });
  });

  test('handles duplicate verify requests idempotently', async ({ request }) => {
    const token = signAuthToken({
      id: TEST_USER_ID,
      name: 'Buyer Fixture',
      nickname: 'buyer_fixture',
      email: 'buyer-fixture@glsoop.test',
    });
    const txId = `apple-idempotent-${Date.now()}`;

    const first = await request.post('/api/purchases/verify', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        platform: 'apple',
        store_sku: 'pass_2026_spring',
        transaction_id: txId,
        receipt_data: 'base64-test-receipt',
      },
    });
    expect(first.status()).toBe(200);

    const second = await request.post('/api/purchases/verify', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        platform: 'apple',
        store_sku: 'pass_2026_spring',
        transaction_id: txId,
        receipt_data: 'base64-test-receipt',
      },
    });
    expect(second.status()).toBe(200);
    const secondPayload = await second.json();
    expect(secondPayload.ok).toBe(true);
    expect(secondPayload.message).toContain('이미 처리된 결제');

    const db = new sqlite3.Database(DB_PATH);
    const countRow = await dbGet(
      db,
      'SELECT COUNT(*) AS cnt FROM purchases WHERE platform = ? AND transaction_id = ?',
      ['apple', txId]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(countRow.cnt).toBe(1);
  });

  test('returns RESOURCE_NOT_FOUND for unknown sku', async ({ request }) => {
    const token = signAuthToken({
      id: TEST_USER_ID,
      name: 'Buyer Fixture',
      nickname: 'buyer_fixture',
      email: 'buyer-fixture@glsoop.test',
    });

    const response = await request.post('/api/purchases/verify', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        platform: 'apple',
        store_sku: 'unknown_pass_sku',
        transaction_id: `apple-notfound-${Date.now()}`,
        receipt_data: 'base64-test-receipt',
      },
    });

    expect(response.status()).toBe(404);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  test('admin can activate pending purchase and sync entitlement', async ({
    request,
  }) => {
    const buyerToken = signAuthToken({
      id: TEST_USER_ID,
      name: 'Buyer Fixture',
      nickname: 'buyer_fixture',
      email: 'buyer-fixture@glsoop.test',
    });
    const adminToken = signAuthToken({
      id: ADMIN_USER_ID,
      name: 'Admin Fixture',
      nickname: 'admin_fixture',
      email: 'admin-fixture@glsoop.test',
      isAdmin: true,
    });
    const txId = `apple-admin-activate-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const verifyResponse = await request.post('/api/purchases/verify', {
      headers: { Authorization: `Bearer ${buyerToken}` },
      data: {
        platform: 'apple',
        store_sku: 'pass_2026_spring',
        transaction_id: txId,
        receipt_data: 'base64-test-receipt',
      },
    });
    expect(verifyResponse.status()).toBe(200);

    const reconcileResponse = await request.post('/api/admin/purchases/reconcile', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        platform: 'apple',
        transaction_id: txId,
        status: 'active',
        expires_at: expiresAt,
        source: 'admin',
        reason: 'e2e activate pending purchase',
      },
    });
    expect(reconcileResponse.status()).toBe(200);
    const reconcilePayload = await reconcileResponse.json();
    expect(reconcilePayload.ok).toBe(true);
    expect(reconcilePayload.purchase).toMatchObject({
      user_id: TEST_USER_ID,
      status: 'active',
    });
    expect(reconcilePayload.entitlement).toMatchObject({
      user_id: TEST_USER_ID,
      entitlement_key: 'pass:2026_spring',
      status: 'active',
      source: 'iap',
    });

    const db = new sqlite3.Database(DB_PATH);
    const purchaseRow = await dbGet(
      db,
      'SELECT status, expires_at FROM purchases WHERE platform = ? AND transaction_id = ? LIMIT 1',
      ['apple', txId]
    );
    const entitlementRow = await dbGet(
      db,
      'SELECT status, source, ends_at FROM user_entitlements WHERE user_id = ? AND entitlement_key = ? LIMIT 1',
      [TEST_USER_ID, 'pass:2026_spring']
    );
    await new Promise((resolve) => db.close(resolve));

    expect(purchaseRow.status).toBe('active');
    expect(purchaseRow.expires_at).toBe(expiresAt);
    expect(entitlementRow.status).toBe('active');
    expect(entitlementRow.source).toBe('iap');
    expect(entitlementRow.ends_at).toBe(expiresAt);
  });

  test('admin can mark purchase refunded and entitlement becomes inactive', async ({
    request,
  }) => {
    const buyerToken = signAuthToken({
      id: TEST_USER_REFUND_ID,
      name: 'Buyer Refund Fixture',
      nickname: 'buyer_refund_fixture',
      email: 'buyer-refund-fixture@glsoop.test',
    });
    const adminToken = signAuthToken({
      id: ADMIN_USER_ID,
      name: 'Admin Fixture',
      nickname: 'admin_fixture',
      email: 'admin-fixture@glsoop.test',
      isAdmin: true,
    });
    const txId = `apple-admin-refund-${Date.now()}`;

    const verifyResponse = await request.post('/api/purchases/verify', {
      headers: { Authorization: `Bearer ${buyerToken}` },
      data: {
        platform: 'apple',
        store_sku: 'pass_2026_spring',
        transaction_id: txId,
        receipt_data: 'base64-test-receipt',
      },
    });
    expect(verifyResponse.status()).toBe(200);

    const activateResponse = await request.post('/api/admin/purchases/reconcile', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        platform: 'apple',
        transaction_id: txId,
        status: 'active',
        source: 'admin',
        reason: 'e2e activate before refund',
      },
    });
    expect(activateResponse.status()).toBe(200);

    const refundResponse = await request.post('/api/admin/purchases/reconcile', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        platform: 'apple',
        transaction_id: txId,
        status: 'refunded',
        source: 'admin',
        reason: 'e2e refund',
      },
    });
    expect(refundResponse.status()).toBe(200);
    const refundPayload = await refundResponse.json();
    expect(refundPayload.ok).toBe(true);
    expect(refundPayload.purchase).toMatchObject({
      user_id: TEST_USER_REFUND_ID,
      status: 'refunded',
    });
    expect(refundPayload.entitlement).toMatchObject({
      user_id: TEST_USER_REFUND_ID,
      entitlement_key: 'pass:2026_spring',
      status: 'inactive',
      source: 'iap',
    });

    const db = new sqlite3.Database(DB_PATH);
    const purchaseRow = await dbGet(
      db,
      'SELECT status FROM purchases WHERE platform = ? AND transaction_id = ? LIMIT 1',
      ['apple', txId]
    );
    const entitlementRow = await dbGet(
      db,
      'SELECT status, source FROM user_entitlements WHERE user_id = ? AND entitlement_key = ? LIMIT 1',
      [TEST_USER_REFUND_ID, 'pass:2026_spring']
    );
    await new Promise((resolve) => db.close(resolve));

    expect(purchaseRow.status).toBe('refunded');
    expect(entitlementRow.status).toBe('inactive');
    expect(entitlementRow.source).toBe('iap');
  });
});
