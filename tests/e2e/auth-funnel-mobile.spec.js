const { test, expect } = require('@playwright/test');

test.describe('Auth funnel on mobile', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'Mobile only');
  });

  test('renders login form first in initial viewport', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false }),
      })
    );
    await page.route('**/api/ux-events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    );

    await page.goto('/html/login.html?next=%2Fhtml%2Feditor.html');

    const emailInput = page.locator('#loginForm input[name="email"]');
    await expect(emailInput).toBeVisible();

    const cardRect = await page.locator('#loginForm').boundingBox();
    const inputRect = await emailInput.boundingBox();
    expect(cardRect).not.toBeNull();
    expect(inputRect).not.toBeNull();

    if (cardRect && inputRect) {
      expect(inputRect.y).toBeGreaterThanOrEqual(0);
      expect(inputRect.y + inputRect.height).toBeLessThanOrEqual(844);
    }

    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);
  });

  test('shows validation error message and moves focus to feedback', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false }),
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

    await page.goto('/html/login.html');
    await page.fill('#loginForm input[name="email"]', 'user@glsoop.test');
    await page.fill('#loginForm input[name="pw"]', 'wrong-password');
    await page.click('#loginForm button[type="submit"]');

    const message = page.locator('#loginMessage');
    await expect(message).toBeVisible();
    await expect(message).toContainText('올바르지 않습니다');

    const activeId = await page.evaluate(() => document.activeElement?.id || '');
    expect(activeId).toBe('loginMessage');
  });

  test('keeps safe next redirect on successful login', async ({ page }) => {
    await page.route('**/api/me', (route) =>
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
      })
    );
    await page.route('**/api/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          message: '로그인 성공',
          remember_me: false,
          remember_notice_required: false,
        }),
      })
    );

    await page.goto('/html/login.html?next=%2Fhtml%2Feditor.html');
    await page.fill('#loginForm input[name="email"]', 'user@glsoop.test');
    await page.fill('#loginForm input[name="pw"]', 'password');

    await Promise.all([
      page.waitForURL(/\/html\/editor\.html$/, { timeout: 12000 }),
      page.click('#loginForm button[type="submit"]'),
    ]);
  });

  test('blocks unsafe next and falls back to mypage redirect', async ({ page }) => {
    await page.route('**/api/me', (route) =>
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
      })
    );
    await page.route('**/api/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          message: '로그인 성공',
          remember_me: false,
          remember_notice_required: false,
        }),
      })
    );

    await page.goto('/html/login.html?next=%2F%2Fevil.com');
    await page.fill('#loginForm input[name="email"]', 'user@glsoop.test');
    await page.fill('#loginForm input[name="pw"]', 'password');

    await Promise.all([
      page.waitForURL(/\/html\/mypage\.html$/, { timeout: 12000 }),
      page.click('#loginForm button[type="submit"]'),
    ]);
  });
});
