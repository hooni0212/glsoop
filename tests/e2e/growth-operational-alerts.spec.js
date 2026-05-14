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

const ADMIN_ID = 9951;
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

const bumpSqliteSequence = async (db, tableName, minSeq) => {
  await dbRun(db, 'INSERT OR IGNORE INTO sqlite_sequence (name, seq) VALUES (?, ?)', [
    tableName,
    minSeq,
  ]);
  await dbRun(
    db,
    `UPDATE sqlite_sequence
     SET seq = CASE WHEN seq < ? THEN ? ELSE seq END
     WHERE name = ?`,
    [minSeq, minSeq, tableName]
  );
};

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const signAdminToken = () =>
  jwt.sign(
    {
      id: ADMIN_ID,
      name: 'Growth Ops Admin',
      nickname: 'growth_ops_admin',
      email: 'growth-ops-admin@glsoop.test',
      isAdmin: true,
      isVerified: true,
    },
    E2E_JWT_SECRET,
    {
      algorithm: E2E_JWT_ALGORITHM,
      issuer: E2E_JWT_ISSUER,
      audience: E2E_JWT_AUDIENCE,
      expiresIn: '1h',
    }
  );

const buildAuthHeaders = () => ({
  Authorization: `Bearer ${signAdminToken()}`,
  'x-auth-legacy-now': AUTH_HEADER_NOW,
});

async function seedAdmin() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);
  const db = new sqlite3.Database(DB_PATH);
  await dbRun(db, 'PRAGMA foreign_keys = OFF');
  await dbRun(
    db,
    `INSERT OR REPLACE INTO users (id, name, nickname, email, pw, is_admin, is_verified)
     VALUES (?, ?, ?, ?, ?, 1, 1)`,
    [ADMIN_ID, 'Growth Ops Admin', 'growth_ops_admin', 'growth-ops-admin@glsoop.test', 'password']
  );
  await bumpSqliteSequence(db, 'quest_templates', 200000);
  await bumpSqliteSequence(db, 'quest_campaigns', 200000);
  await dbRun(db, 'PRAGMA foreign_keys = ON');
  await new Promise((resolve) => db.close(resolve));
}

test.describe('Growth operational alerts', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Shared DB setup: run once on desktop project'
    );
  });

  test.beforeAll(async () => {
    await seedAdmin();
  });

  test('campaign create returns id and item save is visible in health check', async ({ request }) => {
    const templateRes = await request.post('/api/admin/quest-templates', {
      headers: buildAuthHeaders(),
      data: {
        name: 'Ops Linked Quest',
        description: 'campaign item save fixture',
        condition_type: 'POST_COUNT_TOTAL',
        target_value: 1,
        reward_xp: 5,
        template_kind: 'quest',
        code: `ops_linked_${Date.now()}`,
        is_active: 1,
      },
    });
    expect(templateRes.status()).toBe(200);
    const templatePayload = await templateRes.json();
    expect(templatePayload.ok).toBe(true);

    const campaignRes = await request.post('/api/admin/quest-campaigns', {
      headers: buildAuthHeaders(),
      data: {
        name: `Ops Linked Campaign ${Date.now()}`,
        description: 'new campaign should return id',
        campaign_type: 'event',
        is_active: 1,
        priority: 50,
      },
    });
    expect(campaignRes.status()).toBe(200);
    const campaignPayload = await campaignRes.json();
    expect(campaignPayload.ok).toBe(true);
    expect(Number(campaignPayload.campaign_id)).toBeGreaterThan(0);

    const itemRes = await request.put(
      `/api/admin/quest-campaigns/${campaignPayload.campaign_id}/items`,
      {
        headers: buildAuthHeaders(),
        data: {
          items: [{ template_id: templatePayload.template_id, sort_order: 1 }],
        },
      }
    );
    expect(itemRes.status()).toBe(200);
    const itemPayload = await itemRes.json();
    expect(itemPayload.ok).toBe(true);

    const healthRes = await request.get('/api/admin/growth/operations/health', {
      headers: buildAuthHeaders(),
    });
    expect(healthRes.status()).toBe(200);
    const healthPayload = await healthRes.json();
    const emptyCampaignCheck = healthPayload.health.checks.find(
      (check) => check.code === 'GROWTH_ACTIVE_CAMPAIGN_EMPTY'
    );
    expect(emptyCampaignCheck.items.some((item) => item.id === campaignPayload.campaign_id)).toBe(false);
  });

  test('health sync creates resolvable operational alert and admin notification', async ({
    request,
  }) => {
    const campaignRes = await request.post('/api/admin/quest-campaigns', {
      headers: buildAuthHeaders(),
      data: {
        name: `Ops Empty Campaign ${Date.now()}`,
        description: 'empty active campaign alert fixture',
        campaign_type: 'event',
        is_active: 1,
        priority: 51,
      },
    });
    expect(campaignRes.status()).toBe(200);

    const syncRes = await request.post('/api/admin/growth/operations/alerts/sync', {
      headers: buildAuthHeaders(),
    });
    expect(syncRes.status()).toBe(200);
    const syncPayload = await syncRes.json();
    expect(syncPayload.ok).toBe(true);

    const alert = syncPayload.alerts.find(
      (item) => item.code === 'GROWTH_ACTIVE_CAMPAIGN_EMPTY'
    );
    expect(alert).toBeTruthy();
    expect(alert.status).toBe('open');
    expect(alert.level).toBe('warn');

    const notificationsRes = await request.get('/api/notifications', {
      headers: buildAuthHeaders(),
    });
    expect(notificationsRes.status()).toBe(200);
    const notificationsPayload = await notificationsRes.json();
    expect(
      notificationsPayload.notifications.some((item) => item.type === 'admin_operational_alert')
    ).toBe(true);

    const resolveRes = await request.post(`/api/admin/operational-alerts/${alert.id}/resolve`, {
      headers: buildAuthHeaders(),
    });
    expect(resolveRes.status()).toBe(200);
    const resolvePayload = await resolveRes.json();
    expect(resolvePayload.alert).toMatchObject({
      id: alert.id,
      status: 'resolved',
    });
  });
});
