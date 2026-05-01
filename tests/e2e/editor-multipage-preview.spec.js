const { test, expect } = require('@playwright/test');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const SID_SUFFIX = Number(process.pid || 0);
const USER_ID = 9841000 + SID_SUFFIX;
const USER_EMAIL = `editor-multipage-writer-${SID_SUFFIX}@glsoop.test`;
const USER_NICKNAME = `editor_preview_writer_${SID_SUFFIX}`;
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
    [USER_ID, 'Layout Writer', USER_NICKNAME, USER_EMAIL, passwordHash, 0, 1]
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
  cachedLayoutWriterToken = extractTokenFromSetCookie(response);
  return cachedLayoutWriterToken;
};

const applyAuthCookie = async (page, baseURL, token) => {
  await page.context().addCookies([
    {
      name: 'token',
      value: token,
      url: baseURL,
    },
  ]);
};

const buildLayoutPayload = () => ({
  layout_version: 2,
  unit: 'normalized',
  base: {
    title_box: {
      x: 0.336,
      y: 0.256,
      w: 0.424,
      h: 0.122,
      align: 'center',
      font_scale: 1,
      line_height: 1.15,
    },
    text_box: {
      x: 0.336,
      y: 0.364,
      w: 0.424,
      h: 0.346,
      align: 'center',
      font_scale: 1,
      line_height: 1.15,
    },
  },
  pages: [],
});

const parseLayoutJson = (value) => {
  if (!value) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

const buildLongMultilineContent = (lineCount = 120, prefix = '긴 글 테스트 본문') =>
  Array.from({ length: lineCount }, (_item, index) => `${prefix} ${index + 1}`).join('\n');

const setEditorBodyText = async (page, text) => {
  await page.evaluate((nextText) => {
    const editorContainer = document.querySelector('#editor');
    const editorRoot = document.querySelector('#editor .ql-editor');
    const quill =
      editorContainer?.__quill ||
      (window.Quill && window.Quill.find(editorContainer)) ||
      (window.Quill && window.Quill.find(editorRoot));
    if (!quill) {
      throw new Error('quill_not_ready');
    }
    if (typeof quill.setText === 'function') {
      quill.setText(nextText);
      return;
    }
    if (quill.clipboard && typeof quill.clipboard.dangerouslyPasteHTML === 'function') {
      const html = String(nextText || '')
        .split('\n')
        .map((line) => `<p>${line || '<br>'}</p>`)
        .join('');
      quill.clipboard.dangerouslyPasteHTML(html);
      return;
    }
    throw new Error('quill_set_text_unavailable');
  }, text);
};

const buildMockPreviewSessionResponse = (sessionSuffix, totalPages) => {
  const images = Array.from({ length: totalPages }, (_item, index) => {
    return `/img/feed-templates-v2/paper-source-01.jpg?mock=${sessionSuffix}&page=${index + 1}`;
  });
  return {
    ok: true,
    preview_session_id: `mock-session-${sessionSuffix}`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    image_url: images[0],
    primary_image: images[0],
    images,
    has_multiple: totalPages > 1,
    render_images: {
      primary_image: images[0],
      images,
      has_multiple: totalPages > 1,
      page_count: totalPages,
      page_cap: 8,
      is_truncated: false,
      preview_session_id: `mock-session-${sessionSuffix}`,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  };
};

test.describe('Editor multipage preview', () => {
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

  test('editor3 saves and restores the selected background template', async ({ page, request }, testInfo) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';

    await applyAuthCookie(page, baseURL, token);
    await page.goto('/html/editor3.html');

    await page.locator('#postTitle').fill('에디터 배경 저장');
    await setEditorBodyText(page, 'paper02 배경 선택을 저장하는 본문입니다.');
    await page.locator('[data-background-template="paper02"]').click();
    await expect(page.locator('[data-background-template="paper02"]')).toHaveClass(/is-active/);

    const createPostResponsePromise = page.waitForResponse((response) => {
      return response.url().includes('/api/posts') && response.request().method() === 'POST';
    });
    await page.locator('#saveBtn').click();
    const createPostResponse = await createPostResponsePromise;
    expect(createPostResponse.status()).toBe(200);
    await page.waitForURL(/\/html\/editor3\.html\?postId=\d+/);
    const createdPostId = Number.parseInt(new URL(page.url()).searchParams.get('postId') || '', 10);
    expect(typeof createdPostId).toBe('number');
    expect(Number.isInteger(createdPostId)).toBe(true);

    const editResponse = await request.get(`/api/posts/${createdPostId}/edit`, { headers });
    expect(editResponse.status()).toBe(200);
    const editBody = await editResponse.json();
    const savedLayout = parseLayoutJson(editBody.post.layout_json);
    expect(savedLayout.canvas.presetId).toBe('paper02');

    await expect(page.locator('[data-background-template="paper02"]')).toHaveClass(/is-active/);
  });

  test('saves page-specific layout override from the current preview page', async ({ page, request }, testInfo) => {
    const token = await loginAsLayoutWriter(request);
    const headers = { Authorization: `Bearer ${token}` };
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';

    await applyAuthCookie(page, baseURL, token);
    await page.goto('/html/editor.html');

    await page.locator('#postTitle').fill('에디터 페이지별 조절');
    await page.locator('#categorySelect').selectOption('essay');
    await setEditorBodyText(page, buildLongMultilineContent(120, '에디터 본문'));
    await page.locator('#layoutEditToggleBtn').click();

    await expect.poll(async () => {
      const text = await page.locator('#previewCarouselTotalPages').textContent();
      return Number.parseInt(String(text || '1').trim(), 10) || 1;
    }, { timeout: 15000 }).toBeGreaterThan(1);

    await page.locator('#previewCarouselNextBtn').click();
    await expect(page.locator('#previewCarouselCurrentPage')).toHaveText('2');

    const bodyBox = page.locator('.gls-layout-box--body');
    await bodyBox.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      const endX = startX + 36;
      const endY = startY + 24;

      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
          clientX: startX,
          clientY: startY,
        })
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
          clientX: endX,
          clientY: endY,
        })
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
          clientX: endX,
          clientY: endY,
        })
      );
    });

    await page.waitForTimeout(700);

    let createdPostId = null;
    const createPostResponsePromise = page.waitForResponse((response) => {
      return response.url().includes('/api/posts') && response.request().method() === 'POST';
    });

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.locator('#saveBtn').click();
    const createPostResponse = await createPostResponsePromise;
    const createPostBody = await createPostResponse.json();
    createdPostId = createPostBody.post_id;
    await page.waitForURL('**/html/mypage.html');
    expect(typeof createdPostId).toBe('number');

    const editResponse = await request.get(`/api/posts/${createdPostId}/edit`, { headers });
    expect(editResponse.status()).toBe(200);
    const editBody = await editResponse.json();
    const savedLayout = parseLayoutJson(editBody.post.layout_json);
    expect(savedLayout.layout_version).toBe(2);
    expect(savedLayout.base.title_box).toBeTruthy();
    expect(savedLayout.base.text_box).toBeTruthy();
    expect(savedLayout.pages[1].text_box).toBeTruthy();
    expect(savedLayout.pages[1].text_box.x).not.toBe(savedLayout.base.text_box.x);
  });

  test('keeps the latest preview result when an older slower response resolves later', async ({ page, request }, testInfo) => {
    const token = await loginAsLayoutWriter(request);
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';

    await applyAuthCookie(page, baseURL, token);
    await page.goto('/html/editor.html');
    await page.waitForTimeout(600);

    let interceptedCount = 0;
    await page.route('**/api/feed-images/preview/sessions', async (route) => {
      interceptedCount += 1;
      const isFirst = interceptedCount === 1;
      const responseBody = buildMockPreviewSessionResponse(
        interceptedCount,
        isFirst ? 1 : 3
      );

      await new Promise((resolve) => setTimeout(resolve, isFirst ? 900 : 50));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(responseBody),
      });
    });

    await page.locator('#postTitle').fill('프리뷰 레이스 테스트');
    await setEditorBodyText(page, '짧은 문장');
    await page.waitForTimeout(520);

    await setEditorBodyText(page, buildLongMultilineContent(90, '레이스 본문'));
    await page.waitForTimeout(700);
    await expect(page.locator('#previewCarouselTotalPages')).toHaveText('3');

    await page.waitForTimeout(900);
    await expect(page.locator('#previewCarouselTotalPages')).toHaveText('3');
    await expect(page.locator('#previewSessionError')).toBeHidden();
    expect(interceptedCount).toBeGreaterThanOrEqual(2);
  });
});
