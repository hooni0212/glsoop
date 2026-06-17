const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const {
  DAILY_WRITING_CAMPAIGN_KEY,
  DAILY_WRITING_PROMPTS,
} = require('../../utils/dailyWritingCampaign');

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const USER_ID = 28601;
const USER_EMAIL = 'writing-event-posts@glsoop.test';
const AUTH_HEADER_NOW = '2026-03-01T00:00:00+09:00';

function getProjectUserId(testInfo) {
  return USER_ID + (testInfo.project.name.includes('mobile') ? 100 : 0);
}

function getProjectUserEmail(userId) {
  return `${userId}-${USER_EMAIL}`;
}

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
      resolve(row || null);
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

async function withDb(callback) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  try {
    return await callback(db);
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
}

function buildAuthHeaders(userId) {
  const email = getProjectUserEmail(userId);
  const token = jwt.sign(
    {
      id: userId,
      name: 'Writing Event User',
      nickname: 'writing_event_user',
      email,
      isVerified: true,
    },
    process.env.JWT_SECRET || 'devsecret',
    {
      algorithm: process.env.JWT_ALGORITHM || 'HS256',
      issuer: process.env.JWT_ISSUER || 'glsoop',
      audience: process.env.JWT_AUDIENCE || 'glsoop-client',
      expiresIn: '1h',
    }
  );

  return {
    Authorization: `Bearer ${token}`,
    'x-auth-legacy-now': AUTH_HEADER_NOW,
  };
}

async function seedUser(userId) {
  const email = getProjectUserEmail(userId);
  await withDb(async (db) => {
    await dbRun(db, 'PRAGMA foreign_keys = OFF');
    await dbRun(
      db,
      `DELETE FROM post_writing_event_contexts
       WHERE user_id = ?
          OR post_id IN (SELECT id FROM posts WHERE user_id = ?)`,
      [userId, userId]
    );
    await dbRun(db, 'DELETE FROM posts WHERE user_id = ?', [userId]);
    await dbRun(db, 'DELETE FROM users WHERE id = ?', [userId]);
    await dbRun(
      db,
      `INSERT INTO users (id, name, nickname, email, pw, is_admin, is_verified, account_status)
       VALUES (?, ?, ?, ?, ?, 0, 1, 'active')`,
      [userId, 'Writing Event User', 'writing_event_user', email, 'password']
    );
    await dbRun(db, 'PRAGMA foreign_keys = ON');
  });
}

test.describe('Writing event post contexts', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'API coverage runs once.');
    await seedUser(getProjectUserId(testInfo));
  });

  test('stores campaign prompt context and lists my event posts', async ({ request }, testInfo) => {
    const headers = buildAuthHeaders(getProjectUserId(testInfo));
    const prompt = DAILY_WRITING_PROMPTS[1];
    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '창밖에서 시작한 글',
        content: '창밖으로 보이는 장면에서 시작한 기록입니다.',
        category: 'essay',
        hashtags: ['창밖', '기록'],
        writing_event_context: {
          event_key: DAILY_WRITING_CAMPAIGN_KEY,
          prompt_key: prompt.key,
          prompt_day: 99,
        },
      },
    });

    expect(createResponse.status()).toBe(200);
    const createPayload = await createResponse.json();
    expect(createPayload.ok).toBe(true);
    expect(createPayload.post_id).toBeTruthy();

    const storedContext = await withDb((db) =>
      dbGet(
        db,
        `SELECT event_key, prompt_key, prompt_day, prompt_title
         FROM post_writing_event_contexts
         WHERE post_id = ?`,
        [createPayload.post_id]
      )
    );
    expect(storedContext).toMatchObject({
      event_key: DAILY_WRITING_CAMPAIGN_KEY,
      prompt_key: prompt.key,
      prompt_day: prompt.day,
      prompt_title: prompt.title,
    });

    const listResponse = await request.get(
      `/api/writing-events/${encodeURIComponent(DAILY_WRITING_CAMPAIGN_KEY)}/me/posts`,
      { headers }
    );
    expect(listResponse.status()).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.ok).toBe(true);
    expect(listPayload.posts).toHaveLength(1);
    expect(listPayload.posts[0]).toMatchObject({
      id: createPayload.post_id,
      title: '창밖에서 시작한 글',
      prompt_key: prompt.key,
      prompt_day: prompt.day,
      prompt_title: prompt.title,
    });
    expect(listPayload.posts[0].excerpt).toContain('창밖으로 보이는 장면');
  });

  test('rejects unknown prompt keys for the daily writing campaign', async ({ request }, testInfo) => {
    const response = await request.post('/api/posts', {
      headers: buildAuthHeaders(getProjectUserId(testInfo)),
      data: {
        title: '잘못된 글감',
        content: '존재하지 않는 글감으로 저장하려는 글입니다.',
        category: 'essay',
        writing_event_context: {
          event_key: DAILY_WRITING_CAMPAIGN_KEY,
          prompt_key: 'missing-prompt',
        },
      },
    });

    expect(response.status()).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      code: 'INVALID_WRITING_EVENT_PROMPT',
    });
  });

  test('rejects unknown writing event keys', async ({ request }, testInfo) => {
    const response = await request.post('/api/posts', {
      headers: buildAuthHeaders(getProjectUserId(testInfo)),
      data: {
        title: '알 수 없는 이벤트',
        content: '등록되지 않은 이벤트로 저장하려는 글입니다.',
        category: 'essay',
        writing_event_context: {
          event_key: 'unknown-writing-event',
          prompt_key: 'unknown-prompt',
        },
      },
    });

    expect(response.status()).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      code: 'INVALID_WRITING_EVENT',
    });
  });
});
