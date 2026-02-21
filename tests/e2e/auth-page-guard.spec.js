const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';

const USER_ID = 9831;
const SESSION_ID = 'guard_active_session_9831';
const EXPIRED_SESSION_ID = 'guard_expired_session_9831';

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

const signToken = (sid) =>
  jwt.sign(
    {
      id: USER_ID,
      sid,
      name: 'Auth Guard User',
      nickname: 'guard_user',
      email: 'guard-user@glsoop.test',
      isAdmin: false,
      isVerified: true,
    },
    E2E_JWT_SECRET,
    {
      algorithm: E2E_JWT_ALGORITHM,
      issuer: E2E_JWT_ISSUER,
      audience: E2E_JWT_AUDIENCE,
      expiresIn: '1h',
    }
  );

const seedGuardFixtures = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const now = Date.now();
  const activeExpiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  const expiredAt = new Date(now - 60 * 1000).toISOString();

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, 0, 1)`,
    [USER_ID, 'Auth Guard User', 'guard_user', 'guard-user@glsoop.test', 'password']
  );

  await dbRun(
    db,
    'DELETE FROM auth_sessions WHERE user_id = ? OR sid IN (?, ?)',
    [USER_ID, SESSION_ID, EXPIRED_SESSION_ID]
  );

  await dbRun(
    db,
    `INSERT INTO auth_sessions (
      sid, user_id, remember_me, ip_hash, user_agent, created_at, last_seen_at, expires_at, revoked_at, revoked_reason
    ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, NULL, NULL)`,
    [SESSION_ID, USER_ID, 'guard_ip_hash', 'guard-agent', activeExpiresAt, activeExpiresAt, activeExpiresAt]
  );

  await dbRun(
    db,
    `INSERT INTO auth_sessions (
      sid, user_id, remember_me, ip_hash, user_agent, created_at, last_seen_at, expires_at, revoked_at, revoked_reason
    ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, NULL, NULL)`,
    [EXPIRED_SESSION_ID, USER_ID, 'expired_ip_hash', 'expired-agent', expiredAt, expiredAt, expiredAt]
  );

  await new Promise((resolve) => db.close(resolve));
};

test.describe('Auth page guard', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedGuardFixtures();
  });

  test('redirects authenticated user from login to mypage', async ({ request }) => {
    const token = signToken(SESSION_ID);
    const res = await request.get('/html/login.html', {
      headers: { Cookie: `token=${token}` },
      maxRedirects: 0,
    });

    expect(res.status()).toBe(302);
    expect(res.headers().location).toBe('/html/mypage.html');
  });

  test('allows safe next path and blocks auth-page next loop', async ({ request }) => {
    const token = signToken(SESSION_ID);

    const allowSafeNext = await request.get('/html/signup.html?next=%2Fhtml%2Feditor.html', {
      headers: { Cookie: `token=${token}` },
      maxRedirects: 0,
    });
    expect(allowSafeNext.status()).toBe(302);
    expect(allowSafeNext.headers().location).toBe('/html/editor.html');

    const blockedLoop = await request.get('/html/forgot-password.html?next=%2Fhtml%2Flogin.html', {
      headers: { Cookie: `token=${token}` },
      maxRedirects: 0,
    });
    expect(blockedLoop.status()).toBe(302);
    expect(blockedLoop.headers().location).toBe('/html/mypage.html');
  });

  test('does not redirect when sid session is invalid/expired', async ({ request }) => {
    const token = signToken(EXPIRED_SESSION_ID);
    const res = await request.get('/html/login.html', {
      headers: { Cookie: `token=${token}` },
      maxRedirects: 0,
    });

    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('로그인');
  });
});
