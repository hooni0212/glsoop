const { test, expect } = require('@playwright/test');
const { mockAuthorPageApis } = require('./author-test-utils');

test.describe('Author overflow menu actions', () => {
  test('opens/closes with keyboard and wires share/sort actions', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => true,
      });
    });

    const { uxEvents } = await mockAuthorPageApis(page);

    await page.goto('/html/author.html?userId=1');

    const trigger = page.locator('#authorOverflowBtn');
    const menu = page.locator('#authorOverflowMenu');

    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.authorOverflowOpen || 'false'))
      .toBe('true');

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.authorOverflowOpen || 'false'))
      .toBe('false');

    await trigger.click();
    await expect(menu).toBeVisible();
    await page.locator('body').click({ position: { x: 4, y: 4 } });
    await expect(menu).toBeHidden();

    await trigger.click();
    await page.locator('#authorShareBtn').click();
    await expect(menu).toBeHidden();
    await expect(page.locator('#authorToast')).toContainText('공유');

    await trigger.click();
    await page.locator('#authorSortBtn').click();

    const sortModal = page.locator('#authorSortModal');
    await expect(sortModal).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.getElementById('authorSortModal')?.getAttribute('aria-hidden')))
      .toBe('false');

    await page.locator('#authorSortModal [data-gls-dismiss="modal"]').first().click();
    await expect
      .poll(() => page.evaluate(() => document.getElementById('authorSortModal')?.getAttribute('aria-hidden')))
      .toBe('true');
    await expect(trigger).toBeFocused();

    const overflowEvents = uxEvents.filter((eventName) => eventName === 'author_overflow_click');
    expect(overflowEvents.length).toBeGreaterThanOrEqual(2);
  });
});
