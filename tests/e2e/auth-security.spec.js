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
  await dbRun(db, 'UPDATE users SET pw = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?', [
    passwordHash,
    USER_ID,
  ]);
  await new Promise((resolve) => db.close(resolve));
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
    const loginRes = await loginRequest(request, {
      pw: USER_PASSWORD,
      remember: false,
      ip: '198.51.100.41',
    });
    expect(loginRes.status()).toBe(200);

    const body = await loginRes.json();
    expect(body.ok).toBe(true);
    expect(body.remember_me).toBe(false);
    expect(typeof body.session_expires_at).toBe('string');
    expect(typeof body.token).toBe('string');

    const decoded = jwt.verify(body.token, E2E_JWT_SECRET, {
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

  test('creates remember-me long session when remember flag is true', async ({ request }) => {
    const loginRes = await loginRequest(request, {
      pw: USER_PASSWORD,
      remember: true,
      ip: '198.51.100.51',
    });
    expect(loginRes.status()).toBe(200);
    const body = await loginRes.json();
    expect(body.ok).toBe(true);
    expect(body.remember_me).toBe(true);

    const decoded = jwt.verify(body.token, E2E_JWT_SECRET, {
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
});
