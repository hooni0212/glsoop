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

const ADMIN_ID = 9921;
const PLAYER_ID = 9922;

const CAMPAIGN_ID = 99210;
const TEMPLATE_LOCKED_ID = 99211;
const TEMPLATE_REWARD_ID = 99212;
const STATE_LOCKED_ID = 99213;
const STATE_REWARD_ID = 99214;

const REQUIRED_ENTITLEMENT = 'pass:2026_spring';
const REWARD_COSMETIC_KEY = 'sticker_star';

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

const seedGrowthMonetizationFixtures = async () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');

  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [ADMIN_ID, 'Admin Entitlement', 'admin_entitlement', 'admin-entitlement@glsoop.test', 'password', 1, 1]
  );
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [PLAYER_ID, 'Quest Player', 'quest_player', 'quest-player@glsoop.test', 'password', 0, 1]
  );

  await dbRun(db, 'DELETE FROM user_entitlements WHERE user_id = ?', [PLAYER_ID]);
  await dbRun(
    db,
    `DELETE FROM user_cosmetics
     WHERE user_id = ?
       AND cosmetic_id IN (
         SELECT id FROM cosmetic_items WHERE key = ?
       )`,
    [PLAYER_ID, REWARD_COSMETIC_KEY]
  );

  await dbRun(
    db,
    'DELETE FROM user_quest_state WHERE id IN (?, ?) OR (user_id = ? AND campaign_id = ?)',
    [STATE_LOCKED_ID, STATE_REWARD_ID, PLAYER_ID, CAMPAIGN_ID]
  );
  await dbRun(db, 'DELETE FROM quest_campaign_items WHERE campaign_id = ?', [CAMPAIGN_ID]);
  await dbRun(
    db,
    'DELETE FROM quest_templates WHERE id IN (?, ?)',
    [TEMPLATE_LOCKED_ID, TEMPLATE_REWARD_ID]
  );
  await dbRun(db, 'DELETE FROM quest_campaigns WHERE id = ?', [CAMPAIGN_ID]);

  await dbRun(
    db,
    `INSERT INTO quest_campaigns (id, name, description, campaign_type, is_active, priority)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [CAMPAIGN_ID, 'Premium Campaign Fixture', 'entitlement lock test', 'permanent', 1, 100]
  );

  const uiJson = JSON.stringify({
    required_entitlement: REQUIRED_ENTITLEMENT,
    rewards: { cosmetics: [REWARD_COSMETIC_KEY] },
  });

  await dbRun(
    db,
    `INSERT INTO quest_templates
      (id, name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      TEMPLATE_LOCKED_ID,
      'Premium Locked Quest',
      'requires entitlement',
      'POST_COUNT_TOTAL',
      null,
      1,
      15,
      1,
      'quest',
      'premium_locked_fixture',
      uiJson,
    ]
  );

  await dbRun(
    db,
    `INSERT INTO quest_templates
      (id, name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      TEMPLATE_REWARD_ID,
      'Premium Reward Quest',
      'grants cosmetics',
      'POST_COUNT_TOTAL',
      null,
      1,
      20,
      1,
      'quest',
      'premium_reward_fixture',
      uiJson,
    ]
  );

  await dbRun(
    db,
    `INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order)
     VALUES (?, ?, ?), (?, ?, ?)`,
    [CAMPAIGN_ID, TEMPLATE_LOCKED_ID, 1, CAMPAIGN_ID, TEMPLATE_REWARD_ID, 2]
  );

  const nowIso = new Date().toISOString();
  await dbRun(
    db,
    `INSERT INTO user_quest_state
      (id, user_id, campaign_id, template_id, progress, reset_key, completed_at, reward_claimed_at)
     VALUES (?, ?, ?, ?, ?, 'permanent', ?, NULL)`,
    [STATE_LOCKED_ID, PLAYER_ID, CAMPAIGN_ID, TEMPLATE_LOCKED_ID, 1, nowIso]
  );
  await dbRun(
    db,
    `INSERT INTO user_quest_state
      (id, user_id, campaign_id, template_id, progress, reset_key, completed_at, reward_claimed_at)
     VALUES (?, ?, ?, ?, ?, 'permanent', ?, NULL)`,
    [STATE_REWARD_ID, PLAYER_ID, CAMPAIGN_ID, TEMPLATE_REWARD_ID, 1, nowIso]
  );

  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
};

test.describe('Monetization + Growth entitlement lock', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedGrowthMonetizationFixtures();
  });

  test('growth dashboard exposes lock fields when entitlement is missing', async ({
    request,
  }) => {
    const playerToken = signAuthToken({
      id: PLAYER_ID,
      name: 'Quest Player',
      nickname: 'quest_player',
      email: 'quest-player@glsoop.test',
    });

    const response = await request.get('/api/growth/dashboard', {
      headers: buildAuthHeaders(playerToken),
    });
    expect(response.status()).toBe(200);

    const payload = await response.json();
    expect(payload.ok).toBe(true);

    const allQuests = (payload.campaigns || []).flatMap((campaign) => campaign.quests || []);
    const premiumQuest = allQuests.find((quest) => quest.id === TEMPLATE_LOCKED_ID);
    expect(premiumQuest).toBeTruthy();
    expect(premiumQuest).toMatchObject({
      is_locked: true,
      required_entitlement: REQUIRED_ENTITLEMENT,
      lock_reason: 'SEASON_PASS_REQUIRED',
    });
  });

  test('claim blocks locked premium quest without entitlement', async ({ request }) => {
    const playerToken = signAuthToken({
      id: PLAYER_ID,
      name: 'Quest Player',
      nickname: 'quest_player',
      email: 'quest-player@glsoop.test',
    });

    const response = await request.post(`/api/quests/${STATE_LOCKED_ID}/claim`, {
      headers: buildAuthHeaders(playerToken),
    });
    expect(response.status()).toBe(403);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      code: 'ENTITLEMENT_REQUIRED',
    });

    const db = new sqlite3.Database(DB_PATH);
    const state = await dbGet(
      db,
      'SELECT reward_claimed_at FROM user_quest_state WHERE id = ? LIMIT 1',
      [STATE_LOCKED_ID]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(state.reward_claimed_at).toBeNull();
  });

  test('admin can grant entitlement to user', async ({ request }) => {
    const adminToken = signAuthToken({
      id: ADMIN_ID,
      name: 'Admin Entitlement',
      nickname: 'admin_entitlement',
      email: 'admin-entitlement@glsoop.test',
      isAdmin: true,
    });

    const response = await request.post('/api/admin/entitlements/grant', {
      headers: buildAuthHeaders(adminToken),
      data: {
        user_id: PLAYER_ID,
        entitlement_key: REQUIRED_ENTITLEMENT,
        source: 'admin',
      },
    });
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.entitlement).toMatchObject({
      user_id: PLAYER_ID,
      entitlement_key: REQUIRED_ENTITLEMENT,
      status: 'active',
      source: 'admin',
    });
  });

  test('claim grants cosmetics when entitlement is active', async ({ request }) => {
    const playerToken = signAuthToken({
      id: PLAYER_ID,
      name: 'Quest Player',
      nickname: 'quest_player',
      email: 'quest-player@glsoop.test',
    });

    const response = await request.post(`/api/quests/${STATE_REWARD_ID}/claim`, {
      headers: buildAuthHeaders(playerToken),
    });
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.gained_cosmetics).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: REWARD_COSMETIC_KEY })])
    );

    const db = new sqlite3.Database(DB_PATH);
    const ownedReward = await dbGet(
      db,
      `SELECT COUNT(*) AS cnt
       FROM user_cosmetics uc
       JOIN cosmetic_items ci ON ci.id = uc.cosmetic_id
       WHERE uc.user_id = ? AND ci.key = ?`,
      [PLAYER_ID, REWARD_COSMETIC_KEY]
    );
    const state = await dbGet(
      db,
      'SELECT reward_claimed_at FROM user_quest_state WHERE id = ? LIMIT 1',
      [STATE_REWARD_ID]
    );
    await new Promise((resolve) => db.close(resolve));

    expect(ownedReward.cnt).toBe(1);
    expect(state.reward_claimed_at).toBeTruthy();
  });
});
