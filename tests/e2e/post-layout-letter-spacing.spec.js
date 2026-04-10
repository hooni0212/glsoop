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

const buildLayoutPayloadV2 = ({
  pageTwoTextOverride = null,
  pageOneTitleOverride = null,
} = {}) => {
  const legacy = buildLayoutPayload();
  const pages = [];
  if (pageOneTitleOverride) {
    pages[0] = {
      title_box: pageOneTitleOverride,
    };
  }
  if (pageTwoTextOverride) {
    pages[1] = {
      ...(pages[1] || {}),
      text_box: pageTwoTextOverride,
    };
  }

  return {
    layout_version: 2,
    unit: 'normalized',
    base: {
      title_box: legacy.title_box,
      text_box: legacy.text_box,
      footer_box: legacy.footer_box,
    },
    pages,
  };
};

const parseLayoutJson = (value) => {
  if (!value) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

const buildLongMultilineContent = (lineCount = 120, prefix = '긴 글 테스트 본문') =>
  Array.from({ length: lineCount }, (_item, index) => `${prefix} ${index + 1}`).join('\n');

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

  test('returns multipage render metadata and paged images for custom layout posts', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '멀티 페이지 렌더 확인',
        content: buildLongMultilineContent(120),
        category: 'essay',
        layout_json: buildLayoutPayload(),
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    const postId = createBody.post_id;

    const detailResponse = await request.get(`/api/posts/${postId}`, {
      headers,
    });
    expect(detailResponse.status()).toBe(200);

    const detailBody = await detailResponse.json();
    expect(detailBody.ok).toBe(true);
    expect(detailBody.post.image_url).toBe(detailBody.post.primary_image);
    expect(detailBody.post.primary_image).toBe(detailBody.post.images[0]);
    expect(detailBody.post.has_multiple).toBe(true);
    expect(detailBody.post.images.length).toBe(8);
    expect(detailBody.post.render_images.primary_image).toBe(detailBody.post.primary_image);
    expect(detailBody.post.render_images.images).toEqual(detailBody.post.images);
    expect(detailBody.post.render_images.has_multiple).toBe(true);
    expect(detailBody.post.render_images.page_count).toBe(8);
    expect(detailBody.post.render_images.page_cap).toBe(8);
    expect(detailBody.post.render_images.is_truncated).toBe(true);

    const pageTwoResponse = await request.get(`/api/feed-images/post/${postId}`, {
      params: { template: 'paper01', scale: '2', page: '2' },
    });
    expect(pageTwoResponse.status()).toBe(200);
    expect(pageTwoResponse.headers()['content-type']).toContain('image/');
    expect(pageTwoResponse.headers()['x-feed-image-page']).toBe('2');
    expect(pageTwoResponse.headers()['x-feed-image-page-count']).toBe('8');
    expect(pageTwoResponse.headers()['x-feed-image-truncated']).toBe('1');

    const overflowPageResponse = await request.get(`/api/feed-images/post/${postId}`, {
      params: { template: 'paper01', scale: '2', page: '9' },
    });
    expect(overflowPageResponse.status()).toBe(404);
  });

  test('keeps legacy posts on single rendered image metadata', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '레거시 렌더 확인',
        content: buildLongMultilineContent(120, '레거시 본문'),
        category: 'essay',
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    const postId = createBody.post_id;

    const detailResponse = await request.get(`/api/posts/${postId}`, {
      headers,
    });
    expect(detailResponse.status()).toBe(200);

    const detailBody = await detailResponse.json();
    expect(detailBody.ok).toBe(true);
    expect(detailBody.post.image_url).toBe(detailBody.post.primary_image);
    expect(detailBody.post.primary_image).toBe(detailBody.post.images[0]);
    expect(detailBody.post.images.length).toBe(1);
    expect(detailBody.post.has_multiple).toBe(false);
    expect(detailBody.post.render_images.page_count).toBe(1);
    expect(detailBody.post.render_images.page_cap).toBe(8);
    expect(detailBody.post.render_images.has_multiple).toBe(false);
    expect(detailBody.post.render_images.is_truncated).toBe(true);

    const secondPageResponse = await request.get(`/api/feed-images/post/${postId}`, {
      params: { template: 'paper01', scale: '2', page: '2' },
    });
    expect(secondPageResponse.status()).toBe(404);
  });

  test('accepts layout version 2 and preserves multipage metadata after reset-like save', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '레이아웃 v2 저장 테스트',
        content: buildLongMultilineContent(120, '레이아웃 v2 본문'),
        category: 'essay',
        layout_json: buildLayoutPayloadV2({
          pageTwoTextOverride: {
            x: 0.312,
            y: 0.332,
          },
        }),
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    const postId = createBody.post_id;

    const editResponse = await request.get(`/api/posts/${postId}/edit`, { headers });
    expect(editResponse.status()).toBe(200);
    const editBody = await editResponse.json();
    const createdLayout = parseLayoutJson(editBody.post.layout_json);
    expect(createdLayout.layout_version).toBe(2);
    expect(createdLayout.base.title_box).toBeTruthy();
    expect(createdLayout.base.text_box).toBeTruthy();
    expect(createdLayout.pages[1].text_box.x).toBe(0.312);

    const updateResponse = await request.put(`/api/posts/${postId}`, {
      headers,
      data: {
        title: '레이아웃 v2 저장 테스트',
        content: buildLongMultilineContent(120, '레이아웃 v2 본문'),
        category: 'essay',
        layout_json: buildLayoutPayloadV2(),
      },
    });

    expect(updateResponse.status()).toBe(200);

    const detailResponse = await request.get(`/api/posts/${postId}`, { headers });
    expect(detailResponse.status()).toBe(200);
    const detailBody = await detailResponse.json();
    expect(detailBody.ok).toBe(true);
    expect(detailBody.post.render_images.page_count).toBe(8);
    expect(detailBody.post.has_multiple).toBe(true);
    expect(detailBody.post.images.length).toBe(8);

    const updatedEditResponse = await request.get(`/api/posts/${postId}/edit`, { headers });
    expect(updatedEditResponse.status()).toBe(200);
    const updatedEditBody = await updatedEditResponse.json();
    const updatedLayout = parseLayoutJson(updatedEditBody.post.layout_json);
    expect(updatedLayout.layout_version).toBe(2);
    expect(updatedLayout.base.title_box).toBeTruthy();
    expect(updatedLayout.base.text_box).toBeTruthy();
    expect(Array.isArray(updatedLayout.pages)).toBe(true);
  });

  test('creates editor preview sessions with multipage manifest and page rendering', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };

    const response = await request.post('/api/feed-images/preview/sessions', {
      headers,
      data: {
        title: '에디터 미리보기 세션',
        content: `<!--FONT:serif-->${Array.from({ length: 80 }, (_item, index) => `<p>미리보기 본문 ${index + 1}</p>`).join('')}`,
        content_format: 'html',
        category: 'essay',
        template: 'paper01',
        scale: 1,
        layout_json: buildLayoutPayloadV2({
          pageTwoTextOverride: {
            x: 0.312,
            y: 0.332,
          },
        }),
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.preview_session_id).toBe('string');
    expect(body.image_url).toBe(body.primary_image);
    expect(body.primary_image).toBe(body.images[0]);
    expect(Array.isArray(body.images)).toBe(true);
    expect(body.images.length).toBeGreaterThan(1);
    expect(body.has_multiple).toBe(true);
    expect(body.render_images.page_count).toBe(body.images.length);
    expect(body.render_images.preview_session_id).toBe(body.preview_session_id);

    const pageTwoResponse = await request.get(body.images[1], { headers });
    expect(pageTwoResponse.status()).toBe(200);
    expect(pageTwoResponse.headers()["content-type"]).toContain("image/webp");
    expect(pageTwoResponse.headers()["x-feed-image-page"]).toBe("2");
    expect(pageTwoResponse.headers()["x-feed-image-page-count"]).toBe(String(body.images.length));
  });

  test('caps preview sessions at eight pages and expires them with 410', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };

    const response = await request.post('/api/feed-images/preview/sessions', {
      headers,
      data: {
        title: '에디터 초장문 세션',
        content: `<!--FONT:sans-->${buildLongMultilineContent(500, '프리뷰 초장문')}`,
        content_format: 'plain',
        category: 'essay',
        template: 'paper01',
        scale: 1,
        layout_json: buildLayoutPayloadV2(),
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.images.length).toBe(8);
    expect(body.render_images.page_count).toBe(8);
    expect(body.render_images.page_cap).toBe(8);
    expect(body.render_images.is_truncated).toBe(true);

    const sessionPath = path.join(
      REPO_ROOT,
      'tmp',
      'feed-preview-sessions',
      `${body.preview_session_id}.json`
    );
    const sessionRaw = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    sessionRaw.expires_at = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(sessionPath, JSON.stringify(sessionRaw));

    const expiredResponse = await request.get(body.primary_image, { headers });
    expect(expiredResponse.status()).toBe(410);
  });
});
