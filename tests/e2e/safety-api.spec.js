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

const FIXTURE_USER_IDS = [9501, 9502, 9503, 9504, 9505, 9506, 9507, 9599];
const FIXTURE_POST_IDS = [9601, 9602];

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
      resolve(row || null);
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

async function withDb(callback) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  try {
    return await callback(db);
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
}

async function seedSafetyData() {
  await withDb(async (db) => {
    await dbRun(db, 'PRAGMA foreign_keys = OFF');
    await dbRun(
      db,
      `DELETE FROM safety_reports
       WHERE reporter_id IN (${FIXTURE_USER_IDS.join(', ')})
          OR target_user_id IN (${FIXTURE_USER_IDS.join(', ')})
          OR target_post_id IN (${FIXTURE_POST_IDS.join(', ')})`
    );
    await dbRun(
      db,
      `DELETE FROM user_blocks
       WHERE blocker_id IN (${FIXTURE_USER_IDS.join(', ')})
          OR blocked_user_id IN (${FIXTURE_USER_IDS.join(', ')})`
    );
    await dbRun(db, 'DELETE FROM bookmark_items WHERE id IN (9701)');
    await dbRun(db, 'DELETE FROM bookmark_lists WHERE id IN (9700)');
    await dbRun(
      db,
      `DELETE FROM likes
       WHERE user_id IN (${FIXTURE_USER_IDS.join(', ')})
         AND post_id IN (${FIXTURE_POST_IDS.join(', ')})`
    );
    await dbRun(
      db,
      `DELETE FROM follows
       WHERE follower_id IN (${FIXTURE_USER_IDS.join(', ')})
          OR followee_id IN (${FIXTURE_USER_IDS.join(', ')})`
    );
    await dbRun(db, `DELETE FROM posts WHERE id IN (${FIXTURE_POST_IDS.join(', ')})`);
    await dbRun(db, `DELETE FROM users WHERE id IN (${FIXTURE_USER_IDS.join(', ')})`);

    const users = [
      [9501, 'Safety Reader', 'safety_reader', 'safety-reader@glsoop.test', 'password', 0, 1],
      [9502, 'Blocked Author', 'blocked_author', 'blocked-author@glsoop.test', 'password', 0, 1],
      [9503, 'Second Reporter', 'reporter_two', 'reporter-two@glsoop.test', 'password', 0, 1],
      [9504, 'Third Reporter', 'reporter_three', 'reporter-three@glsoop.test', 'password', 0, 1],
      [9505, 'Fourth Reporter', 'reporter_four', 'reporter-four@glsoop.test', 'password', 0, 1],
      [9506, 'Fifth Reporter', 'reporter_five', 'reporter-five@glsoop.test', 'password', 0, 1],
      [9507, 'Dismissed Reporter', 'reporter_six', 'reporter-six@glsoop.test', 'password', 0, 1],
      [9599, 'Safety Admin', 'safety_admin', 'safety-admin@glsoop.test', 'password', 1, 1],
    ];

    for (const user of users) {
      await dbRun(
        db,
        `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        user
      );
    }

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
  });
}

test.describe.serial('Safety API', () => {
  test.beforeEach(async () => {
    await seedSafetyData();
  });

  test('runtime config exposes legal urls and updated safety settings', async ({ request }) => {
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
      report_detail_max_length: 200,
      report_detail_required_reason_codes: ['other'],
    });
    expect(Array.isArray(payload.safety.report_reasons)).toBe(true);
    expect(payload.safety.report_reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'harassment', label: '괴롭힘/비방' }),
        expect.objectContaining({ code: 'violence', label: '폭력성/자해/위협' }),
        expect.objectContaining({ code: 'impersonation', label: '사칭/도용' }),
        expect.objectContaining({ code: 'other', label: '기타' }),
      ])
    );
    expect(payload.safety.report_reasons.find((reason) => reason.code === 'illegal')).toBeFalsy();
  });

  test('validates report reasons and detail rules at the server', async ({ request }) => {
    const viewerHeaders = buildAuthHeaders(9501);

    const emptyOtherResponse = await request.post('/api/posts/9601/report', {
      headers: viewerHeaders,
      data: {
        reason_code: 'other',
        detail: '   ',
      },
    });
    expect(emptyOtherResponse.status()).toBe(400);

    const invalidReasonResponse = await request.post('/api/posts/9601/report', {
      headers: viewerHeaders,
      data: {
        reason_code: 'illegal',
        detail: 'unsupported reason',
      },
    });
    expect(invalidReasonResponse.status()).toBe(400);

    const ignoredDetailResponse = await request.post('/api/posts/9601/report', {
      headers: viewerHeaders,
      data: {
        reason_code: 'spam',
        detail: '이 상세는 저장되면 안 됩니다.',
      },
    });
    expect(ignoredDetailResponse.status()).toBe(200);
    const ignoredDetailBody = await ignoredDetailResponse.json();

    const storedSpamReport = await withDb((db) =>
      dbGet(db, 'SELECT reason_code, detail FROM safety_reports WHERE id = ?', [ignoredDetailBody.report_id])
    );
    expect(storedSpamReport).toMatchObject({
      reason_code: 'spam',
      detail: null,
    });
  });

  test('queues safety reports and allows admin resolution', async ({ request }) => {
    const viewerHeaders = buildAuthHeaders(9501);
    const adminHeaders = buildAuthHeaders(9599);

    const reportResponse = await request.post('/api/posts/9601/report', {
      headers: viewerHeaders,
      data: {
        reason_code: 'other',
        detail: '기타 사유 신고 상세입니다.',
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
      source: 'report',
      reason_code: 'other',
      detail: '기타 사유 신고 상세입니다.',
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

  test('blocking a user hides their content and creates an admin-visible safety report', async ({ request }) => {
    const viewerHeaders = buildAuthHeaders(9501);
    const adminHeaders = buildAuthHeaders(9599);
    const beforeCounts = await withDb((db) =>
      dbGet(db, 'SELECT COUNT(*) AS count FROM safety_reports')
    );

    const blockResponse = await request.post('/api/users/9502/block', {
      headers: viewerHeaders,
      data: {
        reason_code: 'harassment',
        detail: '이 상세는 저장되면 안 됩니다.',
        context_post_id: 9601,
      },
    });
    expect(blockResponse.status()).toBe(200);
    const blockBody = await blockResponse.json();
    expect(blockBody).toMatchObject({
      ok: true,
      blocked_user_id: 9502,
      report_id: expect.any(Number),
      already_blocked: false,
    });

    const afterCounts = await withDb((db) =>
      dbGet(db, 'SELECT COUNT(*) AS count FROM safety_reports')
    );
    expect(afterCounts.count).toBe(beforeCounts.count + 1);

    const storedBlockReport = await withDb((db) =>
      dbGet(
        db,
        `SELECT
          id,
          reporter_id,
          target_type,
          target_post_id,
          target_user_id,
          source,
          reason_code,
          detail,
          status
        FROM safety_reports
        WHERE id = ?`,
        [blockBody.report_id]
      )
    );
    expect(storedBlockReport).toMatchObject({
      id: blockBody.report_id,
      reporter_id: 9501,
      target_type: 'user',
      target_post_id: 9601,
      target_user_id: 9502,
      source: 'block',
      reason_code: 'harassment',
      detail: null,
      status: 'queued',
    });

    const adminListResponse = await request.get('/api/admin/safety/reports?limit=20', {
      headers: adminHeaders,
    });
    expect(adminListResponse.status()).toBe(200);
    const adminListBody = await adminListResponse.json();
    const blockQueueItem = adminListBody.reports.find((item) => item.id === blockBody.report_id);
    expect(blockQueueItem).toMatchObject({
      id: blockBody.report_id,
      source: 'block',
      target_type: 'user',
      target_post_id: 9601,
      target_user_id: 9502,
      status: 'queued',
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
          display_name: expect.any(String),
          nickname: 'blocked_author',
          reason_code: 'harassment',
          detail: null,
          created_at: expect.any(String),
        }),
      ])
    );
  });

  test('admin report list includes block-source rows while reported-posts keeps explicit reports only', async ({ request }) => {
    const adminHeaders = buildAuthHeaders(9599);

    const activeReporters = [9501, 9503, 9504, 9505, 9506];
    for (const reporterId of activeReporters) {
      const response = await request.post('/api/posts/9601/report', {
        headers: buildAuthHeaders(reporterId),
        data: {
          reason_code: 'spam',
          detail: `ignored detail from ${reporterId}`,
        },
      });
      expect(response.status()).toBe(200);
    }

    await withDb(async (db) => {
      await dbRun(
        db,
        `INSERT INTO safety_reports (
          reporter_id,
          target_type,
          target_post_id,
          target_user_id,
          source,
          reason_code,
          detail,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [9507, 'post', 9601, 9502, 'report', 'other', 'dismissed report detail', 'dismissed']
      );
      await dbRun(
        db,
        `INSERT INTO safety_reports (
          reporter_id,
          target_type,
          target_post_id,
          target_user_id,
          source,
          reason_code,
          detail,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [9501, 'post', 9601, 9502, 'block', 'harassment', null, 'queued']
      );
    });

    const adminListResponse = await request.get('/api/admin/safety/reports?limit=20', {
      headers: adminHeaders,
    });
    expect(adminListResponse.status()).toBe(200);
    const adminListBody = await adminListResponse.json();
    expect(adminListBody.reports.length).toBe(7);
    expect(adminListBody.reports.filter((report) => report.source === 'report')).toHaveLength(6);
    expect(adminListBody.reports.filter((report) => report.source === 'block')).toHaveLength(1);

    const reportedPostsResponse = await request.get('/api/admin/safety/reported-posts?limit=10', {
      headers: adminHeaders,
    });
    expect(reportedPostsResponse.status()).toBe(200);
    const reportedPostsBody = await reportedPostsResponse.json();
    const postSummary = reportedPostsBody.posts.find((item) => item.target_post_id === 9601);

    expect(postSummary).toMatchObject({
      target_post_id: 9601,
      target_post_title: 'Fixture Safety Post',
      target_user_id: 9502,
      report_count: 5,
      unique_reporter_count: 5,
    });
    expect(typeof postSummary.latest_reported_at).toBe('string');
  });

  test('admin can resolve active reports for a reported post in bulk', async ({ request }) => {
    const adminHeaders = buildAuthHeaders(9599);
    const activeReporters = [9501, 9503, 9504, 9505, 9506];

    for (const reporterId of activeReporters) {
      const response = await request.post('/api/posts/9601/report', {
        headers: buildAuthHeaders(reporterId),
        data: {
          reason_code: 'spam',
        },
      });
      expect(response.status()).toBe(200);
    }

    const resolveResponse = await request.post('/api/admin/safety/reported-posts/9601/resolve', {
      headers: adminHeaders,
      data: {
        status: 'dismissed',
        action: 'no_violation',
        action_detail: 'bulk dismiss fixture',
      },
    });
    expect(resolveResponse.status()).toBe(200);
    const resolveBody = await resolveResponse.json();
    expect(resolveBody.result).toMatchObject({
      target_post_id: 9601,
      status: 'dismissed',
      action: 'no_violation',
      updated_count: 5,
    });

    const statusCounts = await withDb((db) =>
      dbGet(
        db,
        `SELECT
           COUNT(*) AS count,
           SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed_count
         FROM safety_reports
         WHERE target_post_id = ? AND source = 'report'`,
        [9601]
      )
    );
    expect(statusCounts.count).toBe(5);
    expect(statusCounts.dismissed_count).toBe(5);

    const reportedPostsResponse = await request.get('/api/admin/safety/reported-posts?limit=10', {
      headers: adminHeaders,
    });
    expect(reportedPostsResponse.status()).toBe(200);
    const reportedPostsBody = await reportedPostsResponse.json();
    expect(reportedPostsBody.posts.find((item) => item.target_post_id === 9601)).toBeFalsy();
  });

  test('admin can delete a reported post and mark active reports actioned', async ({ request }) => {
    const adminHeaders = buildAuthHeaders(9599);
    const activeReporters = [9501, 9503, 9504, 9505, 9506];

    for (const reporterId of activeReporters) {
      const response = await request.post('/api/posts/9601/report', {
        headers: buildAuthHeaders(reporterId),
        data: {
          reason_code: 'hate',
        },
      });
      expect(response.status()).toBe(200);
    }

    const deleteResponse = await request.post('/api/admin/safety/reported-posts/9601/delete', {
      headers: adminHeaders,
      data: {
        action_detail: 'delete reported fixture',
      },
    });
    expect(deleteResponse.status()).toBe(200);
    const deleteBody = await deleteResponse.json();
    expect(deleteBody.result).toMatchObject({
      deleted: true,
      resolved_count: 5,
    });
    expect(deleteBody.result.post).toMatchObject({
      id: 9601,
      title: 'Fixture Safety Post',
    });

    const deletedPost = await withDb((db) =>
      dbGet(db, 'SELECT id FROM posts WHERE id = ?', [9601])
    );
    expect(deletedPost).toBeNull();

    const actionedCounts = await withDb((db) =>
      dbGet(
        db,
        `SELECT
           COUNT(*) AS count,
         SUM(CASE WHEN status = 'actioned' AND action = 'post_deleted' THEN 1 ELSE 0 END) AS actioned_count
         FROM safety_reports
         WHERE target_user_id = ? AND source = 'report'`,
        [9502]
      )
    );
    expect(actionedCounts.count).toBe(5);
    expect(actionedCounts.actioned_count).toBe(5);
  });
});
