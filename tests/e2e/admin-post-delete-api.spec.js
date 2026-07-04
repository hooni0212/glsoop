const { test, expect } = require('@playwright/test');
const bcrypt = require('bcrypt');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const IDS = Object.freeze({
  admin: 9901,
  author: 9902,
  reader: 9903,
  post: 9901,
  bookmarkList: 9901,
  bookmarkItem: 9901,
  hashtag: 9901,
  genre: 9901,
  comment: 9901,
  activityPost: 9901,
  activityComment: 9902,
  pushDelivery: 9901,
  shareEvent: 9901,
  safetyReport: 9901,
  feedEvent: 9901,
  photoReward: 9901,
  photoEvent: 9901,
  writingContext: 9901,
  questTemplate: 9901,
  questCampaign: 9901,
  questState: 9901,
  questSubmission: 9901,
});

const ADMIN_PASSWORD = 'AdminDelete123!';
const ADMIN_SID = 'admin-post-delete-api-session';

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

const waitForFile = async (filePath, timeoutMs = 20000) => {
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const withDb = async (callback) => {
  await waitForFile(DB_PATH);
  const db = new sqlite3.Database(DB_PATH);
  try {
    return await callback(db);
  } finally {
    await new Promise((resolve, reject) => {
      db.close((err) => (err ? reject(err) : resolve()));
    });
  }
};

async function cleanupFixture(db) {
  await dbRun(db, 'PRAGMA foreign_keys = OFF');
  await dbRun(db, 'DELETE FROM push_delivery_queue WHERE id = ?', [IDS.pushDelivery]);
  await dbRun(db, 'DELETE FROM activity_events WHERE id IN (?, ?)', [
    IDS.activityPost,
    IDS.activityComment,
  ]);
  await dbRun(db, 'DELETE FROM comment_likes WHERE comment_id = ?', [IDS.comment]);
  await dbRun(db, 'DELETE FROM comments WHERE id = ?', [IDS.comment]);
  await dbRun(db, 'DELETE FROM likes WHERE post_id = ?', [IDS.post]);
  await dbRun(db, 'DELETE FROM bookmark_items WHERE id = ? OR post_id = ?', [
    IDS.bookmarkItem,
    IDS.post,
  ]);
  await dbRun(db, 'DELETE FROM bookmark_lists WHERE id = ?', [IDS.bookmarkList]);
  await dbRun(db, 'DELETE FROM post_hashtags WHERE post_id = ?', [IDS.post]);
  await dbRun(db, 'DELETE FROM hashtags WHERE id = ?', [IDS.hashtag]);
  await dbRun(db, 'DELETE FROM post_genres WHERE post_id = ?', [IDS.post]);
  await dbRun(db, 'DELETE FROM genres WHERE id = ?', [IDS.genre]);
  await dbRun(db, 'DELETE FROM quest_post_submissions WHERE id = ? OR post_id = ?', [
    IDS.questSubmission,
    IDS.post,
  ]);
  await dbRun(db, 'DELETE FROM user_quest_state WHERE id = ?', [IDS.questState]);
  await dbRun(db, 'DELETE FROM quest_campaign_items WHERE campaign_id = ? OR template_id = ?', [
    IDS.questCampaign,
    IDS.questTemplate,
  ]);
  await dbRun(db, 'DELETE FROM quest_campaigns WHERE id = ?', [IDS.questCampaign]);
  await dbRun(db, 'DELETE FROM quest_templates WHERE id = ?', [IDS.questTemplate]);
  await dbRun(db, 'DELETE FROM post_writing_event_contexts WHERE id = ? OR post_id = ?', [
    IDS.writingContext,
    IDS.post,
  ]);
  await dbRun(db, 'DELETE FROM share_events WHERE id = ?', [IDS.shareEvent]);
  await dbRun(db, 'DELETE FROM safety_reports WHERE id = ?', [IDS.safetyReport]);
  await dbRun(db, 'DELETE FROM feed_events WHERE id = ?', [IDS.feedEvent]);
  await dbRun(db, 'DELETE FROM photo_save_events WHERE id = ?', [IDS.photoEvent]);
  await dbRun(db, 'DELETE FROM photo_save_ad_rewards WHERE id = ?', [IDS.photoReward]);
  await dbRun(db, 'DELETE FROM posts WHERE id = ?', [IDS.post]);
  await dbRun(db, 'DELETE FROM auth_sessions WHERE sid = ?', [ADMIN_SID]);
  await dbRun(db, 'DELETE FROM users WHERE id IN (?, ?, ?)', [
    IDS.admin,
    IDS.author,
    IDS.reader,
  ]);
  await dbRun(db, 'PRAGMA foreign_keys = ON');
}

async function seedFixture() {
  return withDb(async (db) => {
    await cleanupFixture(db);

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await dbRun(
      db,
      `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [IDS.admin, 'Admin', '관리자', 'admin-post-delete@glsoop.test', adminHash, 1, 1]
    );
    await dbRun(
      db,
      `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        IDS.author,
        'Author',
        '작성자',
        'admin-post-delete-author@glsoop.test',
        adminHash,
        0,
        1,
      ]
    );
    await dbRun(
      db,
      `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        IDS.reader,
        'Reader',
        '독자',
        'admin-post-delete-reader@glsoop.test',
        adminHash,
        0,
        1,
      ]
    );
    await dbRun(
      db,
      `INSERT INTO auth_sessions
         (sid, user_id, remember_me, created_at, last_seen_at, expires_at)
       VALUES (?, ?, 0, ?, ?, ?)`,
      [ADMIN_SID, IDS.admin, now, now, expiresAt]
    );

    await dbRun(
      db,
      `INSERT INTO posts (id, user_id, title, content, category, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [IDS.post, IDS.author, '관리자 삭제 테스트 글', '삭제 참조 데이터 테스트', 'essay']
    );
    await dbRun(db, 'INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [
      IDS.reader,
      IDS.post,
    ]);
    await dbRun(
      db,
      `INSERT INTO bookmark_lists (id, user_id, name, description)
       VALUES (?, ?, ?, ?)`,
      [IDS.bookmarkList, IDS.reader, '관리자 삭제 테스트', '']
    );
    await dbRun(
      db,
      `INSERT INTO bookmark_items (id, list_id, post_id)
       VALUES (?, ?, ?)`,
      [IDS.bookmarkItem, IDS.bookmarkList, IDS.post]
    );
    await dbRun(db, 'INSERT INTO hashtags (id, name) VALUES (?, ?)', [
      IDS.hashtag,
      '관리자삭제테스트',
    ]);
    await dbRun(db, 'INSERT INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?)', [
      IDS.post,
      IDS.hashtag,
    ]);
    await dbRun(
      db,
      `INSERT INTO genres (id, slug, name, group_name, description)
       VALUES (?, ?, ?, ?, ?)`,
      [IDS.genre, 'admin-delete-e2e', '관리자 삭제', 'genre', '관리자 삭제 테스트']
    );
    await dbRun(db, 'INSERT INTO post_genres (post_id, genre_id, source) VALUES (?, ?, ?)', [
      IDS.post,
      IDS.genre,
      'test',
    ]);
    await dbRun(
      db,
      `INSERT INTO comments (id, post_id, user_id, content)
       VALUES (?, ?, ?, ?)`,
      [IDS.comment, IDS.post, IDS.reader, '삭제 테스트 댓글']
    );
    await dbRun(db, 'INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)', [
      IDS.author,
      IDS.comment,
    ]);
    await dbRun(
      db,
      `INSERT INTO activity_events
         (id, recipient_user_id, actor_user_id, event_type, post_id, title, body, unique_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        IDS.activityPost,
        IDS.author,
        IDS.reader,
        'post_liked',
        IDS.post,
        '좋아요',
        '독자가 좋아요를 눌렀습니다.',
        'admin-post-delete-post',
      ]
    );
    await dbRun(
      db,
      `INSERT INTO activity_events
         (id, recipient_user_id, actor_user_id, event_type, post_id, comment_id, title, body, unique_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        IDS.activityComment,
        IDS.author,
        IDS.reader,
        'comment_created',
        IDS.post,
        IDS.comment,
        '댓글',
        '독자가 댓글을 남겼습니다.',
        'admin-post-delete-comment',
      ]
    );
    await dbRun(
      db,
      `INSERT INTO push_delivery_queue
         (id, activity_event_id, recipient_user_id, title, body)
       VALUES (?, ?, ?, ?, ?)`,
      [IDS.pushDelivery, IDS.activityPost, IDS.author, '알림', '관리자 삭제 테스트 알림']
    );
    await dbRun(
      db,
      `INSERT INTO share_events
         (id, post_id, user_id, platform, surface, channel, result, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [IDS.shareEvent, IDS.post, IDS.reader, 'web', 'admin-delete-e2e', 'copy', 'shared', 'admin-delete']
    );
    await dbRun(
      db,
      `INSERT INTO safety_reports
         (id, reporter_id, target_type, target_post_id, target_user_id, reason_code, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [IDS.safetyReport, IDS.reader, 'post', IDS.post, IDS.author, 'spam', 'queued']
    );
    await dbRun(
      db,
      `INSERT INTO feed_events (id, user_id, post_id, event_type, surface)
       VALUES (?, ?, ?, ?, ?)`,
      [IDS.feedEvent, IDS.reader, IDS.post, 'open', 'admin-delete-e2e']
    );
    await dbRun(
      db,
      `INSERT INTO photo_save_ad_rewards
         (id, user_id, post_id, platform, status, expires_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+1 day'))`,
      [IDS.photoReward, IDS.reader, IDS.post, 'ios', 'earned']
    );
    await dbRun(
      db,
      `INSERT INTO photo_save_events
         (id, user_id, post_id, access_type, platform, rewarded_grant_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [IDS.photoEvent, IDS.reader, IDS.post, 'rewarded_ad', 'ios', IDS.photoReward]
    );
    await dbRun(
      db,
      `INSERT INTO post_writing_event_contexts
         (id, post_id, user_id, event_key, prompt_key)
       VALUES (?, ?, ?, ?, ?)`,
      [IDS.writingContext, IDS.post, IDS.author, 'admin-delete-e2e', 'prompt-1']
    );
    await dbRun(
      db,
      `INSERT INTO quest_templates
         (id, name, description, condition_type, category, target_value, reward_xp, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [IDS.questTemplate, '관리자 삭제 테스트', '', 'post_created', 'test', 1, 1, 1]
    );
    await dbRun(
      db,
      `INSERT INTO quest_campaigns
         (id, name, description, campaign_type, is_active, priority)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [IDS.questCampaign, '관리자 삭제 테스트', '', 'event', 1, 1]
    );
    await dbRun(
      db,
      'INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order) VALUES (?, ?, ?)',
      [IDS.questCampaign, IDS.questTemplate, 1]
    );
    await dbRun(
      db,
      `INSERT INTO user_quest_state
         (id, user_id, campaign_id, template_id, progress, reset_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [IDS.questState, IDS.author, IDS.questCampaign, IDS.questTemplate, 1, 'admin-delete-e2e']
    );
    await dbRun(
      db,
      `INSERT INTO quest_post_submissions
         (id, user_id, post_id, state_id, campaign_id, template_id, prompt_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        IDS.questSubmission,
        IDS.author,
        IDS.post,
        IDS.questState,
        IDS.questCampaign,
        IDS.questTemplate,
        'prompt-1',
      ]
    );
  });
}

function buildAdminToken() {
  return jwt.sign(
    {
      id: IDS.admin,
      sid: ADMIN_SID,
      name: 'Admin',
      nickname: '관리자',
      email: 'admin-post-delete@glsoop.test',
      isAdmin: true,
      isVerified: true,
    },
    'devsecret',
    {
      algorithm: 'HS256',
      issuer: 'glsoop',
      audience: 'glsoop-client',
      expiresIn: '1h',
    }
  );
}

test.describe('Admin post delete API', () => {
  test('deletes a post with related admin-managed references', async ({ request }) => {
    await seedFixture();

    const response = await request.delete(`/api/admin/posts/${IDS.post}`, {
      headers: {
        Cookie: `token=${buildAdminToken()}`,
      },
      data: {
        admin_password: ADMIN_PASSWORD,
      },
    });
    const body = await response.json();

    expect(response.ok(), JSON.stringify(body)).toBe(true);
    expect(body).toMatchObject({ ok: true });

    await withDb(async (db) => {
      await expect(dbGet(db, 'SELECT id FROM posts WHERE id = ?', [IDS.post])).resolves.toBeUndefined();
      await expect(
        dbGet(db, 'SELECT post_id FROM likes WHERE post_id = ?', [IDS.post])
      ).resolves.toBeUndefined();
      await expect(
        dbGet(db, 'SELECT post_id FROM bookmark_items WHERE post_id = ?', [IDS.post])
      ).resolves.toBeUndefined();
      await expect(
        dbGet(db, 'SELECT post_id FROM post_hashtags WHERE post_id = ?', [IDS.post])
      ).resolves.toBeUndefined();
      await expect(
        dbGet(db, 'SELECT post_id FROM post_genres WHERE post_id = ?', [IDS.post])
      ).resolves.toBeUndefined();
      await expect(
        dbGet(db, 'SELECT post_id FROM comments WHERE post_id = ?', [IDS.post])
      ).resolves.toBeUndefined();
      await expect(
        dbGet(db, 'SELECT comment_id FROM comment_likes WHERE comment_id = ?', [IDS.comment])
      ).resolves.toBeUndefined();
      await expect(
        dbGet(db, 'SELECT post_id FROM activity_events WHERE post_id = ?', [IDS.post])
      ).resolves.toBeUndefined();
      await expect(
        dbGet(db, 'SELECT id FROM push_delivery_queue WHERE id = ?', [IDS.pushDelivery])
      ).resolves.toBeUndefined();
      await expect(
        dbGet(db, 'SELECT post_id FROM quest_post_submissions WHERE post_id = ?', [IDS.post])
      ).resolves.toBeUndefined();
      await expect(
        dbGet(db, 'SELECT post_id FROM post_writing_event_contexts WHERE post_id = ?', [IDS.post])
      ).resolves.toBeUndefined();

      await expect(
        dbGet(db, 'SELECT post_id FROM share_events WHERE id = ?', [IDS.shareEvent])
      ).resolves.toMatchObject({ post_id: null });
      await expect(
        dbGet(db, 'SELECT target_post_id FROM safety_reports WHERE id = ?', [IDS.safetyReport])
      ).resolves.toMatchObject({ target_post_id: null });
      await expect(
        dbGet(db, 'SELECT post_id FROM feed_events WHERE id = ?', [IDS.feedEvent])
      ).resolves.toMatchObject({ post_id: null });
      await expect(
        dbGet(db, 'SELECT post_id FROM photo_save_ad_rewards WHERE id = ?', [IDS.photoReward])
      ).resolves.toMatchObject({ post_id: null });
      await expect(
        dbGet(db, 'SELECT post_id FROM photo_save_events WHERE id = ?', [IDS.photoEvent])
      ).resolves.toMatchObject({ post_id: null });
    });
  });
});
