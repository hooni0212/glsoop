const { test, expect } = require('@playwright/test');
const { mockAuthorPageApis } = require('./author-test-utils');

test.describe('Author mobile priority layout', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile-'), 'Mobile only');
  });

  test('shows hero + dual CTA within first viewport and supports bio collapse toggle', async ({ page }) => {
    const { uxEvents } = await mockAuthorPageApis(page);

    await page.goto('/html/author.html?userId=1');
    await expect(page.locator('#authorPostsList .author-post-card')).toHaveCount(3);

    const followBtn = page.locator('#authorFollowBtn');
    const latestBtn = page.locator('#authorLatestPostBtn');
    await expect(followBtn).toBeVisible();
    await expect(latestBtn).toBeVisible();

    const layout = await page.evaluate(() => {
      const hero = document.querySelector('.author-page-header')?.getBoundingClientRect();
      const follow = document.getElementById('authorFollowBtn')?.getBoundingClientRect();
      const latest = document.getElementById('authorLatestPostBtn')?.getBoundingClientRect();
      const list = document.getElementById('authorPostsList')?.getBoundingClientRect();
      return {
        heroBottom: hero?.bottom || 0,
        followTop: follow?.top || 0,
        followBottom: follow?.bottom || 0,
        latestTop: latest?.top || 0,
        latestBottom: latest?.bottom || 0,
        listTop: list?.top || 0,
      };
    });

    expect(layout.followBottom).toBeLessThanOrEqual(844);
    expect(layout.latestBottom).toBeLessThanOrEqual(844);
    expect(layout.heroBottom).toBeLessThan(layout.listTop);
    expect(layout.followTop).toBeLessThanOrEqual(layout.latestTop);

    const bioToggleBtn = page.locator('#authorBioToggleBtn');
    const aboutText = page.locator('#authorAbout');

    await expect(bioToggleBtn).toBeVisible();
    await expect(bioToggleBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(aboutText).toHaveClass(/is-collapsed/);

    await bioToggleBtn.click();
    await expect(bioToggleBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(aboutText).not.toHaveClass(/is-collapsed/);

    await expect.poll(() => uxEvents.includes('author_profile_view')).toBe(true);
  });
});
