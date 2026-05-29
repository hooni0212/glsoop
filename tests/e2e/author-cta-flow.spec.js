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

  test('shows an active visible follow button when already following', async ({ page }) => {
    await mockAuthorPageApis(page, {
      viewer: {
        id: 2,
        is_logged_in: true,
        is_own_profile: false,
        is_following: true,
      },
    });

    await page.goto('/html/author.html?userId=1');

    const followBtn = page.locator('#authorFollowBtn');
    await expect(followBtn).toHaveText('팔로잉');
    await expect(followBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(followBtn).toHaveClass(/gls-btn-primary/);
    await expect(followBtn).toHaveClass(/is-active/);
    await expect(followBtn).not.toHaveCSS('background-image', 'none');
    await expect(followBtn).toHaveCSS('color', 'rgb(248, 255, 249)');
  });

  test('opens author pages from clean /users/:id target paths', async ({ page }) => {
    await mockAuthorPageApis(page);

    await page.goto('/users/1');

    await expect(page.locator('#authorFollowBtn')).toHaveText('팔로우');
    await expect(page.locator('#authorPostsList .author-post-card')).toHaveCount(3);
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
