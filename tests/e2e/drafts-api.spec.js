const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const {
  E2E_SESSION_PASSWORD_HASH,
  loginWithApiSession,
} = require('./session-auth');

const USER_ID = 9871;
const EMAIL = 'draft-api@glsoop.test';
const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve(this);
    });
  });

async function withDb(callback) {
  const db = new sqlite3.Database(DB_PATH);
  try {
    await callback(db);
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
}

test.describe('Server draft API', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Shared DB setup: desktop only');
  });

  test.beforeAll(async () => {
    while (!fs.existsSync(DB_PATH)) await new Promise((resolve) => setTimeout(resolve, 100));
    await withDb(async (db) => {
      await dbRun(db, 'PRAGMA foreign_keys = OFF');
      await dbRun(db, 'DELETE FROM user_drafts WHERE user_id = ?', [USER_ID]);
      await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id = ?', [USER_ID]);
      await dbRun(db, 'DELETE FROM users WHERE id = ?', [USER_ID]);
      await dbRun(
        db,
        `INSERT INTO users (id, name, nickname, email, pw, is_verified, created_at)
         VALUES (?, 'Draft API', 'draft_api', ?, ?, 1, CURRENT_TIMESTAMP)`,
        [USER_ID, EMAIL, E2E_SESSION_PASSWORD_HASH]
      );
      await dbRun(db, 'PRAGMA foreign_keys = ON');
    });
  });

  test.afterAll(async () => {
    if (!fs.existsSync(DB_PATH)) return;
    await withDb(async (db) => {
      await dbRun(db, 'PRAGMA foreign_keys = OFF');
      await dbRun(db, 'DELETE FROM user_drafts WHERE user_id = ?', [USER_ID]);
      await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id = ?', [USER_ID]);
      await dbRun(db, 'DELETE FROM users WHERE id = ?', [USER_ID]);
      await dbRun(db, 'PRAGMA foreign_keys = ON');
    });
  });

  test('saves, lists, resolves stale writes, and deletes a private user draft', async ({ request }) => {
    await loginWithApiSession(request, EMAIL);
    const key = 'create:draft-api-e2e';
    const newerAt = Date.now();

    const saveResponse = await request.put(`/api/drafts/${encodeURIComponent(key)}`, {
      data: {
        client_type: 'native',
        client_updated_at_ms: newerAt,
        state: { id: key, title: '서버에 남은 문장', body: '다른 기기에서도 이어 써요.' },
      },
    });
    expect(saveResponse.status()).toBe(200);

    const staleResponse = await request.put(`/api/drafts/${encodeURIComponent(key)}`, {
      data: {
        client_type: 'web',
        client_updated_at_ms: newerAt - 1000,
        state: { title: '오래된 문장' },
      },
    });
    expect(staleResponse.status()).toBe(200);
    expect((await staleResponse.json()).draft.state.title).toBe('서버에 남은 문장');

    const listResponse = await request.get('/api/drafts');
    expect(listResponse.status()).toBe(200);
    const list = await listResponse.json();
    expect(list.drafts).toHaveLength(1);
    expect(list.drafts[0]).toMatchObject({ draft_key: key, client_type: 'native' });

    const deleteResponse = await request.delete(`/api/drafts/${encodeURIComponent(key)}`);
    expect(deleteResponse.status()).toBe(200);
    expect((await (await request.get('/api/drafts')).json()).drafts).toHaveLength(0);
  });

  test('requires authentication and rejects oversized or invalid draft data', async ({ request }) => {
    const unauthorized = await request.get('/api/drafts');
    expect(unauthorized.status()).toBe(401);

    await loginWithApiSession(request, EMAIL);
    const invalid = await request.put('/api/drafts/not%20valid', {
      data: { client_updated_at_ms: Date.now(), state: { title: 'x' } },
    });
    expect(invalid.status()).toBe(400);

    const oversized = await request.put('/api/drafts/too-large', {
      data: { client_updated_at_ms: Date.now(), state: { body: '가'.repeat(30000) } },
    });
    expect(oversized.status()).toBe(400);
  });
});
