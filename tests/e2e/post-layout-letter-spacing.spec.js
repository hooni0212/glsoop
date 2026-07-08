const { test, expect } = require('@playwright/test');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const sqlite3 = require('sqlite3').verbose();
const {
  extractPostFontKey,
  normalizePostText,
  resolvePostFont,
} = require('../../utils/feedImageRenderer');

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const USER_ID = 9801;
const USER_EMAIL = 'layout-spacing-writer@glsoop.test';
const USER_PASSWORD = 'Pass1234';
let cachedLayoutWriterToken = '';

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
  await dbRun(db, 'DELETE FROM user_entitlements WHERE user_id = ?', [USER_ID]);
  await dbRun(db, 'DELETE FROM user_entitlement_grants WHERE user_id = ?', [USER_ID]);
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
  if (cachedLayoutWriterToken) return cachedLayoutWriterToken;

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
  cachedLayoutWriterToken = extractTokenFromSetCookie(response);
  return cachedLayoutWriterToken;
};

const buildLayoutPayload = ({
  titleLineHeight = 1.3,
  titleLetterSpacing = 0.04,
  bodyLineHeight = 1.45,
  bodyLetterSpacing = -0.02,
  template = 'paper01',
} = {}) => ({
  layout_version: 1,
  unit: 'normalized',
  canvas: {
    presetId: template,
  },
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
  template = 'paper01',
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
    canvas: {
      presetId: template,
    },
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
    expect(createdLayout.canvas.presetId).toBe('paper01');
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
    expect(updatedLayout.canvas.presetId).toBe('paper01');
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

  test('preserves canvas presetId and uses it in render metadata', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '배경 저장 테스트',
        content: 'paper02 배경으로 렌더링되는 본문입니다.',
        category: 'short',
        layout_json: buildLayoutPayload({
          template: 'paper02',
        }),
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    expect(createBody.ok).toBe(true);

    const postId = createBody.post_id;
    const editResponse = await request.get(`/api/posts/${postId}/edit`, { headers });
    expect(editResponse.status()).toBe(200);
    const editBody = await editResponse.json();
    const createdLayout = parseLayoutJson(editBody.post.layout_json);
    expect(createdLayout.canvas.presetId).toBe('paper02');

    const detailResponse = await request.get(`/api/posts/${postId}`, { headers });
    expect(detailResponse.status()).toBe(200);
    const detailBody = await detailResponse.json();
    expect(detailBody.ok).toBe(true);
    expect(detailBody.post.render_images.template).toBe('paper02');
    expect(detailBody.post.primary_image).toContain('template=paper02');
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

    const pngShareResponse = await request.get(`/api/feed-images/share/post/${postId}`, {
      params: { template: 'paper01', scale: '2', format: 'png' },
    });
    expect(pngShareResponse.status()).toBe(200);
    expect(pngShareResponse.headers()['content-type']).toContain('image/png');
    expect(pngShareResponse.headers()['x-feed-image-format']).toBe('png');
  });

  test('requires premium entitlement for author signature share images', async ({ request, playwright }, testInfo) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '작가 서명 렌더 확인',
        content: '프리미엄 작가 서명 이미지 본문입니다.',
        category: 'short',
        layout_json: buildLayoutPayload(),
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    const postId = createBody.post_id;

    const anonymousRequest = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL || 'http://127.0.0.1:3100',
    });
    try {
      const unauthenticatedResponse = await anonymousRequest.get(
        `/api/feed-images/share/post/${postId}`,
        {
          params: {
            template: 'paper01',
            scale: '2',
            format: 'png',
            author_signature: '1',
          },
        }
      );
      expect(unauthenticatedResponse.status()).toBe(401);
    } finally {
      await anonymousRequest.dispose();
    }

    const freeResponse = await request.get(`/api/feed-images/share/post/${postId}`, {
      headers,
      params: {
        template: 'paper01',
        scale: '2',
        format: 'png',
        author_signature: '1',
      },
    });
    expect(freeResponse.status()).toBe(403);

    const db = new sqlite3.Database(DB_PATH);
    await dbRun(
      db,
      `
      INSERT OR REPLACE INTO user_entitlement_grants (
        user_id,
        entitlement_key,
        source,
        status,
        starts_at,
        ends_at,
        meta_json,
        updated_at
      )
      VALUES (?, 'premium:glsoop', 'admin', 'active', datetime('now'), datetime('now', '+7 days'), '{}', datetime('now'))
      `,
      [USER_ID]
    );
    await new Promise((resolve) => db.close(resolve));

    const signedResponse = await request.get(`/api/feed-images/share/post/${postId}`, {
      headers,
      params: {
        template: 'paper01',
        scale: '2',
        format: 'png',
        author_signature: '1',
      },
    });
    expect(signedResponse.status()).toBe(200);
    expect(signedResponse.headers()['content-type']).toContain('image/png');
    expect(signedResponse.headers()['x-feed-image-author-signature']).toBe('1');
    expect(signedResponse.headers()['x-feed-image-author-signature-position']).toBe('bottomRight');
    expect(signedResponse.headers()['x-feed-image-layout']).toContain('author-signature-bottomRight');

    const leftPositionResponse = await request.get(`/api/feed-images/share/post/${postId}`, {
      headers,
      params: {
        template: 'paper01',
        scale: '2',
        format: 'png',
        author_signature: '1',
        author_signature_position: 'bottomLeft',
      },
    });
    expect(leftPositionResponse.status()).toBe(200);
    expect(leftPositionResponse.headers()['x-feed-image-author-signature']).toBe('1');
    expect(leftPositionResponse.headers()['x-feed-image-author-signature-position']).toBe('bottomLeft');
    expect(leftPositionResponse.headers()['x-feed-image-layout']).toContain('author-signature-bottomLeft');
  });

  test('uses FONT meta for feed and share rendered image font selection', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };
    const content = '<!--FONT:hand--><p>손글씨 렌더 확인 본문입니다.</p>';

    expect(extractPostFontKey(content)).toBe('hand');
    expect(resolvePostFont(content).family).toContain('Nanum Pen Script');
    expect(normalizePostText(content)).toBe('손글씨 렌더 확인 본문입니다.');

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '손글씨 렌더 확인',
        content,
        category: 'short',
        layout_json: buildLayoutPayload(),
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    const postId = createBody.post_id;

    const feedResponse = await request.get(`/api/feed-images/post/${postId}`, {
      params: { template: 'paper01', scale: '2' },
    });
    expect(feedResponse.status()).toBe(200);
    expect(feedResponse.headers()['x-feed-image-layout']).toContain('font-hand');

    const shareResponse = await request.get(`/api/feed-images/share/post/${postId}`, {
      params: { template: 'paper01', scale: '2', format: 'png' },
    });
    expect(shareResponse.status()).toBe(200);
    expect(shareResponse.headers()['x-feed-image-layout']).toContain('font-hand');
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
    expect(detailBody.post.render_images.primary_image).toBe(detailBody.post.primary_image);
    expect(detailBody.post.render_images.images).toEqual(detailBody.post.images);
    expect(detailBody.post.render_images.has_multiple).toBe(true);
    expect(detailBody.post.render_images.page_count).toBeGreaterThan(1);
    expect(detailBody.post.render_images.page_count).toBeLessThanOrEqual(
      detailBody.post.render_images.page_cap
    );
    expect(detailBody.post.images.length).toBe(detailBody.post.render_images.page_count);
    expect(detailBody.post.render_images.page_cap).toBe(24);
    expect(detailBody.post.render_images.is_truncated).toBe(false);

    const pageTwoResponse = await request.get(`/api/feed-images/post/${postId}`, {
      params: { template: 'paper01', scale: '2', page: '2' },
    });
    expect(pageTwoResponse.status()).toBe(200);
    expect(pageTwoResponse.headers()['content-type']).toContain('image/');
    expect(pageTwoResponse.headers()['x-feed-image-page']).toBe('2');
    expect(pageTwoResponse.headers()['x-feed-image-page-count']).toBe(
      String(detailBody.post.render_images.page_count)
    );
    expect(pageTwoResponse.headers()['x-feed-image-truncated']).toBe('0');

    const overflowPageResponse = await request.get(`/api/feed-images/post/${postId}`, {
      params: {
        template: 'paper01',
        scale: '2',
        page: String(detailBody.post.render_images.page_count + 1),
      },
    });
    expect(overflowPageResponse.status()).toBe(404);
  });

  test('returns multipage render metadata for posts without custom layout', async ({ request }) => {
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
    expect(detailBody.post.images.length).toBeGreaterThan(1);
    expect(detailBody.post.has_multiple).toBe(true);
    expect(detailBody.post.render_images.page_count).toBe(detailBody.post.images.length);
    expect(detailBody.post.render_images.page_cap).toBe(24);
    expect(detailBody.post.render_images.has_multiple).toBe(true);
    expect(detailBody.post.render_images.is_truncated).toBe(false);

    const secondPageResponse = await request.get(`/api/feed-images/post/${postId}`, {
      params: { template: 'paper01', scale: '2', page: '2' },
    });
    expect(secondPageResponse.status()).toBe(200);
    expect(secondPageResponse.headers()['x-feed-image-page-count']).toBe(
      String(detailBody.post.render_images.page_count)
    );
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
    expect(detailBody.post.render_images.page_count).toBeGreaterThan(1);
    expect(detailBody.post.render_images.page_count).toBeLessThanOrEqual(
      detailBody.post.render_images.page_cap
    );
    expect(detailBody.post.has_multiple).toBe(true);
    expect(detailBody.post.images.length).toBe(detailBody.post.render_images.page_count);
    expect(detailBody.post.render_images.page_cap).toBe(24);

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
        content: `<!--FONT:hand-->${Array.from({ length: 80 }, (_item, index) => `<p>미리보기 본문 ${index + 1}</p>`).join('')}`,
        content_format: 'html',
        category: 'essay',
        template: 'paper02',
        scale: 1,
        layout_json: buildLayoutPayloadV2({
          template: 'paper02',
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
    expect(body.render_images.template).toBe('paper02');
    expect(body.render_images.page_count).toBe(body.images.length);
    expect(body.render_images.preview_session_id).toBe(body.preview_session_id);

    const pageTwoResponse = await request.get(body.images[1], { headers });
    expect(pageTwoResponse.status()).toBe(200);
    expect(pageTwoResponse.headers()["content-type"]).toContain("image/webp");
    expect(pageTwoResponse.headers()["x-feed-image-template"]).toBe("paper02");
    expect(pageTwoResponse.headers()["x-feed-image-layout"]).toContain("font-hand");
    expect(pageTwoResponse.headers()["x-feed-image-page"]).toBe("2");
    expect(pageTwoResponse.headers()["x-feed-image-page-count"]).toBe(String(body.images.length));
    const pageTwoMetadata = await sharp(Buffer.from(await pageTwoResponse.body())).metadata();
    expect(pageTwoMetadata.width).toBe(500);
    expect(pageTwoMetadata.height).toBe(666);

    const publicPageTwoResponse = await request.get(body.images[1]);
    expect(publicPageTwoResponse.status()).toBe(200);
    expect(publicPageTwoResponse.headers()["content-type"]).toContain("image/webp");

    const pngPageTwoResponse = await request.get(`${body.images[1]}&format=png`);
    expect(pngPageTwoResponse.status()).toBe(200);
    expect(pngPageTwoResponse.headers()["content-type"]).toContain("image/png");
    expect(pngPageTwoResponse.headers()["x-feed-image-format"]).toBe("png");
    const pngPageTwoMetadata = await sharp(Buffer.from(await pngPageTwoResponse.body())).metadata();
    expect(pngPageTwoMetadata.format).toBe("png");
  });

  test('stores manual content_pages and renders preserved page boundaries', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };
    const contentPages = [
      '수동 1페이지입니다. 첫 페이지는 짧게 유지합니다.',
      '수동 2페이지입니다. 자동 pagination 없이 이 장으로 렌더링되어야 합니다.',
      '수동 3페이지입니다. 배열 순서가 페이지 순서입니다.',
    ];

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '수동 페이지 저장',
        content: `<!--FONT:sans-->${contentPages.join('\n\n')}`,
        content_pages: contentPages,
        category: 'essay',
        layout_json: buildLayoutPayloadV2(),
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    const postId = createBody.post_id;

    const editResponse = await request.get(`/api/posts/${postId}/edit`, { headers });
    expect(editResponse.status()).toBe(200);
    const editBody = await editResponse.json();
    expect(editBody.post.content_pages).toEqual(contentPages);
    expect(editBody.post.content).toContain('FONT:sans');

    const detailResponse = await request.get(`/api/posts/${postId}`, { headers });
    expect(detailResponse.status()).toBe(200);
    const detailBody = await detailResponse.json();
    expect(detailBody.post.content_pages).toEqual(contentPages);
    expect(detailBody.post.render_images.page_count).toBe(3);
    expect(detailBody.post.images.length).toBe(3);
    expect(detailBody.post.render_images.is_truncated).toBe(false);

    const pageThreeResponse = await request.get(`/api/feed-images/post/${postId}`, {
      params: { template: 'paper01', scale: '2', page: '3' },
    });
    expect(pageThreeResponse.status()).toBe(200);
    expect(pageThreeResponse.headers()['x-feed-image-page']).toBe('3');
    expect(pageThreeResponse.headers()['x-feed-image-page-count']).toBe('3');
    expect(pageThreeResponse.headers()['x-feed-image-layout']).toContain('manual-pages');
    expect(pageThreeResponse.headers()['x-feed-image-layout']).toContain('font-sans');

    const updatePages = ['수정 1페이지입니다.', '수정 2페이지입니다.'];
    const updateResponse = await request.put(`/api/posts/${postId}`, {
      headers,
      data: {
        title: '수동 페이지 수정',
        content: `<!--FONT:hand-->${updatePages.join('\n\n')}`,
        content_pages: updatePages,
        category: 'essay',
        hashtags: [],
        layout_json: buildLayoutPayloadV2(),
      },
    });
    expect(updateResponse.status()).toBe(200);

    const updatedEditResponse = await request.get(`/api/posts/${postId}/edit`, { headers });
    expect(updatedEditResponse.status()).toBe(200);
    const updatedEditBody = await updatedEditResponse.json();
    expect(updatedEditBody.post.content_pages).toEqual(updatePages);
  });

  test('infers a single page for legacy plain mobile saves without content_pages', async ({
    request,
    page,
  }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };
    const longSinglePage = Array.from(
      { length: 10 },
      (_item, index) =>
        `레거시 모바일 한 장 본문 ${index + 1}입니다. content_pages가 없어도 자동 분할하지 않고 한 장으로 보존해야 합니다.`
    ).join(' ');

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '레거시 plain 한 장 보존',
        content: `<!--FONT:hand-->${longSinglePage}`,
        content_format: 'plain',
        category: 'essay',
        layout_json: buildLayoutPayloadV2(),
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    const postId = createBody.post_id;

    const editResponse = await request.get(`/api/posts/${postId}/edit`, { headers });
    expect(editResponse.status()).toBe(200);
    const editBody = await editResponse.json();
    expect(editBody.post.content).toContain('FONT:hand');
    expect(editBody.post.content_pages).toEqual([longSinglePage]);

    const detailResponse = await request.get(`/api/posts/${postId}`, { headers });
    expect(detailResponse.status()).toBe(200);
    const detailBody = await detailResponse.json();
    expect(detailBody.post.content_pages).toEqual([longSinglePage]);
    expect(detailBody.post.render_images.page_count).toBe(1);
    expect(detailBody.post.images.length).toBe(1);

    const feedResponse = await request.get(`/api/feed-images/post/${postId}`, {
      params: { template: 'paper01', scale: '2' },
    });
    expect(feedResponse.status()).toBe(200);
    expect(feedResponse.headers()['x-feed-image-page-count']).toBe('1');
    expect(feedResponse.headers()['x-feed-image-layout']).toContain('manual-pages');
    expect(feedResponse.headers()['x-feed-image-layout']).toContain('font-hand');

    await page.goto(`/html/post.html?postId=${postId}`);
    await expect(page.locator('#postDetail')).toContainText('레거시 plain 한 장 보존');
    await expect(page.locator('#postDetail .feed-rendered-card-image')).toHaveCount(1);
    await expect(page.locator('#postDetail [data-post-carousel-nav]')).toHaveCount(0);

    const updatedSinglePage = Array.from(
      { length: 8 },
      (_item, index) =>
        `수정된 레거시 모바일 본문 ${index + 1}입니다. 수정 저장에서도 한 장 경계를 다시 추론해야 합니다.`
    ).join(' ');
    const updateResponse = await request.put(`/api/posts/${postId}`, {
      headers,
      data: {
        title: '레거시 plain 한 장 수정',
        content: `<!--FONT:sans-->${updatedSinglePage}`,
        content_format: 'plain',
        category: 'essay',
        hashtags: [],
        layout_json: buildLayoutPayloadV2(),
      },
    });
    expect(updateResponse.status()).toBe(200);

    const updatedEditResponse = await request.get(`/api/posts/${postId}/edit`, { headers });
    expect(updatedEditResponse.status()).toBe(200);
    const updatedEditBody = await updatedEditResponse.json();
    expect(updatedEditBody.post.content).toContain('FONT:sans');
    expect(updatedEditBody.post.content_pages).toEqual([updatedSinglePage]);
  });

  test('preserves html content when editor3 sends explicit content_pages', async ({
    request,
  }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };
    const contentPages = [
      'HTML 첫 페이지입니다. 굵은 문장이 들어간 원본 본문은 그대로 저장되어야 합니다.',
      'HTML 둘째 페이지입니다. 페이지 경계는 별도 배열로 보존됩니다.',
    ];
    const htmlContent = [
      '<p><strong>HTML 첫 페이지입니다.</strong> 굵은 문장이 들어간 원본 본문은 그대로 저장되어야 합니다.</p>',
      '<p>HTML 둘째 페이지입니다. 페이지 경계는 별도 배열로 보존됩니다.</p>',
    ].join('');

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: 'editor3 HTML 페이지 저장',
        content: `<!--FONT:sans-->${htmlContent}`,
        content_format: 'html',
        content_pages: contentPages,
        category: 'essay',
        layout_json: buildLayoutPayloadV2(),
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    const postId = createBody.post_id;

    const editResponse = await request.get(`/api/posts/${postId}/edit`, { headers });
    expect(editResponse.status()).toBe(200);
    const editBody = await editResponse.json();
    expect(editBody.post.content).toContain('<strong>HTML 첫 페이지입니다.</strong>');
    expect(editBody.post.content_pages).toEqual(contentPages);

    const detailResponse = await request.get(`/api/posts/${postId}`, { headers });
    expect(detailResponse.status()).toBe(200);
    const detailBody = await detailResponse.json();
    expect(detailBody.post.content).toContain('<strong>HTML 첫 페이지입니다.</strong>');
    expect(detailBody.post.content_pages).toEqual(contentPages);
    expect(detailBody.post.render_images.page_count).toBe(2);
    expect(detailBody.post.images.length).toBe(2);

    const pageTwoResponse = await request.get(`/api/feed-images/post/${postId}`, {
      params: { template: 'paper01', scale: '2', page: '2' },
    });
    expect(pageTwoResponse.status()).toBe(200);
    expect(pageTwoResponse.headers()['x-feed-image-page']).toBe('2');
    expect(pageTwoResponse.headers()['x-feed-image-page-count']).toBe('2');
    expect(pageTwoResponse.headers()['x-feed-image-layout']).toContain('manual-pages');
    expect(pageTwoResponse.headers()['x-feed-image-layout']).toContain('font-sans');
  });

  test('post3 preserves a long single manual content page as one desktop card', async ({
    request,
    page,
  }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };
    const longSinglePage = Array.from(
      { length: 12 },
      (_item, index) =>
        `긴 산문 한 장 테스트 문장 ${index + 1}입니다. 모바일 작성 화면에서 한 장으로 저장한 페이지 경계를 데스크탑 상세에서도 그대로 유지해야 합니다.`
    ).join(' ');

    const createResponse = await request.post('/api/posts', {
      headers,
      data: {
        title: '긴 한 장 페이지 보존',
        content: `<!--FONT:serif-->${longSinglePage}`,
        content_pages: [longSinglePage],
        category: 'essay',
        layout_json: buildLayoutPayloadV2(),
      },
    });

    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    const postId = createBody.post_id;

    const detailResponse = await request.get(`/api/posts/${postId}`, { headers });
    expect(detailResponse.status()).toBe(200);
    const detailBody = await detailResponse.json();
    expect(detailBody.post.content_pages).toEqual([longSinglePage]);
    expect(detailBody.post.render_images.page_count).toBe(1);
    expect(detailBody.post.images.length).toBe(1);

    await page.goto(`/html/post3.html?postId=${postId}`);
    await expect(page.locator('#post3Title')).toContainText('긴 한 장 페이지 보존');
    await expect(page.locator('#post3PageCount')).toHaveText('1');
    await expect(page.locator('#post3CurrentTotal')).toHaveText('1');
    await expect(page.locator('.post3-page')).toHaveCount(1);
    await expect(page.locator('#post3Description')).toContainText('한 장');
  });

  test('creates preview sessions from manual content_pages', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };
    const contentPages = ['프리뷰 1페이지', '프리뷰 2페이지', '프리뷰 3페이지'];

    const response = await request.post('/api/feed-images/preview/sessions', {
      headers,
      data: {
        title: '수동 페이지 프리뷰',
        content: `<!--FONT:serif-->${contentPages.join('\n\n')}`,
        content_pages: contentPages,
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
    expect(body.images.length).toBe(3);
    expect(body.render_images.page_count).toBe(3);
    expect(body.render_images.is_truncated).toBe(false);

    const pageTwoResponse = await request.get(body.images[1], { headers });
    expect(pageTwoResponse.status()).toBe(200);
    expect(pageTwoResponse.headers()['x-feed-image-page']).toBe('2');
    expect(pageTwoResponse.headers()['x-feed-image-page-count']).toBe('3');
    expect(pageTwoResponse.headers()['x-feed-image-layout']).toContain('manual-pages');
  });

  test('rejects invalid manual content_pages payloads', async ({ request }) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };

    const tooManyPages = await request.post('/api/posts', {
      headers,
      data: {
        title: '페이지 초과',
        content: '본문',
        content_pages: Array.from({ length: 9 }, (_item, index) => `페이지 ${index + 1}`),
        category: 'essay',
      },
    });
    expect(tooManyPages.status()).toBe(400);
    expect((await tooManyPages.json()).message).toContain('최대 8장');

    const emptyPages = await request.post('/api/posts', {
      headers,
      data: {
        title: '빈 페이지',
        content: '본문',
        content_pages: ['', '   '],
        category: 'essay',
      },
    });
    expect(emptyPages.status()).toBe(400);

    const tooLongPage = await request.post('/api/posts', {
      headers,
      data: {
        title: '긴 페이지',
        content: '본문',
        content_pages: ['가'.repeat(1001)],
        category: 'essay',
      },
    });
    expect(tooLongPage.status()).toBe(400);
    expect((await tooLongPage.json()).message).toContain('1000자');
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
