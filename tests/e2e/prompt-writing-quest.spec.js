const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const E2E_JWT_SECRET = 'devsecret';
const E2E_JWT_ALGORITHM = 'HS256';
const E2E_JWT_ISSUER = 'glsoop';
const E2E_JWT_AUDIENCE = 'glsoop-client';
const AUTH_HEADER_NOW = '2026-03-01T00:00:00+09:00';

const ADMIN_ID = 9930;
const WRITER_ID = 9931;
const CAMPAIGN_ID = 99310;
const TEMPLATE_ID = 99311;
const PROMPT_KEY = 'past-lover-letter';

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

const dbGet = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
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

const signAuthToken = ({ id, name, nickname, email, isAdmin = false, isVerified = true }) =>
  jwt.sign(
    {
      id,
      name,
      nickname,
      email,
      isAdmin,
      isVerified,
    },
    E2E_JWT_SECRET,
    {
      algorithm: E2E_JWT_ALGORITHM,
      issuer: E2E_JWT_ISSUER,
      audience: E2E_JWT_AUDIENCE,
      expiresIn: '1h',
    }
  );

const buildAuthHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'x-auth-legacy-now': AUTH_HEADER_NOW,
});

const findPromptQuest = (campaigns = []) => {
  for (const campaign of campaigns) {
    for (const quest of campaign.quests || []) {
      if (quest.id === TEMPLATE_ID) return quest;
    }
  }
  return null;
};

async function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);
  return new sqlite3.Database(DB_PATH);
}

async function seedPromptWritingQuestFixtures() {
  const db = await openDb();
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  await dbRun(db, 'DELETE FROM quest_post_submissions WHERE user_id = ?', [WRITER_ID]);
  await dbRun(db, 'DELETE FROM posts WHERE user_id = ?', [WRITER_ID]);
  await dbRun(db, 'DELETE FROM user_quest_state WHERE user_id = ? OR campaign_id = ?', [
    WRITER_ID,
    CAMPAIGN_ID,
  ]);
  await dbRun(db, 'DELETE FROM quest_campaign_items WHERE campaign_id = ?', [CAMPAIGN_ID]);
  await dbRun(db, 'DELETE FROM quest_templates WHERE id = ?', [TEMPLATE_ID]);
  await dbRun(db, 'DELETE FROM quest_campaigns WHERE id = ?', [CAMPAIGN_ID]);

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, 1, 1)`,
    [ADMIN_ID, 'Prompt Admin', 'prompt_admin', 'prompt-admin@glsoop.test', 'password']
  );
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, 0, 1)`,
    [WRITER_ID, 'Prompt Writer', 'prompt_writer', 'prompt-writer@glsoop.test', 'password']
  );

  await dbRun(
    db,
    `INSERT INTO quest_campaigns (id, name, description, campaign_type, is_active, priority)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [CAMPAIGN_ID, 'Instagram Prompt Campaign', 'prompt quest fixture', 'permanent', 1, 120]
  );

  await dbRun(
    db,
    `INSERT INTO quest_templates
      (id, name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      TEMPLATE_ID,
      '지나간 연인에게 편지를 써봐요',
      '인스타그램 주제를 기반으로 글을 남기는 퀘스트',
      'PROMPT_POST_CREATED',
      'essay',
      1,
      25,
      1,
      'quest',
      'prompt_past_lover_letter',
      JSON.stringify({
        quest_kind: 'writing_prompt',
        prompt: {
          key: PROMPT_KEY,
          title: '지나간 연인에게 편지를 써봐요',
          body: '보내지 못한 말, 지금이라면 다르게 쓰고 싶은 문장을 글로 남겨보세요.',
          cta_label: '이 주제로 쓰기',
          default_category: 'essay',
          suggested_hashtags: ['편지', '이별', '글숲'],
        },
        source: 'instagram',
        source_url: 'https://www.instagram.com/glsoop',
      }),
    ]
  );

  await dbRun(
    db,
    `INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order)
     VALUES (?, ?, ?)`,
    [CAMPAIGN_ID, TEMPLATE_ID, 1]
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
}

test.describe('Prompt writing quest', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
    await seedPromptWritingQuestFixtures();
  });

  test('admin API validates prompt quest ui_json requirements', async ({ request }) => {
    const adminToken = signAuthToken({
      id: ADMIN_ID,
      name: 'Prompt Admin',
      nickname: 'prompt_admin',
      email: 'prompt-admin@glsoop.test',
      isAdmin: true,
    });

    const invalidRes = await request.post('/api/admin/quest-templates', {
      headers: buildAuthHeaders(adminToken),
      data: {
        name: 'Broken Prompt Quest',
        description: 'missing prompt key',
        condition_type: 'PROMPT_POST_CREATED',
        target_value: 1,
        reward_xp: 5,
        template_kind: 'quest',
        code: `broken_prompt_${Date.now()}`,
        ui_json: JSON.stringify({ quest_kind: 'writing_prompt', prompt: { title: '제목만' } }),
      },
    });
    expect(invalidRes.status()).toBe(400);
    const invalidPayload = await invalidRes.json();
    expect(invalidPayload.ok).toBe(false);
    expect(invalidPayload.message).toContain('prompt.key/title');

    const validRes = await request.post('/api/admin/quest-templates', {
      headers: buildAuthHeaders(adminToken),
      data: {
        name: 'Valid Prompt Quest',
        description: 'prompt template validation fixture',
        condition_type: 'PROMPT_POST_CREATED',
        target_value: 1,
        reward_xp: 5,
        template_kind: 'quest',
        code: `valid_prompt_${Date.now()}`,
        ui_json: JSON.stringify({
          quest_kind: 'writing_prompt',
          prompt: { key: `admin-${Date.now()}`, title: '관리자 생성 주제' },
        }),
      },
    });
    expect(validRes.status()).toBe(200);
    const validPayload = await validRes.json();
    expect(validPayload.ok).toBe(true);
    expect(Number(validPayload.template_id)).toBeGreaterThan(0);
  });

  test('admin template delete cleans prompt quest states and submissions', async ({ request }) => {
    const adminToken = signAuthToken({
      id: ADMIN_ID,
      name: 'Prompt Admin',
      nickname: 'prompt_admin',
      email: 'prompt-admin@glsoop.test',
      isAdmin: true,
    });
    const writerToken = signAuthToken({
      id: WRITER_ID,
      name: 'Prompt Writer',
      nickname: 'prompt_writer',
      email: 'prompt-writer@glsoop.test',
    });
    const writerHeaders = buildAuthHeaders(writerToken);

    const activeRes = await request.get('/api/quests/active', { headers: writerHeaders });
    expect(activeRes.status()).toBe(200);
    const activePayload = await activeRes.json();
    const quest = findPromptQuest(activePayload.campaigns);
    expect(quest).toBeTruthy();

    const createRes = await request.post('/api/posts', {
      headers: writerHeaders,
      data: {
        title: '삭제 전 완료 글',
        content: '삭제 경로 검증을 위해 먼저 퀘스트를 완료합니다.',
        category: 'essay',
        quest_context: {
          state_id: quest.state_id,
          prompt_key: PROMPT_KEY,
        },
      },
    });
    expect(createRes.status()).toBe(200);

    const deleteRes = await request.delete(`/api/admin/quest-templates/${TEMPLATE_ID}`, {
      headers: buildAuthHeaders(adminToken),
    });
    expect(deleteRes.status()).toBe(200);
    const deletePayload = await deleteRes.json();
    expect(deletePayload.ok).toBe(true);

    const db = await openDb();
    const counts = await dbGet(
      db,
      `SELECT
        (SELECT COUNT(*) FROM quest_templates WHERE id = ?) AS templates,
        (SELECT COUNT(*) FROM quest_campaign_items WHERE template_id = ?) AS campaign_items,
        (SELECT COUNT(*) FROM user_quest_state WHERE template_id = ?) AS states,
        (SELECT COUNT(*) FROM quest_post_submissions WHERE template_id = ?) AS submissions`,
      [TEMPLATE_ID, TEMPLATE_ID, TEMPLATE_ID, TEMPLATE_ID]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(counts.templates).toBe(0);
    expect(counts.campaign_items).toBe(0);
    expect(counts.states).toBe(0);
    expect(counts.submissions).toBe(0);
  });

  test('admin campaign delete cleans linked quest states', async ({ request }) => {
    const adminToken = signAuthToken({
      id: ADMIN_ID,
      name: 'Prompt Admin',
      nickname: 'prompt_admin',
      email: 'prompt-admin@glsoop.test',
      isAdmin: true,
    });
    const writerToken = signAuthToken({
      id: WRITER_ID,
      name: 'Prompt Writer',
      nickname: 'prompt_writer',
      email: 'prompt-writer@glsoop.test',
    });

    const activeRes = await request.get('/api/quests/active', {
      headers: buildAuthHeaders(writerToken),
    });
    expect(activeRes.status()).toBe(200);
    expect(findPromptQuest((await activeRes.json()).campaigns)).toBeTruthy();

    const deleteRes = await request.delete(`/api/admin/quest-campaigns/${CAMPAIGN_ID}`, {
      headers: buildAuthHeaders(adminToken),
    });
    expect(deleteRes.status()).toBe(200);
    const deletePayload = await deleteRes.json();
    expect(deletePayload.ok).toBe(true);

    const db = await openDb();
    const counts = await dbGet(
      db,
      `SELECT
        (SELECT COUNT(*) FROM quest_campaigns WHERE id = ?) AS campaigns,
        (SELECT COUNT(*) FROM quest_campaign_items WHERE campaign_id = ?) AS campaign_items,
        (SELECT COUNT(*) FROM user_quest_state WHERE campaign_id = ?) AS states,
        (SELECT COUNT(*) FROM quest_templates WHERE id = ?) AS templates`,
      [CAMPAIGN_ID, CAMPAIGN_ID, CAMPAIGN_ID, TEMPLATE_ID]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(counts.campaigns).toBe(0);
    expect(counts.campaign_items).toBe(0);
    expect(counts.states).toBe(0);
    expect(counts.templates).toBe(1);
  });

  test('posting with quest_context completes the matching prompt quest', async ({ request }) => {
    const writerToken = signAuthToken({
      id: WRITER_ID,
      name: 'Prompt Writer',
      nickname: 'prompt_writer',
      email: 'prompt-writer@glsoop.test',
    });
    const headers = buildAuthHeaders(writerToken);

    const activeBeforeRes = await request.get('/api/quests/active', { headers });
    expect(activeBeforeRes.status()).toBe(200);
    const activeBeforePayload = await activeBeforeRes.json();
    const questBefore = findPromptQuest(activeBeforePayload.campaigns);
    expect(questBefore).toBeTruthy();
    expect(questBefore.condition_type).toBe('PROMPT_POST_CREATED');
    expect(questBefore.progress).toBe(0);
    expect(Number(questBefore.state_id)).toBeGreaterThan(0);

    const createRes = await request.post('/api/posts', {
      headers,
      data: {
        title: '보내지 못한 편지',
        content: '그때는 말하지 못했던 마음을 이제는 담담히 적어봅니다.',
        category: 'essay',
        hashtags: ['편지', '이별'],
        quest_context: {
          state_id: questBefore.state_id,
          prompt_key: PROMPT_KEY,
        },
      },
    });
    expect(createRes.status()).toBe(200);
    const createPayload = await createRes.json();
    expect(createPayload.ok).toBe(true);
    expect(createPayload.quest_completion).toMatchObject({
      state_id: questBefore.state_id,
      template_id: TEMPLATE_ID,
      campaign_id: CAMPAIGN_ID,
      prompt_key: PROMPT_KEY,
      progress: 1,
      target: 1,
      status: 'completed',
    });

    const db = await openDb();
    const submission = await dbGet(
      db,
      `SELECT post_id, state_id, prompt_key
       FROM quest_post_submissions
       WHERE user_id = ? AND state_id = ?`,
      [WRITER_ID, questBefore.state_id]
    );
    await new Promise((resolve) => db.close(resolve));
    expect(Number(submission.post_id)).toBe(Number(createPayload.post_id));
    expect(submission.prompt_key).toBe(PROMPT_KEY);

    const activeAfterRes = await request.get('/api/quests/active', { headers });
    expect(activeAfterRes.status()).toBe(200);
    const activeAfterPayload = await activeAfterRes.json();
    const questAfter = findPromptQuest(activeAfterPayload.campaigns);
    expect(questAfter.progress).toBe(1);
    expect(questAfter.status).toBe('completed');
    expect(questAfter.completed_at).toBeTruthy();
  });

  test('prompt key mismatch rejects the post and rolls back the insert', async ({ request }) => {
    const writerToken = signAuthToken({
      id: WRITER_ID,
      name: 'Prompt Writer',
      nickname: 'prompt_writer',
      email: 'prompt-writer@glsoop.test',
    });
    const headers = buildAuthHeaders(writerToken);

    const activeRes = await request.get('/api/quests/active', { headers });
    expect(activeRes.status()).toBe(200);
    const activePayload = await activeRes.json();
    const quest = findPromptQuest(activePayload.campaigns);
    expect(quest).toBeTruthy();

    const createRes = await request.post('/api/posts', {
      headers,
      data: {
        title: '잘못된 주제 문맥',
        content: '이 글은 퀘스트 문맥이 맞지 않아 저장되지 않아야 합니다.',
        category: 'essay',
        quest_context: {
          state_id: quest.state_id,
          prompt_key: 'other-prompt',
        },
      },
    });
    expect(createRes.status()).toBe(400);
    const createPayload = await createRes.json();
    expect(createPayload).toMatchObject({
      ok: false,
      code: 'PROMPT_KEY_MISMATCH',
    });

    const db = await openDb();
    const postRow = await dbGet(
      db,
      'SELECT id FROM posts WHERE user_id = ? AND title = ? LIMIT 1',
      [WRITER_ID, '잘못된 주제 문맥']
    );
    const submissionRow = await dbGet(
      db,
      'SELECT id FROM quest_post_submissions WHERE user_id = ? AND state_id = ? LIMIT 1',
      [WRITER_ID, quest.state_id]
    );
    await new Promise((resolve) => db.close(resolve));
    expect(postRow).toBeFalsy();
    expect(submissionRow).toBeFalsy();
  });
});
