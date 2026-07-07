const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.cwd();
const STAGING_ROOT = path.join(REPO_ROOT, 'tmp', 'e2e-ig-upload-staging');
const VALID_TOKEN = 'testtoken_abcdefghijklmnopqrstuvwxyz';
const EXPIRED_TOKEN = 'expiredtoken_abcdefghijklmnopqrstuvwxyz';
const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

function writePng(token, filename = '01.png') {
  const imageDir = path.join(STAGING_ROOT, token, 'images');
  fs.mkdirSync(imageDir, { recursive: true });
  const filePath = path.join(imageDir, filename);
  fs.writeFileSync(filePath, PNG_FIXTURE);
  return filePath;
}

test.describe('Instagram staging assets', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared staging filesystem setup: run once on desktop project'
    );
    fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
  });

  test('serves staged PNG without CDN caching', async ({ request }) => {
    writePng(VALID_TOKEN, '01.png');

    const response = await request.get(`/ig-upload-staging/${VALID_TOKEN}/images/01.png`);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['cdn-cache-control']).toBe('no-store');
    expect(response.headers()['cloudflare-cdn-cache-control']).toBe('no-store');
    expect(response.headers()['x-robots-tag']).toContain('noindex');
    expect(await response.body()).toEqual(PNG_FIXTURE);
  });

  test('rejects invalid tokens and filenames', async ({ request }) => {
    writePng(VALID_TOKEN, '01.png');

    const invalidToken = await request.get('/ig-upload-staging/short/images/01.png');
    expect(invalidToken.status()).toBe(404);
    expect(invalidToken.headers()['cache-control']).toContain('no-store');

    expect((await request.get(`/ig-upload-staging/${VALID_TOKEN}/images/11.png`)).status()).toBe(
      404
    );
    expect(
      (await request.get(`/ig-upload-staging/${VALID_TOKEN}/images/../01.png`)).status()
    ).toBe(404);
  });

  test('returns gone for expired staged files', async ({ request }) => {
    const filePath = writePng(EXPIRED_TOKEN, '01.png');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(filePath, twoHoursAgo, twoHoursAgo);

    const response = await request.get(`/ig-upload-staging/${EXPIRED_TOKEN}/images/01.png`);

    expect(response.status()).toBe(410);
    expect(response.headers()['cache-control']).toContain('no-store');
  });
});
