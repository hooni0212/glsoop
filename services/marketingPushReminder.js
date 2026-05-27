const { allAsync, getAsync, runAsync } = require('../utils/questService');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REMINDER_HOUR_KST = 20;
const DEFAULT_REMINDER_WINDOW_MINUTES = 55;
const DEFAULT_RECENT_ACTIVITY_DAYS = 30;
const DEFAULT_SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TITLE = '오늘의 기록을 아직 남기지 않았다면';
const DEFAULT_BODY = '짧은 문장 하나로 오늘의 마음을 남겨보세요.';
const DEFAULT_TARGET_PATH = '/write';
const CAMPAIGN_KIND = 'evening_writing_reminder';

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeNullableText(value, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeInternalTargetPath(value) {
  const trimmed = normalizeNullableText(value, 300);
  if (!trimmed) return DEFAULT_TARGET_PATH;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_TARGET_PATH;
  if (trimmed.startsWith('/(auth)')) return DEFAULT_TARGET_PATH;
  return trimmed;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value !== 'string') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

function stripAdLabel(value) {
  return String(value || '').replace(/^\(광고\)\s*/u, '').trim();
}

function normalizeMarketingTitle(value, options = {}) {
  const raw = normalizeNullableText(value, 80) || DEFAULT_TITLE;
  const title = stripAdLabel(raw) || DEFAULT_TITLE;
  return options.includeAdLabel ? `(광고) ${title}` : title;
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
  const hourKst = clampInt(
    input.hourKst ?? process.env.MARKETING_PUSH_REMINDER_HOUR_KST,
    DEFAULT_REMINDER_HOUR_KST,
    0,
    23
  );
  const windowMinutes = clampInt(
    input.windowMinutes ?? process.env.MARKETING_PUSH_REMINDER_WINDOW_MINUTES,
    DEFAULT_REMINDER_WINDOW_MINUTES,
    1,
    180
  );
  const parts = getKstDateParts(input.nowMs);
  const windowStart = hourKst * 60;
  const windowEnd = windowStart + windowMinutes;

  return {
    within: parts.totalMinutes >= windowStart && parts.totalMinutes < windowEnd,
    kstDate: parts.date,
    hourKst,
    windowMinutes,
  };
}

function buildCampaignKey(kstDate) {
  return `${CAMPAIGN_KIND}:${kstDate}`;
}

function buildTargetRule({
  kstDate,
  recentActivityDays,
  todayStartUtc,
  todayEndUtc,
}) {
  return {
    kind: CAMPAIGN_KIND,
    kst_date: kstDate,
    recent_activity_days: recentActivityDays,
    today_utc_window: {
      start: todayStartUtc,
      end: todayEndUtc,
    },
    required: [
      'marketing_push_opt_in',
      'active_account',
      'active_push_token',
      'recent_auth_session',
      'has_prior_post',
      'no_post_today_kst',
    ],
  };
}

async function selectEligibleRecipientRows({
  recentActivitySince,
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
          AND datetime(s.last_seen_at) >= datetime(?)
        LIMIT 1
      )
      AND EXISTS (
        SELECT 1
        FROM posts prior_posts
        WHERE prior_posts.user_id = u.id
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
    [recentActivitySince, todayStartUtc, todayEndUtc]
  );
}

async function queueConditionalEveningMarketingPush(input = {}) {
  const nowMs = toFiniteNowMs(input.nowMs);
  const recentActivityDays = clampInt(
    input.recentActivityDays ?? process.env.MARKETING_PUSH_REMINDER_RECENT_ACTIVITY_DAYS,
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
      queued_count: 0,
      eligible_user_count: 0,
      eligible_token_count: 0,
    };
  }

  const kstDate = input.kstDate || window.kstDate;
  const dayBounds = getKstDayBoundsUtc(kstDate);
  const recentActivitySince = formatSqlDateTime(nowMs - recentActivityDays * DAY_MS);
  const recipientRows = await selectEligibleRecipientRows({
    recentActivitySince,
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
      eligible_user_count: tokenRowsByUser.size,
      eligible_token_count: recipientRows.length,
    };
  }

  const includeAdLabel = parseBoolean(
    input.includeAdLabel ?? process.env.MARKETING_PUSH_REMINDER_INCLUDE_AD_LABEL,
    false
  );
  const title = normalizeMarketingTitle(
    input.title ?? process.env.MARKETING_PUSH_REMINDER_TITLE ?? DEFAULT_TITLE,
    { includeAdLabel }
  );
  const body =
    normalizeNullableText(input.body ?? process.env.MARKETING_PUSH_REMINDER_BODY, 180) ||
    DEFAULT_BODY;
  const targetPath = normalizeInternalTargetPath(
    input.targetPath ?? process.env.MARKETING_PUSH_REMINDER_TARGET_PATH ?? DEFAULT_TARGET_PATH
  );
  const campaignKey = input.campaignKey || buildCampaignKey(kstDate);
  const targetRuleJson = serializeMeta(
    buildTargetRule({
      kstDate,
      recentActivityDays,
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
            notification_type: 'marketing_campaign',
            campaign_id: campaignId,
            campaign_kind: CAMPAIGN_KIND,
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
              type: 'marketing_campaign',
              event_type: 'system',
              campaign_id: campaignId,
              campaign_kind: CAMPAIGN_KIND,
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
      queued_count: queuedCount,
      eligible_user_count: tokenRowsByUser.size,
      eligible_token_count: recipientRows.length,
    };
  } catch (error) {
    try {
      await runAsync('ROLLBACK');
    } catch (rollbackError) {
      console.error('[marketing-push-reminder] rollback failed:', rollbackError);
    }
    throw error;
  }
}

function startMarketingPushReminderScheduler(input = {}) {
  const intervalMs = clampInt(
    input.intervalMs ?? process.env.MARKETING_PUSH_REMINDER_INTERVAL_MS,
    DEFAULT_SCHEDULER_INTERVAL_MS,
    60 * 1000,
    60 * 60 * 1000
  );
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await queueConditionalEveningMarketingPush(input);
      if (!summary.skipped || summary.reason === 'outside_window') {
        if (summary.queued_count > 0 || !summary.skipped) {
          console.log('[marketing-push-reminder] summary:', summary);
        }
      }
    } catch (error) {
      console.error('[marketing-push-reminder] failed:', error);
    } finally {
      running = false;
    }
  };

  tick();
  return setInterval(tick, intervalMs);
}

function stopMarketingPushReminderScheduler(handle) {
  if (handle) clearInterval(handle);
}

module.exports = {
  CAMPAIGN_KIND,
  buildCampaignKey,
  getKstDateParts,
  getKstDayBoundsUtc,
  isWithinReminderWindow,
  queueConditionalEveningMarketingPush,
  startMarketingPushReminderScheduler,
  stopMarketingPushReminderScheduler,
};
