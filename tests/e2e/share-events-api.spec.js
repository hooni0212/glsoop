const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const {
  E2E_SESSION_PASSWORD_HASH,
  loginWithApiSession,
} = require('./session-auth');

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

const seedShareFixtures = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');
  await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id IN (?, ?)', [9601, 9602]);
  await dbRun(db, 'DELETE FROM auth_login_state WHERE user_id IN (?, ?)', [9601, 9602]);

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      9601,
      'Admin Share',
      'admin_share',
      'admin-share@glsoop.test',
      E2E_SESSION_PASSWORD_HASH,
      1,
      1,
    ]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      9602,
      'Writer Share',
      'writer_share',
      'writer-share@glsoop.test',
      E2E_SESSION_PASSWORD_HASH,
      0,
      1,
    ]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO posts (id, user_id, title, content, category, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '-1 hour'))`,
    [9701, 9602, 'Share Event Fixture Post', 'Seed content for share event API tests.', 'essay']
  );

  await dbRun(db, 'DELETE FROM share_events WHERE post_id = ?', [9701]);

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

test.describe('Share events API', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedShareFixtures();
  });

  test('returns INVALID_REQUEST for malformed payload', async ({ request }) => {
    const response = await request.post('/api/share-events', {
      data: {
        platform: 'mobile',
        surface: 'post_detail',
        channel: 'system',
        result: 'shared',
      },
    });

    expect(response.status()).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });

  test('records share event without auth token', async ({ request }) => {
    const response = await request.post('/api/share-events', {
      data: {
        post_id: 9701,
        platform: 'mobile',
        surface: 'post_detail',
        channel: 'system',
        result: 'shared',
        meta: { source: 'e2e' },
      },
    });

    expect(response.status()).toBe(201);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.event?.id).toEqual(expect.any(Number));

    const db = new sqlite3.Database(DB_PATH);
    const row = await dbGet(
      db,
      'SELECT user_id, platform, surface, channel, result FROM share_events WHERE id = ? LIMIT 1',
      [payload.event.id]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(row).toMatchObject({
      user_id: null,
      platform: 'mobile',
      surface: 'post_detail',
      channel: 'system',
      result: 'shared',
    });
  });

  test('records share event with authenticated user', async ({ request }) => {
    const { token } = await loginWithApiSession(request, 'writer-share@glsoop.test', {
      ip: '198.51.100.211',
    });

    const response = await request.post('/api/share-events', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      data: {
        post_id: 9701,
        platform: 'mobile',
        surface: 'post_detail',
        channel: 'system',
        result: 'dismissed',
      },
    });

    expect(response.status()).toBe(201);
    const payload = await response.json();
    expect(payload.ok).toBe(true);

    const db = new sqlite3.Database(DB_PATH);
    const row = await dbGet(
      db,
      'SELECT user_id, result FROM share_events WHERE id = ? LIMIT 1',
      [payload.event.id]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(row).toMatchObject({
      user_id: 9602,
      result: 'dismissed',
    });
  });

  test('returns admin summary for authenticated admin', async ({ request }) => {
    const { token: adminToken } = await loginWithApiSession(
      request,
      'admin-share@glsoop.test',
      { ip: '198.51.100.212' }
    );

    const response = await request.get('/api/admin/share-events/summary', {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      params: {
        platform: 'all',
      },
    });

    expect(response.status()).toBe(200);
    const payload = await response.json();

    expect(payload.ok).toBe(true);
    expect(payload.summary.total_count).toBeGreaterThanOrEqual(2);
    expect(payload.summary.shared_count).toBeGreaterThanOrEqual(1);
    expect(payload.by_channel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'system', event_count: expect.any(Number) }),
      ])
    );
  });

  test('returns INVALID_REQUEST for invalid admin summary query', async ({ request }) => {
    const { token: adminToken } = await loginWithApiSession(
      request,
      'admin-share@glsoop.test',
      { ip: '198.51.100.213' }
    );

    const response = await request.get('/api/admin/share-events/summary', {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      params: {
        platform: 'desktop',
      },
    });

    expect(response.status()).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });
});
