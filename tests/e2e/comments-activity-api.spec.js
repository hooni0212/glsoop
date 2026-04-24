const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { dispatchPushBatch } = require('../../services/pushDispatcher');

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');
const AUTH_HEADER_NOW = '2026-03-01T00:00:00+09:00';

const USERS = {
  author: 19801,
  commenter: 19802,
  replier: 19803,
  blocked: 19804,
};
const POST_ID = 19811;

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

function buildAuthHeaders(userId, extraClaims = {}) {
  const token = jwt.sign(
    {
      id: userId,
      name: `User ${userId}`,
      nickname: `user_${userId}`,
      email: `user-${userId}@glsoop.test`,
      isVerified: true,
      ...extraClaims,
    },
    process.env.JWT_SECRET || 'devsecret',
    {
      algorithm: process.env.JWT_ALGORITHM || 'HS256',
      issuer: process.env.JWT_ISSUER || 'glsoop',
      audience: process.env.JWT_AUDIENCE || 'glsoop-client',
      expiresIn: '1h',
    }
  );

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

async function seedFixtures() {
  await withDb(async (db) => {
    await dbRun(db, 'PRAGMA foreign_keys = OFF');
    await dbRun(db, `DELETE FROM push_delivery_queue WHERE recipient_user_id IN (?, ?, ?, ?)`, [
      USERS.author,
      USERS.commenter,
      USERS.replier,
      USERS.blocked,
    ]);
    await dbRun(db, `DELETE FROM push_tokens WHERE user_id IN (?, ?, ?, ?)`, [
      USERS.author,
      USERS.commenter,
      USERS.replier,
      USERS.blocked,
    ]);
    await dbRun(db, `DELETE FROM activity_events WHERE recipient_user_id IN (?, ?, ?, ?)`, [
      USERS.author,
      USERS.commenter,
      USERS.replier,
      USERS.blocked,
    ]);
    await dbRun(
      db,
      `DELETE FROM comment_likes
       WHERE user_id IN (?, ?, ?, ?)`,
      [USERS.author, USERS.commenter, USERS.replier, USERS.blocked]
    );
    await dbRun(db, 'DELETE FROM comments WHERE post_id = ?', [POST_ID]);
    await dbRun(
      db,
      `DELETE FROM user_blocks
       WHERE blocker_id IN (?, ?, ?, ?)
          OR blocked_user_id IN (?, ?, ?, ?)`,
      [
        USERS.author,
        USERS.commenter,
        USERS.replier,
        USERS.blocked,
        USERS.author,
        USERS.commenter,
        USERS.replier,
        USERS.blocked,
      ]
    );
    await dbRun(db, 'DELETE FROM bookmark_items WHERE post_id = ?', [POST_ID]);
    await dbRun(db, 'DELETE FROM bookmark_lists WHERE user_id IN (?, ?, ?, ?)', [
      USERS.author,
      USERS.commenter,
      USERS.replier,
      USERS.blocked,
    ]);
    await dbRun(db, 'DELETE FROM likes WHERE post_id = ?', [POST_ID]);
    await dbRun(db, 'DELETE FROM posts WHERE id = ?', [POST_ID]);
    await dbRun(db, `DELETE FROM users WHERE id IN (?, ?, ?, ?)`, [
      USERS.author,
      USERS.commenter,
      USERS.replier,
      USERS.blocked,
    ]);

    for (const [role, id] of Object.entries(USERS)) {
      await dbRun(
        db,
        `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
         VALUES (?, ?, ?, ?, ?, 0, 1)`,
        [id, `Fixture ${role}`, `fixture_${role}`, `${role}@comments.glsoop.test`, 'password']
      );
    }

    await dbRun(
      db,
      `INSERT INTO posts (id, user_id, title, content, category, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '-1 hour'))`,
      [POST_ID, USERS.author, 'Comment Activity Fixture', 'comment test post', 'essay']
    );
    await dbRun(db, 'PRAGMA foreign_keys = ON');
  });
}

test.describe('Comments and activity API', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedFixtures();
  });

  test('creates comments and emits activity for the post author', async ({ request }) => {
    const response = await request.post(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.commenter),
      data: {
        content: '첫 댓글입니다.',
      },
    });

    expect(response.status()).toBe(201);
    const payload = await response.json();
    expect(payload.comment).toMatchObject({
      post_id: POST_ID,
      content: '첫 댓글입니다.',
      status: 'active',
    });
    expect(payload.comment.author.display_name).toBe('fixture_commenter');

    const activityResponse = await request.get('/api/activity', {
      headers: buildAuthHeaders(USERS.author),
    });
    expect(activityResponse.status()).toBe(200);
    const activityPayload = await activityResponse.json();
    expect(activityPayload.unread_count).toBeGreaterThanOrEqual(1);
    expect(activityPayload.activities[0]).toMatchObject({
      recipient_user_id: USERS.author,
      actor_user_id: USERS.commenter,
      event_type: 'comment_created',
      post_id: POST_ID,
      comment_id: payload.comment.id,
    });
  });

  test('creates reply activity and supports read state', async ({ request }) => {
    const parentResponse = await request.post(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.commenter),
      data: {
        content: '답글 받을 댓글',
      },
    });
    const parent = (await parentResponse.json()).comment;

    const replyResponse = await request.post(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.replier),
      data: {
        parent_comment_id: parent.id,
        content: '답글입니다.',
      },
    });

    expect(replyResponse.status()).toBe(201);
    const reply = (await replyResponse.json()).comment;
    expect(reply.parent_comment_id).toBe(parent.id);

    const activityResponse = await request.get('/api/activity?unread_only=true', {
      headers: buildAuthHeaders(USERS.commenter),
    });
    const activity = (await activityResponse.json()).activities.find(
      (item) => item.event_type === 'comment_replied' && item.comment_id === reply.id
    );
    expect(activity).toBeTruthy();

    const readResponse = await request.patch(`/api/activity/${activity.id}/read`, {
      headers: buildAuthHeaders(USERS.commenter),
    });
    expect(readResponse.status()).toBe(200);

    const countResponse = await request.get('/api/activity/unread-count', {
      headers: buildAuthHeaders(USERS.commenter),
    });
    expect(countResponse.status()).toBe(200);
    const countPayload = await countResponse.json();
    expect(countPayload.unread_count).toBeGreaterThanOrEqual(0);
  });

  test('lists and toggles comment likes', async ({ request }) => {
    const commentResponse = await request.post(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.commenter),
      data: {
        content: '공감 받을 댓글',
      },
    });
    expect(commentResponse.status()).toBe(201);
    const comment = (await commentResponse.json()).comment;
    expect(comment.like_count).toBe(0);
    expect(comment.liked_by_me).toBe(false);

    const likeResponse = await request.post(`/api/comments/${comment.id}/toggle-like`, {
      headers: buildAuthHeaders(USERS.replier),
    });
    expect(likeResponse.status()).toBe(200);
    const likePayload = await likeResponse.json();
    expect(likePayload).toMatchObject({
      ok: true,
      liked: true,
      like_count: 1,
    });

    const listResponse = await request.get(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.replier),
    });
    expect(listResponse.status()).toBe(200);
    const listPayload = await listResponse.json();
    const listed = listPayload.comments.find((item) => item.id === comment.id);
    expect(listed).toMatchObject({
      like_count: 1,
      liked_by_me: true,
    });

    const unlikeResponse = await request.post(`/api/comments/${comment.id}/toggle-like`, {
      headers: buildAuthHeaders(USERS.replier),
    });
    expect(unlikeResponse.status()).toBe(200);
    const unlikePayload = await unlikeResponse.json();
    expect(unlikePayload).toMatchObject({
      liked: false,
      like_count: 0,
    });

    await withDb((db) =>
      dbRun(db, "UPDATE comments SET status = 'deleted' WHERE id = ?", [comment.id])
    );

    const deletedLikeResponse = await request.post(`/api/comments/${comment.id}/toggle-like`, {
      headers: buildAuthHeaders(USERS.replier),
    });
    expect(deletedLikeResponse.status()).toBe(400);

    const anonymousResponse = await request.post(`/api/comments/${comment.id}/toggle-like`);
    expect(anonymousResponse.status()).toBe(401);
  });

  test('emits activity for likes and bookmarks received', async ({ request }) => {
    const likeResponse = await request.post(`/api/posts/${POST_ID}/toggle-like`, {
      headers: buildAuthHeaders(USERS.replier),
    });
    expect(likeResponse.status()).toBe(200);
    const likePayload = await likeResponse.json();
    expect(likePayload.liked).toBe(true);

    const listResponse = await request.post('/api/bookmarks/lists', {
      headers: buildAuthHeaders(USERS.commenter),
      data: {
        name: '댓글 활동 테스트',
      },
    });
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()).list;

    const bookmarkResponse = await request.post(`/api/bookmarks/lists/${list.id}/items`, {
      headers: buildAuthHeaders(USERS.commenter),
      data: {
        postId: POST_ID,
      },
    });
    expect(bookmarkResponse.status()).toBe(200);

    const activityResponse = await request.get('/api/activity', {
      headers: buildAuthHeaders(USERS.author),
    });
    expect(activityResponse.status()).toBe(200);
    const activities = (await activityResponse.json()).activities;
    expect(
      activities.some(
        (item) =>
          item.event_type === 'post_liked' &&
          item.actor_user_id === USERS.replier &&
          item.post_id === POST_ID
      )
    ).toBe(true);
    expect(
      activities.some(
        (item) =>
          item.event_type === 'post_bookmarked' &&
          item.actor_user_id === USERS.commenter &&
          item.post_id === POST_ID
      )
    ).toBe(true);
  });

  test('hides comments from users blocked by the viewer', async ({ request }) => {
    await withDb(async (db) => {
      await dbRun(
        db,
        `INSERT OR REPLACE INTO user_blocks (blocker_id, blocked_user_id, reason_code)
         VALUES (?, ?, ?)`,
        [USERS.author, USERS.blocked, 'harassment']
      );
    });

    const commentResponse = await request.post(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.blocked),
      data: {
        content: '차단된 사용자의 댓글',
      },
    });
    expect(commentResponse.status()).toBe(403);

    await withDb(async (db) => {
      await dbRun(db, 'DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_user_id = ?', [
        USERS.author,
        USERS.blocked,
      ]);
      await dbRun(
        db,
        `INSERT INTO comments (post_id, user_id, content)
         VALUES (?, ?, ?)`,
        [POST_ID, USERS.blocked, '목록에서 숨겨질 댓글']
      );
      await dbRun(
        db,
        `INSERT OR REPLACE INTO user_blocks (blocker_id, blocked_user_id, reason_code)
         VALUES (?, ?, ?)`,
        [USERS.author, USERS.blocked, 'harassment']
      );
    });

    const listResponse = await request.get(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.author),
    });
    const listPayload = await listResponse.json();
    expect(listPayload.comments.some((comment) => comment.author?.id === USERS.blocked)).toBe(false);
  });

  test('creates push queue rows when recipient has a push token', async ({ request }) => {
    const tokenResponse = await request.post('/api/push-tokens', {
      headers: buildAuthHeaders(USERS.author),
      data: {
        token: 'ExponentPushToken[comments-activity-e2e]',
        platform: 'ios',
        device_id: 'e2e-device',
        app_version: '1.0.0',
      },
    });
    expect(tokenResponse.status()).toBe(201);

    const commentResponse = await request.post(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.commenter),
      data: {
        content: '푸시 큐를 만드는 댓글',
      },
    });
    expect(commentResponse.status()).toBe(201);

    const dbRow = await withDb((db) =>
      dbGet(
        db,
        `
        SELECT COUNT(*) AS cnt
        FROM push_delivery_queue
        WHERE recipient_user_id = ?
          AND status = 'queued'
        `,
        [USERS.author]
      )
    );
    expect(dbRow.cnt).toBeGreaterThanOrEqual(1);
  });

  test('validates Expo push token registration input', async ({ request }) => {
    const invalidTokenResponse = await request.post('/api/push-tokens', {
      headers: buildAuthHeaders(USERS.author),
      data: {
        token: 'not-a-push-token',
        platform: 'ios',
      },
    });
    expect(invalidTokenResponse.status()).toBe(400);
    expect((await invalidTokenResponse.json()).code).toBe('INVALID_PUSH_TOKEN');

    const invalidPlatformResponse = await request.post('/api/push-tokens', {
      headers: buildAuthHeaders(USERS.author),
      data: {
        token: 'ExponentPushToken[comments-activity-e2e]',
        platform: 'web',
      },
    });
    expect(invalidPlatformResponse.status()).toBe(400);
    expect((await invalidPlatformResponse.json()).code).toBe('INVALID_PLATFORM');
  });

  test('dispatches queued push deliveries through Expo tickets', async ({ request }) => {
    const token = 'ExponentPushToken[comments-activity-dispatch-e2e]';
    const tokenResponse = await request.post('/api/push-tokens', {
      headers: buildAuthHeaders(USERS.author),
      data: {
        token,
        platform: 'ios',
        device_id: 'dispatch-device',
        app_version: '1.0.0',
      },
    });
    expect(tokenResponse.status()).toBe(201);

    const commentResponse = await request.post(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.commenter),
      data: {
        content: '푸시 발송 테스트 댓글',
      },
    });
    expect(commentResponse.status()).toBe(201);

    const summary = await dispatchPushBatch({
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        expect(body.some((message) => message.to === token)).toBe(true);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: body.map(() => ({ status: 'ok', id: 'expo-ticket-e2e' })),
          }),
        };
      },
    });
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const dbRow = await withDb((db) =>
      dbGet(
        db,
        `
        SELECT status, provider_message_id
        FROM push_delivery_queue
        WHERE recipient_user_id = ?
          AND status = 'sent'
        ORDER BY id DESC
        LIMIT 1
        `,
        [USERS.author]
      )
    );
    expect(dbRow).toMatchObject({
      status: 'sent',
      provider_message_id: 'expo-ticket-e2e',
    });
  });
});
