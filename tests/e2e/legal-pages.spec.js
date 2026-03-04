const { test, expect } = require('@playwright/test');

test.describe('Legal pages', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop only');
  });

  test('serves legal pages with core headings', async ({ request }) => {
    const pages = [
      { path: '/html/terms.html', heading: '글숲 이용약관' },
      { path: '/html/privacy.html', heading: '개인정보 처리방침' },
      { path: '/html/community-guidelines.html', heading: '글숲 커뮤니티 가이드라인' },
    ];

    for (const pageInfo of pages) {
      const response = await request.get(pageInfo.path);
      expect(response.status(), pageInfo.path).toBe(200);
      const html = await response.text();
      expect(html).toContain(pageInfo.heading);
    }
  });

  test('signup page links to terms/privacy and opens community guideline modal', async ({ page }) => {
    await page.goto('/html/signup.html');

    await expect(page.locator('a[href="/html/terms.html"]')).toBeVisible();
    await expect(page.locator('a[href="/html/privacy.html"]')).toBeVisible();
    const guidelineTrigger = page.locator('button[data-bs-target="#signupGuidelineModal"]');
    await expect(guidelineTrigger).toBeVisible();

    await guidelineTrigger.click();
    const guidelineModal = page.locator('#signupGuidelineModal');
    await expect(guidelineModal).toBeVisible();
    await expect(guidelineModal.locator('a[href="/html/community-guidelines.html"]')).toBeVisible();
  });
});
