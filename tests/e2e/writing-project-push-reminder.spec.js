const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const {
  buildCampaignKey,
  getKstDateParts,
  isWithinReminderWindow,
  queueDailyWritingProjectPush,
  resolveReminderHours,
} = require('../../services/writingProjectPushReminder');
const { getDefaultWritingEventStatus } = require('../../utils/dailyWritingCampaign');

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
    firstTimer: base + 2,
    optOut: base + 3,
    inactive: base + 4,
    todayWriter: base + 5,
    oldSession: base + 6,
    expiredSession: base + 7,
    disabledToken: base + 8,
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
      ['daily_writing_project_prompt:%', 'e2e-writing-project:%']
    );
    await dbRun(
      db,
      `DELETE FROM push_tokens WHERE token LIKE 'ExponentPushToken[e2e-writing-project-%]'`
    );
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
          `Writing Project ${key}`,
          `writing_project_${key}`,
          `writing-project-${userId}@glsoop.test`,
          key === 'inactive' ? 'deactivated' : 'active',
          key === 'optOut' ? 0 : 1,
          '2026-06-01 00:00:00',
        ]
      );
    }

    await dbRun(
      db,
      `
      INSERT INTO posts (user_id, title, content, category, created_at)
      VALUES (?, '오늘의 글', '오늘은 이미 작성함', 'short', '2026-06-20 00:30:00')
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
        VALUES (?, ?, 1, '2026-06-01 00:00:00', ?, ?)
        `,
        [
          `writing-project-session-${userId}`,
          userId,
          key === 'oldSession' ? '2026-05-01 00:00:00' : '2026-06-20 00:00:00',
          key === 'expiredSession' ? '2026-06-01 00:00:00' : '2026-07-01 00:00:00',
        ]
      );
    }

    const tokenRows = [
      [users.eligible, `ExponentPushToken[e2e-writing-project-${users.eligible}-a]`, 1],
      [users.eligible, `ExponentPushToken[e2e-writing-project-${users.eligible}-b]`, 1],
      [users.firstTimer, `ExponentPushToken[e2e-writing-project-${users.firstTimer}]`, 1],
      [users.optOut, `ExponentPushToken[e2e-writing-project-${users.optOut}]`, 1],
      [users.inactive, `ExponentPushToken[e2e-writing-project-${users.inactive}]`, 1],
      [users.todayWriter, `ExponentPushToken[e2e-writing-project-${users.todayWriter}]`, 1],
      [users.oldSession, `ExponentPushToken[e2e-writing-project-${users.oldSession}]`, 1],
      [users.expiredSession, `ExponentPushToken[e2e-writing-project-${users.expiredSession}]`, 1],
      [users.disabledToken, `ExponentPushToken[e2e-writing-project-${users.disabledToken}]`, 0],
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
        VALUES (?, ?, 'ios', ?, '1.0.0', ?, '2026-06-20 00:00:00', '2026-06-20 00:00:00')
        `,
        [userId, token, `writing-project-device-${userId}`, enabled]
      );
    }

    await dbRun(db, 'PRAGMA foreign_keys = ON');
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('글숲 한달 글쓰기 프로젝트 푸시 리마인더', () => {
  test('09:00, 14:00, 18:00 KST 실행 창과 프로젝트 날짜 key를 계산한다', () => {
    const nowMs = Date.parse('2026-06-20T00:10:00.000Z');
    const status = getDefaultWritingEventStatus(new Date(nowMs));

    expect(getKstDateParts(nowMs)).toMatchObject({
      date: '2026-06-20',
      hour: 9,
      minute: 10,
    });
    expect(status.currentDay).toBe(7);
    expect(resolveReminderHours()).toEqual([9, 14, 18]);
    expect(isWithinReminderWindow({ nowMs })).toMatchObject({
      within: true,
      hourKst: 9,
      slotKey: 'slot-09',
    });
    expect(isWithinReminderWindow({ nowMs: Date.parse('2026-06-20T05:10:00.000Z') })).toMatchObject({
      within: true,
      hourKst: 14,
      slotKey: 'slot-14',
    });
    expect(isWithinReminderWindow({ nowMs: Date.parse('2026-06-20T09:10:00.000Z') })).toMatchObject({
      within: true,
      hourKst: 18,
      slotKey: 'slot-18',
    });
    expect(isWithinReminderWindow({ nowMs: Date.parse('2026-06-20T00:55:00.000Z') })).toMatchObject({
      within: true,
      hourKst: 9,
      slotKey: 'slot-09',
    });
    expect(isWithinReminderWindow({ nowMs: Date.parse('2026-06-20T05:55:00.000Z') })).toMatchObject({
      within: true,
      hourKst: 14,
      slotKey: 'slot-14',
    });
    expect(isWithinReminderWindow({ nowMs: Date.parse('2026-06-20T09:55:00.000Z') })).toMatchObject({
      within: true,
      hourKst: 18,
      slotKey: 'slot-18',
    });
    expect(isWithinReminderWindow({ nowMs: Date.parse('2026-06-20T00:56:00.000Z') }).within).toBe(
      false
    );
    expect(isWithinReminderWindow({ nowMs: Date.parse('2026-06-20T02:10:00.000Z') }).within).toBe(
      false
    );
    expect(buildCampaignKey(status, 'slot-09')).toBe(
      'daily_writing_project_prompt:glsoop-monthly-writing-project-prototype:2026-06-20:day-07-rain-memory:slot-09'
    );

    const nextCycleStatus = getDefaultWritingEventStatus(new Date('2026-07-14T00:10:00.000Z'));
    expect(nextCycleStatus.currentDay).toBe(1);
    expect(nextCycleStatus.prompt.key).toBe('day-01-kind-gaze');

    const inactiveStatus = getDefaultWritingEventStatus(new Date('2026-08-13T00:10:00.000Z'));
    expect(inactiveStatus.active).toBe(false);
    expect(inactiveStatus.prompt).toBeNull();
    expect(inactiveStatus.writePath).toBeNull();
  });

  test('진행 중인 글쓰기 프로젝트가 없으면 자동 푸시를 만들지 않는다', async () => {
    const result = await queueDailyWritingProjectPush({
      nowMs: Date.parse('2026-08-13T00:10:00.000Z'),
      force: true,
    });

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'inactive_campaign',
      queued_count: 0,
    });
  });

  test('오늘 아직 쓰지 않은 수신 동의 사용자에게만 시간대별로 한 번씩 큐를 만든다', async ({}, testInfo) => {
    const base = testInfo.project.name === 'mobile-chrome' ? 23900 : 23800;
    const users = buildUsers(base);
    const morningMs = Date.parse('2026-06-20T00:10:00.000Z');
    const afternoonMs = Date.parse('2026-06-20T05:10:00.000Z');

    await seedReminderFixtures(users);

    const result = await queueDailyWritingProjectPush({
      nowMs: morningMs,
    });

    expect(result).toMatchObject({
      ok: true,
      kst_date: '2026-06-20',
      reminder_slot_key: 'slot-09',
      queued_count: 3,
      eligible_user_count: 2,
      eligible_token_count: 3,
    });

    const queuedRows = await withDb((db) =>
      dbAll(
        db,
        `
        SELECT recipient_user_id, title, body, payload_json
        FROM push_delivery_queue
        WHERE recipient_user_id IN (?, ?, ?, ?, ?, ?, ?, ?)
        ORDER BY id ASC
        `,
        Object.values(users)
      )
    );
    expect(queuedRows).toHaveLength(3);
    expect(new Set(queuedRows.map((row) => row.recipient_user_id))).toEqual(
      new Set([users.eligible, users.firstTimer])
    );
    expect(queuedRows[0].title).toBe('7일차 글감: 비 오는 날 떠오르는 기억');
    expect(JSON.parse(queuedRows[0].payload_json)).toMatchObject({
      type: 'writing_project_prompt',
      campaign_kind: 'daily_writing_project_prompt',
      prompt_key: 'day-07-rain-memory',
      prompt_day: 7,
      reminder_slot_key: 'slot-09',
    });
    expect(JSON.parse(queuedRows[0].payload_json).target_path).toContain('/write?');

    const duplicate = await queueDailyWritingProjectPush({
      nowMs: morningMs,
    });
    expect(duplicate).toMatchObject({
      skipped: true,
      reason: 'already_queued',
      reminder_slot_key: 'slot-09',
      queued_count: 3,
    });

    const afternoonResult = await queueDailyWritingProjectPush({
      nowMs: afternoonMs,
    });
    expect(afternoonResult).toMatchObject({
      ok: true,
      kst_date: '2026-06-20',
      reminder_slot_key: 'slot-14',
      queued_count: 3,
      eligible_user_count: 2,
      eligible_token_count: 3,
    });

    const queueCount = await withDb((db) =>
      dbGet(
        db,
        `
        SELECT COUNT(*) AS count
        FROM push_delivery_queue
        WHERE recipient_user_id IN (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        Object.values(users)
      )
    );
    expect(queueCount.count).toBe(6);
  });

  test('세 실행 창 밖에서는 캠페인을 만들지 않는다', async ({}, testInfo) => {
    const base = testInfo.project.name === 'mobile-chrome' ? 24900 : 24800;
    const users = buildUsers(base);
    const campaignKey = `e2e-writing-project:${base}:outside-window`;

    await seedReminderFixtures(users);

    const result = await queueDailyWritingProjectPush({
      nowMs: Date.parse('2026-06-20T02:10:00.000Z'),
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
