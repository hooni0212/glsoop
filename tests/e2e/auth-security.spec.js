const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';

const USER_ID = 9841;
const USER_EMAIL = 'auth-security-user@glsoop.test';
const USER_PASSWORD = 'Pass1234';

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
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const seedSecurityUser = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);
  const passwordHash = await bcrypt.hash(USER_PASSWORD, 10);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, 0, 1)`,
    [USER_ID, 'Auth Security User', 'auth_security_user', USER_EMAIL, passwordHash]
  );
  await new Promise((resolve) => db.close(resolve));
};

const resetSecurityState = async () => {
  const passwordHash = await bcrypt.hash(USER_PASSWORD, 10);
  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'DELETE FROM auth_login_state WHERE user_id = ?', [USER_ID]);
  await dbRun(db, 'DELETE FROM auth_login_events WHERE user_id = ? OR email = ?', [USER_ID, USER_EMAIL]);
  await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id = ?', [USER_ID]);
  await dbRun(db, 'DELETE FROM password_reset_tokens WHERE user_id = ?', [USER_ID]);
  await dbRun(
    db,
    'UPDATE users SET pw = ?, reset_token = NULL, reset_expires = NULL, remember_login_enabled = 0 WHERE id = ?',
    [passwordHash, USER_ID]
  );
  await new Promise((resolve) => db.close(resolve));
};

const getSeoulDateKey = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
};

const loginRequest = async (request, { pw, remember = false, ip = '198.51.100.10' }) => {
  return request.post('/api/login', {
    headers: { 'x-forwarded-for': ip },
    data: {
      email: USER_EMAIL,
      pw,
      remember,
    },
  });
};

const setRememberPreference = async (enabled) => {
  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'UPDATE users SET remember_login_enabled = ? WHERE id = ?', [enabled ? 1 : 0, USER_ID]);
  await new Promise((resolve) => db.close(resolve));
};

const extractTokenFromSetCookie = (response) => {
  const setCookieHeader = response.headers()['set-cookie'];
  expect(typeof setCookieHeader).toBe('string');
  const matched = /token=([^;]+)/.exec(setCookieHeader);
  expect(matched).toBeTruthy();
  return decodeURIComponent(matched[1]);
};

test.describe('Auth security policy', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedSecurityUser();
  });

  test.beforeEach(async () => {
    await resetSecurityState();
  });

  test('locks account after 5 failed attempts within 15 minutes', async ({ request }) => {
    for (let idx = 0; idx < 4; idx += 1) {
      const response = await loginRequest(request, {
        pw: 'WrongPass123',
        ip: '198.51.100.31',
      });
      expect(response.status()).toBe(401);
      const payload = await response.json();
      expect(payload).toMatchObject({
        ok: false,
        code: 'AUTH_INVALID_CREDENTIALS',
      });
    }

    const fifth = await loginRequest(request, {
      pw: 'WrongPass123',
      ip: '198.51.100.31',
    });
    expect(fifth.status()).toBe(423);
    const fifthBody = await fifth.json();
    expect(fifthBody.ok).toBe(false);
    expect(fifthBody.code).toBe('AUTH_ACCOUNT_LOCKED');
    expect(Number(fifthBody.retry_after)).toBeGreaterThan(0);

    const sixth = await loginRequest(request, {
      pw: USER_PASSWORD,
      ip: '198.51.100.31',
    });
    expect(sixth.status()).toBe(423);
    const sixthBody = await sixth.json();
    expect(sixthBody.code).toBe('AUTH_ACCOUNT_LOCKED');
    expect(Number(sixthBody.retry_after)).toBeGreaterThan(0);

    const db = new sqlite3.Database(DB_PATH);
    const summary = await dbGet(
      db,
      `SELECT
         SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) AS failure_count,
         SUM(CASE WHEN outcome = 'locked' THEN 1 ELSE 0 END) AS locked_count
       FROM auth_login_events
       WHERE user_id = ?`,
      [USER_ID]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(Number(summary.failure_count || 0)).toBeGreaterThanOrEqual(4);
    expect(Number(summary.locked_count || 0)).toBeGreaterThanOrEqual(1);
  });

  test('creates short session and sid token for default login', async ({ request }) => {
    await setRememberPreference(false);
    const loginRes = await loginRequest(request, {
      pw: USER_PASSWORD,
      ip: '198.51.100.41',
    });
    expect(loginRes.status()).toBe(200);

    const body = await loginRes.json();
    expect(body.ok).toBe(true);
    expect(body.remember_me).toBe(false);
    expect(body.remember_notice_required).toBe(false);
    expect(typeof body.session_expires_at).toBe('string');
    expect(body.token).toBeUndefined();

    const setCookieHeader = loginRes.headers()['set-cookie'] || '';
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('SameSite=Lax');
    expect(setCookieHeader).toContain('Path=/');

    const maxAgeMatch = /Max-Age=(\d+)/.exec(setCookieHeader);
    expect(maxAgeMatch).toBeTruthy();
    const maxAge = Number(maxAgeMatch[1]);
    expect(maxAge).toBeGreaterThan(100 * 60);
    expect(maxAge).toBeLessThan(130 * 60);

    const decoded = jwt.verify(extractTokenFromSetCookie(loginRes), E2E_JWT_SECRET, {
      algorithms: [E2E_JWT_ALGORITHM],
      issuer: E2E_JWT_ISSUER,
      audience: E2E_JWT_AUDIENCE,
    });
    expect(typeof decoded.sid).toBe('string');

    const db = new sqlite3.Database(DB_PATH);
    const sessionRow = await dbGet(
      db,
      'SELECT sid, remember_me, expires_at FROM auth_sessions WHERE sid = ?',
      [decoded.sid]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(sessionRow).toBeTruthy();
    expect(Number(sessionRow.remember_me)).toBe(0);

    const expiresMs = new Date(sessionRow.expires_at).getTime();
    const diffMs = expiresMs - Date.now();
    expect(diffMs).toBeGreaterThan(100 * 60 * 1000);
    expect(diffMs).toBeLessThan(130 * 60 * 1000);
  });

  test('creates remember-me long session when remember preference is enabled', async ({ request }) => {
    await setRememberPreference(true);
    const loginRes = await loginRequest(request, {
      pw: USER_PASSWORD,
      ip: '198.51.100.51',
    });
    expect(loginRes.status()).toBe(200);
    const body = await loginRes.json();
    expect(body.ok).toBe(true);
    expect(body.remember_me).toBe(true);
    expect(body.remember_notice_required).toBe(true);
    expect(body.token).toBeUndefined();

    const decoded = jwt.verify(extractTokenFromSetCookie(loginRes), E2E_JWT_SECRET, {
      algorithms: [E2E_JWT_ALGORITHM],
      issuer: E2E_JWT_ISSUER,
      audience: E2E_JWT_AUDIENCE,
    });

    const db = new sqlite3.Database(DB_PATH);
    const sessionRow = await dbGet(
      db,
      'SELECT sid, remember_me, expires_at FROM auth_sessions WHERE sid = ?',
      [decoded.sid]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(sessionRow).toBeTruthy();
    expect(Number(sessionRow.remember_me)).toBe(1);

    const diffMs = new Date(sessionRow.expires_at).getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(28 * 24 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  test('clear cookie keeps required auth-cookie options on logout', async ({ request }) => {
    await setRememberPreference(false);
    const loginRes = await loginRequest(request, {
      pw: USER_PASSWORD,
      ip: '198.51.100.61',
    });
    expect(loginRes.status()).toBe(200);
    const token = extractTokenFromSetCookie(loginRes);

    const logoutRes = await request.post('/api/logout', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(logoutRes.status()).toBe(200);

    const clearCookieHeader = logoutRes.headers()['set-cookie'] || '';
    expect(clearCookieHeader).toContain('token=');
    expect(clearCookieHeader).toContain('Path=/');
    expect(clearCookieHeader).toContain('SameSite=Lax');
    expect(clearCookieHeader).toContain('HttpOnly');
  });

  test('shows remember modal once when remember is enabled and mypage redirect is used', async ({ page }) => {
    await setRememberPreference(true);

    await page.goto('/html/login.html');
    await page.fill('input[name="email"]', USER_EMAIL);
    await page.fill('input[name="pw"]', USER_PASSWORD);
    await page.click('button[type="submit"]');

    const modal = page.locator('#rememberLoginModal');
    await expect(modal).toBeVisible({ timeout: 8000 });
    await page.click('#rememberLoginConfirmBtn', { timeout: 2000 });
    await page.waitForURL('**/html/mypage.html', { timeout: 10000 });

    const rememberedDate = await page.evaluate(
      () => window.localStorage.getItem('glsoop.remember_notice_shown_date')
    );
    expect(rememberedDate).toBe(getSeoulDateKey());
  });

  test('does not mark remember modal notice when remember is disabled', async ({ page }) => {
    await setRememberPreference(false);

    await page.goto('/html/login.html');
    await page.fill('input[name="email"]', USER_EMAIL);
    await page.fill('input[name="pw"]', USER_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/html/mypage.html', { timeout: 10000 });

    const rememberedDate = await page.evaluate(
      () => window.localStorage.getItem('glsoop.remember_notice_shown_date')
    );
    expect(rememberedDate).toBeNull();
  });

  test('does not show remember modal for non-mypage redirect target', async ({ page }) => {
    await setRememberPreference(true);

    await page.goto('/html/login.html?next=/html/editor.html');
    await page.fill('input[name="email"]', USER_EMAIL);
    await page.fill('input[name="pw"]', USER_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/html/editor.html', { timeout: 10000 });

    const rememberedDate = await page.evaluate(
      () => window.localStorage.getItem('glsoop.remember_notice_shown_date')
    );
    expect(rememberedDate).toBeNull();
  });
});
