const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';

const USER_ID = 9861;
const USER_EMAIL = 'auth-legacy-user@glsoop.test';

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');
const DEPRECATION_DOC_LINK_PATH = encodeURI('docs/서버/API/인증-계정.md');

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

const signLegacyToken = () =>
  jwt.sign(
    {
      id: USER_ID,
      name: 'Auth Legacy User',
      nickname: 'auth_legacy_user',
      email: USER_EMAIL,
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

const seedLegacyUser = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);
  const db = new sqlite3.Database(DB_PATH);
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified, remember_login_enabled)
     VALUES (?, ?, ?, ?, ?, 0, 1, 0)`,
    [USER_ID, 'Auth Legacy User', 'auth_legacy_user', USER_EMAIL, 'password']
  );
  await new Promise((resolve) => db.close(resolve));
};

test.describe('Legacy token deprecation', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedLegacyUser();
  });

  test('allows legacy token before sunset and attaches deprecation headers', async ({ request }) => {
    const token = signLegacyToken();
    const response = await request.get('/api/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-auth-legacy-now': '2026-03-01T00:00:00+09:00',
      },
    });

    expect(response.status()).toBe(200);
    expect(response.headers().deprecation).toBe('true');
    expect(typeof response.headers().sunset).toBe('string');
    expect(response.headers().link || '').toContain(DEPRECATION_DOC_LINK_PATH);
  });

  test('blocks legacy token after sunset cutoff', async ({ request }) => {
    const token = signLegacyToken();
    const response = await request.get('/api/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-auth-legacy-now': '2026-03-08T00:00:00+09:00',
      },
    });

    expect(response.status()).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe('AUTH_LEGACY_TOKEN_DEPRECATED');
    expect(response.headers().deprecation).toBe('true');
    expect(response.headers().link || '').toContain(DEPRECATION_DOC_LINK_PATH);
  });
});
