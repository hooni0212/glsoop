const { test, expect } = require('@playwright/test');

const LOGIN_URL = '/html/login.html';

const mockMe = async (page, authenticated = false) => {
  await page.route('**/api/me', (route) => {
    if (!authenticated) {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false }),
      });
      return;
    }

    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        id: 2,
        name: 'User',
        nickname: '일반사용자',
        email: 'user@glsoop.test',
        is_admin: 0,
        is_verified: 1,
      }),
    });
  });
};

const mockUxEvents = async (page) => {
  await page.route('**/api/ux-events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  );
};

test.describe('Login Rive stability', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop only');
  });

  test('shows validation error immediately and does not call /api/login when fields are empty', async ({ page }) => {
    let loginCalls = 0;

    await mockMe(page, false);
    await mockUxEvents(page);
    await page.route('**/api/login', (route) => {
      loginCalls += 1;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto(LOGIN_URL);
    await page.click('#loginForm button[type="submit"]');

    await expect(page.locator('#loginMessage')).toContainText('이메일과 비밀번호를 모두 입력하세요.');
    expect(loginCalls).toBe(0);
  });

  test('starts API request immediately and applies minimum visual delay before success transition', async ({ page }) => {
    let requestAt = 0;

    await mockMe(page, true);
    await mockUxEvents(page);
    await page.route('**/api/login', (route) => {
      requestAt = Date.now();
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          message: '로그인 성공',
          remember_me: false,
          remember_notice_required: false,
        }),
      });
    });

    await page.goto(`${LOGIN_URL}?next=%2Fhtml%2Feditor.html`);
    await page.fill('#loginForm input[name="email"]', 'user@glsoop.test');
    await page.fill('#loginForm input[name="pw"]', 'Pass1234');

    const clickAt = Date.now();
    await Promise.all([
      page.waitForURL(/\/html\/editor\.html$/, { timeout: 12000 }),
      page.click('#loginForm button[type="submit"]'),
    ]);
    const navigatedAt = Date.now();

    expect(requestAt).toBeGreaterThan(0);
    expect(requestAt - clickAt).toBeLessThan(450);
    expect(navigatedAt - clickAt).toBeGreaterThanOrEqual(800);
  });

  test('keeps login flow working when Rive enters fallback mode', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(String(error?.message || error));
    });

    await mockMe(page, false);
    await mockUxEvents(page);

    await page.route('**/cdn.jsdelivr.net/npm/@rive-app/canvas@2.31.6**', (route) => route.abort());
    await page.route('**/unpkg.com/@rive-app/canvas@2.31.6/**', (route) => route.abort());
    await page.route('**/rive/*.riv', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'not found',
      })
    );

    await page.route('**/api/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          code: 'INVALID_CREDENTIALS',
          message: '이메일 또는 비밀번호가 올바르지 않습니다.',
        }),
      })
    );

    await page.goto(`${LOGIN_URL}?riveDebug=1`);
    await page.fill('#loginForm input[name="email"]', 'user@glsoop.test');
    await page.fill('#loginForm input[name="pw"]', 'wrong-password');
    await page.click('#loginForm button[type="submit"]');

    await expect(page.locator('#loginMessage')).toContainText('올바르지 않습니다');

    const meta = await page.evaluate(() => window.glsoopLoginRive?.getMeta?.() || null);
    expect(meta).toBeTruthy();
    expect(meta.fallbackMode).not.toBe('none');
    expect(pageErrors).toEqual([]);
  });

  test('prevents duplicate submit requests on rapid multi-click', async ({ page }) => {
    let loginCalls = 0;

    await mockMe(page, false);
    await mockUxEvents(page);
    await page.route('**/api/login', async (route) => {
      loginCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          code: 'INVALID_CREDENTIALS',
          message: '이메일 또는 비밀번호가 올바르지 않습니다.',
        }),
      });
    });

    await page.goto(LOGIN_URL);
    await page.fill('#loginForm input[name="email"]', 'user@glsoop.test');
    await page.fill('#loginForm input[name="pw"]', 'wrong-password');

    await page.evaluate(() => {
      const button = document.querySelector('#loginForm button[type="submit"]');
      if (!button) return;
      button.click();
      button.click();
      button.click();
    });

    await expect(page.locator('#loginMessage')).toContainText('올바르지 않습니다');
    expect(loginCalls).toBe(1);
  });

  test('maps focus steps for email/password and skips submit acorn on failed credentials', async ({ page }) => {
    await mockMe(page, false);
    await mockUxEvents(page);

    await page.route('**/api/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          code: 'INVALID_CREDENTIALS',
          message: '이메일 또는 비밀번호가 올바르지 않습니다.',
        }),
      })
    );

    await page.goto(`${LOGIN_URL}?riveDebug=1`);

    await expect
      .poll(async () => {
        const meta = await page.evaluate(() => window.glsoopLoginRive?.getMeta?.() || null);
        return Boolean(meta && (meta.ready || meta.fallbackMode !== 'none'));
      })
      .toBe(true);

    await page.waitForTimeout(1100);

    await page.fill('#loginForm input[name="email"]', 'user@glsoop.test');
    await expect
      .poll(() => page.evaluate(() => window.glsoopLoginRive?.getMeta?.().desiredFocusStep ?? -1))
      .toBe(1);

    await page.focus('#loginForm input[name="pw"]');
    await expect
      .poll(() => page.evaluate(() => window.glsoopLoginRive?.getMeta?.().desiredFocusStep ?? -1))
      .toBe(2);

    await page.fill('#loginForm input[name="email"]', 'user@glsoop.test');
    await page.fill('#loginForm input[name="pw"]', 'wrong-password');
    await page.click('#loginForm button[type="submit"]');
    await expect(page.locator('#loginMessage')).toContainText('올바르지 않습니다');

    await expect
      .poll(() => page.evaluate(() => window.glsoopLoginRive?.getMeta?.().submitAttemptCount ?? -1))
      .toBe(0);
    await expect
      .poll(() => page.evaluate(() => window.glsoopLoginRive?.getMeta?.().lastSubmitAttemptFocusStep ?? -1))
      .not.toBe(3);
  });
});
