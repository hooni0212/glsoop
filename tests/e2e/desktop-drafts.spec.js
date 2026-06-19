const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const USER_ID = 26801;
const REPO_ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(REPO_ROOT, process.env.DB_PATH)
  : path.join(REPO_ROOT, 'tmp', 'e2e_playwright.sqlite');

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve(this);
    });
  });

function buildAuthHeaders() {
  const token = jwt.sign(
    {
      id: USER_ID,
      name: 'Desktop Draft User',
      nickname: 'desktop_draft_user',
      email: 'desktop-draft@glsoop.test',
      isVerified: true,
    },
    process.env.JWT_SECRET || 'devsecret',
    {
      algorithm: process.env.JWT_ALGORITHM || 'HS256',
      issuer: process.env.JWT_ISSUER || 'glsoop',
      audience: process.env.JWT_AUDIENCE || 'glsoop-client',
      expiresIn: '1h',
    }
  );
  return {
    Authorization: `Bearer ${token}`,
    'x-auth-legacy-now': '2026-03-01T00:00:00+09:00',
  };
}

test.describe('Desktop draft manager', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop local storage flow runs once.');
    await waitForFile(DB_PATH, 20000);
    const db = new sqlite3.Database(DB_PATH);
    await dbRun(db, 'PRAGMA foreign_keys = OFF');
    await dbRun(
      db,
      `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified, account_status)
       VALUES (?, ?, ?, ?, ?, 0, 1, 'active')`,
      [USER_ID, 'Desktop Draft User', 'desktop_draft_user', 'desktop-draft@glsoop.test', 'password']
    );
    await dbRun(db, 'PRAGMA foreign_keys = ON');
    await new Promise((resolve) => db.close(resolve));
    await page.setExtraHTTPHeaders(buildAuthHeaders());
    page.on('dialog', (dialog) => dialog.accept());
  });

  test('keeps multiple drafts and lets the user delete one', async ({ page }) => {
    await page.goto('/write?draftId=first-draft');
    await page.locator('#postTitle').fill('첫 번째 임시글');
    await page.locator('#categorySelect').selectOption('essay');
    await page.locator('.ql-editor').fill('첫 번째 글의 본문입니다.');
    await page.waitForFunction(() =>
      Object.keys(localStorage).some((key) => key.endsWith(':create:first-draft'))
    );

    await page.goto('/write?draftId=second-draft');
    await page.locator('#postTitle').fill('두 번째 임시글');
    await page.locator('#categorySelect').selectOption('short');
    await page.locator('.ql-editor').fill('두 번째 글의 본문입니다.');
    await page.waitForFunction(() =>
      Object.keys(localStorage).filter((key) => key.includes('glsoop:editor:drafts:v2:user:26801:create:')).length === 2
    );

    await page.goto('/drafts');
    await expect(page.locator('.draft-card')).toHaveCount(2);
    await expect(page.locator('#draftsList')).toContainText('첫 번째 임시글');
    await expect(page.locator('#draftsList')).toContainText('두 번째 임시글');

    const firstCard = page.locator('.draft-card').filter({ hasText: '첫 번째 임시글' });
    await firstCard.locator('[data-delete-draft]').click();
    await expect(page.locator('.draft-card')).toHaveCount(1);
    await expect(page.locator('#draftsList')).not.toContainText('첫 번째 임시글');
  });
});
