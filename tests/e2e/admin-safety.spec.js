const { test, expect } = require('@playwright/test');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

async function seedAdminGuardFixtures() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [1, 'Admin', '관리자', 'admin@glsoop.test', 'password', 1, 1]
  );
  await new Promise((resolve) => db.close(resolve));
}

async function applyAdminCookie(page, baseURL) {
  const token = jwt.sign(
    {
      id: 1,
      sid: `admin_safety_sid_${process.pid}`,
      name: 'Admin',
      nickname: '관리자',
      email: 'admin@glsoop.test',
      isAdmin: true,
      isVerified: true,
    },
    'devsecret',
    {
      algorithm: 'HS256',
      issuer: 'glsoop',
      audience: 'glsoop-client',
      expiresIn: '2h',
    }
  );

  await page.context().addCookies([
    {
      name: 'token',
      value: token,
      url: baseURL,
    },
  ]);
}

async function mockAdminBootApis(page, options = {}) {
  let reportStatus = options.initialReportStatus || 'queued';
  let reportedPostRows = [
    {
      target_post_id: 11,
      target_post_title: 'Poem Post',
      target_user_id: 2,
      target_user_display_name: 'User',
      target_user_nickname: '일반사용자',
      report_count: 8,
      unique_reporter_count: 5,
      queued_count: 7,
      reviewing_count: 1,
      latest_reported_at: '2026-04-03T05:00:00.000Z',
    },
  ];

  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        id: 1,
        name: 'Admin',
        nickname: '관리자',
        email: 'admin@glsoop.test',
        is_admin: 1,
        is_verified: 1,
      }),
    })
  );

  await page.route('**/api/admin/users', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        users: [
          {
            id: 1,
            name: 'Admin',
            nickname: '관리자',
            email: 'admin@glsoop.test',
            is_admin: 1,
            is_verified: 1,
          },
          {
            id: 2,
            name: 'User',
            nickname: '일반사용자',
            email: 'user@glsoop.test',
            is_admin: 0,
            is_verified: 1,
          },
        ],
      }),
    })
  );

  await page.route('**/api/admin/posts**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [
          {
            id: 11,
            title: 'Poem Post',
            content: 'Poem content',
            category: 'poem',
            author_name: 'Admin',
            author_nickname: '관리자',
            author_email: 'admin@glsoop.test',
            created_at: '2026-02-23 15:06:00',
            like_count: 1,
          },
        ],
        total: 1,
        page: 1,
        page_size: 48,
      }),
    })
  );

  await page.route('**/api/posts/11**', (route) => {
    const url = route.request().url();
    if (url.includes('/related')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, posts: [] }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        post: {
          id: 11,
          title: 'Poem Post',
          content: 'Poem content',
          category: 'poem',
          author_name: 'Admin',
          author_nickname: '관리자',
          created_at: '2026-02-23 15:06:00',
          like_count: 1,
          liked: false,
        },
      }),
    });
  });

  await page.route('**/api/admin/quest-templates', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [],
      }),
    })
  );

  await page.route('**/api/admin/quest-campaigns', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [],
        campaign_items: [],
      }),
    })
  );

  await page.route('**/api/admin/share-events/summary**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        summary: {
          total_count: 0,
          shared_count: 0,
          dismissed_count: 0,
          failed_count: 0,
          unique_user_count: 0,
          unique_post_count: 0,
        },
        by_channel: [],
        by_surface: [],
        daily: [],
      }),
    })
  );

  await page.route('**/api/admin/safety/reports**', async (route) => {
    const request = route.request();
    const url = request.url();

    if (request.method() === 'POST' && url.includes('/resolve')) {
      const body = JSON.parse(request.postData() || '{}');
      reportStatus = body.status || reportStatus;
      if (typeof options.onResolveReport === 'function') {
        options.onResolveReport({ url, body });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          report: {
            id: 101,
            status: reportStatus,
            action: body.action || null,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        reports: [
          {
            id: 101,
            reporter_id: 7,
            reporter_display_name: '신고자A',
            reporter_nickname: '새벽',
            target_user_id: 2,
            target_user_display_name: 'User',
            target_user_nickname: '일반사용자',
            target_post_id: 11,
            target_post_title: 'Poem Post',
            source: 'report',
            reason_code: 'other',
            detail: '운영 검토가 필요한 내용입니다.',
            status: reportStatus,
            created_at: '2026-04-03T01:30:00.000Z',
          },
        ],
        meta: {
          count: 1,
          source: 'report+block',
          sources: ['report', 'block'],
        },
      }),
    });
  });

  await page.route('**/api/admin/safety/reported-posts**', async (route) => {
    const request = route.request();
    const url = request.url();

    if (request.method() === 'POST' && url.includes('/resolve')) {
      const body = JSON.parse(request.postData() || '{}');
      reportedPostRows = [];
      reportStatus = body.status || reportStatus;
      if (typeof options.onResolveReportedPost === 'function') {
        options.onResolveReportedPost({ url, body });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          result: {
            target_post_id: 11,
            status: body.status,
            action: body.action,
            updated_count: 8,
          },
        }),
      });
      return;
    }

    if (request.method() === 'POST' && url.includes('/delete')) {
      const body = JSON.parse(request.postData() || '{}');
      reportedPostRows = [];
      reportStatus = 'actioned';
      if (typeof options.onDeleteReportedPost === 'function') {
        options.onDeleteReportedPost({ url, body });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          result: {
            deleted: true,
            resolved_count: 8,
            post: { id: 11, title: 'Poem Post' },
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        posts: reportedPostRows,
      }),
    });
  });

  await page.route('**/api/ux-events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  );
}

test.describe('Admin dangerous action safety', () => {
  test.beforeEach(async () => {
    await seedAdminGuardFixtures();
  });

  test('requires two-step confirmation and prevents duplicate delete requests', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';
    let deleteCalls = 0;
    let resolveDelete = null;

    await mockAdminBootApis(page);
    await applyAdminCookie(page, baseURL);
    await page.route('**/api/admin/users/2', async (route) => {
      deleteCalls += 1;
      await new Promise((resolve) => {
        resolveDelete = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/admin');
    const userRow = page.locator('tr[data-user-id="2"]');
    const deleteBtn = userRow.locator('.admin-delete-user-btn');
    await expect(deleteBtn).toBeVisible();

    await deleteBtn.click();
    await expect(page.locator('#adminDangerConfirmModal')).toBeVisible();
    await expect(page.locator('#adminDangerConfirmBtn')).toBeDisabled();
    expect(deleteCalls).toBe(0);

    await page.fill('#adminDangerInput', 'wrong');
    await expect(page.locator('#adminDangerConfirmBtn')).toBeDisabled();

    await page.fill('#adminDangerInput', 'DELETE');
    await expect(page.locator('#adminDangerConfirmBtn')).toBeEnabled();
    await page.click('#adminDangerConfirmBtn');

    await expect.poll(() => deleteCalls).toBe(1);
    await expect(deleteBtn).toBeDisabled();

    await page.evaluate(() => {
      const btn = document.querySelector('tr[data-user-id="2"] .admin-delete-user-btn');
      btn?.click();
    });
    await page.waitForTimeout(120);
    expect(deleteCalls).toBe(1);
    await expect(page.locator('#adminDangerConfirmModal')).toBeHidden();

    if (resolveDelete) resolveDelete();
    await expect(userRow).toHaveCount(0);
    expect(deleteCalls).toBe(1);
  });

  test('renders safety tab with report list and reported-post summary', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';

    await mockAdminBootApis(page);
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.getByRole('button', { name: /신고/ }).click();

    await expect(page.locator('#safetyTab')).toBeVisible();
    await expect(page.locator('#adminSafetyReports')).toContainText('신고자');
    await expect(page.locator('#adminSafetyReports')).toContainText('대상 사용자');
    await expect(page.locator('#adminSafetyReports')).toContainText('운영 검토가 필요한 내용입니다.');
    await expect(page.locator('#adminSafetyReports')).toContainText('접수');
    await expect(page.locator('#adminSafetyReports')).toContainText('조치');

    await expect(page.locator('#adminReportedPosts')).toContainText('Poem Post');
    await expect(page.locator('#adminReportedPosts')).toContainText('신고자');
    await expect(page.locator('#adminReportedPosts')).toContainText('5');
    await expect(page.locator('#adminReportedPosts')).toContainText('삭제');
  });

  test('opens admin post detail links with postId query parameter', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';

    await mockAdminBootApis(page);
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.locator('.admin-tabs .nav-link[data-target="postsTab"]').click();

    const [postPreviewPage] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('#adminPosts .admin-post-card__preview').click(),
    ]);
    await expect(postPreviewPage).toHaveURL(/\/html\/post\.html\?postId=11$/);
    await postPreviewPage.close();

    await page.locator('.admin-tabs .nav-link[data-target="safetyTab"]').click();
    const [reportedPostPage] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('#adminReportedPosts [data-reported-post-action="open-post"]').click(),
    ]);
    await expect(reportedPostPage).toHaveURL(/\/html\/post\.html\?postId=11$/);
    await reportedPostPage.close();
  });

  test('resolves reported posts from the safety tab UI', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';
    let resolveCalls = 0;
    let resolvePayload = null;

    await mockAdminBootApis(page, {
      onResolveReportedPost({ body }) {
        resolveCalls += 1;
        resolvePayload = body;
      },
    });
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.getByRole('button', { name: /신고/ }).click();

    await page.locator('#adminReportedPosts [data-reported-post-action="dismissed"]').click();

    await expect.poll(() => resolveCalls).toBe(1);
    expect(resolvePayload).toMatchObject({
      status: 'dismissed',
      action: 'no_violation',
    });
    await expect(page.locator('#adminReportedPosts')).toContainText('누적 신고 5건 이상인 글이 없습니다.');
  });

  test('deletes reported posts through the safety tab danger confirmation', async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://127.0.0.1:3100';
    let deleteCalls = 0;

    await mockAdminBootApis(page, {
      onDeleteReportedPost() {
        deleteCalls += 1;
      },
    });
    await applyAdminCookie(page, baseURL);

    await page.goto('/admin');
    await page.getByRole('button', { name: /신고/ }).click();

    await page.locator('#adminReportedPosts [data-reported-post-action="delete-post"]').click();
    await expect(page.locator('#adminDangerConfirmModal')).toBeVisible();
    await expect(page.locator('#adminDangerConfirmBtn')).toBeDisabled();

    await page.fill('#adminDangerInput', 'DELETE');
    await expect(page.locator('#adminDangerConfirmBtn')).toBeEnabled();
    await page.click('#adminDangerConfirmBtn');

    await expect.poll(() => deleteCalls).toBe(1);
    await expect(page.locator('#adminReportedPosts')).toContainText('누적 신고 5건 이상인 글이 없습니다.');
  });
});
