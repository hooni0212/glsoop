const { test, expect, devices } = require('@playwright/test');

async function mockLoggedIn(page) {
  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, name: '김태훈' }),
    })
  );
  await page.route('**/api/logout', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: '로그아웃되었습니다.' }),
    })
  );
}

function skipUnlessProject(name) {
  return ({ viewport }) => {
    const isDesktop = (viewport?.width || 0) >= 768;
    return name === 'desktop-chrome' ? !isDesktop : isDesktop;
  };
}

async function waitForNavCollapse(page) {
  const navbarNav = page.locator('#navbarNav');
  await expect
    .poll(
      async () => {
        const classList = await navbarNav.evaluate((el) => el.className);
        return classList.includes('show');
      },
      { message: 'wait for nav to open' }
    )
    .toBe(true);
}

async function expectNavClosed(page) {
  const navbarNav = page.locator('#navbarNav');
  await expect
    .poll(
      async () => {
        const classList = await navbarNav.evaluate((el) => el.className);
        return !classList.includes('show');
      },
      { message: 'nav should be closed' }
    )
    .toBe(true);
}

async function expectScrollLocked(page, locked) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const body = document.body;
          return {
            state: body.dataset.mobileNavOpen || '',
            overflow: window.getComputedStyle(body).overflow,
          };
        }),
      { message: `body scroll lock should be ${locked ? 'on' : 'off'}` }
    )
    .toEqual(
      locked
        ? expect.objectContaining({ state: 'true', overflow: 'hidden' })
        : expect.objectContaining({ state: 'false' })
    );
}

async function closeDialogOn(page) {
  page.once('dialog', (dialog) => dialog.accept());
}

test.describe('Desktop account popover', () => {
  test.skip(skipUnlessProject('desktop-chrome'), 'Desktop only');

  test('opens, aligns, and closes through all affordances', async ({ page }) => {
    await mockLoggedIn(page);
    await page.goto('/');

    const trigger = page.getByRole('button', { name: '계정 메뉴 열기' });
    await expect(trigger).toBeVisible();

    await trigger.click();
    const menu = page.locator('.account-menu');
    await expect(menu).toBeVisible();

    const triggerBox = await trigger.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();
    if (menuBox && triggerBox) {
      const gap = menuBox.y - (triggerBox.y + triggerBox.height);
      expect(gap).toBeLessThanOrEqual(8);
      const viewport = page.viewportSize();
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual((viewport?.width || 0) + 1);
    }

    await trigger.click();
    await expect(menu).toBeHidden();

    await trigger.click();
    await expect(menu).toBeVisible();
    await page.locator('body').click({ position: { x: 4, y: 4 } });
    await expect(menu).toBeHidden();

    await trigger.click();
    await expect(menu).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(menu).toBeVisible();
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('menuitem', { name: '마이페이지' }).click(),
    ]);
    await expect(page).toHaveURL(/mypage\.html/);

    const triggerAfterNav = page.getByRole('button', { name: '계정 메뉴 열기' });
    await expect(triggerAfterNav).toBeVisible();
    await triggerAfterNav.click();
    await expect(page.getByRole('menuitem', { name: '로그아웃' })).toBeVisible();
    closeDialogOn(page);
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('menuitem', { name: '로그아웃' }).click(),
    ]);
    await expect(page).toHaveURL(/index\.html/);
  });
});

test.describe('Mobile hamburger menu', () => {
  test.skip(skipUnlessProject('mobile-chrome'), 'Mobile only');

  test('locks scroll on open, restores focus/scroll on close, and keeps logout as list item', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ...devices['Pixel 5'],
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await mockLoggedIn(page);
    await page.goto('/');

    const toggler = page.locator('.navbar-toggler');
    await toggler.click();
    await waitForNavCollapse(page);
    await expectScrollLocked(page, true);

    const nav = page.locator('#navbarNav');
    await expect(nav.locator('.mobile-account-chip')).toBeVisible();

    const logoutButton = nav.getByRole('button', { name: '로그아웃' });
    const dividerBeforeLogout = await logoutButton.evaluate((el) => {
      const parentLi = el.closest('li');
      return !!parentLi?.previousElementSibling?.classList.contains('mobile-menu-divider');
    });
    expect(dividerBeforeLogout).toBe(true);

    await page.keyboard.press('Escape');
    await expectNavClosed(page);
    await expectScrollLocked(page, false);
    await expect(toggler).toBeFocused();

    await toggler.click();
    await waitForNavCollapse(page);
    await expectScrollLocked(page, true);
    await page.locator('body').click({ position: { x: 4, y: 4 } });
    await expectNavClosed(page);
    await expectScrollLocked(page, false);

    await toggler.click();
    await waitForNavCollapse(page);
    await expectScrollLocked(page, true);
    await Promise.all([
      page.waitForNavigation(),
      nav.getByRole('link', { name: '마이페이지' }).click(),
    ]);
    await expectNavClosed(page);
    await expectScrollLocked(page, false);

    await page.locator('.navbar-toggler').click();
    await waitForNavCollapse(page);
    await expectScrollLocked(page, true);

    closeDialogOn(page);
    await Promise.all([page.waitForNavigation(), logoutButton.click()]);
    await expect(page).toHaveURL(/index\.html/);
    await expectScrollLocked(page, false);

    await context.close();
  });
});
