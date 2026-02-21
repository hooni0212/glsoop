const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';
const E2E_RESET_HMAC_SECRET = 'devsecret';

const USER_ID = 9851;
const USER_EMAIL = 'auth-session-user@glsoop.test';
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

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const seedSessionUser = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);
  const passwordHash = await bcrypt.hash(USER_PASSWORD, 10);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, 0, 1)`,
    [USER_ID, 'Auth Session User', 'auth_session_user', USER_EMAIL, passwordHash]
  );
  await new Promise((resolve) => db.close(resolve));
};

const resetSessionState = async () => {
  const passwordHash = await bcrypt.hash(USER_PASSWORD, 10);
  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id = ?', [USER_ID]);
  await dbRun(db, 'DELETE FROM auth_login_state WHERE user_id = ?', [USER_ID]);
  await dbRun(db, 'DELETE FROM auth_login_events WHERE user_id = ? OR email = ?', [USER_ID, USER_EMAIL]);
  await dbRun(db, 'DELETE FROM password_reset_tokens WHERE user_id = ?', [USER_ID]);
  await dbRun(
    db,
    'UPDATE users SET pw = ?, reset_token = NULL, reset_expires = NULL, remember_login_enabled = 0 WHERE id = ?',
    [passwordHash, USER_ID]
  );
  await new Promise((resolve) => db.close(resolve));
};

const login = async (request, { remember = null, ip }) => {
  if (typeof remember === 'boolean') {
    await setRememberPreference(remember);
  }
  const response = await request.post('/api/login', {
    headers: { 'x-forwarded-for': ip },
    data: {
      email: USER_EMAIL,
      pw: USER_PASSWORD,
    },
  });
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  expect(payload.token).toBeUndefined();
  return extractTokenFromSetCookie(response);
};

test.describe('Auth session management', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedSessionUser();
  });

  test.beforeEach(async () => {
    await resetSessionState();
  });

  test('returns active sessions and marks current sid', async ({ request }) => {
    const tokenA = await login(request, { remember: false, ip: '203.0.113.11' });
    const tokenB = await login(request, { remember: true, ip: '203.0.113.12' });

    const decodedA = jwt.verify(tokenA, E2E_JWT_SECRET, {
      algorithms: [E2E_JWT_ALGORITHM],
      issuer: E2E_JWT_ISSUER,
      audience: E2E_JWT_AUDIENCE,
    });
    const decodedB = jwt.verify(tokenB, E2E_JWT_SECRET, {
      algorithms: [E2E_JWT_ALGORITHM],
      issuer: E2E_JWT_ISSUER,
      audience: E2E_JWT_AUDIENCE,
    });

    expect(typeof decodedA.sid).toBe('string');
    expect(typeof decodedB.sid).toBe('string');
    expect(decodedA.sid).not.toBe(decodedB.sid);

    const sessionRes = await request.get('/api/me/sessions', {
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(sessionRes.status()).toBe(200);
    const sessionBody = await sessionRes.json();
    expect(sessionBody.ok).toBe(true);
    expect(Array.isArray(sessionBody.sessions)).toBe(true);
    expect(sessionBody.sessions.length).toBeGreaterThanOrEqual(2);

    const currentSession = sessionBody.sessions.find((item) => item.current);
    expect(currentSession).toBeTruthy();
    expect(currentSession.sid).toBe(decodedB.sid);
  });

  test('applies remember_login_enabled preference from /api/me on next login', async ({ request }) => {
    const initialToken = await login(request, { remember: false, ip: '203.0.113.15' });

    const updateRes = await request.put('/api/me', {
      headers: {
        Authorization: `Bearer ${initialToken}`,
      },
      data: {
        remember_login_enabled: true,
      },
    });
    expect(updateRes.status()).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);

    const rememberToken = await login(request, { remember: null, ip: '203.0.113.16' });
    const rememberDecoded = jwt.verify(rememberToken, E2E_JWT_SECRET, {
      algorithms: [E2E_JWT_ALGORITHM],
      issuer: E2E_JWT_ISSUER,
      audience: E2E_JWT_AUDIENCE,
    });

    const db = new sqlite3.Database(DB_PATH);
    const rememberSession = await dbGet(
      db,
      'SELECT remember_me FROM auth_sessions WHERE sid = ?',
      [rememberDecoded.sid]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(rememberSession).toBeTruthy();
    expect(Number(rememberSession.remember_me)).toBe(1);
  });

  test('logout-all revokes every active session', async ({ request }) => {
    const tokenA = await login(request, { remember: false, ip: '203.0.113.21' });
    const tokenB = await login(request, { remember: false, ip: '203.0.113.22' });

    const logoutAllRes = await request.post('/api/logout-all', {
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(logoutAllRes.status()).toBe(200);
    const logoutAllBody = await logoutAllRes.json();
    expect(logoutAllBody.ok).toBe(true);

    const meAfterLogoutA = await request.get('/api/me', {
      headers: {
        Authorization: `Bearer ${tokenA}`,
      },
    });
    expect(meAfterLogoutA.status()).toBe(401);
    const meAfterLogoutABody = await meAfterLogoutA.json();
    expect(meAfterLogoutABody.code).toBe('AUTH_INVALID_SESSION');

    const meAfterLogoutB = await request.get('/api/me', {
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });
    expect(meAfterLogoutB.status()).toBe(401);
    const meAfterLogoutBBody = await meAfterLogoutB.json();
    expect(meAfterLogoutBBody.code).toBe('AUTH_INVALID_SESSION');
  });

  test('password reset revokes existing sessions and old token becomes invalid', async ({ request }) => {
    const activeToken = await login(request, { remember: true, ip: '203.0.113.31' });
    const resetToken = 'auth-reset-token-9851';

    const db = new sqlite3.Database(DB_PATH);
    const futureExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const tokenHash = crypto
      .createHmac('sha256', E2E_RESET_HMAC_SECRET)
      .update(resetToken)
      .digest('hex');
    await dbRun(
      db,
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [USER_ID, tokenHash, futureExpires]
    );
    await new Promise((resolve) => db.close(resolve));

    const validateRes = await request.post('/api/password-reset/validate', {
      data: { token: resetToken },
    });
    expect(validateRes.status()).toBe(200);
    const validateBody = await validateRes.json();
    expect(validateBody.ok).toBe(true);

    const resetRes = await request.post('/api/password-reset', {
      data: {
        token: resetToken,
        newPw: 'Newpass123',
      },
    });
    expect(resetRes.status()).toBe(200);
    const resetBody = await resetRes.json();
    expect(resetBody.ok).toBe(true);

    const reusedValidateRes = await request.post('/api/password-reset/validate', {
      data: { token: resetToken },
    });
    expect(reusedValidateRes.status()).toBe(400);
    const reusedValidateBody = await reusedValidateRes.json();
    expect(reusedValidateBody.code).toBe('AUTH_RESET_TOKEN_USED');

    const meRes = await request.get('/api/me', {
      headers: {
        Authorization: `Bearer ${activeToken}`,
      },
    });
    expect(meRes.status()).toBe(401);
    const meBody = await meRes.json();
    expect(meBody.code).toBe('AUTH_INVALID_SESSION');
  });
});
