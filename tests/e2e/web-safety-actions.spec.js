const { test, expect } = require('@playwright/test');
const { mockAuthorPageApis } = require('./author-test-utils');

const runtimeConfigPayload = {
  ok: true,
  flags: {
    safe_area_guides: false,
  },
  legal: {
    urls: {
      terms: '/html/terms.html',
      privacy: '/html/privacy.html',
      guidelines: '/html/community-guidelines.html',
    },
  },
  safety: {
    report_enabled: true,
    block_enabled: true,
    moderation_sla_hours: 24,
    report_detail_max_length: 200,
    report_detail_required_reason_codes: ['other'],
    report_reasons: [
      { code: 'harassment', label: '괴롭힘/비방', target_types: ['post', 'user'] },
      { code: 'hate', label: '혐오/차별', target_types: ['post', 'user'] },
      { code: 'sexual', label: '선정성/음란성', target_types: ['post', 'user'] },
      { code: 'violence', label: '폭력성/자해/위협', target_types: ['post', 'user'] },
      { code: 'spam', label: '광고/스팸', target_types: ['post', 'user'] },
      { code: 'impersonation', label: '사칭/도용', target_types: ['post', 'user'] },
      { code: 'other', label: '기타', target_types: ['post', 'user'] },
    ],
  },
};

const postFixture = {
  id: 1,
  user_id: 1,
  author_id: 1,
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

test.describe('Website safety actions', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop only');
  });

  test('author overflow menu submits report and block requests', async ({ page }) => {
    let reportPayload = null;
    let blockPayload = null;

    await mockAuthorPageApis(page);

    await page.route('**/api/runtime-config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(runtimeConfigPayload),
      })
    );

    await page.route('**/api/users/1/report', async (route) => {
      reportPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.route('**/api/users/1/block', async (route) => {
      blockPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/html/author.html?userId=1');

    await page.click('#authorOverflowBtn');
    await page.click('#authorReportBtn');
    await expect(page.locator('#glsoopSafetyModal')).toBeVisible();
    await expect(page.locator('#glsoopSafetyModalDescription')).toContainText('운영 검토 큐에 접수됩니다');
    await expect(page.locator('#glsoopSafetyDetailField')).toBeHidden();
    await page.check('input[name="glsoopSafetyReason"][value="other"]');
    await expect(page.locator('#glsoopSafetyDetailField')).toBeVisible();
    await page.fill('#glsoopSafetyDetailInput', '프로필 설명이 부적절합니다.');
    await page.click('#glsoopSafetyConfirmBtn');
    await expect.poll(() => Boolean(reportPayload)).toBe(true);
    expect(reportPayload).toMatchObject({
      reason_code: 'other',
      detail: '프로필 설명이 부적절합니다.',
    });

    await page.click('#authorOverflowBtn');
    await page.click('#authorBlockBtn');
    await expect(page.locator('#glsoopSafetyModal')).toBeVisible();
    await expect(page.locator('#glsoopSafetyModalDescription')).toContainText('내 화면에서 숨겨집니다');
    await expect(page.locator('#glsoopSafetyModalDescription')).not.toContainText('운영');
    await expect(page.locator('#glsoopSafetyDetailField')).toBeHidden();
    await page.check('input[name="glsoopSafetyReason"][value="hate"]');
    await page.click('#glsoopSafetyConfirmBtn');

    await expect.poll(() => Boolean(blockPayload)).toBe(true);
    expect(blockPayload).toMatchObject({
      reason_code: 'hate',
    });
    await page.waitForURL('**/explore');
  });

  test('post safety menu submits post report and author block requests', async ({ page }) => {
    let postReportPayload = null;
    let blockPayload = null;

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

    await page.route('**/api/runtime-config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(runtimeConfigPayload),
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
        body: JSON.stringify({
          ok: true,
          posts: [],
        }),
      })
    );

    await page.route('**/api/posts/1/report', async (route) => {
      postReportPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.route('**/api/users/1/block', async (route) => {
      blockPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/html/post.html?postId=1');
    await expect(page.locator('#postDetail .gls-post-card')).toBeVisible();

    await page.click('#sideSafetyBtn');
    await expect(page.locator('#postSafetyMenuModal')).toBeVisible();
    await page.click('#postSafetyReportBtn');
    await expect(page.locator('#glsoopSafetyModal')).toBeVisible();
    await expect(page.locator('#glsoopSafetyModalDescription')).toContainText('운영 검토 큐에 접수됩니다');
    await expect(page.locator('#glsoopSafetyDetailField')).toBeHidden();
    await page.check('input[name="glsoopSafetyReason"][value="other"]');
    await expect(page.locator('#glsoopSafetyDetailField')).toBeVisible();
    await page.fill('#glsoopSafetyDetailInput', '반복적인 광고성 문구입니다.');
    await page.click('#glsoopSafetyConfirmBtn');

    await expect.poll(() => Boolean(postReportPayload)).toBe(true);
    expect(postReportPayload).toMatchObject({
      reason_code: 'other',
      detail: '반복적인 광고성 문구입니다.',
    });

    await page.click('#sideSafetyBtn');
    await page.click('#postSafetyBlockBtn');
    await expect(page.locator('#glsoopSafetyModal')).toBeVisible();
    await expect(page.locator('#glsoopSafetyModalDescription')).toContainText('내 화면에서 바로 숨겨집니다');
    await expect(page.locator('#glsoopSafetyModalDescription')).not.toContainText('운영');
    await expect(page.locator('#glsoopSafetyDetailField')).toBeHidden();
    await page.check('input[name="glsoopSafetyReason"][value="harassment"]');
    await page.click('#glsoopSafetyConfirmBtn');

    await expect.poll(() => Boolean(blockPayload)).toBe(true);
    expect(blockPayload).toMatchObject({
      reason_code: 'harassment',
      context_post_id: 1,
    });
    await page.waitForURL('**/explore');
  });

  test('post3 safety menu submits a post report request', async ({ page }) => {
    let postReportPayload = null;

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

    await page.route('**/api/runtime-config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(runtimeConfigPayload),
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
        body: JSON.stringify({
          ok: true,
          posts: [],
        }),
      })
    );

    await page.route('**/api/posts/1/report', async (route) => {
      postReportPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/html/post3.html?postId=1');
    await expect(page.locator('#post3Title')).toContainText('Poem Post');

    await page.click('#post3SafetyBtn');
    await expect(page.locator('#post3SafetyMenuModal')).toBeVisible();
    await page.click('#post3SafetyReportBtn');
    await expect(page.locator('#glsoopSafetyModal')).toBeVisible();
    await expect(page.locator('#glsoopSafetyDetailField')).toBeHidden();
    await page.check('input[name="glsoopSafetyReason"][value="other"]');
    await expect(page.locator('#glsoopSafetyDetailField')).toBeVisible();
    await page.check('input[name="glsoopSafetyReason"][value="spam"]');
    await expect(page.locator('#glsoopSafetyDetailField')).toBeHidden();
    await page.click('#glsoopSafetyConfirmBtn');

    await expect.poll(() => Boolean(postReportPayload)).toBe(true);
    expect(postReportPayload).toMatchObject({
      reason_code: 'spam',
    });
  });
});
