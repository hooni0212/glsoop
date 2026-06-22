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

const signAuthToken = ({
  id,
  name,
  nickname,
  email,
  isAdmin = false,
  isVerified = true,
  sid = `ux-events-session-${id}`,
}) =>
  jwt.sign(
    {
      id,
      sid,
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

  for (const userId of [ADMIN_USER_ID, USER_A_ID, USER_B_ID]) {
    const sid = `ux-events-session-${userId}`;
    await dbRun(db, 'DELETE FROM auth_sessions WHERE sid = ?', [sid]);
    await dbRun(
      db,
      `INSERT INTO auth_sessions
         (sid, user_id, remember_me, created_at, last_seen_at, expires_at)
       VALUES (?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, datetime('now', '+1 day'))`,
      [sid, userId]
    );
  }

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

  test('records ux event with server-classified device dimensions', async ({ request }) => {
    const response = await request.post('/api/ux-events', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      },
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
      `SELECT user_id, event_name, source, session_id, anonymous_id, page_path,
              device_class, platform_family
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
      device_class: 'mobile',
      platform_family: 'ios',
    });
  });

  test('records one automatic page view for a web page visit', async ({ page }) => {
    const sessionId = 'sess_ux_page_view';
    await page.addInitScript((fixedSessionId) => {
      window.sessionStorage.setItem('glsoop:analytics:session_id', fixedSessionId);
      window.localStorage.setItem('glsoop:analytics:anonymous_id', 'anon_ux_page_view');
    }, sessionId);

    const [response] = await Promise.all([
      page.waitForResponse((candidate) => {
        return (
          candidate.url().endsWith('/api/ux-events') && candidate.request().method() === 'POST'
        );
      }),
      page.goto('/'),
    ]);
    expect(response.status()).toBe(202);

    const db = new sqlite3.Database(DB_PATH);
    const row = await dbGet(
      db,
      `SELECT event_name, session_id, anonymous_id, page_path, properties_json,
              device_class, platform_family
       FROM ux_events
       WHERE session_id = ? AND event_name = 'page_view'
       ORDER BY id DESC
       LIMIT 1`,
      [sessionId]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(row).toMatchObject({
      event_name: 'page_view',
      session_id: sessionId,
      anonymous_id: 'anon_ux_page_view',
      page_path: '/',
      device_class: 'desktop',
    });
    expect(['macos', 'windows', 'linux', 'chromeos']).toContain(row.platform_family);
    expect(JSON.parse(row.properties_json)).toMatchObject({ document_title: expect.any(String) });
  });

  test('records native app events with explicit app source and platform dimensions', async ({ request }) => {
    const cases = [
      {
        sessionId: 'sess_native_ios',
        headers: {
          'X-Glsoop-Client': 'native_app',
          'X-Glsoop-Platform': 'ios',
          'X-Glsoop-Device-Class': 'mobile',
        },
        deviceClass: 'mobile',
        platformFamily: 'ios',
      },
      {
        sessionId: 'sess_native_android_tablet',
        headers: {
          'X-Glsoop-Client': 'native_app',
          'X-Glsoop-Platform': 'android',
          'X-Glsoop-Device-Class': 'tablet',
        },
        deviceClass: 'tablet',
        platformFamily: 'android',
      },
    ];

    for (const item of cases) {
      const response = await request.post('/api/ux-events', {
        headers: item.headers,
        data: {
          event_name: 'native_app_open',
          session_id: item.sessionId,
          anonymous_id: `anon_${item.sessionId}`,
          page_path: '/(tabs)',
        },
      });
      expect(response.status()).toBe(202);
    }

    const db = new sqlite3.Database(DB_PATH);
    for (const item of cases) {
      const row = await dbGet(
        db,
        `SELECT source, device_class, platform_family
         FROM ux_events
         WHERE session_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [item.sessionId]
      );
      expect(row).toMatchObject({
        source: 'native_client',
        device_class: item.deviceClass,
        platform_family: item.platformFamily,
      });
    }
    await new Promise((resolve) => db.close(resolve));
  });

  test('classifies desktop, tablet, and automated user agents without storing raw values', async ({ request }) => {
    const cases = [
      {
        sessionId: 'sess_ux_desktop',
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36',
        deviceClass: 'desktop',
        platformFamily: 'macos',
      },
      {
        sessionId: 'sess_ux_tablet',
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; SM-X910 Build/AP3A.240905.015.A2) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36',
        deviceClass: 'tablet',
        platformFamily: 'android',
      },
      {
        sessionId: 'sess_ux_unknown',
        userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        deviceClass: 'unknown',
        platformFamily: 'unknown',
      },
    ];

    for (const item of cases) {
      const response = await request.post('/api/ux-events', {
        headers: { 'User-Agent': item.userAgent },
        data: {
          event_name: 'device_classification_check',
          session_id: item.sessionId,
          properties: {
            device_class: 'mobile',
            platform_family: 'ios',
          },
        },
      });
      expect(response.status()).toBe(202);
    }

    const db = new sqlite3.Database(DB_PATH);
    for (const item of cases) {
      const row = await dbGet(
        db,
        `SELECT device_class, platform_family, properties_json
         FROM ux_events
         WHERE session_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [item.sessionId]
      );
      expect(row).toMatchObject({
        device_class: item.deviceClass,
        platform_family: item.platformFamily,
      });
      expect(row.properties_json).not.toContain(item.userAgent);
    }
    await new Promise((resolve) => db.close(resolve));
  });

  test('returns admin summary and p0 metrics', async ({ request }) => {
    const db = new sqlite3.Database(DB_PATH);

    await dbRun(db, "DELETE FROM ux_events WHERE source = 'e2e_seed'");

    const seedRows = [
      [null, 'signup_success_pending_created', 'mobile', 'ios'],
      [USER_A_ID, 'verify_email_submit', 'desktop', 'macos'],
      [USER_B_ID, 'verify_email_submit', 'mobile', 'android'],
      [USER_A_ID, 'verify_email_error', 'desktop', 'macos'],
      [USER_A_ID, 'verify_email_success', 'desktop', 'macos'],
      [USER_B_ID, 'verify_email_success', 'mobile', 'android'],
      [USER_A_ID, 'login_success', 'desktop', 'macos'],
      [USER_A_ID, 'post_create_submit', 'desktop', 'macos'],
      [USER_A_ID, 'post_create_submit', 'desktop', 'macos'],
      [USER_A_ID, 'post_create_error', 'desktop', 'macos'],
      [USER_A_ID, 'post_create_success', 'desktop', 'macos'],
      [USER_A_ID, 'first_post_created_24h', 'desktop', 'macos'],
    ];

    for (const [userId, eventName, deviceClass, platformFamily] of seedRows) {
      await dbRun(
        db,
        `INSERT INTO ux_events
           (user_id, event_name, source, session_id, anonymous_id, page_path,
            device_class, platform_family, created_at)
         VALUES (?, ?, 'e2e_seed', ?, ?, ?, ?, ?, datetime('now', '-1 hour'))`,
        [
          userId,
          eventName,
          userId ? `sess_${userId}` : 'sess_guest_seed',
          userId ? null : 'anon_seed_1',
          '/e2e/ux',
          deviceClass,
          platformFamily,
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

    expect(payload.by_device).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          device_class: 'desktop',
          event_count: 9,
          unique_session_count: 1,
        }),
        expect.objectContaining({
          device_class: 'mobile',
          event_count: 3,
          unique_session_count: 2,
        }),
      ])
    );
    expect(payload.by_platform).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform_family: 'macos', event_count: 9 }),
        expect.objectContaining({ platform_family: 'android', event_count: 2 }),
        expect.objectContaining({ platform_family: 'ios', event_count: 1 }),
      ])
    );

    const filteredResponse = await request.get('/api/admin/ux-events/summary', {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: {
        source: 'e2e_seed',
        device_class: 'mobile',
        platform_family: 'android',
      },
    });
    expect(filteredResponse.status()).toBe(200);
    const filteredPayload = await filteredResponse.json();
    expect(filteredPayload.filters).toMatchObject({
      device_class: 'mobile',
      platform_family: 'android',
    });
    expect(filteredPayload.summary).toMatchObject({
      total_count: 2,
      unique_user_count: 1,
      unique_session_count: 1,
    });
    expect(filteredPayload.by_device).toEqual([
      expect.objectContaining({ device_class: 'mobile', event_count: 2 }),
    ]);
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
