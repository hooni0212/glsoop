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

const USERS = {
  author: 20801,
  likerA: 20802,
  likerB: 20803,
  commenter: 20804,
  replier: 20805,
  follower: 20806,
  blocked: 20807,
  admin: 20808,
};
const POST_ID = 20811;

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
  const userIds = Object.values(USERS);
  const placeholders = userIds.map(() => '?').join(', ');

  await withDb(async (db) => {
    await dbRun(db, 'PRAGMA foreign_keys = OFF');
    await dbRun(
      db,
      `DELETE FROM push_delivery_queue
       WHERE recipient_user_id IN (${placeholders})
          OR activity_event_id IN (
            SELECT id FROM activity_events
            WHERE recipient_user_id IN (${placeholders})
               OR actor_user_id IN (${placeholders})
          )`,
      [...userIds, ...userIds, ...userIds]
    );
    await dbRun(db, `DELETE FROM marketing_push_consent_events WHERE user_id IN (${placeholders})`, userIds);
    await dbRun(db, `DELETE FROM marketing_push_campaigns WHERE created_by_user_id IN (${placeholders})`, userIds);
    await dbRun(db, `DELETE FROM push_tokens WHERE user_id IN (${placeholders})`, userIds);
    await dbRun(
      db,
      `DELETE FROM activity_events
       WHERE recipient_user_id IN (${placeholders})
          OR actor_user_id IN (${placeholders})`,
      [...userIds, ...userIds]
    );
    await dbRun(db, `DELETE FROM comment_likes WHERE user_id IN (${placeholders})`, userIds);
    await dbRun(db, 'DELETE FROM comments WHERE post_id = ?', [POST_ID]);
    await dbRun(
      db,
      `DELETE FROM user_blocks
       WHERE blocker_id IN (${placeholders})
          OR blocked_user_id IN (${placeholders})`,
      [...userIds, ...userIds]
    );
    await dbRun(
      db,
      `DELETE FROM follows
       WHERE follower_id IN (${placeholders})
          OR followee_id IN (${placeholders})`,
      [...userIds, ...userIds]
    );
    await dbRun(db, 'DELETE FROM bookmark_items WHERE post_id = ?', [POST_ID]);
    await dbRun(db, `DELETE FROM bookmark_lists WHERE user_id IN (${placeholders})`, userIds);
    await dbRun(db, 'DELETE FROM likes WHERE post_id = ?', [POST_ID]);
    await dbRun(db, 'DELETE FROM posts WHERE id = ?', [POST_ID]);
    await dbRun(db, `DELETE FROM users WHERE id IN (${placeholders})`, userIds);

    for (const [role, id] of Object.entries(USERS)) {
      await dbRun(
        db,
        `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
         VALUES (?, ?, ?, ?, ?, 0, 1)`,
        [id, `Notification ${role}`, `notify_${role}`, `${role}@notifications.glsoop.test`, 'password']
      );
    }

    await dbRun(db, 'UPDATE users SET is_admin = 1 WHERE id = ?', [USERS.admin]);

    await dbRun(
      db,
      `INSERT INTO posts (id, user_id, title, content, category, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '-1 hour'))`,
      [POST_ID, USERS.author, 'Notification Fixture', 'notification test post', 'essay']
    );
    await dbRun(db, 'PRAGMA foreign_keys = ON');
  });
}

async function getQueuedPushPayloads(recipientUserId) {
  const rows = await withDb((db) =>
    dbAll(
      db,
      `
      SELECT payload_json
      FROM push_delivery_queue
      WHERE recipient_user_id = ?
      ORDER BY id ASC
      `,
      [recipientUserId]
    )
  );

  return rows.map((row) => JSON.parse(row.payload_json || '{}'));
}

test.describe('Notifications API', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
    await seedFixtures();
  });

  test('aggregates post reactions and marks the grouped notification read', async ({ request }) => {
    const tokenResponse = await request.post('/api/push-tokens', {
      headers: buildAuthHeaders(USERS.author),
      data: {
        token: 'ExponentPushToken[notifications-like-push-e2e]',
        platform: 'ios',
        device_id: 'notifications-like-push-device',
        app_version: '1.0.0',
      },
    });
    expect(tokenResponse.status()).toBe(201);

    for (const userId of [USERS.likerA, USERS.likerB]) {
      const likeResponse = await request.post(`/api/posts/${POST_ID}/toggle-like`, {
        headers: buildAuthHeaders(userId),
      });
      expect(likeResponse.status()).toBe(200);
      expect((await likeResponse.json()).liked).toBe(true);
    }

    const listResponse = await request.get('/api/notifications?limit=30&offset=0', {
      headers: buildAuthHeaders(USERS.author),
    });
    expect(listResponse.status()).toBe(200);
    const payload = await listResponse.json();
    const reaction = payload.notifications.find((item) => item.type === 'post_reaction');

    expect(payload.unread_count).toBe(1);
    expect(reaction).toMatchObject({
      id: `post_reaction:${POST_ID}`,
      type: 'post_reaction',
      actor_count: 2,
      post_id: POST_ID,
      target_path: `/posts/${POST_ID}`,
      read_at: null,
    });
    expect(reaction.title).toBe('2명이 내 글에 공감했어요.');

    const queuedBeforeRead = await getQueuedPushPayloads(USERS.author);
    const reactionPushes = queuedBeforeRead.filter((item) => item.type === 'post_reaction');
    expect(reactionPushes).toHaveLength(2);
    expect(reactionPushes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'post_reaction',
          event_type: 'post_liked',
          target_path: `/posts/${POST_ID}`,
          post_id: POST_ID,
          user_id: USERS.likerA,
        }),
        expect.objectContaining({
          type: 'post_reaction',
          event_type: 'post_liked',
          target_path: `/posts/${POST_ID}`,
          post_id: POST_ID,
          user_id: USERS.likerB,
        }),
      ])
    );

    const readResponse = await request.patch(
      `/api/notifications/${encodeURIComponent(reaction.id)}/read`,
      {
        headers: buildAuthHeaders(USERS.author),
      }
    );
    expect(readResponse.status()).toBe(200);

    const afterReadResponse = await request.get('/api/notifications?limit=30&offset=0', {
      headers: buildAuthHeaders(USERS.author),
    });
    const afterRead = await afterReadResponse.json();
    const readReaction = afterRead.notifications.find((item) => item.id === reaction.id);
    expect(afterRead.unread_count).toBe(0);
    expect(readReaction.read_at).toBeTruthy();
  });

  test('lists comments, replies, and followers with push payload metadata', async ({ request }) => {
    const tokenResponse = await request.post('/api/push-tokens', {
      headers: buildAuthHeaders(USERS.author),
      data: {
        token: 'ExponentPushToken[notifications-api-e2e]',
        platform: 'ios',
        device_id: 'notifications-e2e-device',
        app_version: '1.0.0',
      },
    });
    expect(tokenResponse.status()).toBe(201);

    const commentResponse = await request.post(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.commenter),
      data: {
        content: '알림함 댓글입니다.',
      },
    });
    expect(commentResponse.status()).toBe(201);

    const parentResponse = await request.post(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.author),
      data: {
        content: '답글 받을 댓글입니다.',
      },
    });
    expect(parentResponse.status()).toBe(201);
    const parent = (await parentResponse.json()).comment;

    const replyResponse = await request.post(`/api/posts/${POST_ID}/comments`, {
      headers: buildAuthHeaders(USERS.replier),
      data: {
        parent_comment_id: parent.id,
        content: '알림함 답글입니다.',
      },
    });
    expect(replyResponse.status()).toBe(201);

    const followResponse = await request.post(`/api/users/${USERS.author}/follow`, {
      headers: buildAuthHeaders(USERS.follower),
    });
    expect(followResponse.status()).toBe(200);
    expect((await followResponse.json()).following).toBe(true);

    const listResponse = await request.get('/api/notifications?limit=30&offset=0', {
      headers: buildAuthHeaders(USERS.author),
    });
    expect(listResponse.status()).toBe(200);
    const notifications = (await listResponse.json()).notifications;
    const types = notifications.map((item) => item.type);

    expect(types).toContain('post_comment');
    expect(types).toContain('comment_reply');
    expect(types).toContain('new_follower');
    expect(notifications.find((item) => item.type === 'post_comment')).toMatchObject({
      target_path: `/posts/${POST_ID}`,
      post_id: POST_ID,
      user_id: USERS.commenter,
    });
    expect(notifications.find((item) => item.type === 'comment_reply')).toMatchObject({
      target_path: `/posts/${POST_ID}`,
      post_id: POST_ID,
      user_id: USERS.replier,
    });
    expect(notifications.find((item) => item.type === 'new_follower')).toMatchObject({
      target_path: `/users/${USERS.follower}`,
      user_id: USERS.follower,
    });

    const queuedPayloads = await getQueuedPushPayloads(USERS.author);
    expect(queuedPayloads.map((item) => item.type)).toEqual(
      expect.arrayContaining(['post_comment', 'comment_reply', 'new_follower'])
    );
    expect(queuedPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'new_follower',
          target_path: `/users/${USERS.follower}`,
          user_id: USERS.follower,
        }),
      ])
    );
  });

  test('suppresses blocked actor events from creation and notification exposure', async ({ request }) => {
    await withDb((db) =>
      dbRun(
        db,
        `INSERT OR REPLACE INTO user_blocks (blocker_id, blocked_user_id, reason_code)
         VALUES (?, ?, ?)`,
        [USERS.author, USERS.blocked, 'harassment']
      )
    );

    const blockedLikeResponse = await request.post(`/api/posts/${POST_ID}/toggle-like`, {
      headers: buildAuthHeaders(USERS.blocked),
    });
    expect(blockedLikeResponse.status()).toBe(200);

    const blockedActivityRow = await withDb((db) =>
      dbGet(
        db,
        `
        SELECT COUNT(*) AS cnt
        FROM activity_events
        WHERE recipient_user_id = ?
          AND actor_user_id = ?
        `,
        [USERS.author, USERS.blocked]
      )
    );
    expect(blockedActivityRow.cnt).toBe(0);

    await withDb((db) =>
      dbRun(
        db,
        `
        INSERT INTO activity_events (
          recipient_user_id,
          actor_user_id,
          event_type,
          post_id,
          title,
          body
        )
        VALUES (?, ?, 'post_liked', ?, '차단된 공감', '차단된 사용자 이벤트')
        `,
        [USERS.author, USERS.blocked, POST_ID]
      )
    );

    const listResponse = await request.get('/api/notifications?limit=30&offset=0', {
      headers: buildAuthHeaders(USERS.author),
    });
    expect(listResponse.status()).toBe(200);
    const notifications = (await listResponse.json()).notifications;
    expect(notifications.some((item) => item.type === 'post_reaction')).toBe(false);
  });

	  test('stores marketing push consent changes with an audit trail', async ({ request }) => {
	    const initialResponse = await request.get('/api/marketing-push-consent', {
	      headers: buildAuthHeaders(USERS.author),
    });
    expect(initialResponse.status()).toBe(200);
    const initialPayload = await initialResponse.json();
    expect(initialPayload.consent.marketing_push_opt_in).toBe(false);
    expect(initialPayload.consent.marketing_version).toBeTruthy();

    const optInResponse = await request.patch('/api/marketing-push-consent', {
      headers: buildAuthHeaders(USERS.author),
      data: {
        marketing_push_opt_in: true,
        marketing_version: initialPayload.consent.marketing_version,
      },
    });
    expect(optInResponse.status()).toBe(200);
    expect((await optInResponse.json()).consent.marketing_push_opt_in).toBe(true);

    const optOutResponse = await request.patch('/api/marketing-push-consent', {
      headers: buildAuthHeaders(USERS.author),
      data: {
        marketing_push_opt_in: false,
        marketing_version: initialPayload.consent.marketing_version,
      },
    });
    expect(optOutResponse.status()).toBe(200);
    expect((await optOutResponse.json()).consent.marketing_push_opt_in).toBe(false);

    const eventRow = await withDb((db) =>
      dbGet(
        db,
        `
        SELECT COUNT(*) AS cnt
        FROM marketing_push_consent_events
        WHERE user_id = ?
        `,
        [USERS.author]
      )
    );
	    expect(eventRow.cnt).toBe(2);
	  });

	  test('rejects malformed marketing push consent updates', async ({ request }) => {
	    const response = await request.patch('/api/marketing-push-consent', {
	      headers: buildAuthHeaders(USERS.author),
	      data: {},
	    });
	    expect(response.status()).toBe(400);
	    expect((await response.json()).code).toBe('INVALID_REQUEST');
	  });

	  test('queues marketing push campaigns only for opted-in users', async ({ request }) => {
    const authorTokenResponse = await request.post('/api/push-tokens', {
      headers: buildAuthHeaders(USERS.author),
      data: {
        token: 'ExponentPushToken[marketing-push-author-e2e]',
        platform: 'ios',
        device_id: 'marketing-author-device',
        app_version: '1.0.0',
      },
    });
    expect(authorTokenResponse.status()).toBe(201);

    const commenterTokenResponse = await request.post('/api/push-tokens', {
      headers: buildAuthHeaders(USERS.commenter),
      data: {
        token: 'ExponentPushToken[marketing-push-commenter-e2e]',
        platform: 'ios',
        device_id: 'marketing-commenter-device',
        app_version: '1.0.0',
      },
    });
    expect(commenterTokenResponse.status()).toBe(201);

    const consentResponse = await request.get('/api/marketing-push-consent', {
      headers: buildAuthHeaders(USERS.author),
    });
    const marketingVersion = (await consentResponse.json()).consent.marketing_version;

    const optInResponse = await request.patch('/api/marketing-push-consent', {
      headers: buildAuthHeaders(USERS.author),
      data: {
        marketing_push_opt_in: true,
        marketing_version: marketingVersion,
      },
    });
    expect(optInResponse.status()).toBe(200);

    const listBeforeResponse = await request.get('/api/admin/marketing-push-campaigns?limit=5', {
      headers: buildAuthHeaders(USERS.admin),
    });
    expect(listBeforeResponse.status()).toBe(200);
    const listBeforePayload = await listBeforeResponse.json();
    expect(listBeforePayload.audience.eligible_user_count).toBeGreaterThanOrEqual(1);
    expect(listBeforePayload.audience.eligible_token_count).toBeGreaterThanOrEqual(1);

    const dryRunResponse = await request.post('/api/admin/marketing-push-campaigns', {
      headers: buildAuthHeaders(USERS.admin),
      data: {
        title: '이번 주 글쓰기 리마인드',
        body: '조용히 남겨둘 문장을 한 편 써보세요.',
        target_path: '/write',
        dry_run: true,
      },
    });
    expect(dryRunResponse.status()).toBe(200);
    const dryRunPayload = await dryRunResponse.json();
    expect(dryRunPayload.dry_run).toBe(true);
    expect(dryRunPayload.eligible_user_count).toBeGreaterThanOrEqual(1);
    expect(dryRunPayload.eligible_token_count).toBeGreaterThanOrEqual(1);

    const campaignResponse = await request.post('/api/admin/marketing-push-campaigns', {
      headers: buildAuthHeaders(USERS.admin),
      data: {
        title: '이번 주 글쓰기 리마인드',
        body: '조용히 남겨둘 문장을 한 편 써보세요.',
        target_path: '/write',
      },
    });
    expect(campaignResponse.status()).toBe(201);
    const campaignPayload = await campaignResponse.json();
    expect(campaignPayload.queued_count).toBeGreaterThanOrEqual(1);
    expect(campaignPayload.eligible_token_count).toBeGreaterThanOrEqual(1);

    const authorPayloads = await getQueuedPushPayloads(USERS.author);
    expect(authorPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'marketing_campaign',
          campaign_id: campaignPayload.campaign_id,
          target_path: '/write',
        }),
      ])
    );

	    const queuedTitleRow = await withDb((db) =>
	      dbGet(
	        db,
        `
        SELECT title
        FROM push_delivery_queue
        WHERE recipient_user_id = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [USERS.author]
      )
	    );
	    expect(queuedTitleRow.title).toBe('(광고) 이번 주 글쓰기 리마인드');
	    expect(await getQueuedPushPayloads(USERS.commenter)).toHaveLength(0);

    const nonAdCampaignResponse = await request.post('/api/admin/marketing-push-campaigns', {
      headers: buildAuthHeaders(USERS.admin),
      data: {
        title: '(광고) 오늘의 기록 시간',
        body: '짧은 문장을 남겨보세요.',
        target_path: '/write',
        include_ad_label: false,
      },
    });
    expect(nonAdCampaignResponse.status()).toBe(201);
    const nonAdTitleRow = await withDb((db) =>
      dbGet(
        db,
        `
        SELECT title
        FROM push_delivery_queue
        WHERE recipient_user_id = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [USERS.author]
      )
    );
    expect(nonAdTitleRow.title).toBe('오늘의 기록 시간');

    const listAfterResponse = await request.get('/api/admin/marketing-push-campaigns?limit=5', {
      headers: buildAuthHeaders(USERS.admin),
    });
    expect(listAfterResponse.status()).toBe(200);
    const listAfterPayload = await listAfterResponse.json();
    const originalCampaign = listAfterPayload.campaigns.find(
      (item) => item.id === campaignPayload.campaign_id
    );
    expect(originalCampaign).toMatchObject({
      id: campaignPayload.campaign_id,
      target_path: '/write',
    });
    expect(originalCampaign.queued_count).toBeGreaterThanOrEqual(1);
    expect(listAfterPayload.campaigns[0].title).toBe('오늘의 기록 시간');

	    const notificationsResponse = await request.get('/api/notifications?limit=30&offset=0', {
	      headers: buildAuthHeaders(USERS.author),
	    });
	    expect(notificationsResponse.status()).toBe(200);
	    expect((await notificationsResponse.json()).notifications).toHaveLength(0);

	    const activityResponse = await request.get('/api/activity?limit=30&offset=0', {
	      headers: buildAuthHeaders(USERS.author),
	    });
	    expect(activityResponse.status()).toBe(200);
	    const activityPayload = await activityResponse.json();
	    expect(activityPayload.activities).toHaveLength(0);
	    expect(activityPayload.unread_count).toBe(0);

	    const unreadCountResponse = await request.get('/api/activity/unread-count', {
	      headers: buildAuthHeaders(USERS.author),
	    });
	    expect(unreadCountResponse.status()).toBe(200);
	    expect((await unreadCountResponse.json()).unread_count).toBe(0);
	  });
	});
