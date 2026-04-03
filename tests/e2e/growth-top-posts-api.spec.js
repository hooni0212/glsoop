const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';

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
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const signAuthToken = ({ id, name, nickname, email, isAdmin = false, isVerified = true }) =>
  jwt.sign(
    {
      id,
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

const seedGrowthTopPostsFixtures = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [9801, 'Growth Writer', 'growth_writer', 'growth-writer@glsoop.test', 'password', 0, 1]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [9802, 'Growth Reader', 'growth_reader', 'growth-reader@glsoop.test', 'password', 0, 1]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO posts (id, user_id, title, content, category, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '-1 hour'))`,
    [
      9811,
      9801,
      'Growth Rich Preview',
      '<!--FONT:hand--><p>첫 줄 <strong>강조</strong> &amp; 미리보기<br>둘째 줄</p>',
      'essay',
    ]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO likes (user_id, post_id, created_at)
     VALUES (?, ?, datetime('now'))`,
    [9802, 9811]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO bookmark_lists (id, user_id, name, description, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [9821, 9802, 'Growth Top Posts', 'Seed list for growth top posts API tests']
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO bookmark_items (id, list_id, post_id, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [9831, 9821, 9811]
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

test.describe('Growth top posts API', () => {
  test.beforeAll(async () => {
    await seedGrowthTopPostsFixtures();
  });

  test('returns plain-text excerpts for rich post content', async ({ request }) => {
    const token = signAuthToken({
      id: 9802,
      name: 'Growth Reader',
      nickname: 'growth_reader',
      email: 'growth-reader@glsoop.test',
    });

    const response = await request.get('/api/growth/top-posts', {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-auth-legacy-now': '0',
      },
    });
    expect(response.status()).toBe(200);

    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.top_posts)).toBe(true);

    const post = payload.top_posts.find((item) => item.id === 9811);
    expect(post).toMatchObject({
      id: 9811,
      title: 'Growth Rich Preview',
      author_name: 'growth_writer',
      author_display_name: 'growth_writer',
      excerpt: expect.any(String),
    });
    expect(post.excerpt).toContain('첫 줄 강조 & 미리보기');
    expect(post.excerpt).toContain('둘째 줄');
    expect(post.excerpt).not.toContain('<!--');
    expect(post.excerpt).not.toContain('<p>');
    expect(post.excerpt).not.toContain('<br>');
  });
});
