const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const {
  E2E_SESSION_PASSWORD_HASH,
  loginWithApiSession,
} = require('./session-auth');

const ADMIN_ID = 9861;
const ACTIVE_WRITER_ID = 9862;
const D1_USER_ID = 9863;
const D7_USER_ID = 9864;
const REWRITE_USER_ID = 9865;
const USER_IDS = [ADMIN_ID, ACTIVE_WRITER_ID, D1_USER_ID, D7_USER_ID, REWRITE_USER_ID];
const POST_IDS = [98621, 98622, 98623, 98651, 98652];

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve(this);
    });
  });

const waitForFile = async (filePath, timeoutMs = 20000) => {
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

async function seedOverviewFixtures() {
  await waitForFile(DB_PATH);
  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  const userPlaceholders = USER_IDS.map(() => '?').join(', ');
  const postPlaceholders = POST_IDS.map(() => '?').join(', ');
  await dbRun(db, `DELETE FROM ux_events WHERE user_id IN (${userPlaceholders})`, USER_IDS);
  await dbRun(db, `DELETE FROM auth_sessions WHERE user_id IN (${userPlaceholders})`, USER_IDS);
  await dbRun(db, `DELETE FROM auth_login_state WHERE user_id IN (${userPlaceholders})`, USER_IDS);
  await dbRun(db, `DELETE FROM safety_reports WHERE detail = 'admin-overview-e2e'`);
  await dbRun(db, `DELETE FROM posts WHERE id IN (${postPlaceholders})`, POST_IDS);
  await dbRun(db, `DELETE FROM users WHERE id IN (${userPlaceholders})`, USER_IDS);

  const users = [
    [ADMIN_ID, 'Overview Admin', 'overview_admin', 'overview-admin@glsoop.test', 1],
    [ACTIVE_WRITER_ID, 'Overview Writer', 'overview_writer', 'overview-writer@glsoop.test', 0],
    [D1_USER_ID, 'Overview D1', 'overview_d1', 'overview-d1@glsoop.test', 0],
    [D7_USER_ID, 'Overview D7', 'overview_d7', 'overview-d7@glsoop.test', 0],
    [REWRITE_USER_ID, 'Overview Rewrite', 'overview_rewrite', 'overview-rewrite@glsoop.test', 0],
  ];
  for (const [id, name, nickname, email, isAdmin] of users) {
    await dbRun(
      db,
      `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, name, nickname, email, E2E_SESSION_PASSWORD_HASH, isAdmin]
    );
  }

  const uxEvents = [
    [ACTIVE_WRITER_ID, 'verify_email_success', '-3 days'],
    [ACTIVE_WRITER_ID, 'first_post_created_24h', '-60 hours'],
    [ACTIVE_WRITER_ID, 'native_app_open', '-2 days'],
    [D1_USER_ID, 'verify_email_success', '-4 days'],
    [D1_USER_ID, 'native_app_foreground', '-60 hours'],
    [D7_USER_ID, 'verify_email_success', '-12 days'],
    [D7_USER_ID, 'native_app_foreground', '-108 hours'],
  ];
  for (const [userId, eventName, modifier] of uxEvents) {
    await dbRun(
      db,
      `INSERT INTO ux_events
         (user_id, event_name, source, session_id, page_path, created_at)
       VALUES (?, ?, 'e2e_overview', ?, '/e2e-overview', datetime('now', ?))`,
      [userId, eventName, `overview-${userId}`, modifier]
    );
  }

  const posts = [
    [98621, ACTIVE_WRITER_ID, 'Earlier overview post', '-12 days'],
    [98622, ACTIVE_WRITER_ID, 'Current overview post one', '-3 days'],
    [98623, ACTIVE_WRITER_ID, 'Current overview post two', '-2 days'],
    [98651, REWRITE_USER_ID, 'First rewrite overview post', '-10 days'],
    [98652, REWRITE_USER_ID, 'Second rewrite overview post', '-8 days'],
  ];
  for (const [id, userId, title, modifier] of posts) {
    await dbRun(
      db,
      `INSERT INTO posts (id, user_id, title, content, category, created_at)
       VALUES (?, ?, ?, 'overview body', 'short', datetime('now', ?))`,
      [id, userId, title, modifier]
    );
  }

  await dbRun(
    db,
    `INSERT INTO safety_reports
       (reporter_id, target_type, target_user_id, source, reason_code, detail, status, created_at)
     VALUES (?, 'user', ?, 'report', 'other', 'admin-overview-e2e', 'queued', datetime('now', '-2 days'))`,
    [D1_USER_ID, ACTIVE_WRITER_ID]
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
}

test.describe('Admin operations overview API', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedOverviewFixtures();
  });

  test('returns comparable activity, activation, retention, and operations metrics', async ({ request }) => {
    await loginWithApiSession(request, 'overview-admin@glsoop.test');

    const response = await request.get('/api/admin/overview?days=7');
    expect(response.status()).toBe(200);
    const payload = await response.json();

    expect(payload).toMatchObject({
      ok: true,
      timezone: 'Asia/Seoul',
      period: { days: 7 },
    });
    expect(payload.daily).toHaveLength(7);
    expect(payload.headline.active_users.current).toBeGreaterThanOrEqual(3);
    expect(payload.headline.posts_created.current).toBeGreaterThanOrEqual(2);
    expect(payload.headline.repeat_writers.current).toBeGreaterThanOrEqual(1);
    expect(payload.activation.verified_users).toBeGreaterThanOrEqual(1);
    expect(payload.activation.first_post_24h_users).toBeGreaterThanOrEqual(1);
    expect(payload.retention.d1.returned_count).toBeGreaterThanOrEqual(1);
    expect(payload.retention.d7.returned_count).toBeGreaterThanOrEqual(1);
    expect(payload.retention.rewrite_7d.rewritten_count).toBeGreaterThanOrEqual(1);
    expect(payload.operations.safety.open_count).toBeGreaterThanOrEqual(1);
    expect(payload.operations.safety.overdue_24h_count).toBeGreaterThanOrEqual(1);
    expect(payload.definitions.active_user).toContain('관리자 계정을 제외');
  });

  test('supports the 30-day view and rejects non-admin access', async ({ request }) => {
    await loginWithApiSession(request, 'overview-admin@glsoop.test');
    const adminResponse = await request.get('/api/admin/overview?days=30');
    expect(adminResponse.status()).toBe(200);
    const adminPayload = await adminResponse.json();
    expect(adminPayload.period.days).toBe(30);
    expect(adminPayload.daily).toHaveLength(30);

    await loginWithApiSession(request, 'overview-writer@glsoop.test');
    const userResponse = await request.get('/api/admin/overview?days=7');
    expect(userResponse.status()).toBe(403);
  });
});
