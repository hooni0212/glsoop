const { test, expect } = require('@playwright/test');

test.describe('Mobile editor input', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile-'), 'Mobile only');
  });

  test('accepts title and rich-text input and remains scrollable', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          id: 2,
          name: 'Mobile User',
          nickname: '모바일사용자',
          email: 'mobile-user@glsoop.test',
          is_admin: 0,
          is_verified: 1,
        }),
      })
    );
    await page.route('**/api/notifications**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, notifications: [], unread_count: 0 }),
      })
    );

    await page.goto('/html/editor.html');

    const title = page.locator('#postTitle');
    await title.focus();
    await page.keyboard.insertText('모바일 키보드 제목');
    await expect(title).toHaveValue('모바일 키보드 제목');

    const editor = page.locator('.ql-editor');
    await editor.focus();
    await page.keyboard.insertText('모바일 키보드로 입력한 본문입니다.');
    await expect(editor).toContainText('모바일 키보드로 입력한 본문입니다.');

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    await expect(editor).toBeVisible();
  });
});
