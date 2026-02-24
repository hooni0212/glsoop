const { test, expect } = require('@playwright/test');
const { mockAuthorPageApis } = require('./author-test-utils');

test.describe('Author CTA flow', () => {
  test('toggles follow state and opens latest post CTA', async ({ page }) => {
    const { uxEvents } = await mockAuthorPageApis(page);

    await page.goto('/html/author.html?userId=1');

    const followBtn = page.locator('#authorFollowBtn');
    await expect(followBtn).toHaveText('팔로우');

    await followBtn.click();
    await expect(followBtn).toHaveText('팔로잉');
    await expect(page.locator('#authorFollowerCount')).toHaveText('3');

    await followBtn.click();
    await expect(followBtn).toHaveText('팔로우');
    await expect(page.locator('#authorFollowerCount')).toHaveText('2');

    await Promise.all([
      page.waitForURL(/\/html\/post\.html\?postId=103/),
      page.locator('#authorLatestPostBtn').click(),
    ]);

    await expect.poll(() => uxEvents.includes('author_follow_click')).toBe(true);
    await expect.poll(() => uxEvents.includes('author_post_open')).toBe(true);
  });

  test('opens post detail when clicking feed cards', async ({ page }) => {
    const { uxEvents } = await mockAuthorPageApis(page);

    await page.goto('/html/author.html?userId=1');

    const firstCard = page.locator('#authorPostsList .author-post-card').first();
    await expect(firstCard).toBeVisible();

    const postId = await firstCard.getAttribute('data-post-id');
    expect(postId).toBeTruthy();

    const titleLinkArea = firstCard.locator('.author-post-title').first();

    await Promise.all([
      page.waitForURL(new RegExp(`/html/post\\.html\\?postId=${postId}$`)),
      titleLinkArea.click(),
    ]);

    await expect.poll(() => uxEvents.includes('author_post_open')).toBe(true);
  });
});
