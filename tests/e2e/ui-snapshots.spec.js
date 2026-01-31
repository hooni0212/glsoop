const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const SNAPSHOT_ROOT = path.join(process.cwd(), 'test-results', 'ui-snapshots');
const DB_PATH = path.join(process.cwd(), 'tmp', 'e2e_playwright.sqlite');
const BASE_STYLE = '*{transition:none!important;animation:none!important;caret-color:transparent!important;}';

const guestPages = [
  { key: 'home', path: '/' },
  { key: 'explore', path: '/explore' },
  { key: 'category-poem', path: '/html/category.html?category=poem' },
  { key: 'post-1', path: '/html/post.html?postId=1' },
  { key: 'author-1', path: '/html/author.html?userId=1' },
  { key: 'login', path: '/html/login.html' },
  { key: 'signup', path: '/html/signup.html' },
  { key: 'verify-email', path: '/html/verify-email.html?pending_id=1&email=test@glsoop.com' },
  { key: 'forgot-password', path: '/html/forgot-password.html' },
  { key: 'reset-password', path: '/html/reset-password.html?token=dummy' },
  { key: 'ui-kit', path: '/html/ui-kit.html', optional: true },
];

const authedPages = [
  { key: 'editor', path: '/html/editor.html' },
  { key: 'mypage', path: '/html/mypage.html' },
  { key: 'bookmarks', path: '/html/bookmarks.html' },
  { key: 'growth', path: '/html/growth.html' },
];

const adminPages = [{ key: 'admin', path: '/admin' }];

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

const waitForFile = async (filePath, timeoutMs = 5000) => {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const seedTestData = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  const tablesToClear = [
    'bookmark_items',
    'bookmark_lists',
    'likes',
    'follows',
    'posts',
    'otp_verifications',
    'pending_otp_verifications',
    'pending_signups',
    'xp_log',
    'user_achievements',
    'user_quest_state',
    'quest_campaign_items',
    'quest_campaigns',
    'quest_templates',
    'achievements',
    'post_hashtags',
    'hashtags',
    'users',
  ];

  for (const table of tablesToClear) {
    await dbRun(db, `DELETE FROM ${table}`);
  }

  await dbRun(
    db,
    `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)` ,
    [1, 'Admin', '관리자', 'admin@glsoop.test', 'password', 1, 1]
  );
  await dbRun(
    db,
    `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)` ,
    [2, 'User', '일반사용자', 'user@glsoop.test', 'password', 0, 1]
  );

  await dbRun(
    db,
    `INSERT INTO posts (id, user_id, title, content, category)
     VALUES (?, ?, ?, ?, ?)` ,
    [1, 1, 'Poem Post', 'Poem content', 'poem']
  );
  await dbRun(
    db,
    `INSERT INTO posts (id, user_id, title, content, category)
     VALUES (?, ?, ?, ?, ?)` ,
    [2, 1, 'Essay Post', 'Essay content', 'essay']
  );
  await dbRun(
    db,
    `INSERT INTO posts (id, user_id, title, content, category)
     VALUES (?, ?, ?, ?, ?)` ,
    [3, 1, 'Short Post', 'Short content', 'short']
  );

  await dbRun(
    db,
    `INSERT INTO likes (user_id, post_id)
     VALUES (?, ?)` ,
    [2, 1]
  );

  await dbRun(
    db,
    `INSERT INTO follows (follower_id, followee_id)
     VALUES (?, ?)` ,
    [2, 1]
  );

  await dbRun(
    db,
    `INSERT INTO bookmark_lists (id, user_id, name, description)
     VALUES (?, ?, ?, ?)` ,
    [1, 1, 'Favorites', 'E2E list']
  );
  await dbRun(
    db,
    `INSERT INTO bookmark_items (list_id, post_id)
     VALUES (?, ?)` ,
    [1, 1]
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const toUrl = (baseURL, targetPath) => new URL(targetPath, baseURL).toString();

const buildSnapshotPath = (projectName, mode, filename) =>
  path.join(SNAPSHOT_ROOT, projectName, mode, filename);

const writeLogEntries = (logPath, title, entries) => {
  if (!entries.length) return;
  const lines = [`\n## ${title}`, ...entries.map((entry) => `- ${entry}`), ''];
  fs.appendFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');
};

const installLoggers = (page, entries) => {
  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      entries.push(`[console.error] ${msg.text()}`);
    }
  };
  const onPageError = (error) => {
    entries.push(`[pageerror] ${error.message}`);
  };
  const onResponse = (response) => {
    if (response.status() >= 400) {
      entries.push(`[response ${response.status()}] ${response.url()}`);
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  return () => {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
  };
};

const safeClickIfVisible = async (page, selector) => {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return false;
  if (!(await locator.isVisible())) return false;
  await locator.click({ timeout: 2000 });
  return true;
};

const stabilizePage = async (page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.addStyleTag({ content: BASE_STYLE });
  await page.waitForTimeout(300);
};

const captureSnapshot = async ({
  page,
  baseURL,
  projectName,
  mode,
  key,
  pathName,
  optional,
  manifest,
  logPath,
}) => {
  const entries = [];
  const removeLoggers = installLoggers(page, entries);
  const url = toUrl(baseURL, pathName);

  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    entries.push(`[navigation] ${error.message}`);
  }

  if (response && response.status() >= 400) {
    entries.push(`[navigation ${response.status()}] ${url}`);
    if (optional) {
      removeLoggers();
      writeLogEntries(logPath, `${key} (skipped)`, entries);
      return { skipped: true };
    }
  }

  await stabilizePage(page);

  const filePath = buildSnapshotPath(projectName, mode, `${key}.png`);
  ensureDir(path.dirname(filePath));
  await page.screenshot({ path: filePath, fullPage: true });

  const relativeFile = path.relative(SNAPSHOT_ROOT, filePath).split(path.sep).join('/');
  manifest.push({ key, url, file: relativeFile });

  removeLoggers();
  writeLogEntries(logPath, key, entries);
  return { skipped: false };
};

const captureExtraSnapshot = async ({
  page,
  projectName,
  mode,
  key,
  manifest,
}) => {
  const filePath = buildSnapshotPath(projectName, mode, `${key}.png`);
  ensureDir(path.dirname(filePath));
  await page.screenshot({ path: filePath, fullPage: true });
  const relativeFile = path
    .relative(SNAPSHOT_ROOT, filePath)
    .split(path.sep)
    .join('/');
  manifest.push({ key, file: relativeFile });
};

const applyAuthCookie = async (page, baseURL, payload) => {
  const token = jwt.sign(payload, 'devsecret', {
    algorithm: 'HS256',
    issuer: 'glsoop',
    audience: 'glsoop-client',
    expiresIn: '7d',
  });

  await page.context().addCookies([
    {
      name: 'token',
      value: token,
      url: baseURL,
    },
  ]);
};

test.describe('UI snapshot tour', () => {
  test('visit main pages and capture snapshots', async ({ page }, testInfo) => {
    const projectName = testInfo.project.name;
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';

    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await seedTestData();

    const modes = [
      { name: 'guest', pages: guestPages },
      {
        name: 'authed',
        pages: authedPages,
        auth: {
          id: 2,
          name: 'User',
          nickname: '일반사용자',
          email: 'user@glsoop.test',
          isAdmin: false,
          isVerified: true,
        },
      },
      {
        name: 'admin',
        pages: adminPages,
        auth: {
          id: 1,
          name: 'Admin',
          nickname: '관리자',
          email: 'admin@glsoop.test',
          isAdmin: true,
          isVerified: true,
        },
      },
    ];

    for (const mode of modes) {
      await page.context().clearCookies();
      if (mode.auth) {
        await applyAuthCookie(page, baseURL, mode.auth);
      }

      const logPath = buildSnapshotPath(projectName, mode.name, 'console-errors.txt');
      ensureDir(path.dirname(logPath));
      fs.writeFileSync(logPath, `# Console errors (${projectName}/${mode.name})\n`, 'utf8');

      const manifest = [];

      for (const pageEntry of mode.pages) {
        const result = await captureSnapshot({
          page,
          baseURL,
          projectName,
          mode: mode.name,
          key: pageEntry.key,
          pathName: pageEntry.path,
          optional: pageEntry.optional,
          manifest,
          logPath,
        });

        if (result?.skipped) {
          continue;
        }

        if (mode.name === 'guest' && pageEntry.key === 'home') {
          const opened = await safeClickIfVisible(page, '.navbar-toggler');
          if (opened) {
            await stabilizePage(page);
            await captureExtraSnapshot({
              page,
              projectName,
              mode: mode.name,
              key: 'home_nav-open',
              manifest,
            });
          }
        }

        if (mode.name === 'authed' && pageEntry.key === 'post-1') {
          const liked = await safeClickIfVisible(page, '.like-btn');
          if (liked) {
            await stabilizePage(page);
            await captureExtraSnapshot({
              page,
              projectName,
              mode: mode.name,
              key: 'post-1_like-on',
              manifest,
            });
          }

          const modalOpened =
            (await safeClickIfVisible(page, '.ig-share-btn')) ||
            (await safeClickIfVisible(page, '[data-ig-share-btn="1"]'));
          if (modalOpened) {
            await stabilizePage(page);
            await captureExtraSnapshot({
              page,
              projectName,
              mode: mode.name,
              key: 'post-1_modal',
              manifest,
            });
          }
        }

        if (mode.name === 'authed' && pageEntry.key === 'author-1') {
          const followed = await safeClickIfVisible(page, '#authorFollowBtn');
          if (followed) {
            await stabilizePage(page);
            await captureExtraSnapshot({
              page,
              projectName,
              mode: mode.name,
              key: 'author-1_follow-on',
              manifest,
            });
          }
        }
      }

      const manifestPath = buildSnapshotPath(projectName, mode.name, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  });
});
