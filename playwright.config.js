const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const buildRunId = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

process.env.GLSOOP_SNAPSHOT_RUN_ID = process.env.GLSOOP_SNAPSHOT_RUN_ID || buildRunId();

const e2eDbRelativePath =
  process.env.DB_PATH ||
  path.posix.join('tmp', `e2e_playwright_${process.env.GLSOOP_SNAPSHOT_RUN_ID}.sqlite`);

process.env.DB_PATH = e2eDbRelativePath;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60 * 1000,
  expect: {
    timeout: 12 * 1000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/ensure-e2e-dirs.mjs && node server.js',
    port: 3100,
    reuseExistingServer: false,
    timeout: 120 * 1000,
    env: {
      PORT: '3100',
      NODE_ENV: 'development',
      DB_PATH: e2eDbRelativePath,
      DB_AUTOINIT: 'false',
      JWT_SECRET: 'devsecret',
      JWT_ISSUER: 'glsoop',
      JWT_AUDIENCE: 'glsoop-client',
      RESET_TOKEN_HMAC_SECRET: 'devsecret',
      AUTH_SIGNUP_EMAIL_DRY_RUN: 'true',
      PHOTO_SAVE_ADS_ENABLED: 'true',
      PHOTO_SAVE_FREE_DAILY_LIMIT: '1',
      PHOTO_SAVE_REWARDED_GRANT_TTL_MINUTES: '30',
      PHOTO_SAVE_ADMOB_ANDROID_REWARDED_UNIT_ID: 'ca-app-pub-test/android-rewarded',
      PHOTO_SAVE_ADMOB_IOS_REWARDED_UNIT_ID: 'ca-app-pub-test/ios-rewarded',
    },
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
