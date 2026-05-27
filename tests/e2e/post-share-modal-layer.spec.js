const { test, expect } = require('@playwright/test');

const postFixture = {
  id: 37,
  user_id: 1,
  title: '공유 모달 레이어 테스트',
  content: '공유 모달이 헤더 위에 떠야 합니다.',
  category: 'short',
  author_name: '관리자',
  author_nickname: '관리자',
  author_email: 'admin@glsoop.test',
  created_at: '2026-02-23T15:06:00.000Z',
  like_count: 0,
  liked_by_me: false,
  hashtags: ['공유'],
};

test.describe('Post share modal layer', () => {
  test.beforeEach(async ({ page }) => {
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

    await page.route('**/api/posts/37', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          post: postFixture,
        }),
      })
    );

    await page.route('**/api/posts/37/related**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          posts: [],
        }),
      })
    );

    await page.route('**/api/posts/37/comments**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          comments: [],
          pagination: { limit: 50, offset: 0, total: 0, has_more: false },
        }),
      })
    );

    await page.route('**/api/feed-images/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="100%" height="100%" fill="#f8f2e8"/></svg>',
      })
    );
  });

  test('opens above the fixed site header', async ({ page }) => {
    await page.goto('/html/post.html?postId=37');
    await expect(page.locator('#postDetail .gls-post-card')).toBeVisible();

    await page.locator('#sideShareBtn').click();
    await expect(page.locator('#igExportModal')).toBeVisible();
    await expect(page.locator('.gls-modal-backdrop')).toBeVisible();

    const layers = await page.evaluate(() => {
      const readZIndex = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const raw = window.getComputedStyle(element).zIndex;
        if (!raw || raw === 'auto') return 0;
        return Number.parseInt(raw, 10);
      };

      return {
        header: readZIndex('.custom-navbar'),
        backdrop: readZIndex('.gls-modal-backdrop'),
        modal: readZIndex('#igExportModal'),
      };
    });

    expect(layers.header).not.toBeNull();
    expect(layers.backdrop).toBeGreaterThan(layers.header);
    expect(layers.modal).toBeGreaterThan(layers.header);
    expect(layers.modal).toBeGreaterThan(layers.backdrop);
  });
});
