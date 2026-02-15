const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';

const ADMIN_USER_ID = 9751;
const USER_A_ID = 9752;
const USER_B_ID = 9753;

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

const seedUxFixtures = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [ADMIN_USER_ID, 'Admin UX', 'admin_ux', 'admin-ux@glsoop.test', 'password', 1, 1]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [USER_A_ID, 'User A UX', 'user_a_ux', 'user-a-ux@glsoop.test', 'password', 0, 1]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [USER_B_ID, 'User B UX', 'user_b_ux', 'user-b-ux@glsoop.test', 'password', 0, 1]
  );

  await dbRun(
    db,
    `DELETE FROM ux_events
     WHERE source = 'e2e_seed'
       OR session_id = 'sess_ux_guest'`,
    []
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

test.describe('UX events API', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedUxFixtures();
  });

  test('returns INVALID_REQUEST for malformed payload', async ({ request }) => {
    const response = await request.post('/api/ux-events', {
      data: {
        session_id: 'sess_ux_invalid',
      },
    });

    expect(response.status()).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });

  test('records ux event without auth token', async ({ request }) => {
    const response = await request.post('/api/ux-events', {
      data: {
        event_name: 'signup_view',
        session_id: 'sess_ux_guest',
        anonymous_id: 'anon_ux_guest',
        page_path: '/html/signup.html',
        properties: { source: 'e2e' },
      },
    });

    expect(response.status()).toBe(202);
    const payload = await response.json();
    expect(payload.ok).toBe(true);

    const db = new sqlite3.Database(DB_PATH);
    const row = await dbGet(
      db,
      `SELECT user_id, event_name, source, session_id, anonymous_id, page_path
       FROM ux_events
       WHERE session_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      ['sess_ux_guest']
    );
    await new Promise((resolve) => db.close(resolve));

    expect(row).toMatchObject({
      user_id: null,
      event_name: 'signup_view',
      source: 'web_client',
      session_id: 'sess_ux_guest',
      anonymous_id: 'anon_ux_guest',
      page_path: '/html/signup.html',
    });
  });

  test('returns admin summary and p0 metrics', async ({ request }) => {
    const db = new sqlite3.Database(DB_PATH);

    await dbRun(db, "DELETE FROM ux_events WHERE source = 'e2e_seed'");

    const seedRows = [
      [null, 'signup_success_pending_created', 'e2e_seed'],
      [USER_A_ID, 'verify_email_submit', 'e2e_seed'],
      [USER_B_ID, 'verify_email_submit', 'e2e_seed'],
      [USER_A_ID, 'verify_email_error', 'e2e_seed'],
      [USER_A_ID, 'verify_email_success', 'e2e_seed'],
      [USER_B_ID, 'verify_email_success', 'e2e_seed'],
      [USER_A_ID, 'login_success', 'e2e_seed'],
      [USER_A_ID, 'post_create_submit', 'e2e_seed'],
      [USER_A_ID, 'post_create_submit', 'e2e_seed'],
      [USER_A_ID, 'post_create_error', 'e2e_seed'],
      [USER_A_ID, 'post_create_success', 'e2e_seed'],
      [USER_A_ID, 'first_post_created_24h', 'e2e_seed'],
    ];

    for (const [userId, eventName, source] of seedRows) {
      await dbRun(
        db,
        `INSERT INTO ux_events (user_id, event_name, source, session_id, anonymous_id, page_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-1 hour'))`,
        [
          userId,
          eventName,
          source,
          userId ? `sess_${userId}` : 'sess_guest_seed',
          userId ? null : 'anon_seed_1',
          '/e2e/ux',
        ]
      );
    }

    await new Promise((resolve) => db.close(resolve));

    const adminToken = signAuthToken({
      id: ADMIN_USER_ID,
      name: 'Admin UX',
      nickname: 'admin_ux',
      email: 'admin-ux@glsoop.test',
      isAdmin: true,
    });

    const response = await request.get('/api/admin/ux-events/summary', {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      params: {
        source: 'e2e_seed',
      },
    });

    expect(response.status()).toBe(200);
    const payload = await response.json();

    expect(payload.ok).toBe(true);
    expect(payload.summary).toMatchObject({
      total_count: 12,
      unique_user_count: 2,
      anonymous_count: 1,
    });

    expect(payload.key_events).toMatchObject({
      signup_success_pending_created_count: 1,
      verify_email_success_count: 2,
      login_success_count: 1,
      post_create_success_count: 1,
      first_post_created_24h_count: 1,
    });

    expect(payload.p0_metrics).toMatchObject({
      verified_users: 2,
      first_post_24h_users: 1,
      first_post_24h_rate: 50,
      verify_submit_count: 2,
      verify_error_count: 1,
      verify_email_failure_rate: 50,
      post_submit_count: 2,
      post_error_count: 1,
      post_create_error_rate: 50,
    });

    expect(payload.by_event).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_name: 'verify_email_submit', event_count: 2 }),
        expect.objectContaining({ event_name: 'verify_email_success', event_count: 2 }),
      ])
    );
  });

  test('rejects non-admin summary access', async ({ request }) => {
    const userToken = signAuthToken({
      id: USER_A_ID,
      name: 'User A UX',
      nickname: 'user_a_ux',
      email: 'user-a-ux@glsoop.test',
      isAdmin: false,
    });

    const response = await request.get('/api/admin/ux-events/summary', {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
      params: {
        source: 'e2e_seed',
      },
    });

    expect(response.status()).toBe(403);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      code: 'AUTH_FORBIDDEN',
    });
  });
});
