const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const {
  buildCampaignKey,
  getKstDateParts,
  isWithinReminderWindow,
  queueConditionalEveningMarketingPush,
} = require('../../services/marketingPushReminder');

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
      resolve(row || null);
    });
  });

const dbAll = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });

const waitForFile = async (filePath, timeoutMs = 10000) => {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

async function withDb(callback) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  await waitForFile(DB_PATH, 20000);

  const db = new sqlite3.Database(DB_PATH);
  try {
    return await callback(db);
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
}

function buildUsers(base) {
  return {
    eligible: base + 1,
    optOut: base + 2,
    inactive: base + 3,
    todayWriter: base + 4,
    oldSession: base + 5,
    noPriorPost: base + 6,
    disabledToken: base + 7,
  };
}

async function seedReminderFixtures(users) {
  const userIds = Object.values(users);
  const placeholders = userIds.map(() => '?').join(', ');

  await withDb(async (db) => {
    await dbRun(db, 'PRAGMA foreign_keys = OFF');
    await dbRun(
      db,
      `DELETE FROM push_delivery_queue
       WHERE recipient_user_id IN (${placeholders})
          OR activity_event_id IN (
            SELECT id FROM activity_events
            WHERE recipient_user_id IN (${placeholders})
          )`,
      [...userIds, ...userIds]
    );
    await dbRun(
      db,
      `DELETE FROM activity_events WHERE recipient_user_id IN (${placeholders})`,
      userIds
    );
    await dbRun(
      db,
      `DELETE FROM marketing_push_campaigns
       WHERE campaign_key LIKE ? OR campaign_key LIKE ?`,
      ['evening_writing_reminder:%', 'e2e-evening-reminder:%']
    );
    await dbRun(db, `DELETE FROM push_tokens WHERE token LIKE 'ExponentPushToken[e2e-reminder-%]'`);
    await dbRun(db, `DELETE FROM push_tokens WHERE user_id IN (${placeholders})`, userIds);
    await dbRun(db, `DELETE FROM auth_sessions WHERE user_id IN (${placeholders})`, userIds);
    await dbRun(db, `DELETE FROM posts WHERE user_id IN (${placeholders})`, userIds);
    await dbRun(db, `DELETE FROM users WHERE id IN (${placeholders})`, userIds);

    for (const [key, userId] of Object.entries(users)) {
      await dbRun(
        db,
        `
        INSERT INTO users (
          id,
          name,
          nickname,
          email,
          pw,
          is_verified,
          account_status,
          marketing_push_opt_in,
          marketing_push_opt_in_updated_at
        )
        VALUES (?, ?, ?, ?, 'hashed-password', 1, ?, ?, ?)
        `,
        [
          userId,
          `Reminder ${key}`,
          `reminder_${key}`,
          `reminder-${userId}@glsoop.test`,
          key === 'inactive' ? 'deactivated' : 'active',
          key === 'optOut' ? 0 : 1,
          '2026-05-14 00:00:00',
        ]
      );
    }

    for (const userId of [users.eligible, users.optOut, users.inactive, users.todayWriter, users.oldSession, users.disabledToken]) {
      await dbRun(
        db,
        `
        INSERT INTO posts (user_id, title, content, category, created_at)
        VALUES (?, '어제의 글', '조건부 리마인더 테스트', 'short', '2026-05-14 08:00:00')
        `,
        [userId]
      );
    }
    await dbRun(
      db,
      `
      INSERT INTO posts (user_id, title, content, category, created_at)
      VALUES (?, '오늘의 글', '오늘은 이미 작성함', 'short', '2026-05-15 05:00:00')
      `,
      [users.todayWriter]
    );

    for (const [key, userId] of Object.entries(users)) {
      await dbRun(
        db,
        `
        INSERT INTO auth_sessions (
          sid,
          user_id,
          remember_me,
          created_at,
          last_seen_at,
          expires_at
        )
        VALUES (?, ?, 1, '2026-05-01 00:00:00', ?, '2026-06-01 00:00:00')
        `,
        [
          `reminder-session-${userId}`,
          userId,
          key === 'oldSession' ? '2026-04-01 00:00:00' : '2026-05-15 09:00:00',
        ]
      );
    }

    const tokenRows = [
      [users.eligible, `ExponentPushToken[e2e-reminder-${users.eligible}-a]`, 1],
      [users.eligible, `ExponentPushToken[e2e-reminder-${users.eligible}-b]`, 1],
      [users.optOut, `ExponentPushToken[e2e-reminder-${users.optOut}]`, 1],
      [users.inactive, `ExponentPushToken[e2e-reminder-${users.inactive}]`, 1],
      [users.todayWriter, `ExponentPushToken[e2e-reminder-${users.todayWriter}]`, 1],
      [users.oldSession, `ExponentPushToken[e2e-reminder-${users.oldSession}]`, 1],
      [users.noPriorPost, `ExponentPushToken[e2e-reminder-${users.noPriorPost}]`, 1],
      [users.disabledToken, `ExponentPushToken[e2e-reminder-${users.disabledToken}]`, 0],
    ];

    for (const [userId, token, enabled] of tokenRows) {
      await dbRun(
        db,
        `
        INSERT INTO push_tokens (
          user_id,
          token,
          platform,
          device_id,
          app_version,
          enabled,
          last_seen_at,
          updated_at
        )
        VALUES (?, ?, 'ios', ?, '1.0.0', ?, '2026-05-15 09:00:00', '2026-05-15 09:00:00')
        `,
        [userId, token, `device-${userId}`, enabled]
      );
    }

    await dbRun(db, 'PRAGMA foreign_keys = ON');
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('조건부 오후 8시 마케팅 푸시 리마인더', () => {
  test('20:00 KST 실행 창과 날짜 key를 계산한다', () => {
    const nowMs = Date.parse('2026-05-15T11:10:00.000Z');

    expect(getKstDateParts(nowMs)).toMatchObject({
      date: '2026-05-15',
      hour: 20,
      minute: 10,
    });
    expect(isWithinReminderWindow({ nowMs }).within).toBe(true);
    expect(isWithinReminderWindow({ nowMs: Date.parse('2026-05-15T12:10:00.000Z') }).within).toBe(
      false
    );
    expect(buildCampaignKey('2026-05-15')).toBe('evening_writing_reminder:2026-05-15');
  });

  test('조건을 만족한 사용자에게만 큐를 만들고 같은 날짜 중복 생성을 막는다', async ({}, testInfo) => {
    const base = testInfo.project.name === 'mobile-chrome' ? 21900 : 21800;
    const users = buildUsers(base);
    const campaignKey = `e2e-evening-reminder:${base}:2026-05-15`;
    const nowMs = Date.parse('2026-05-15T11:10:00.000Z');

    await seedReminderFixtures(users);

    const result = await queueConditionalEveningMarketingPush({
      nowMs,
      campaignKey,
    });

    expect(result).toMatchObject({
      ok: true,
      kst_date: '2026-05-15',
      queued_count: 2,
      eligible_user_count: 1,
      eligible_token_count: 2,
    });

    const queuedRows = await withDb((db) =>
      dbAll(
        db,
        `
        SELECT recipient_user_id, title, body, payload_json
        FROM push_delivery_queue
        WHERE recipient_user_id IN (?, ?, ?, ?, ?, ?, ?)
        ORDER BY id ASC
        `,
        Object.values(users)
      )
    );
    expect(queuedRows).toHaveLength(2);
    expect(new Set(queuedRows.map((row) => row.recipient_user_id))).toEqual(
      new Set([users.eligible])
    );
    expect(queuedRows[0].title).toBe('오늘의 기록을 아직 남기지 않았다면');
    expect(JSON.parse(queuedRows[0].payload_json)).toMatchObject({
      type: 'marketing_campaign',
      campaign_kind: 'evening_writing_reminder',
      target_path: '/write',
    });

    const duplicate = await queueConditionalEveningMarketingPush({
      nowMs,
      campaignKey,
    });
    expect(duplicate).toMatchObject({
      skipped: true,
      reason: 'already_queued',
      queued_count: 2,
    });

    const queueCount = await withDb((db) =>
      dbGet(
        db,
        `
        SELECT COUNT(*) AS count
        FROM push_delivery_queue
        WHERE recipient_user_id IN (?, ?, ?, ?, ?, ?, ?)
        `,
        Object.values(users)
      )
    );
    expect(queueCount.count).toBe(2);
  });

  test('20:00 KST 실행 창 밖에서는 캠페인을 만들지 않는다', async ({}, testInfo) => {
    const base = testInfo.project.name === 'mobile-chrome' ? 22900 : 22800;
    const users = buildUsers(base);
    const campaignKey = `e2e-evening-reminder:${base}:outside-window`;

    await seedReminderFixtures(users);

    const result = await queueConditionalEveningMarketingPush({
      nowMs: Date.parse('2026-05-15T10:30:00.000Z'),
      campaignKey,
    });

    expect(result).toMatchObject({
      skipped: true,
      reason: 'outside_window',
      queued_count: 0,
    });

    const campaign = await withDb((db) =>
      dbGet(db, 'SELECT id FROM marketing_push_campaigns WHERE campaign_key = ?', [campaignKey])
    );
    expect(campaign).toBeNull();
  });
});
