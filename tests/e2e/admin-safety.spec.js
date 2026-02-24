const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

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

async function mockAdminBootApis(page) {
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

  await page.route('**/api/ux-events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  );
}

test.describe('Admin dangerous action safety', () => {
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
});
