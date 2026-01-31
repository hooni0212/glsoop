const { defineConfig, devices } = require('@playwright/test');

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
      DB_PATH: 'tmp/e2e_playwright.sqlite',
      DB_AUTOINIT: 'false',
      JWT_SECRET: 'devsecret',
      JWT_ISSUER: 'glsoop',
      JWT_AUDIENCE: 'glsoop-client',
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
