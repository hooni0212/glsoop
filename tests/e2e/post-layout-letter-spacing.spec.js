const { test, expect } = require('@playwright/test');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const USER_ID = 9801;
const USER_EMAIL = 'layout-spacing-writer@glsoop.test';
const USER_PASSWORD = 'Pass1234';

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

const seedLayoutWriter = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);
  const passwordHash = await bcrypt.hash(USER_PASSWORD, 10);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [USER_ID, 'Layout Writer', 'layout_writer', USER_EMAIL, passwordHash, 0, 1]
  );
  await new Promise((resolve) => db.close(resolve));
};

const resetLayoutWriterState = async () => {
  const passwordHash = await bcrypt.hash(USER_PASSWORD, 10);
  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'DELETE FROM likes WHERE user_id = ?', [USER_ID]);
  await dbRun(db, 'DELETE FROM posts WHERE user_id = ?', [USER_ID]);
  await dbRun(
    db,
    `UPDATE users
     SET pw = ?,
         is_verified = 1
     WHERE id = ?`,
    [passwordHash, USER_ID]
  );
  await new Promise((resolve) => db.close(resolve));
};

const extractTokenFromSetCookie = (response) => {
  const setCookieHeader = response.headers()['set-cookie'];
  expect(typeof setCookieHeader).toBe('string');
  const matched = /token=([^;]+)/.exec(setCookieHeader);
  expect(matched).toBeTruthy();
  return decodeURIComponent(matched[1]);
};

const loginAsLayoutWriter = async (request) => {
  const response = await request.post('/api/login', {
    data: {
      email: USER_EMAIL,
      pw: USER_PASSWORD,
    },
  });

  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  expect(typeof payload.token).toBe('string');
  return extractTokenFromSetCookie(response);
};

const buildLayoutPayload = ({
  titleLineHeight = 1.3,
  titleLetterSpacing = 0.04,
  bodyLineHeight = 1.45,
  bodyLetterSpacing = -0.02,
} = {}) => ({
  layout_version: 1,
  unit: 'normalized',
  title_box: {
    x: 0.336,
    y: 0.256,
    w: 0.424,
    h: 0.122,
    align: 'center',
    font_scale: 1,
    line_height: titleLineHeight,
    letter_spacing: titleLetterSpacing,
    hidden: false,
  },
  text_box: {
    x: 0.336,
    y: 0.364,
    w: 0.424,
    h: 0.346,
    align: 'center',
    font_scale: 1,
    line_height: bodyLineHeight,
    letter_spacing: bodyLetterSpacing,
    hidden: false,
  },
  footer_box: {
    x: 0.78,
    y: 0.9,
    w: 0.16,
    h: 0.06,
    align: 'right',
    font_scale: 1,
    line_height: 1.1,
    hidden: false,
  },
});

const parseLayoutJson = (value) => {
  if (!value) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

test.describe('Post layout letter spacing', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedLayoutWriter();
  });

  test.beforeEach(async () => {
    await resetLayoutWriterState();
  });

  test('stores and updates title/body letter_spacing in layout_json', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '자간 저장 테스트',
        content: '행간과 자간이 포함된 본문입니다.',
        category: 'short',
        layout_json: buildLayoutPayload(),
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    expect(createBody.ok).toBe(true);
    expect(typeof createBody.post_id).toBe('number');

    const postId = createBody.post_id;

    const editResponse = await request.get(`/api/posts/${postId}/edit`, { headers });
    expect(editResponse.status()).toBe(200);
    const editBody = await editResponse.json();
    const createdLayout = parseLayoutJson(editBody.post.layout_json);
    expect(createdLayout.title_box.letter_spacing).toBe(0.04);
    expect(createdLayout.text_box.letter_spacing).toBe(-0.02);

    const updateResponse = await request.put(`/api/posts/${postId}`, {
      headers,
      data: {
        title: '자간 수정 테스트',
        content: '수정된 본문입니다.',
        category: 'short',
        hashtags: [],
        layout_json: buildLayoutPayload({
          titleLineHeight: 1.15,
          titleLetterSpacing: 0,
          bodyLineHeight: 1.3,
          bodyLetterSpacing: 0.04,
        }),
      },
    });

    expect(updateResponse.status()).toBe(200);
    const updatedEditResponse = await request.get(`/api/posts/${postId}/edit`, { headers });
    expect(updatedEditResponse.status()).toBe(200);
    const updatedEditBody = await updatedEditResponse.json();
    const updatedLayout = parseLayoutJson(updatedEditBody.post.layout_json);
    expect(updatedLayout.title_box.line_height).toBe(1.15);
    expect(updatedLayout.title_box.letter_spacing).toBe(0);
    expect(updatedLayout.text_box.line_height).toBe(1.3);
    expect(updatedLayout.text_box.letter_spacing).toBe(0.04);
    expect(updatedLayout.footer_box.letter_spacing).toBeUndefined();
  });

  test('rejects invalid letter_spacing values', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };

    const response = await request.post('/api/posts', {
      headers,
      data: {
        title: '잘못된 자간',
        content: 'validation 확인용 본문',
        category: 'short',
        layout_json: buildLayoutPayload({
          bodyLetterSpacing: 0.12,
        }),
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.message).toContain('레이아웃');
  });

  test('renders preview and saved post images with letter_spacing params', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '렌더 확인용 제목',
        content: '렌더 확인용 본문입니다.',
        category: 'short',
        layout_json: buildLayoutPayload(),
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    const postId = createBody.post_id;

    const previewResponse = await request.get('/api/feed-images/preview', {
      params: {
        title: '미리보기 제목',
        content: '미리보기 본문',
        category: 'short',
        template: 'paper01',
        scale: '2',
        layout_x: '0.336',
        layout_y: '0.364',
        layout_w: '0.424',
        layout_h: '0.346',
        layout_align: 'center',
        layout_font_scale: '1',
        layout_line_height: '1.45',
        layout_letter_spacing: '-0.02',
        layout_title_x: '0.336',
        layout_title_y: '0.256',
        layout_title_w: '0.424',
        layout_title_h: '0.122',
        layout_title_align: 'center',
        layout_title_font_scale: '1',
        layout_title_line_height: '1.3',
        layout_title_letter_spacing: '0.04',
      },
    });

    expect(previewResponse.status()).toBe(200);
    expect(previewResponse.headers()['content-type']).toContain('image/');

    const renderedResponse = await request.get(`/api/feed-images/post/${postId}`, {
      params: { template: 'paper01', scale: '2' },
    });
    expect(renderedResponse.status()).toBe(200);
    expect(renderedResponse.headers()['content-type']).toContain('image/');
  });
});
