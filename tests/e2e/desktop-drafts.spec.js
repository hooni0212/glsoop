const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const {
  E2E_SESSION_PASSWORD_HASH,
  loginWithSession,
} = require('./session-auth');

const USER_ID = 26801;
const USER_EMAIL = 'desktop-draft@glsoop.test';
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

test.describe('Desktop draft manager', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop local storage flow runs once.');
    await waitForFile(DB_PATH, 20000);
    const db = new sqlite3.Database(DB_PATH);
    await dbRun(db, 'PRAGMA foreign_keys = OFF');
    await dbRun(db, 'DELETE FROM user_drafts WHERE user_id = ?', [USER_ID]);
    await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id = ?', [USER_ID]);
    await dbRun(db, 'DELETE FROM auth_login_state WHERE user_id = ?', [USER_ID]);
    await dbRun(
      db,
      `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified, account_status)
       VALUES (?, ?, ?, ?, ?, 0, 1, 'active')`,
      [USER_ID, 'Desktop Draft User', 'desktop_draft_user', USER_EMAIL, E2E_SESSION_PASSWORD_HASH]
    );
    await dbRun(db, 'PRAGMA foreign_keys = ON');
    await new Promise((resolve) => db.close(resolve));
    await loginWithSession(page, USER_EMAIL, { ip: '198.51.100.201' });
    page.on('dialog', (dialog) => dialog.accept());
  });

  test.afterAll(async () => {
    if (!fs.existsSync(DB_PATH)) return;
    const db = new sqlite3.Database(DB_PATH);
    await dbRun(db, 'PRAGMA foreign_keys = OFF');
    await dbRun(db, 'DELETE FROM user_drafts WHERE user_id = ?', [USER_ID]);
    await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id = ?', [USER_ID]);
    await dbRun(db, 'DELETE FROM auth_login_state WHERE user_id = ?', [USER_ID]);
    await dbRun(db, 'DELETE FROM users WHERE id = ?', [USER_ID]);
    await dbRun(db, 'PRAGMA foreign_keys = ON');
    await new Promise((resolve) => db.close(resolve));
  });

  test('keeps multiple drafts across reconnection and lets the user delete one', async ({
    page,
    context,
  }) => {
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

    await page.close();
    const reconnectedPage = await context.newPage();
    reconnectedPage.on('dialog', (dialog) => dialog.accept());
    await reconnectedPage.goto('/drafts');
    await expect(reconnectedPage.locator('.draft-card')).toHaveCount(2);
    await expect(reconnectedPage.locator('#draftsList')).toContainText('첫 번째 임시글');
    await expect(reconnectedPage.locator('#draftsList')).toContainText('두 번째 임시글');

    const firstCard = reconnectedPage.locator('.draft-card').filter({ hasText: '첫 번째 임시글' });
    await firstCard.locator('[data-delete-draft]').click();
    await expect(reconnectedPage.locator('.draft-card')).toHaveCount(1);
    await expect(reconnectedPage.locator('#draftsList')).not.toContainText('첫 번째 임시글');
  });

  test('resumes a campaign draft with its content and prompt context', async ({ page }) => {
    const writePath = [
      '/write?draftId=campaign-draft',
      'campaignKey=glsoop-monthly-writing-project-prototype',
      'campaignPromptKey=day-01',
      'promptDay=1',
      `promptTitle=${encodeURIComponent('지금 창밖에는 무엇이 있나요?')}`,
      `promptBody=${encodeURIComponent('창밖의 장면에서 오늘의 글을 시작해보세요.')}`,
      'promptCategory=essay',
      `promptTags=${encodeURIComponent('창밖,오늘')}`,
      `promptSource=${encodeURIComponent('글숲 한달 글쓰기 프로젝트')}`,
    ].join('&');

    await page.goto(writePath);
    await page.locator('#postTitle').fill('프로젝트 임시글');
    await page.locator('.ql-editor').fill('프로젝트 글감으로 시작한 본문입니다.');
    await page.waitForFunction(() =>
      Boolean(localStorage.getItem('glsoop:editor:drafts:v2:user:26801:create:campaign-draft'))
    );

    await page.goto('/drafts');
    const card = page.locator('.draft-card').filter({ hasText: '프로젝트 임시글' });
    await expect(card).toContainText('글숲 한달 글쓰기 프로젝트 · 1일차');
    await card.getByRole('link', { name: '이어서 쓰기' }).click();

    await expect(page).toHaveURL(/\/write\?.*draftId=campaign-draft/);
    await expect(page).toHaveURL(/campaignPromptKey=day-01/);
    await page.getByRole('button', { name: '초안 복구' }).click();
    await expect(page.locator('#postTitle')).toHaveValue('프로젝트 임시글');
    await expect(page.locator('.ql-editor')).toContainText('프로젝트 글감으로 시작한 본문입니다.');
    await expect(page.locator('#editorWritingCampaign')).toContainText('지금 창밖에는 무엇이 있나요?');
  });

  test('migrates a legacy draft and removes expired drafts before clearing all', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'glsoop:editor:draft:v1:new',
        JSON.stringify({
          saved_at: new Date().toISOString(),
          state: {
            title: '예전 형식 임시글',
            content_html: '<p>마이그레이션할 본문입니다.</p>',
            category: 'essay',
            hashtags: [],
          },
        })
      );
      localStorage.setItem(
        'glsoop:editor:drafts:v2:user:26801:create:expired-draft',
        JSON.stringify({
          version: 2,
          draft_id: 'expired-draft',
          auth_namespace: 'user:26801',
          mode: 'create',
          saved_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
          expires_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          state: {
            title: '만료된 임시글',
            content_html: '<p>표시되면 안 됩니다.</p>',
            category: 'essay',
            hashtags: [],
          },
        })
      );
    });

    await page.goto('/drafts');
    await expect(page.locator('.draft-card')).toHaveCount(1);
    await expect(page.locator('#draftsList')).toContainText('예전 형식 임시글');
    await expect(page.locator('#draftsList')).not.toContainText('만료된 임시글');
    expect(
      await page.evaluate(() => localStorage.getItem('glsoop:editor:draft:v1:new'))
    ).toBeNull();

    await page.locator('#draftsClearAll').click();
    await expect(page.locator('.draft-card')).toHaveCount(0);
    await expect(page.locator('#draftsList')).toContainText('임시저장한 글이 없습니다.');
    await expect(page.locator('#draftsClearAll')).toBeDisabled();
  });
});
