const { allAsync, getAsync, runAsync } = require('../utils/questService');
const { getDefaultWritingEventStatus } = require('../utils/dailyWritingCampaign');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REMINDER_HOURS_KST = [9, 14, 18];
const DEFAULT_REMINDER_WINDOW_MINUTES = 56;
const DEFAULT_RECENT_ACTIVITY_DAYS = 30;
const DEFAULT_SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;
const CAMPAIGN_KIND = 'daily_writing_project_prompt';
const DEFAULT_TARGET_PATH = '/write';

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseReminderHours(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
  const seen = new Set();
  const hours = [];

  for (const rawValue of rawValues) {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23 || seen.has(parsed)) continue;
    seen.add(parsed);
    hours.push(parsed);
  }

  return hours.sort((a, b) => a - b);
}

function resolveReminderHours(input = {}) {
  const configured = parseReminderHours(
    input.hoursKst ??
      input.hourKst ??
      process.env.WRITING_PROJECT_PUSH_REMINDER_HOURS_KST ??
      process.env.WRITING_PROJECT_PUSH_REMINDER_HOUR_KST
  );
  return configured.length > 0 ? configured : DEFAULT_REMINDER_HOURS_KST;
}

function normalizeNullableText(value, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeInternalTargetPath(value) {
  const trimmed = normalizeNullableText(value, 600);
  if (!trimmed) return DEFAULT_TARGET_PATH;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_TARGET_PATH;
  if (trimmed.startsWith('/(auth)')) return DEFAULT_TARGET_PATH;
  return trimmed;
}

function serializeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  try {
    return JSON.stringify(meta);
  } catch {
    return null;
  }
}

function formatSqlDateTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function toFiniteNowMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : Date.now();
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function getKstDateParts(nowMs = Date.now()) {
  const kstDate = new Date(toFiniteNowMs(nowMs) + KST_OFFSET_MS);
  const hour = kstDate.getUTCHours();
  const minute = kstDate.getUTCMinutes();
  return {
    date: kstDate.toISOString().slice(0, 10),
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
  };
}

function getKstDayBoundsUtc(kstDate) {
  const [year, month, day] = String(kstDate || '').split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid KST date: ${kstDate}`);
  }

  const kstStartAsUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0) - KST_OFFSET_MS;
  return {
    startMs: kstStartAsUtcMs,
    endMs: kstStartAsUtcMs + DAY_MS,
    startSql: formatSqlDateTime(kstStartAsUtcMs),
    endSql: formatSqlDateTime(kstStartAsUtcMs + DAY_MS),
  };
}

function isWithinReminderWindow(input = {}) {
  const hoursKst = resolveReminderHours(input);
  const windowMinutes = clampInt(
    input.windowMinutes ?? process.env.WRITING_PROJECT_PUSH_REMINDER_WINDOW_MINUTES,
    DEFAULT_REMINDER_WINDOW_MINUTES,
    1,
    180
  );
  const parts = getKstDateParts(input.nowMs);
  const matchedHourKst = hoursKst.find((hourKst) => {
    const windowStart = hourKst * 60;
    const windowEnd = windowStart + windowMinutes;
    return parts.totalMinutes >= windowStart && parts.totalMinutes < windowEnd;
  });

  return {
    within: matchedHourKst !== undefined,
    kstDate: parts.date,
    hourKst: matchedHourKst ?? null,
    hoursKst,
    slotKey: matchedHourKst === undefined ? null : `slot-${String(matchedHourKst).padStart(2, '0')}`,
    windowMinutes,
  };
}

function buildCampaignKey(status, slotKey = null) {
  const campaignKey = status?.campaignKey || 'default';
  const localDateKey = status?.localDateKey || getKstDateParts().date;
  const promptKey = status?.prompt?.key || 'prompt';
  const normalizedSlotKey = slotKey || 'slot-default';
  return `${CAMPAIGN_KIND}:${campaignKey}:${localDateKey}:${promptKey}:${normalizedSlotKey}`;
}

function buildTargetRule({ status, recentActivityDays, reminderSlotKey, todayStartUtc, todayEndUtc }) {
  return {
    kind: CAMPAIGN_KIND,
    campaign_key: status.campaignKey,
    prompt_key: status.prompt.key,
    prompt_day: status.prompt.day,
    kst_date: status.localDateKey,
    reminder_slot_key: reminderSlotKey,
    recent_activity_days: recentActivityDays,
    today_utc_window: {
      start: todayStartUtc,
      end: todayEndUtc,
    },
    required: [
      'marketing_push_opt_in',
      'active_account',
      'active_push_token',
      'recent_active_auth_session',
      'no_post_today_kst',
    ],
  };
}

async function selectEligibleRecipientRows({
  recentActivitySince,
  nowSql,
  todayStartUtc,
  todayEndUtc,
}) {
  return allAsync(
    `
    SELECT
      u.id AS user_id,
      pt.id AS push_token_id
    FROM users u
    JOIN push_tokens pt
      ON pt.user_id = u.id
     AND pt.enabled = 1
    WHERE COALESCE(u.marketing_push_opt_in, 0) = 1
      AND COALESCE(u.account_status, 'active') = 'active'
      AND EXISTS (
        SELECT 1
        FROM auth_sessions s
        WHERE s.user_id = u.id
          AND s.revoked_at IS NULL
          AND datetime(s.expires_at) > datetime(?)
          AND datetime(s.last_seen_at) >= datetime(?)
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM posts today_posts
        WHERE today_posts.user_id = u.id
          AND datetime(today_posts.created_at) >= datetime(?)
          AND datetime(today_posts.created_at) < datetime(?)
        LIMIT 1
      )
    ORDER BY u.id ASC, pt.last_seen_at DESC, pt.id DESC
    `,
    [nowSql, recentActivitySince, todayStartUtc, todayEndUtc]
  );
}

function buildNotificationCopy(status, input = {}) {
  const day = Number(status?.prompt?.day || status?.currentDay || 1);
  const promptTitle = normalizeNullableText(status?.prompt?.title, 80) || '오늘의 글감';
  const promptBody =
    normalizeNullableText(status?.prompt?.body, 180) ||
    '오늘의 글감으로 짧게 한 문장을 남겨보세요.';
  return {
    title:
      normalizeNullableText(input.title ?? process.env.WRITING_PROJECT_PUSH_REMINDER_TITLE, 80) ||
      `${day}일차 글감: ${promptTitle}`,
    body:
      normalizeNullableText(input.body ?? process.env.WRITING_PROJECT_PUSH_REMINDER_BODY, 180) ||
      promptBody,
  };
}

async function queueDailyWritingProjectPush(input = {}) {
  const nowMs = toFiniteNowMs(input.nowMs);
  const now = new Date(nowMs);
  const status = input.status || getDefaultWritingEventStatus(now);
  if (!status?.prompt) {
    return {
      ok: true,
      skipped: true,
      reason: 'missing_status',
      queued_count: 0,
      eligible_user_count: 0,
      eligible_token_count: 0,
    };
  }

  const recentActivityDays = clampInt(
    input.recentActivityDays ?? process.env.WRITING_PROJECT_PUSH_REMINDER_RECENT_ACTIVITY_DAYS,
    DEFAULT_RECENT_ACTIVITY_DAYS,
    1,
    365
  );
  const window = isWithinReminderWindow({
    nowMs,
    hourKst: input.hourKst,
    windowMinutes: input.windowMinutes,
  });

  if (!input.force && !window.within) {
    return {
      ok: true,
      skipped: true,
      reason: 'outside_window',
      kst_date: window.kstDate,
      reminder_slot_key: null,
      queued_count: 0,
      eligible_user_count: 0,
      eligible_token_count: 0,
    };
  }

  const kstDate = input.kstDate || status.localDateKey || window.kstDate;
  const reminderSlotKey = input.reminderSlotKey || window.slotKey || 'slot-forced';
  const statusForDate = kstDate === status.localDateKey ? status : getDefaultWritingEventStatus(now);
  const dayBounds = getKstDayBoundsUtc(kstDate);
  const recentActivitySince = formatSqlDateTime(nowMs - recentActivityDays * DAY_MS);
  const nowSql = formatSqlDateTime(nowMs);
  const recipientRows = await selectEligibleRecipientRows({
    recentActivitySince,
    nowSql,
    todayStartUtc: dayBounds.startSql,
    todayEndUtc: dayBounds.endSql,
  });
  const tokenRowsByUser = new Map();

  for (const row of recipientRows) {
    const list = tokenRowsByUser.get(row.user_id) || [];
    list.push(row.push_token_id);
    tokenRowsByUser.set(row.user_id, list);
  }

  if (input.dryRun) {
    return {
      ok: true,
      dry_run: true,
      kst_date: kstDate,
      reminder_slot_key: reminderSlotKey,
      eligible_user_count: tokenRowsByUser.size,
      eligible_token_count: recipientRows.length,
    };
  }

  const { title, body } = buildNotificationCopy(statusForDate, input);
  const targetPath = normalizeInternalTargetPath(
    input.targetPath ?? process.env.WRITING_PROJECT_PUSH_REMINDER_TARGET_PATH ?? statusForDate.writePath
  );
  const campaignKey = input.campaignKey || buildCampaignKey(statusForDate, reminderSlotKey);
  const targetRuleJson = serializeMeta(
    buildTargetRule({
      status: statusForDate,
      recentActivityDays,
      reminderSlotKey,
      todayStartUtc: dayBounds.startSql,
      todayEndUtc: dayBounds.endSql,
    })
  );

  await runAsync('BEGIN IMMEDIATE');
  try {
    const campaign = await runAsync(
      `
      INSERT OR IGNORE INTO marketing_push_campaigns (
        title,
        body,
        target_path,
        created_by_user_id,
        queued_count,
        dry_run,
        campaign_key,
        campaign_kind,
        scheduled_for_date,
        target_rule_json
      )
      VALUES (?, ?, ?, NULL, 0, 0, ?, ?, ?, ?)
      `,
      [title, body, targetPath, campaignKey, CAMPAIGN_KIND, kstDate, targetRuleJson]
    );

    if (campaign.changes <= 0) {
      const existing = await getAsync(
        `
        SELECT id, queued_count
        FROM marketing_push_campaigns
        WHERE campaign_key = ?
        LIMIT 1
        `,
        [campaignKey]
      );
      await runAsync('COMMIT');
      return {
        ok: true,
        skipped: true,
        reason: 'already_queued',
        campaign_id: existing?.id || null,
        kst_date: kstDate,
        reminder_slot_key: reminderSlotKey,
        queued_count: Number(existing?.queued_count || 0),
        eligible_user_count: tokenRowsByUser.size,
        eligible_token_count: recipientRows.length,
      };
    }

    const campaignId = campaign.lastID;
    let queuedCount = 0;

    for (const [userId, pushTokenIds] of tokenRowsByUser.entries()) {
      const activity = await runAsync(
        `
        INSERT INTO activity_events (
          recipient_user_id,
          actor_user_id,
          event_type,
          title,
          body,
          meta_json
        )
        VALUES (?, NULL, 'system', ?, ?, ?)
        `,
        [
          userId,
          title,
          body,
          serializeMeta({
            notification_type: 'writing_project_prompt',
            campaign_id: campaignId,
            campaign_kind: CAMPAIGN_KIND,
            campaign_key: statusForDate.campaignKey,
            prompt_key: statusForDate.prompt.key,
            prompt_day: statusForDate.prompt.day,
            reminder_slot_key: reminderSlotKey,
            target_path: targetPath,
          }),
        ]
      );

      for (const pushTokenId of pushTokenIds) {
        await runAsync(
          `
          INSERT INTO push_delivery_queue (
            activity_event_id,
            recipient_user_id,
            push_token_id,
            title,
            body,
            payload_json
          )
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            activity.lastID,
            userId,
            pushTokenId,
            title,
            body,
            serializeMeta({
              notification_id: String(activity.lastID),
              activity_event_id: activity.lastID,
              type: 'writing_project_prompt',
              event_type: 'system',
              campaign_id: campaignId,
              campaign_kind: CAMPAIGN_KIND,
              campaign_key: statusForDate.campaignKey,
              prompt_key: statusForDate.prompt.key,
              prompt_day: statusForDate.prompt.day,
              reminder_slot_key: reminderSlotKey,
              target_path: targetPath,
            }),
          ]
        );
        queuedCount += 1;
      }
    }

    await runAsync('UPDATE marketing_push_campaigns SET queued_count = ? WHERE id = ?', [
      queuedCount,
      campaignId,
    ]);
    await runAsync('COMMIT');

    return {
      ok: true,
      campaign_id: campaignId,
      campaign_key: campaignKey,
      kst_date: kstDate,
      reminder_slot_key: reminderSlotKey,
      queued_count: queuedCount,
      eligible_user_count: tokenRowsByUser.size,
      eligible_token_count: recipientRows.length,
    };
  } catch (error) {
    try {
      await runAsync('ROLLBACK');
    } catch (rollbackError) {
      console.error('[writing-project-push-reminder] rollback failed:', rollbackError);
    }
    throw error;
  }
}

function startWritingProjectPushReminderScheduler(input = {}) {
  const intervalMs = clampInt(
    input.intervalMs ?? process.env.WRITING_PROJECT_PUSH_REMINDER_INTERVAL_MS,
    DEFAULT_SCHEDULER_INTERVAL_MS,
    60 * 1000,
    60 * 60 * 1000
  );
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await queueDailyWritingProjectPush(input);
      if (summary.queued_count > 0 || (!summary.skipped && !summary.dry_run)) {
        console.log('[writing-project-push-reminder] summary:', summary);
      }
    } catch (error) {
      console.error('[writing-project-push-reminder] failed:', error);
    } finally {
      running = false;
    }
  };

  tick();
  return setInterval(tick, intervalMs);
}

function stopWritingProjectPushReminderScheduler(handle) {
  if (handle) clearInterval(handle);
}

module.exports = {
  CAMPAIGN_KIND,
  buildCampaignKey,
  getKstDateParts,
  getKstDayBoundsUtc,
  isWithinReminderWindow,
  resolveReminderHours,
  queueDailyWritingProjectPush,
  startWritingProjectPushReminderScheduler,
  stopWritingProjectPushReminderScheduler,
};
