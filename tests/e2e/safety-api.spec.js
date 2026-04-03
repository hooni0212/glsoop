const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');
const AUTH_HEADER_NOW = '2026-03-01T00:00:00+09:00';

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

function buildAuthHeaders(userId) {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET || 'devsecret', {
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
    issuer: process.env.JWT_ISSUER || 'glsoop',
    audience: process.env.JWT_AUDIENCE || 'glsoop-client',
  });

  return {
    Authorization: `Bearer ${token}`,
    'x-auth-legacy-now': AUTH_HEADER_NOW,
  };
}

async function seedSafetyData() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  await dbRun(
    db,
    'DELETE FROM safety_reports WHERE reporter_id IN (9501, 9599) OR target_user_id IN (9502) OR target_post_id IN (9601, 9602)'
  );
  await dbRun(db, 'DELETE FROM user_blocks WHERE blocker_id IN (9501) OR blocked_user_id IN (9502)');
  await dbRun(db, 'DELETE FROM bookmark_items WHERE id IN (9701)');
  await dbRun(db, 'DELETE FROM bookmark_lists WHERE id IN (9700)');
  await dbRun(db, 'DELETE FROM likes WHERE (user_id = 9501 AND post_id IN (9601, 9602))');
  await dbRun(db, 'DELETE FROM follows WHERE follower_id = 9501 AND followee_id = 9502');
  await dbRun(db, 'DELETE FROM posts WHERE id IN (9601, 9602)');
  await dbRun(db, 'DELETE FROM users WHERE id IN (9501, 9502, 9599)');

  await dbRun(
    db,
    `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [9501, 'Safety Reader', 'safety_reader', 'safety-reader@glsoop.test', 'password', 0, 1]
  );
  await dbRun(
    db,
    `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [9502, 'Blocked Author', 'blocked_author', 'blocked-author@glsoop.test', 'password', 0, 1]
  );
  await dbRun(
    db,
    `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [9599, 'Safety Admin', 'safety_admin', 'safety-admin@glsoop.test', 'password', 1, 1]
  );

  await dbRun(
    db,
    `INSERT INTO posts (id, user_id, title, content, category, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '-1 day'))`,
    [9601, 9502, 'Fixture Safety Post', 'Reportable fixture content for safety tests.', 'essay']
  );
  await dbRun(
    db,
    `INSERT INTO posts (id, user_id, title, content, category, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '-2 day'))`,
    [9602, 9501, 'Reader Owned Post', 'Safe content from viewer user.', 'short']
  );

  await dbRun(
    db,
    `INSERT INTO likes (user_id, post_id, created_at)
     VALUES (?, ?, datetime('now'))`,
    [9501, 9601]
  );
  await dbRun(
    db,
    `INSERT INTO bookmark_lists (id, user_id, name, description, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [9700, 9501, 'Safety Bookmarks', 'Seed list for safety API tests']
  );
  await dbRun(
    db,
    `INSERT INTO bookmark_items (id, list_id, post_id, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [9701, 9700, 9601]
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
}

test.describe.serial('Safety API', () => {
  test.beforeAll(async () => {
    await seedSafetyData();
  });

  test('runtime config exposes legal urls and safety settings', async ({ request }) => {
    const response = await request.get('/api/runtime-config');
    expect(response.status()).toBe(200);

    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.legal.urls).toMatchObject({
      terms: expect.stringContaining('/html/terms.html'),
      privacy: expect.stringContaining('/html/privacy.html'),
      guidelines: expect.stringContaining('/html/community-guidelines.html'),
    });
    expect(payload.safety).toMatchObject({
      report_enabled: true,
      block_enabled: true,
      moderation_sla_hours: 24,
    });
    expect(Array.isArray(payload.safety.report_reasons)).toBe(true);
    expect(payload.safety.report_reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'harassment', label: expect.any(String) }),
        expect.objectContaining({ code: 'other', label: expect.any(String) }),
      ])
    );
  });

  test('queues safety reports and allows admin resolution', async ({ request }) => {
    const viewerHeaders = buildAuthHeaders(9501);
    const adminHeaders = buildAuthHeaders(9599);

    const reportResponse = await request.post('/api/posts/9601/report', {
      headers: viewerHeaders,
      data: {
        reason_code: 'spam',
        detail: 'fixture report detail',
      },
    });

    expect(reportResponse.status()).toBe(200);
    const reportBody = await reportResponse.json();
    expect(reportBody).toMatchObject({
      ok: true,
      status: 'queued',
    });
    expect(reportBody.report_id).toEqual(expect.any(Number));

    const adminListResponse = await request.get('/api/admin/safety/reports?limit=10', {
      headers: adminHeaders,
    });
    expect(adminListResponse.status()).toBe(200);
    const adminListBody = await adminListResponse.json();
    const createdReport = adminListBody.reports.find((item) => item.id === reportBody.report_id);
    expect(createdReport).toMatchObject({
      target_type: 'post',
      target_post_id: 9601,
      target_user_id: 9502,
      status: 'queued',
      reason_code: 'spam',
    });

    const resolveResponse = await request.post(
      `/api/admin/safety/reports/${reportBody.report_id}/resolve`,
      {
        headers: adminHeaders,
        data: {
          status: 'actioned',
          action: 'content_removed',
          action_detail: 'fixture moderation action',
        },
      }
    );
    expect(resolveResponse.status()).toBe(200);
    const resolveBody = await resolveResponse.json();
    expect(resolveBody.report).toMatchObject({
      id: reportBody.report_id,
      status: 'actioned',
      action: 'content_removed',
    });
  });

  test('blocking a user hides their content from viewer-facing APIs', async ({ request }) => {
    const viewerHeaders = buildAuthHeaders(9501);

    const blockResponse = await request.post('/api/users/9502/block', {
      headers: viewerHeaders,
      data: {
        reason_code: 'harassment',
        context_post_id: 9601,
      },
    });
    expect(blockResponse.status()).toBe(200);
    const blockBody = await blockResponse.json();
    expect(blockBody).toMatchObject({
      ok: true,
      blocked_user_id: 9502,
    });

    const searchResponse = await request.get('/api/search', {
      headers: viewerHeaders,
      params: { q: 'fixture', type: 'all' },
    });
    expect(searchResponse.status()).toBe(200);
    const searchBody = await searchResponse.json();
    expect(searchBody.posts.find((item) => item.id === 9601)).toBeFalsy();
    expect(searchBody.authors.find((item) => item.id === 9502)).toBeFalsy();

    const feedResponse = await request.get('/api/posts', {
      headers: viewerHeaders,
      params: { limit: '10' },
    });
    expect(feedResponse.status()).toBe(200);
    const feedBody = await feedResponse.json();
    expect(feedBody.posts.find((item) => item.id === 9601)).toBeFalsy();

    const detailResponse = await request.get('/api/posts/9601', {
      headers: viewerHeaders,
    });
    expect(detailResponse.status()).toBe(404);

    const profileResponse = await request.get('/api/users/9502/profile', {
      headers: viewerHeaders,
    });
    expect(profileResponse.status()).toBe(404);

    const bookmarkResponse = await request.get('/api/bookmarks/lists/9700/items', {
      headers: viewerHeaders,
    });
    expect(bookmarkResponse.status()).toBe(200);
    const bookmarkBody = await bookmarkResponse.json();
    expect(bookmarkBody.posts).toEqual([]);

    const blocksResponse = await request.get('/api/me/blocks', {
      headers: viewerHeaders,
    });
    expect(blocksResponse.status()).toBe(200);
    const blocksBody = await blocksResponse.json();
    expect(blocksBody.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: 9502,
          reason_code: 'harassment',
        }),
      ])
    );
  });
});
