const { test, expect } = require('@playwright/test');

test.describe('Legal pages', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop only');
  });

  test('serves legal pages with core headings', async ({ request }) => {
    const pages = [
      { path: '/child-safety', heading: '글숲 아동 안전 표준', includes: 'glsoop1752@gmail.com' },
      { path: '/html/child-safety.html', heading: '글숲 아동 안전 표준', includes: 'glsoop1752@gmail.com' },
      { path: '/html/terms.html', heading: '글숲 이용약관' },
      { path: '/html/privacy.html', heading: '개인정보 처리방침' },
      { path: '/html/community-guidelines.html', heading: '글숲 커뮤니티 가이드라인' },
      { path: '/support', heading: '글숲 지원 안내', includes: 'glsoop1752@gmail.com' },
    ];

    for (const pageInfo of pages) {
      const response = await request.get(pageInfo.path);
      expect(response.status(), pageInfo.path).toBe(200);
      const html = await response.text();
      expect(html).toContain(pageInfo.heading);
      if (pageInfo.includes) {
        expect(html).toContain(pageInfo.includes);
      }
    }
  });

  test('blocks direct support html path', async ({ request }) => {
    const response = await request.get('/html/support.html');
    expect(response.status()).toBe(404);
  });

  test('signup page links to terms, privacy, and community guideline docs', async ({ page }) => {
    await page.goto('/html/signup.html');

    await expect(page.locator('a[href="/html/terms.html"]')).toBeVisible();
    await expect(page.locator('a[href="/html/privacy.html"]')).toBeVisible();
    await expect(page.locator('a.auth-guideline-trigger[href="/html/community-guidelines.html"]')).toBeVisible();
  });
});
