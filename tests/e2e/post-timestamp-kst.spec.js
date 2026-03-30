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

const seedTimestampData = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [9601, 'Timestamp Writer', '시간작가', 'timestamp-writer@glsoop.test', 'password', 0, 1]
  );

  await dbRun(
    db,
    `INSERT OR REPLACE INTO posts (id, user_id, title, content, category, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [9701, 9601, '시간대 테스트', '<p>작성 시간 확인용 글입니다.</p>', 'short', '2026-03-29 16:16:00']
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

test.describe('Post timestamp timezone normalization', () => {
  test.beforeAll(async () => {
    await seedTimestampData();
  });

  test('returns SQLite UTC timestamps as ISO strings from post APIs', async ({ request }) => {
    const feedResponse = await request.get('/api/posts', {
      params: {
        sort: 'latest',
        limit: '50',
        offset: '0',
      },
    });

    expect(feedResponse.status()).toBe(200);
    const feedPayload = await feedResponse.json();
    const feedPost = (feedPayload.posts || []).find((item) => item.id === 9701);
    expect(feedPost).toBeTruthy();
    expect(feedPost.created_at).toBe('2026-03-29T16:16:00.000Z');

    const detailResponse = await request.get('/api/posts/9701');
    expect(detailResponse.status()).toBe(200);
    const detailPayload = await detailResponse.json();
    expect(detailPayload.post.created_at).toBe('2026-03-29T16:16:00.000Z');
  });

  test('renders bare SQLite timestamps as KST on the post detail page', async ({ page }) => {
    await page.route('**/api/posts/9701', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          post: {
            id: 9701,
            title: '시간대 테스트',
            content: '<p>작성 시간 확인용 글입니다.</p>',
            category: 'short',
            created_at: '2026-03-29 16:16:00',
            author_id: 9601,
            author_name: 'Timestamp Writer',
            author_nickname: '시간작가',
            author_email: 'timestamp-writer@glsoop.test',
            like_count: 0,
            user_liked: 0,
            hashtags: [],
          },
        }),
      })
    );

    await page.route('**/api/posts/9701/related**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          posts: [],
        }),
      })
    );

    await page.goto('/html/post.html?postId=9701');
    await expect(page.locator('#postDetail .gls-post-card')).toBeVisible();
    await expect(page.locator('#postMetaCategory')).toContainText('2026-03-30 01:16');
  });
});
