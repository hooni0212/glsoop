const { allAsync, runAsync } = require('../utils/questService');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const DEFAULT_BATCH_SIZE = 50;
const MAX_EXPO_BATCH_SIZE = 100;
const DEFAULT_INTERVAL_MS = 15000;
const DEFAULT_LOCK_TIMEOUT_MINUTES = 10;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_MS = 60000;

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeJsonParse(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isPermanentExpoError(errorCode) {
  return ['DeviceNotRegistered', 'InvalidCredentials', 'MessageTooBig'].includes(errorCode);
}

function shouldDisableToken(errorCode) {
  return errorCode === 'DeviceNotRegistered';
}

function retryDelayMs(attemptCount, retryBaseMs) {
  const exponent = Math.max(0, Math.min(5, Number(attemptCount || 1) - 1));
  return retryBaseMs * 2 ** exponent;
}

async function selectReadyDeliveries({ batchSize, lockTimeoutMinutes }) {
  return allAsync(
    `
    SELECT
      q.id,
      q.push_token_id,
      q.title,
      q.body,
      q.payload_json,
      q.attempt_count,
      pt.token
    FROM push_delivery_queue q
    JOIN push_tokens pt ON pt.id = q.push_token_id
    WHERE q.provider = 'expo'
      AND q.status = 'queued'
      AND pt.enabled = 1
      AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= CURRENT_TIMESTAMP)
      AND (q.locked_at IS NULL OR q.locked_at < datetime('now', ?))
    ORDER BY q.created_at ASC, q.id ASC
    LIMIT ?
    `,
    [`-${lockTimeoutMinutes} minutes`, batchSize]
  );
}

async function lockDelivery(row) {
  const result = await runAsync(
    `
    UPDATE push_delivery_queue
    SET locked_at = CURRENT_TIMESTAMP,
        last_attempt_at = CURRENT_TIMESTAMP,
        attempt_count = attempt_count + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status = 'queued'
    `,
    [row.id]
  );
  return result.changes > 0;
}

async function markSent(row, ticket) {
  await runAsync(
    `
    UPDATE push_delivery_queue
    SET status = 'sent',
        provider_message_id = ?,
        last_error = NULL,
        locked_at = NULL,
        sent_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [ticket?.id || null, row.id]
  );
}

async function markSkipped(row, message) {
  await runAsync(
    `
    UPDATE push_delivery_queue
    SET status = 'skipped',
        last_error = ?,
        locked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [String(message || 'Skipped'), row.id]
  );
}

async function markFailed(row, message) {
  await runAsync(
    `
    UPDATE push_delivery_queue
    SET status = 'failed',
        last_error = ?,
        locked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [String(message || 'Failed'), row.id]
  );
}

async function markRetry(row, message, retryBaseMs) {
  const nextAttemptAt = new Date(Date.now() + retryDelayMs(row.attempt_count + 1, retryBaseMs))
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');

  await runAsync(
    `
    UPDATE push_delivery_queue
    SET status = 'queued',
        last_error = ?,
        next_attempt_at = ?,
        locked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [String(message || 'Retry scheduled'), nextAttemptAt, row.id]
  );
}

async function disablePushToken(pushTokenId) {
  await runAsync(
    `
    UPDATE push_tokens
    SET enabled = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [pushTokenId]
  );
}

function buildExpoMessage(row) {
  return {
    to: row.token,
    sound: 'default',
    title: row.title || '글숲 알림',
    body: row.body || '새로운 활동이 있습니다.',
    data: safeJsonParse(row.payload_json),
  };
}

async function applyTicketResult(row, ticket, options, summary) {
  if (ticket?.status === 'ok') {
    await markSent(row, ticket);
    summary.sent += 1;
    return;
  }

  const errorCode = ticket?.details?.error || null;
  const message = ticket?.message || errorCode || 'Expo push delivery failed';

  if (shouldDisableToken(errorCode)) {
    await disablePushToken(row.push_token_id);
    await markSkipped(row, message);
    summary.skipped += 1;
    return;
  }

  if (isPermanentExpoError(errorCode) || row.attempt_count + 1 >= options.maxAttempts) {
    await markFailed(row, message);
    summary.failed += 1;
    return;
  }

  await markRetry(row, message, options.retryBaseMs);
  summary.retried += 1;
}

async function dispatchPushBatch(input = {}) {
  const options = {
    batchSize: clampInt(input.batchSize ?? process.env.PUSH_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, MAX_EXPO_BATCH_SIZE),
    lockTimeoutMinutes: clampInt(
      input.lockTimeoutMinutes ?? process.env.PUSH_LOCK_TIMEOUT_MINUTES,
      DEFAULT_LOCK_TIMEOUT_MINUTES,
      1,
      60
    ),
    maxAttempts: clampInt(input.maxAttempts ?? process.env.PUSH_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 20),
    retryBaseMs: clampInt(input.retryBaseMs ?? process.env.PUSH_RETRY_BASE_MS, DEFAULT_RETRY_BASE_MS, 1000, 3600000),
    fetchImpl: input.fetchImpl || global.fetch,
  };

  const summary = { processed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };
  if (typeof options.fetchImpl !== 'function') {
    throw new Error('Push dispatcher requires fetch support.');
  }

  const candidates = await selectReadyDeliveries(options);
  const rows = [];
  for (const row of candidates) {
    if (await lockDelivery(row)) {
      rows.push(row);
    }
  }
  if (rows.length === 0) return summary;

  summary.processed = rows.length;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  let response;
  try {
    response = await options.fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(rows.map(buildExpoMessage)),
    });
  } catch (error) {
    for (const row of rows) {
      await markRetry(row, error?.message || 'Expo push network error', options.retryBaseMs);
      summary.retried += 1;
    }
    return summary;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !Array.isArray(payload?.data)) {
    const message = payload?.errors?.[0]?.message || `Expo push HTTP ${response.status || 'error'}`;
    for (const row of rows) {
      if (row.attempt_count + 1 >= options.maxAttempts) {
        await markFailed(row, message);
        summary.failed += 1;
      } else {
        await markRetry(row, message, options.retryBaseMs);
        summary.retried += 1;
      }
    }
    return summary;
  }

  for (let index = 0; index < rows.length; index += 1) {
    await applyTicketResult(rows[index], payload.data[index], options, summary);
  }

  return summary;
}

function startPushDispatcher(input = {}) {
  const intervalMs = clampInt(
    input.intervalMs ?? process.env.PUSH_DISPATCH_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
    1000,
    300000
  );

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await dispatchPushBatch(input);
      if (summary.processed > 0) {
        console.log('[push/dispatcher] summary:', summary);
      }
    } catch (error) {
      console.error('[push/dispatcher] failed:', error);
    } finally {
      running = false;
    }
  };

  tick();
  return setInterval(tick, intervalMs);
}

function stopPushDispatcher(handle) {
  if (handle) clearInterval(handle);
}

module.exports = {
  dispatchPushBatch,
  startPushDispatcher,
  stopPushDispatcher,
};
