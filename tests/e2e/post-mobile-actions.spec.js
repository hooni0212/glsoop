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

const relatedPosts = [
  {
    id: 2,
    user_id: 1,
    title: 'Essay Post',
    content: 'Essay content',
    category: 'essay',
    author_name: '관리자',
    author_nickname: '관리자',
    author_email: 'admin@glsoop.test',
    created_at: '2026-02-23T15:06:00.000Z',
    like_count: 0,
    liked_by_me: false,
  },
  {
    id: 3,
    user_id: 1,
    title: 'Short Post',
    content: 'Short content',
    category: 'short',
    author_name: '관리자',
    author_nickname: '관리자',
    author_email: 'admin@glsoop.test',
    created_at: '2026-02-23T15:06:00.000Z',
    like_count: 0,
    liked_by_me: false,
  },
];

test.describe('Post mobile action priority', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'Mobile only');
  });

  test('keeps action dock safe and wires like/bookmark/share actions', async ({ page }) => {
    let likeCount = 1;
    let liked = false;

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
          post: {
            ...postFixture,
            like_count: likeCount,
            liked_by_me: liked,
          },
        }),
      })
    );

    await page.route('**/api/posts/1/related**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          posts: relatedPosts,
        }),
      })
    );

    await page.route('**/api/posts/1/comments**', (route) => {
      if (route.request().method() === 'POST') {
        const payload = route.request().postDataJSON();
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            comment: {
              id: 11,
              post_id: 1,
              parent_comment_id: payload.parent_comment_id || null,
              status: 'active',
              content: payload.content,
              author: { id: 2, nickname: '일반사용자', display_name: '일반사용자' },
              reply_count: 0,
              like_count: 0,
              liked_by_me: false,
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
              like_count: 0,
              liked_by_me: false,
              created_at: '2026-02-23T15:08:00.000Z',
            },
          ],
          pagination: { limit: 50, offset: 0, total: 1, has_more: false },
        }),
      });
    });

    await page.route('**/api/posts/1/toggle-like', (route) => {
      liked = !liked;
      likeCount += liked ? 1 : -1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          liked,
          like_count: likeCount,
        }),
      });
    });

    await page.route('**/api/bookmarks/lists', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          lists: [
            { id: 1, name: 'Favorites' },
            { id: 2, name: 'Poems' },
          ],
        }),
      })
    );

    await page.route('**/api/posts/1/bookmarks', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          lists: [{ id: 1, contains: false }],
        }),
      })
    );

    await page.goto('/html/post.html?postId=1');
    await expect(page.locator('#postDetail .gls-post-card')).toBeVisible();
    await expect(page.locator('#sideLikeBtn')).toBeVisible();
    await expect(page.locator('#postCommentsPanel')).toBeVisible();
    await expect(page.getByText('웹 댓글입니다.')).toBeVisible();
    await page.locator('#postCommentInput').fill('새 웹 댓글입니다.');
    await page.locator('#postCommentSubmitBtn').click();
    await expect(page.getByText('새 웹 댓글입니다.')).toBeVisible();

    let modeAfterScroll = 'inline';
    for (const ratio of [0.72, 0.82, 0.92]) {
      await page.evaluate((value) => {
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo(0, maxScroll * value);
      }, ratio);
      await page.waitForTimeout(180);
      const mode = await page.evaluate(() => document.body.dataset.postActionMode || 'inline');
      modeAfterScroll = mode;
      if (mode === 'dock') {
        break;
      }
    }
    expect(['inline', 'dock']).toContain(modeAfterScroll);

    const hasOverlap = await page.evaluate(() => {
      const dockPanel = document.querySelector('.post-action-dock .post-actions-panel');
      const card = document.querySelector('#postDetail .gls-post-card');
      if (!dockPanel || !card) return false;
      const dockRect = dockPanel.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const overlap = Math.min(cardRect.bottom, dockRect.bottom) - Math.max(cardRect.top, dockRect.top);
      return overlap > 0;
    });
    expect(hasOverlap).toBe(false);

    const likeCountBefore = Number((await page.locator('#sideLikeCount').innerText()).trim());
    await page.click('#sideLikeBtn');
    await expect(page.locator('#sideLikeBtn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#sideLikeCount')).toHaveText(String(likeCountBefore + 1));

    await page.click('#sideBookmarkBtn');
    await expect(page.locator('#bookmarkSelectModal')).toBeVisible();
    await page.click('#bookmarkSelectModal [data-gls-dismiss="modal"]');
    await expect(page.locator('#bookmarkSelectModal')).toBeHidden();

    await page.click('#sideShareBtn');
    await expect(page.locator('#igExportModal')).toBeVisible();
  });
});
