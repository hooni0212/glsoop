const { test, expect } = require('@playwright/test');

const postFixture = {
  id: 1,
  user_id: 1,
  title: 'Poem Post',
  content: 'Poem content',
  category: 'poem',
  author_name: '관리자',
  author_nickname: '관리자',
  author_email: 'admin@glsoop.test',
  created_at: '2026-02-23T15:06:00.000Z',
  like_count: 1,
  liked_by_me: false,
  hashtags: ['시'],
};

test.describe('Post web comments', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop only');
  });

  test('shows comments and allows writing comments and replies', async ({ page }) => {
    let createdCommentId = 11;

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

    await page.route('**/api/posts/1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          post: postFixture,
        }),
      })
    );

    await page.route('**/api/posts/1/related**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, posts: [] }),
      })
    );

    await page.route('**/api/posts/1/comments**', (route) => {
      if (route.request().method() === 'POST') {
        const payload = route.request().postDataJSON();
        createdCommentId += 1;
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            comment: {
              id: createdCommentId,
              post_id: 1,
              parent_comment_id: payload.parent_comment_id || null,
              status: 'active',
              content: payload.content,
              author: { id: 2, nickname: '일반사용자', display_name: '일반사용자' },
              reply_count: 0,
              created_at: '2026-02-23T15:10:00.000Z',
            },
          }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          comments: [
            {
              id: 10,
              post_id: 1,
              parent_comment_id: null,
              status: 'active',
              content: '웹 댓글입니다.',
              author: { id: 3, nickname: '독자', display_name: '독자' },
              reply_count: 0,
              created_at: '2026-02-23T15:08:00.000Z',
            },
          ],
          pagination: { limit: 50, offset: 0, total: 1, has_more: false },
        }),
      });
    });

    await page.goto('/html/post.html?postId=1');

    await expect(page.locator('#postDetail .gls-post-card')).toBeVisible();
    await expect(page.locator('#postCommentsPanel')).toBeVisible();
    await expect(page.locator('#postCommentsCount')).toHaveText('1');
    await expect(page.locator('.post-comment-body', { hasText: '웹 댓글입니다.' })).toBeVisible();

    await page.locator('#postCommentInput').fill('새 웹 댓글입니다.');
    await page.locator('#postCommentSubmitBtn').click();
    await expect(page.locator('.post-comment-body', { hasText: '새 웹 댓글입니다.' })).toBeVisible();
    await expect(page.locator('#postCommentsCount')).toHaveText('2');

    await page.locator('[data-comment-reply="10"]').click();
    await expect(page.locator('#postCommentReplyTarget')).toBeVisible();
    await page.locator('#postCommentInput').fill('웹 답글입니다.');
    await page.locator('#postCommentSubmitBtn').click();

    await expect(page.locator('.post-comment-item--reply .post-comment-body', { hasText: '웹 답글입니다.' })).toBeVisible();
    await expect(page.locator('#postCommentsCount')).toHaveText('3');
  });
});
