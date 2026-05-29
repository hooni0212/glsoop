const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const TAG = 'recommendation-e2e';
const WRITER_ID = 99201;
const POPULAR_POST_ID = 99211;
const RECENT_POST_ID = 99212;
const MID_POST_ID = 99213;
const LIKE_USER_IDS = Array.from({ length: 8 }, (_, index) => 99231 + index);

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
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const seedRecommendedFeedFixtures = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  const postIds = [POPULAR_POST_ID, RECENT_POST_ID, MID_POST_ID];
  await dbRun(db, `DELETE FROM post_hashtags WHERE post_id IN (${postIds.map(() => '?').join(', ')})`, postIds);
  await dbRun(db, `DELETE FROM likes WHERE post_id IN (${postIds.map(() => '?').join(', ')})`, postIds);
  await dbRun(db, `DELETE FROM posts WHERE id IN (${postIds.map(() => '?').join(', ')})`, postIds);

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [WRITER_ID, 'Recommendation Writer', 'recommend_writer', 'recommend-writer@glsoop.test', 'password', 0, 1]
  );

  for (const userId of LIKE_USER_IDS) {
    await dbRun(
      db,
      `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        `Recommendation Reader ${userId}`,
        `recommend_reader_${userId}`,
        `recommend-reader-${userId}@glsoop.test`,
        'password',
        0,
        1,
      ]
    );
  }

  const posts = [
    [POPULAR_POST_ID, '추천 인기 글', '좋아요가 많은 추천 후보입니다.', 'essay', "datetime('now', '-10 day')"],
    [RECENT_POST_ID, '추천 최신 글', '방금 올라온 추천 후보입니다.', 'essay', "datetime('now', '-1 hour')"],
    [MID_POST_ID, '추천 중간 글', '중간 점수의 추천 후보입니다.', 'essay', "datetime('now', '-2 day')"],
  ];

  for (const [id, title, content, category, createdAtExpression] of posts) {
    await dbRun(
      db,
      `INSERT OR REPLACE INTO posts (id, user_id, title, content, category, created_at)
       VALUES (?, ?, ?, ?, ?, ${createdAtExpression})`,
      [id, WRITER_ID, title, content, category]
    );
  }

  for (const userId of LIKE_USER_IDS) {
    await dbRun(
      db,
      `INSERT OR REPLACE INTO likes (user_id, post_id, created_at)
       VALUES (?, ?, datetime('now'))`,
      [userId, POPULAR_POST_ID]
    );
  }

  await dbRun(
    db,
    `INSERT OR IGNORE INTO hashtags (name)
     VALUES (?)`,
    [TAG]
  );
  const tagRow = await dbGet(db, 'SELECT id FROM hashtags WHERE name = ?', [TAG]);

  for (const postId of postIds) {
    await dbRun(
      db,
      `INSERT INTO post_hashtags (post_id, hashtag_id)
       VALUES (?, ?)`,
      [postId, tagRow.id]
    );
  }

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

test.describe('Feed recommendation API', () => {
  test.beforeAll(async () => {
    await seedRecommendedFeedFixtures();
  });

  test('supports server-side recommended sorting for the mobile recommendation tab', async ({ request }) => {
    const response = await request.get('/api/posts', {
      params: {
        sort: 'recommended',
        tag: TAG,
        limit: '10',
        offset: '0',
        seed: '7',
      },
    });

    expect(response.status()).toBe(200);
    const payload = await response.json();

    expect(payload.ok).toBe(true);
    expect(payload.context).toMatchObject({
      sort: 'recommended',
      recommendation_seed: 7,
      tags: [TAG],
    });

    const ids = (payload.posts || []).map((post) => post.id);
    expect(ids).toEqual(expect.arrayContaining([POPULAR_POST_ID, RECENT_POST_ID, MID_POST_ID]));
    expect(ids.indexOf(POPULAR_POST_ID)).toBeLessThan(ids.indexOf(RECENT_POST_ID));
  });

  test('honors exclude_ids for recommendation pagination and refresh flows', async ({ request }) => {
    const response = await request.get('/api/posts', {
      params: {
        sort: 'recommended',
        tag: TAG,
        limit: '10',
        offset: '0',
        seed: '7',
        exclude_ids: `${POPULAR_POST_ID},${RECENT_POST_ID}`,
      },
    });

    expect(response.status()).toBe(200);
    const payload = await response.json();
    const ids = (payload.posts || []).map((post) => post.id);

    expect(payload.context).toMatchObject({
      sort: 'recommended',
      excluded_post_ids: [POPULAR_POST_ID, RECENT_POST_ID],
    });
    expect(ids).toContain(MID_POST_ID);
    expect(ids).not.toContain(POPULAR_POST_ID);
    expect(ids).not.toContain(RECENT_POST_ID);
  });
});
