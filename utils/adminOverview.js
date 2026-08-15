const { allAsync, getAsync } = require('./questService');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_PERIOD_DAYS = new Set([7, 30]);

function parseOverviewDays(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return ALLOWED_PERIOD_DAYS.has(parsed) ? parsed : 7;
}

function formatSqlUtc(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function formatKstDate(date) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function getKstDayStartUtc(now) {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      KST_OFFSET_MS
  );
}

function buildOverviewPeriod(days, now = new Date()) {
  const currentEnd = new Date(getKstDayStartUtc(now).getTime() + DAY_MS);
  const currentStart = new Date(currentEnd.getTime() - days * DAY_MS);
  const previousEnd = new Date(currentStart);
  const previousStart = new Date(previousEnd.getTime() - days * DAY_MS);

  return {
    days,
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    current_start: formatSqlUtc(currentStart),
    current_end: formatSqlUtc(currentEnd),
    previous_start: formatSqlUtc(previousStart),
    previous_end: formatSqlUtc(previousEnd),
    current_start_date: formatKstDate(currentStart),
    current_end_date: formatKstDate(new Date(currentEnd.getTime() - DAY_MS)),
    previous_start_date: formatKstDate(previousStart),
    previous_end_date: formatKstDate(new Date(previousEnd.getTime() - DAY_MS)),
  };
}

function number(value) {
  return Number(value || 0);
}

function parseStoredUtcDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
    ? raw
    : `${raw.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildCountMetric(current, previous) {
  const currentValue = number(current);
  const previousValue = number(previous);
  const delta = currentValue - previousValue;
  const changePercent =
    previousValue > 0 ? Number(((delta * 100) / previousValue).toFixed(1)) : null;

  return {
    current: currentValue,
    previous: previousValue,
    delta,
    change_percent: changePercent,
  };
}

function buildRateMetric(currentRate, previousRate, currentBase, previousBase) {
  const current = number(currentRate);
  const previous = number(previousRate);
  return {
    current,
    previous,
    delta_percentage_points: Number((current - previous).toFixed(1)),
    current_base: number(currentBase),
    previous_base: number(previousBase),
  };
}

async function fetchActiveUsers(start, end) {
  const row = await getAsync(
    `SELECT COUNT(DISTINCT ue.user_id) AS cnt
     FROM ux_events ue
     JOIN users u ON u.id = ue.user_id
     WHERE ue.created_at >= ?
       AND ue.created_at < ?
       AND COALESCE(u.is_admin, 0) = 0`,
    [start, end]
  );
  return number(row?.cnt);
}

async function fetchVerificationCount(start, end) {
  const row = await getAsync(
    `SELECT COUNT(*) AS cnt
     FROM users u
     WHERE u.is_verified = 1
       AND u.created_at >= ?
       AND u.created_at < ?
       AND COALESCE(u.is_admin, 0) = 0`,
    [start, end]
  );
  return number(row?.cnt);
}

async function fetchPostMetrics(start, end) {
  const [summary, repeatWriters, returningWriters] = await Promise.all([
    getAsync(
      `SELECT COUNT(*) AS post_count, COUNT(DISTINCT p.user_id) AS writer_count
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.created_at >= ?
         AND p.created_at < ?
         AND COALESCE(u.is_admin, 0) = 0`,
      [start, end]
    ),
    getAsync(
      `SELECT COUNT(*) AS cnt
       FROM (
         SELECT p.user_id
         FROM posts p
         JOIN users u ON u.id = p.user_id
         WHERE p.created_at >= ?
           AND p.created_at < ?
           AND COALESCE(u.is_admin, 0) = 0
         GROUP BY p.user_id
         HAVING COUNT(*) >= 2
       ) repeated`,
      [start, end]
    ),
    getAsync(
      `SELECT COUNT(*) AS cnt
       FROM (
         SELECT DISTINCT current_posts.user_id
         FROM posts current_posts
         JOIN users u ON u.id = current_posts.user_id
         WHERE current_posts.created_at >= ?
           AND current_posts.created_at < ?
           AND COALESCE(u.is_admin, 0) = 0
           AND EXISTS (
             SELECT 1
             FROM posts earlier_posts
             WHERE earlier_posts.user_id = current_posts.user_id
               AND earlier_posts.created_at < ?
           )
       ) returning_writers`,
      [start, end, start]
    ),
  ]);

  return {
    post_count: number(summary?.post_count),
    writer_count: number(summary?.writer_count),
    repeat_writer_count: number(repeatWriters?.cnt),
    returning_writer_count: number(returningWriters?.cnt),
  };
}

async function fetchEngagementMetrics(start, end) {
  const row = await getAsync(
    `WITH engagement_events AS (
       SELECT l.user_id, l.created_at FROM likes l
       UNION ALL
       SELECT bl.user_id, bi.created_at
       FROM bookmark_items bi
       JOIN bookmark_lists bl ON bl.id = bi.list_id
       UNION ALL
       SELECT c.user_id, c.created_at
       FROM comments c
       WHERE c.status = 'active'
       UNION ALL
       SELECT se.user_id, se.created_at
       FROM share_events se
       WHERE se.result = 'shared'
     )
     SELECT
       COUNT(*) AS event_count,
       COUNT(DISTINCT ee.user_id) AS participant_count
     FROM engagement_events ee
     LEFT JOIN users u ON u.id = ee.user_id
     WHERE ee.created_at >= ?
       AND ee.created_at < ?
       AND (ee.user_id IS NULL OR COALESCE(u.is_admin, 0) = 0)`,
    [start, end]
  );

  return {
    event_count: number(row?.event_count),
    participant_count: number(row?.participant_count),
  };
}

async function fetchActivationCohort(start, end) {
  const row = await getAsync(
    `WITH signed_up AS (
       SELECT u.id AS user_id, u.created_at AS signed_up_at
       FROM users u
       WHERE u.is_verified = 1
         AND u.created_at >= ?
         AND u.created_at < ?
         AND COALESCE(u.is_admin, 0) = 0
     )
     SELECT
       COUNT(*) AS cohort_count,
       SUM(
         CASE WHEN EXISTS (
           SELECT 1
           FROM posts first_post
           WHERE first_post.user_id = signed_up.user_id
             AND first_post.created_at >= signed_up.signed_up_at
             AND first_post.created_at <= datetime(signed_up.signed_up_at, '+24 hours')
         ) THEN 1 ELSE 0 END
       ) AS activated_count
     FROM signed_up`,
    [start, end]
  );
  const cohortCount = number(row?.cohort_count);
  const activatedCount = number(row?.activated_count);
  return {
    cohort_count: cohortCount,
    activated_count: activatedCount,
    rate: cohortCount > 0 ? Number(((activatedCount * 100) / cohortCount).toFixed(1)) : 0,
  };
}

async function fetchUxRetentionCohort(start, end, dayOffset) {
  const offsetStart = `+${dayOffset} days`;
  const offsetEnd = `+${dayOffset + 1} days`;
  const row = await getAsync(
    `WITH signed_up AS (
       SELECT u.id AS user_id, u.created_at AS signed_up_at
       FROM users u
       WHERE u.is_verified = 1
         AND u.created_at >= ?
         AND u.created_at < ?
         AND COALESCE(u.is_admin, 0) = 0
     )
     SELECT
       COUNT(*) AS cohort_count,
       SUM(
         CASE WHEN EXISTS (
           SELECT 1
           FROM ux_events returned
           WHERE returned.user_id = signed_up.user_id
             AND returned.created_at >= datetime(signed_up.signed_up_at, ?)
             AND returned.created_at < datetime(signed_up.signed_up_at, ?)
         ) THEN 1 ELSE 0 END
       ) AS returned_count
     FROM signed_up`,
    [start, end, offsetStart, offsetEnd]
  );
  const cohortCount = number(row?.cohort_count);
  const returnedCount = number(row?.returned_count);
  return {
    cohort_count: cohortCount,
    returned_count: returnedCount,
    rate: cohortCount > 0 ? Number(((returnedCount * 100) / cohortCount).toFixed(1)) : 0,
  };
}

async function fetchRewriteCohort(start, end) {
  const row = await getAsync(
    `WITH first_posts AS (
       SELECT p.user_id, MIN(p.created_at) AS first_post_at
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE COALESCE(u.is_admin, 0) = 0
       GROUP BY p.user_id
     ), eligible AS (
       SELECT user_id, first_post_at
       FROM first_posts
       WHERE first_post_at >= ?
         AND first_post_at < ?
     )
     SELECT
       COUNT(*) AS cohort_count,
       SUM(
         CASE WHEN EXISTS (
           SELECT 1
           FROM posts next_post
           WHERE next_post.user_id = eligible.user_id
             AND next_post.created_at > eligible.first_post_at
             AND next_post.created_at <= datetime(eligible.first_post_at, '+7 days')
         ) THEN 1 ELSE 0 END
       ) AS rewritten_count
     FROM eligible`,
    [start, end]
  );
  const cohortCount = number(row?.cohort_count);
  const rewrittenCount = number(row?.rewritten_count);
  return {
    cohort_count: cohortCount,
    rewritten_count: rewrittenCount,
    rate: cohortCount > 0 ? Number(((rewrittenCount * 100) / cohortCount).toFixed(1)) : 0,
  };
}

async function fetchOperations(start, end) {
  const [safety, push, publishing, api] = await Promise.all([
    getAsync(
      `SELECT
         SUM(CASE WHEN status IN ('queued', 'reviewing') THEN 1 ELSE 0 END) AS open_count,
         SUM(
           CASE WHEN status IN ('queued', 'reviewing')
             AND created_at < datetime('now', '-24 hours') THEN 1 ELSE 0 END
         ) AS overdue_count,
         MIN(CASE WHEN status IN ('queued', 'reviewing') THEN created_at END) AS oldest_open_at
       FROM safety_reports`
    ),
    getAsync(
      `SELECT
         SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS period_total,
         SUM(
           CASE WHEN created_at >= ? AND created_at < ? AND status = 'failed' THEN 1 ELSE 0 END
         ) AS period_failed,
         SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued_now
       FROM push_delivery_queue`,
      [start, end, start, end]
    ),
    getAsync(
      `SELECT
         SUM(CASE WHEN event_name = 'post_create_submit' THEN 1 ELSE 0 END) AS submit_count,
         SUM(CASE WHEN event_name = 'post_create_error' THEN 1 ELSE 0 END) AS error_count
       FROM ux_events
       WHERE created_at >= ? AND created_at < ?`,
      [start, end]
    ),
    getAsync(
      `SELECT
         COALESCE(SUM(request_count), 0) AS request_count,
         COALESCE(SUM(CASE WHEN status_class = 4 THEN request_count ELSE 0 END), 0) AS client_error_count,
         COALESCE(SUM(CASE WHEN status_class = 5 THEN request_count ELSE 0 END), 0) AS server_error_count,
         COALESCE(SUM(duration_total_ms), 0) AS duration_total_ms,
         COALESCE(MAX(duration_max_ms), 0) AS duration_max_ms
       FROM api_request_daily_metrics
       WHERE day_key >= date(?, '+9 hours')
         AND day_key < date(?, '+9 hours')`,
      [start, end]
    ),
  ]);

  const pushTotal = number(push?.period_total);
  const pushFailed = number(push?.period_failed);
  const publishSubmit = number(publishing?.submit_count);
  const publishError = number(publishing?.error_count);
  const oldestOpenAt = safety?.oldest_open_at || null;
  const oldestOpenDate = parseStoredUtcDate(oldestOpenAt);
  const oldestOpenHours = oldestOpenDate
    ? Math.max(0, Math.floor((Date.now() - oldestOpenDate.getTime()) / (60 * 60 * 1000)))
    : 0;
  const apiRequestCount = number(api?.request_count);
  const apiServerErrorCount = number(api?.server_error_count);

  return {
    safety: {
      open_count: number(safety?.open_count),
      overdue_24h_count: number(safety?.overdue_count),
      oldest_open_at: oldestOpenAt,
      oldest_open_hours: oldestOpenHours,
    },
    push: {
      queued_now: number(push?.queued_now),
      period_total: pushTotal,
      period_failed: pushFailed,
      failure_rate: pushTotal > 0 ? Number(((pushFailed * 100) / pushTotal).toFixed(1)) : 0,
    },
    publishing: {
      submit_count: publishSubmit,
      error_count: publishError,
      error_rate:
        publishSubmit > 0 ? Number(((publishError * 100) / publishSubmit).toFixed(1)) : 0,
    },
    api: {
      request_count: apiRequestCount,
      client_error_count: number(api?.client_error_count),
      server_error_count: apiServerErrorCount,
      server_error_rate:
        apiRequestCount > 0
          ? Number(((apiServerErrorCount * 100) / apiRequestCount).toFixed(2))
          : 0,
      average_duration_ms:
        apiRequestCount > 0
          ? Math.round(number(api?.duration_total_ms) / apiRequestCount)
          : 0,
      max_duration_ms: number(api?.duration_max_ms),
    },
  };
}

async function fetchDraftStats() {
  const row = await getAsync(
    `SELECT COUNT(*) AS draft_count, COUNT(DISTINCT user_id) AS writer_count
     FROM user_drafts
     WHERE expires_at > CURRENT_TIMESTAMP`
  );
  return {
    draft_count: number(row?.draft_count),
    writer_count: number(row?.writer_count),
  };
}

async function fetchDailyTrend(period) {
  const [activeRows, postRows] = await Promise.all([
    allAsync(
      `SELECT
         date(ue.created_at, '+9 hours') AS day,
         COUNT(DISTINCT ue.user_id) AS active_users
       FROM ux_events ue
       JOIN users u ON u.id = ue.user_id
       WHERE ue.created_at >= ?
         AND ue.created_at < ?
         AND COALESCE(u.is_admin, 0) = 0
       GROUP BY date(ue.created_at, '+9 hours')`,
      [period.current_start, period.current_end]
    ),
    allAsync(
      `SELECT
         date(p.created_at, '+9 hours') AS day,
         COUNT(*) AS posts_created,
         COUNT(DISTINCT p.user_id) AS writers
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.created_at >= ?
         AND p.created_at < ?
         AND COALESCE(u.is_admin, 0) = 0
       GROUP BY date(p.created_at, '+9 hours')`,
      [period.current_start, period.current_end]
    ),
  ]);

  const byDay = new Map();
  activeRows.forEach((row) => {
    byDay.set(row.day, { day: row.day, active_users: number(row.active_users), posts_created: 0, writers: 0 });
  });
  postRows.forEach((row) => {
    const value = byDay.get(row.day) || { day: row.day, active_users: 0, posts_created: 0, writers: 0 };
    value.posts_created = number(row.posts_created);
    value.writers = number(row.writers);
    byDay.set(row.day, value);
  });

  const result = [];
  for (let index = 0; index < period.days; index += 1) {
    const date = new Date(period.currentStart.getTime() + index * DAY_MS);
    const day = formatKstDate(date);
    result.push(byDay.get(day) || { day, active_users: 0, posts_created: 0, writers: 0 });
  }
  return result;
}

async function fetchAdminOverview({ days: rawDays, now = new Date() } = {}) {
  const days = parseOverviewDays(rawDays);
  const period = buildOverviewPeriod(days, now);
  const activationCurrentEnd = new Date(now.getTime() - DAY_MS);
  const activationCurrentStart = new Date(activationCurrentEnd.getTime() - days * DAY_MS);
  const activationPreviousEnd = new Date(activationCurrentStart);
  const activationPreviousStart = new Date(activationPreviousEnd.getTime() - days * DAY_MS);
  const d1End = new Date(now.getTime() - 2 * DAY_MS);
  const d1Start = new Date(d1End.getTime() - days * DAY_MS);
  const d7End = new Date(now.getTime() - 8 * DAY_MS);
  const d7Start = new Date(d7End.getTime() - days * DAY_MS);
  const rewriteEnd = new Date(now.getTime() - 7 * DAY_MS);
  const rewriteStart = new Date(rewriteEnd.getTime() - days * DAY_MS);

  const [
    currentActive,
    previousActive,
    currentVerified,
    previousVerified,
    currentPosts,
    previousPosts,
    currentEngagement,
    previousEngagement,
    currentActivation,
    previousActivation,
    d1Retention,
    d7Retention,
    rewriteRetention,
    currentOperations,
    previousOperations,
    daily,
    draftStats,
  ] = await Promise.all([
    fetchActiveUsers(period.current_start, period.current_end),
    fetchActiveUsers(period.previous_start, period.previous_end),
    fetchVerificationCount(period.current_start, period.current_end),
    fetchVerificationCount(period.previous_start, period.previous_end),
    fetchPostMetrics(period.current_start, period.current_end),
    fetchPostMetrics(period.previous_start, period.previous_end),
    fetchEngagementMetrics(period.current_start, period.current_end),
    fetchEngagementMetrics(period.previous_start, period.previous_end),
    fetchActivationCohort(formatSqlUtc(activationCurrentStart), formatSqlUtc(activationCurrentEnd)),
    fetchActivationCohort(formatSqlUtc(activationPreviousStart), formatSqlUtc(activationPreviousEnd)),
    fetchUxRetentionCohort(formatSqlUtc(d1Start), formatSqlUtc(d1End), 1),
    fetchUxRetentionCohort(formatSqlUtc(d7Start), formatSqlUtc(d7End), 7),
    fetchRewriteCohort(formatSqlUtc(rewriteStart), formatSqlUtc(rewriteEnd)),
    fetchOperations(period.current_start, period.current_end),
    fetchOperations(period.previous_start, period.previous_end),
    fetchDailyTrend(period),
    fetchDraftStats(),
  ]);

  return {
    generated_at: now.toISOString(),
    timezone: 'Asia/Seoul',
    period: {
      days,
      current_start: period.current_start,
      current_end: period.current_end,
      previous_start: period.previous_start,
      previous_end: period.previous_end,
      current_start_date: period.current_start_date,
      current_end_date: period.current_end_date,
      previous_start_date: period.previous_start_date,
      previous_end_date: period.previous_end_date,
    },
    headline: {
      active_users: buildCountMetric(currentActive, previousActive),
      verified_users: buildCountMetric(currentVerified, previousVerified),
      posts_created: buildCountMetric(currentPosts.post_count, previousPosts.post_count),
      writers: buildCountMetric(currentPosts.writer_count, previousPosts.writer_count),
      repeat_writers: buildCountMetric(
        currentPosts.repeat_writer_count,
        previousPosts.repeat_writer_count
      ),
      engagement_events: buildCountMetric(
        currentEngagement.event_count,
        previousEngagement.event_count
      ),
      engagement_participants: buildCountMetric(
        currentEngagement.participant_count,
        previousEngagement.participant_count
      ),
      activation_24h_rate: buildRateMetric(
        currentActivation.rate,
        previousActivation.rate,
        currentActivation.cohort_count,
        previousActivation.cohort_count
      ),
    },
    writing: {
      returning_writers: currentPosts.returning_writer_count,
      returning_writer_rate:
        currentPosts.writer_count > 0
          ? Number(((currentPosts.returning_writer_count * 100) / currentPosts.writer_count).toFixed(1))
          : 0,
      repeat_writers: currentPosts.repeat_writer_count,
      active_drafts_now: draftStats.draft_count,
      draft_writers_now: draftStats.writer_count,
    },
    activation: {
      verified_users: currentActivation.cohort_count,
      first_post_24h_users: currentActivation.activated_count,
      first_post_24h_rate: currentActivation.rate,
    },
    retention: {
      d1: d1Retention,
      d7: d7Retention,
      rewrite_7d: rewriteRetention,
    },
    operations: {
      ...currentOperations,
      push: {
        ...currentOperations.push,
        failure_rate_change_percentage_points: Number(
          (currentOperations.push.failure_rate - previousOperations.push.failure_rate).toFixed(1)
        ),
      },
      publishing: {
        ...currentOperations.publishing,
        error_rate_change_percentage_points: Number(
          (currentOperations.publishing.error_rate - previousOperations.publishing.error_rate).toFixed(1)
        ),
      },
      api: {
        ...currentOperations.api,
        server_error_rate_change_percentage_points: Number(
          (
            currentOperations.api.server_error_rate -
            previousOperations.api.server_error_rate
          ).toFixed(2)
        ),
      },
    },
    daily,
    definitions: {
      active_user: '관리자 계정을 제외하고 기간 내 UX 이벤트를 1회 이상 남긴 로그인 사용자',
      signup_time: '신규 계정은 실제 가입 완료 시각, 기존 계정은 가입 동의·활동·글 중 가장 이른 기록으로 보정',
      repeat_writer: '기간 내 글을 2개 이상 작성한 사용자',
      activation_24h: '가입 완료 후 24시간 관찰이 끝난 사용자 중 실제 첫 글을 작성한 비율',
      d1_retention: '가입 완료 24~48시간 후 UX 이벤트를 남긴 사용자 비율',
      d7_retention: '가입 완료 7~8일 후 UX 이벤트를 남긴 사용자 비율',
      rewrite_7d: '첫 글 작성 후 7일 안에 두 번째 글을 작성한 사용자 비율',
      publishing_error: '웹 편집기의 글 발행 시도 대비 오류 이벤트 비율',
      api_error: '전체 API 응답 중 서버 오류(5xx) 비율과 평균·최장 응답시간',
    },
  };
}

module.exports = {
  buildOverviewPeriod,
  fetchAdminOverview,
  parseOverviewDays,
};
