const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const REPO_ROOT = process.cwd();
const SNAPSHOT_ROOT = process.env.GLSOOP_SNAPSHOT_ROOT
  ? path.resolve(REPO_ROOT, process.env.GLSOOP_SNAPSHOT_ROOT)
  : path.join(REPO_ROOT, 'test-results', 'ui-snapshots');
const buildRunId = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const RUN_ID = process.env.GLSOOP_SNAPSHOT_RUN_ID || buildRunId();
const RUN_ROOT = path.join(SNAPSHOT_ROOT, 'runs', RUN_ID);
const LATEST_ROOT = path.join(SNAPSHOT_ROOT, 'latest');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');
const BASE_STYLE = '*{transition:none!important;animation:none!important;caret-color:transparent!important;}';

const guestPages = [
  { key: 'home', path: '/' },
  { key: 'explore', path: '/explore', waitFor: '#feedPosts' },
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
  { key: 'bookmarks', path: '/html/bookmarks.html', waitFor: '#bookmarkContent' },
  { key: 'growth', path: '/html/growth.html', waitFor: '#growthLevelLabel' },
  { key: 'post-1', path: '/html/post.html?postId=1', waitFor: '#postDetail' },
  { key: 'author-1', path: '/html/author.html?userId=1', waitFor: '#authorPostsList' },
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
    'user_quest_state',
    'post_hashtags',
    'hashtags',
    'users',
  ];

  const existingTables = await new Promise((resolve, reject) => {
    db.all("SELECT name FROM sqlite_master WHERE type = 'table'", (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(new Set(rows.map((row) => row.name)));
    });
  });

  for (const table of tablesToClear) {
    if (!existingTables.has(table)) continue;
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

const buildSnapshotPath = (root, projectName, mode, filename) =>
  path.join(root, projectName, mode, filename);

const mirrorToLatest = (sourcePath, projectName, mode, filename) => {
  const destination = buildSnapshotPath(LATEST_ROOT, projectName, mode, filename);
  ensureDir(path.dirname(destination));
  fs.copyFileSync(sourcePath, destination);
};

const writeLogEntries = (logPath, title, entries, mirrorPath) => {
  if (!entries.length) return;
  const lines = [`\n## ${title}`, ...entries.map((entry) => `- ${entry}`), ''];
  fs.appendFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');
  if (mirrorPath) {
    fs.appendFileSync(mirrorPath, `${lines.join('\n')}\n`, 'utf8');
  }
};

const installLoggers = (page, entries, baseURL) => {
  const baseOrigin = (() => {
    try {
      return new URL(baseURL).origin;
    } catch (error) {
      return null;
    }
  })();
  const isRelevantRequest = (url, resourceType) => {
    if (!['document', 'xhr', 'fetch'].includes(resourceType)) return false;
    if (!url) return false;
    const sameOrigin = baseOrigin ? url.startsWith(baseOrigin) : false;
    return sameOrigin || url.includes('/api/');
  };

  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      entries.push(`[console.error] ${msg.text()}`);
    }
  };
  const onPageError = (error) => {
    entries.push(`[pageerror] ${error.message}`);
  };
  const onResponse = (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    const resourceType = request.resourceType();
    const url = response.url();
    if (!isRelevantRequest(url, resourceType)) return;
    entries.push(`[response ${response.status()}] ${url}`);
  };
  const onRequestFailed = (request) => {
    const url = request.url();
    const resourceType = request.resourceType();
    if (!isRelevantRequest(url, resourceType)) return;
    const failure = request.failure();
    entries.push(
      `[requestfailed] ${url} (${resourceType}) ${failure?.errorText || 'unknown error'}`
    );
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return () => {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  };
};

const safeClickIfVisible = async (page, selector) => {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return false;
  if (!(await locator.isVisible())) return false;
  try {
    await locator.click({ timeout: 2000 });
    return true;
  } catch (error) {
    return false;
  }
};

const stabilizePage = async (page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.addStyleTag({ content: BASE_STYLE });
  await page.waitForTimeout(300);
};

const renderErrorPlaceholder = async (page, { key, url, reason }) => {
  const escapedReason = reason ? String(reason).replace(/[<>]/g, '') : 'Unknown error';
  const escapedUrl = url ? String(url).replace(/[<>]/g, '') : 'Unknown URL';
  await page.setContent(
    `<!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Navigation failed</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; }
        .panel { border: 2px dashed #d33; padding: 16px; border-radius: 8px; background: #fff5f5; }
        h1 { margin-top: 0; color: #b91c1c; }
        code { display: block; margin-top: 8px; white-space: pre-wrap; }
      </style>
    </head>
    <body>
      <div class="panel">
        <h1>Navigation failed</h1>
        <p><strong>Key:</strong> ${key}</p>
        <p><strong>URL:</strong> ${escapedUrl}</p>
        <code>${escapedReason}</code>
      </div>
    </body>
    </html>`,
    { waitUntil: 'domcontentloaded' }
  );
  await page.addStyleTag({ content: BASE_STYLE });
  await page.waitForTimeout(200);
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
  latestLogPath,
  waitFor,
}) => {
  const entries = [];
  const removeLoggers = installLoggers(page, entries, baseURL);
  const url = toUrl(baseURL, pathName);

  let response;
  let navigationError;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    navigationError = error;
    entries.push(`[navigation] ${error.message}`);
  }

  if (navigationError) {
    await renderErrorPlaceholder(page, {
      key,
      url,
      reason: navigationError.message,
    });
    const filePath = buildSnapshotPath(RUN_ROOT, projectName, mode, `${key}.png`);
    ensureDir(path.dirname(filePath));
    await page.screenshot({ path: filePath, fullPage: true });
    mirrorToLatest(filePath, projectName, mode, `${key}.png`);
    const relativeFile = path
      .relative(SNAPSHOT_ROOT, filePath)
      .split(path.sep)
      .join('/');
    manifest.push({ key, url, file: relativeFile });
    removeLoggers();
    writeLogEntries(logPath, key, entries, latestLogPath);
    return { skipped: true };
  }

  if (response && response.status() >= 400) {
    entries.push(`[navigation ${response.status()}] ${url}`);
    if (optional) {
      removeLoggers();
      writeLogEntries(logPath, `${key} (skipped)`, entries, latestLogPath);
      return { skipped: true };
    }
    await renderErrorPlaceholder(page, {
      key,
      url,
      reason: `HTTP ${response.status()}`,
    });
    const filePath = buildSnapshotPath(RUN_ROOT, projectName, mode, `${key}.png`);
    ensureDir(path.dirname(filePath));
    await page.screenshot({ path: filePath, fullPage: true });
    mirrorToLatest(filePath, projectName, mode, `${key}.png`);
    const relativeFile = path
      .relative(SNAPSHOT_ROOT, filePath)
      .split(path.sep)
      .join('/');
    manifest.push({ key, url, file: relativeFile });
    removeLoggers();
    writeLogEntries(logPath, key, entries, latestLogPath);
    return { skipped: true };
  }

  await stabilizePage(page);
  if (waitFor) {
    try {
      await page.waitForSelector(waitFor, { timeout: 8000 });
    } catch (error) {
      entries.push(`[waitFor] ${waitFor} not found`);
    }
  }

  const filePath = buildSnapshotPath(RUN_ROOT, projectName, mode, `${key}.png`);
  ensureDir(path.dirname(filePath));
  await page.screenshot({ path: filePath, fullPage: true });
  mirrorToLatest(filePath, projectName, mode, `${key}.png`);

  const relativeFile = path
    .relative(SNAPSHOT_ROOT, filePath)
    .split(path.sep)
    .join('/');
  manifest.push({ key, url, file: relativeFile });

  removeLoggers();
  writeLogEntries(logPath, key, entries, latestLogPath);
  return { skipped: false };
};

const captureExtraSnapshot = async ({
  page,
  projectName,
  mode,
  key,
  manifest,
}) => {
  const filePath = buildSnapshotPath(RUN_ROOT, projectName, mode, `${key}.png`);
  ensureDir(path.dirname(filePath));
  await page.screenshot({ path: filePath, fullPage: true });
  mirrorToLatest(filePath, projectName, mode, `${key}.png`);
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
  test.setTimeout(120 * 1000);
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

      const logPath = buildSnapshotPath(RUN_ROOT, projectName, mode.name, 'console-errors.txt');
      const latestLogPath = buildSnapshotPath(
        LATEST_ROOT,
        projectName,
        mode.name,
        'console-errors.txt'
      );
      ensureDir(path.dirname(logPath));
      fs.writeFileSync(logPath, `# Console errors (${projectName}/${mode.name})\n`, 'utf8');
      ensureDir(path.dirname(latestLogPath));
      fs.writeFileSync(latestLogPath, `# Console errors (${projectName}/${mode.name})\n`, 'utf8');

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
          latestLogPath,
          waitFor: pageEntry.waitFor,
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

      const manifestPath = buildSnapshotPath(RUN_ROOT, projectName, mode.name, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const latestManifestPath = buildSnapshotPath(
        LATEST_ROOT,
        projectName,
        mode.name,
        'manifest.json'
      );
      const latestManifest = manifest.map((entry) => ({
        ...entry,
        file: entry.file
          ? path
              .relative(
                SNAPSHOT_ROOT,
                buildSnapshotPath(LATEST_ROOT, projectName, mode.name, `${entry.key}.png`)
              )
              .split(path.sep)
              .join('/')
          : entry.file,
      }));
      ensureDir(path.dirname(latestManifestPath));
      fs.writeFileSync(latestManifestPath, JSON.stringify(latestManifest, null, 2));
    }
  });
});
