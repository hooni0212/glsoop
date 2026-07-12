const { test, expect } = require('@playwright/test');

const APP_STORE_URL = 'https://apps.apple.com/kr/app/id6761228925';
const CAMPAIGN_QUERY =
  'utm_source=instagram&utm_medium=paid_social&utm_campaign=glsoop_start_202607&utm_content=quiet_sentence';

test.describe('Instagram /start landing', () => {
  test('renders the focused landing structure without horizontal overflow', async ({ page }) => {
    await page.route('**/api/ux-events', (route) =>
      route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );

    const response = await page.goto(`/start?${CAMPAIGN_QUERY}`);
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/글숲 시작하기/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('오늘 마음에 남은 한 문장을');
    await expect(page.getByRole('heading', { name: '문장이 흘러가지 않도록' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /반응을 경쟁하는 공간보다/ })).toBeVisible();
    await expect(page.getByText('무료로 시작할 수 있어요', { exact: true })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('uses device-specific CTA destinations and records UTM-attributed clicks', async ({ page }, testInfo) => {
    const events = [];
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'sendBeacon', {
        configurable: true,
        value: undefined,
      });
    });
    await page.route('**/api/ux-events', async (route) => {
      const payload = route.request().postDataJSON();
      if (payload) events.push(payload);
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto(`/start?${CAMPAIGN_QUERY}`);
    const primary = page.locator('#startPrimaryCta');
    const href = await primary.getAttribute('href');
    const isIos = testInfo.project.name === 'mobile-webkit';

    if (isIos) {
      expect(href).toBe(APP_STORE_URL);
      await expect(primary).toContainText('App Store에서 글숲 시작하기');
    } else {
      expect(href).toContain('/html/signup.html');
      expect(href).toContain('utm_campaign=glsoop_start_202607');
      await expect(primary).toContainText('웹에서 글숲 시작하기');
    }

    const homeHref = await page.getByRole('link', { name: '글숲 홈으로 이동' }).getAttribute('href');
    expect(homeHref).toContain('utm_campaign=glsoop_start_202607');

    await primary.evaluate((element) => {
      element.addEventListener('click', (event) => event.preventDefault(), { once: true });
    });
    await primary.click();

    const expectedClickEvent = isIos ? 'landing_app_store_click' : 'landing_web_signup_click';
    await expect.poll(() => events.map((event) => event.event_name)).toContain('landing_view');
    await expect.poll(() => events.map((event) => event.event_name)).toContain(expectedClickEvent);

    const clickEvent = events.find((event) => event.event_name === expectedClickEvent);
    expect(clickEvent.properties).toMatchObject({
      utm_source: 'instagram',
      utm_medium: 'paid_social',
      utm_campaign: 'glsoop_start_202607',
      utm_content: 'quiet_sentence',
      landing_path: '/start',
      landing_variant: 'start_v1',
    });
  });

  test('keeps campaign attribution for the web signup funnel', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Attribution persistence needs one browser');

    const events = [];
    await page.route('**/api/ux-events', async (route) => {
      events.push(route.request().postDataJSON());
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto(`/start?${CAMPAIGN_QUERY}`);
    await page.locator('#startPrimaryCta').click();
    await expect(page).toHaveURL(/\/html\/signup\.html/);
    await expect(page.getByRole('heading', { name: '회원가입' })).toBeVisible();

    await expect
      .poll(() =>
        events.some(
          (event) =>
            (event.event_name === 'page_view' || event.event_name === 'signup_view') &&
            event.page_path.startsWith('/html/signup.html') &&
            event.properties.utm_campaign === 'glsoop_start_202607'
        )
      )
      .toBe(true);
  });

  test('shows the App Store QR on desktop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop-only QR path');
    await page.route('**/api/ux-events', (route) =>
      route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );

    await page.goto('/start');
    const qr = page.getByRole('img', { name: 'App Store 글숲 페이지 QR 코드' });
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute('src', '/img/app-store-glsoop-qr.svg');
  });
});
