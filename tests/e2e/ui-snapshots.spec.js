const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const SNAPSHOT_ROOT = path.join(process.cwd(), 'test-results', 'ui-snapshots');
const DB_PATH = path.join(process.cwd(), 'tmp', 'e2e_playwright.sqlite');
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
const JWT_ISSUER = process.env.JWT_ISSUER || 'glsoop';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'glsoop-client';

const PAGES = {
  guest: [
    { key: 'home', url: '/' },
    { key: 'explore', url: '/explore' },
    { key: 'category-poem', url: '/html/category.html?category=poem' },
    { key: 'post-1', url: '/html/post.html?postId=1' },
    { key: 'author-1', url: '/html/author.html?userId=1' },
    { key: 'login', url: '/html/login.html' },
    { key: 'signup', url: '/html/signup.html' },
    { key: 'verify-email', url: '/html/verify-email.html?pending_id=1&email=test@glsoop.com' },
    { key: 'forgot-password', url: '/html/forgot-password.html' },
    { key: 'reset-password', url: '/html/reset-password.html?token=dummy' },
    { key: 'ui-kit', url: '/html/ui-kit.html', optional: true },
  ],
  authed: [
    { key: 'editor', url: '/html/editor.html' },
    { key: 'mypage', url: '/html/mypage.html' },
    { key: 'bookmarks', url: '/html/bookmarks.html' },
    { key: 'growth', url: '/html/growth.html' },
  ],
  admin: [{ key: 'admin', url: '/admin' }],
};

const INTERACTION_SELECTORS = {
  navToggle: ['.navbar-toggler', '[data-gls-toggle="dropdown"]', '.nav-account-pill button'],
  postLike: ['.like-btn', '.post-side-like-btn', '[data-testid="like"]'],
  postModal: ['.ig-share-btn', '[data-ig-share-btn="1"]', '[data-gls-toggle="modal"]'],
  authorFollow: ['#authorFollowBtn', '.author-follow-btn'],
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const appendLog = (logPath, message) => {
  fs.appendFileSync(logPath, `${message}\n`);
};

const attachErrorLogging = (page, logPath, pageKey) => {
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.removeAllListeners('requestfailed');
  page.removeAllListeners('response');

  appendLog(logPath, `\n=== ${pageKey} (${new Date().toISOString()}) ===`);

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    appendLog(logPath, `[console:${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', (error) => {
    appendLog(logPath, `[pageerror] ${error?.stack || error}`);
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure();
    if (!failure) return;
    appendLog(logPath, `[requestfailed] ${request.url()} :: ${failure.errorText}`);
  });

  page.on('response', (response) => {
    if (response.status() < 400) return;
    appendLog(logPath, `[response:${response.status()}] ${response.url()}`);
  });
};

const disableMotion = async (page) => {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
        caret-color: transparent !important;
      }
    `,
  });
};

const stabilize = async (page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
};

const tryClick = async (page, selectors) => {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    try {
      await locator.click({ timeout: 2000 });
      await page.waitForTimeout(200);
      return true;
    } catch (error) {
      // ignore and try next selector
    }
  }
  return false;
};

const captureScreenshot = async (page, filePath) => {
  await stabilize(page);
  await page.screenshot({ path: filePath, fullPage: true });
};

const createToken = (payload) =>
  jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: '7d',
  });

const seedDatabase = async () => {
  ensureDir(path.dirname(DB_PATH));
  const db = new sqlite3.Database(DB_PATH);
  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function callback(err) {
        if (err) return reject(err);
        return resolve(this);
      });
    });

  await run('PRAGMA foreign_keys = OFF');
  await run('BEGIN TRANSACTION');
  await run('DELETE FROM likes');
  await run('DELETE FROM follows');
  await run('DELETE FROM bookmark_items');
  await run('DELETE FROM bookmark_lists');
  await run('DELETE FROM posts');
  await run('DELETE FROM users');
  await run('DELETE FROM sqlite_sequence');
  await run('COMMIT');
  await run('PRAGMA foreign_keys = ON');

  await run(
    'INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [1, 'Admin', '관리자', 'admin@glsoop.test', 'pw', 1, 1]
  );
  await run(
    'INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [2, 'User', '일반', 'user@glsoop.test', 'pw', 0, 1]
  );

  await run(
    'INSERT INTO posts (id, user_id, title, content, category) VALUES (?, ?, ?, ?, ?)',
    [1, 1, 'Poem Title', 'Poem content', 'poem']
  );
  await run(
    'INSERT INTO posts (id, user_id, title, content, category) VALUES (?, ?, ?, ?, ?)',
    [2, 1, 'Essay Title', 'Essay content', 'essay']
  );
  await run(
    'INSERT INTO posts (id, user_id, title, content, category) VALUES (?, ?, ?, ?, ?)',
    [3, 1, 'Short Title', 'Short content', 'short']
  );

  await run('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [2, 1]);
  await run('INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)', [2, 1]);
  await run(
    'INSERT INTO bookmark_lists (id, user_id, name, description) VALUES (?, ?, ?, ?)',
    [1, 1, 'Snapshot List', 'E2E snapshots']
  );
  await run('INSERT INTO bookmark_items (list_id, post_id) VALUES (?, ?)', [1, 1]);

  await new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
};

test.describe('UI snapshots', () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const context = await browser.newContext({ ...testInfo.project.use });
    const page = await context.newPage();
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await context.close();
    await seedDatabase();
  });

  test('captures guest, authed, and admin pages', async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const projectName = testInfo.project.name;

    const modes = [
      {
        name: 'guest',
        token: null,
        pages: PAGES.guest,
      },
      {
        name: 'authed',
        token: createToken({
          id: 2,
          name: 'User',
          nickname: '일반',
          email: 'user@glsoop.test',
          isAdmin: false,
          isVerified: true,
        }),
        pages: PAGES.authed,
      },
      {
        name: 'admin',
        token: createToken({
          id: 1,
          name: 'Admin',
          nickname: '관리자',
          email: 'admin@glsoop.test',
          isAdmin: true,
          isVerified: true,
        }),
        pages: PAGES.admin,
      },
    ];

    for (const mode of modes) {
      const context = await browser.newContext({ ...testInfo.project.use });
      if (mode.token) {
        await context.addCookies([
          {
            name: 'token',
            value: mode.token,
            url: baseURL,
          },
        ]);
      }

      const modeDir = path.join(SNAPSHOT_ROOT, projectName, mode.name);
      ensureDir(modeDir);
      const logPath = path.join(modeDir, 'console-errors.txt');
      fs.writeFileSync(logPath, '');

      const page = await context.newPage();
      const manifest = [];

      for (const pageDef of mode.pages) {
        attachErrorLogging(page, logPath, pageDef.key);

        let response;
        try {
          response = await page.goto(pageDef.url, { waitUntil: 'domcontentloaded' });
        } catch (error) {
          appendLog(logPath, `[navigation-error] ${pageDef.url} :: ${error.message}`);
          continue;
        }

        if (response && response.status() === 404 && pageDef.optional) {
          appendLog(logPath, `[optional-skip] ${pageDef.url} returned 404`);
          continue;
        }

        try {
          await disableMotion(page);
        } catch (error) {
          appendLog(logPath, `[style-error] ${error.message}`);
        }

        const screenshotPath = path.join(modeDir, `${pageDef.key}.png`);
        await captureScreenshot(page, screenshotPath);
        manifest.push({
          key: pageDef.key,
          url: pageDef.url,
          file: path.basename(screenshotPath),
        });

        if (pageDef.key === 'home') {
          const opened = await tryClick(page, INTERACTION_SELECTORS.navToggle);
          if (opened) {
            const navPath = path.join(modeDir, 'home_nav-open.png');
            await captureScreenshot(page, navPath);
            manifest.push({
              key: 'home_nav-open',
              url: pageDef.url,
              file: path.basename(navPath),
            });
          }
        }

        if (pageDef.key === 'post-1') {
          const liked = await tryClick(page, INTERACTION_SELECTORS.postLike);
          if (liked) {
            const likePath = path.join(modeDir, 'post-1_like-on.png');
            await captureScreenshot(page, likePath);
            manifest.push({
              key: 'post-1_like-on',
              url: pageDef.url,
              file: path.basename(likePath),
            });
          }

          const modalOpened = await tryClick(page, INTERACTION_SELECTORS.postModal);
          if (modalOpened) {
            const modalPath = path.join(modeDir, 'post-1_modal.png');
            await captureScreenshot(page, modalPath);
            manifest.push({
              key: 'post-1_modal',
              url: pageDef.url,
              file: path.basename(modalPath),
            });
          }
        }

        if (pageDef.key === 'author-1') {
          const followed = await tryClick(page, INTERACTION_SELECTORS.authorFollow);
          if (followed) {
            const followPath = path.join(modeDir, 'author-1_follow-on.png');
            await captureScreenshot(page, followPath);
            manifest.push({
              key: 'author-1_follow-on',
              url: pageDef.url,
              file: path.basename(followPath),
            });
          }
        }
      }

      fs.writeFileSync(
        path.join(modeDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
      await context.close();
    }
  });
});
