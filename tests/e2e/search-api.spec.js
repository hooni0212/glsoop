const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

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

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const seedSearchData = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [9101, 'Alpha Writer', 'alpha_writer', 'alpha-writer@glsoop.test', 'password', 0, 1]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [9102, 'Reader Fan', 'reader_fan', 'reader-fan@glsoop.test', 'password', 0, 1]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified, account_status, deactivated_at, scheduled_purge_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'deactivated', datetime('now', '-5 day'), datetime('now', '+25 day'))`,
    [9103, 'Ghost Writer', 'ghost_writer', 'ghost-writer@glsoop.test', 'password', 0, 1]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO posts (id, user_id, title, content, category, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '-1 day'))`,
    [
      9201,
      9101,
      'Alpha Search Post',
      'This post is seeded to verify search endpoint behavior for both post and author results.',
      'essay',
    ]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO likes (user_id, post_id, created_at)
    VALUES (?, ?, datetime('now'))`,
    [9102, 9201]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO posts (id, user_id, title, content, category, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '-2 day'))`,
    [
      9202,
      9103,
      'Ghost Forest Letter',
      'This hidden author post should stay visible as anonymous content.',
      'poem',
    ]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO follows (follower_id, followee_id, created_at)
     VALUES (?, ?, datetime('now'))`,
    [9102, 9101]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO bookmark_lists (id, user_id, name, description, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [9301, 9102, 'Search Fixtures', 'Seed list for search API tests']
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO bookmark_items (id, list_id, post_id, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [9401, 9301, 9201]
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

test.describe('Search API', () => {
  test.beforeAll(async () => {
    await seedSearchData();
  });

  test('returns INVALID_REQUEST when query is missing', async ({ request }) => {
    const response = await request.get('/api/search');
    expect(response.status()).toBe(400);

    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });

  test('returns grouped results for type=all', async ({ request }) => {
    const response = await request.get('/api/search', {
      params: {
        q: 'alpha',
        type: 'all',
        limit: '10',
        offset: '0',
      },
    });

    expect(response.status()).toBe(200);
    const payload = await response.json();

    expect(payload.ok).toBe(true);
    expect(payload.query).toBe('alpha');
    expect(Array.isArray(payload.posts)).toBe(true);
    expect(Array.isArray(payload.authors)).toBe(true);
    expect(payload.meta).toEqual({
      posts_count: payload.posts.length,
      authors_count: payload.authors.length,
      limit: 10,
      offset: 0,
    });

    const post = payload.posts.find((item) => item.id === 9201);
    expect(post).toMatchObject({
      id: 9201,
      title: expect.any(String),
      excerpt: expect.any(String),
      category: expect.any(String),
      created_at: expect.any(String),
      author_id: expect.any(Number),
      author_name: expect.any(String),
      author_nickname: expect.any(String),
      like_count: expect.any(Number),
      bookmark_count: expect.any(Number),
    });

    const author = payload.authors.find((item) => item.id === 9101);
    expect(author).toMatchObject({
      id: 9101,
      name: expect.any(String),
      nickname: expect.any(String),
      post_count: expect.any(Number),
      follower_count: expect.any(Number),
    });
  });

  test('respects type filter', async ({ request }) => {
    const postsOnlyResponse = await request.get('/api/search', {
      params: { q: 'alpha', type: 'posts' },
    });
    expect(postsOnlyResponse.status()).toBe(200);
    const postsOnly = await postsOnlyResponse.json();
    expect(Array.isArray(postsOnly.posts)).toBe(true);
    expect(postsOnly.authors).toEqual([]);

    const authorsOnlyResponse = await request.get('/api/search', {
      params: { q: 'alpha', type: 'authors' },
    });
    expect(authorsOnlyResponse.status()).toBe(200);
    const authorsOnly = await authorsOnlyResponse.json();
    expect(Array.isArray(authorsOnly.authors)).toBe(true);
    expect(authorsOnly.posts).toEqual([]);
  });

  test('keeps deactivated author posts searchable as anonymous and hides public profile', async ({ request }) => {
    const searchResponse = await request.get('/api/search', {
      params: { q: 'ghost', type: 'all' },
    });
    expect(searchResponse.status()).toBe(200);
    const searchBody = await searchResponse.json();

    const ghostPost = searchBody.posts.find((item) => item.id === 9202);
    expect(ghostPost).toMatchObject({
      id: 9202,
      author_id: null,
      author_name: '익명',
      author_nickname: '익명',
    });
    expect(searchBody.authors.find((item) => item.id === 9103)).toBeUndefined();

    const profileResponse = await request.get('/api/users/9103/profile');
    expect(profileResponse.status()).toBe(404);

    const postDetailResponse = await request.get('/api/posts/9202');
    expect(postDetailResponse.status()).toBe(200);
    const postDetailBody = await postDetailResponse.json();
    expect(postDetailBody.post).toMatchObject({
      id: 9202,
      author_id: null,
      author_name: '익명',
      author_nickname: '익명',
      author_email: null,
    });
  });
});
