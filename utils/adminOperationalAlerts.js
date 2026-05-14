const { ACTIVITY_TYPES, createActivityEvent } = require('./activityEvents');
const { allAsync, getAsync, runAsync } = require('./questService');

const ALLOWED_DOMAINS = new Set(['growth', 'campaign', 'notifications', 'monetization', 'system']);
const ALLOWED_LEVELS = new Set(['info', 'warn', 'error']);
const ALLOWED_STATUSES = new Set(['open', 'resolved']);

function normalizeText(value, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeDomain(value) {
  const normalized = normalizeText(value, 40)?.toLowerCase();
  return ALLOWED_DOMAINS.has(normalized) ? normalized : 'system';
}

function normalizeLevel(value) {
  const normalized = normalizeText(value, 20)?.toLowerCase();
  return ALLOWED_LEVELS.has(normalized) ? normalized : 'info';
}

function normalizeStatus(value, level) {
  const normalized = normalizeText(value, 20)?.toLowerCase();
  if (ALLOWED_STATUSES.has(normalized)) return normalized;
  return level === 'info' ? 'resolved' : 'open';
}

function serializeContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  try {
    return JSON.stringify(context);
  } catch {
    return null;
  }
}

function parseContext(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mapOperationalAlert(row) {
  if (!row) return null;
  return {
    id: row.id,
    domain: row.domain,
    level: row.level,
    code: row.code,
    title: row.title,
    message: row.message || null,
    context: parseContext(row.context_json),
    status: row.status,
    dedupe_key: row.dedupe_key || null,
    created_by_admin_id: row.created_by_admin_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at || null,
    resolved_at: row.resolved_at || null,
    resolved_by_admin_id: row.resolved_by_admin_id || null,
  };
}

async function fetchAdminUsers() {
  return allAsync(
    `
    SELECT id
    FROM users
    WHERE COALESCE(is_admin, 0) = 1
      AND COALESCE(is_verified, 0) = 1
      AND COALESCE(account_status, 'active') = 'active'
    ORDER BY id ASC
    `
  );
}

async function notifyAdmins(alert) {
  if (!alert?.id) return { notified: 0 };
  const admins = await fetchAdminUsers();
  let notified = 0;

  for (const admin of admins) {
    const activity = await createActivityEvent({
      recipientUserId: admin.id,
      eventType: ACTIVITY_TYPES.SYSTEM,
      title: `[운영] ${alert.title}`,
      body: alert.message || alert.title,
      meta: {
        notification_type: 'admin_operational_alert',
        alert_id: alert.id,
        domain: alert.domain,
        level: alert.level,
        code: alert.code,
        target_path: '/notifications',
      },
    });
    if (activity?.id) notified += 1;
  }

  return { notified };
}

async function createAdminOperationalAlert(input = {}) {
  const domain = normalizeDomain(input.domain);
  const level = normalizeLevel(input.level);
  const code = normalizeText(input.code, 80);
  const title = normalizeText(input.title, 160);
  const message = normalizeText(input.message, 800);
  const status = normalizeStatus(input.status, level);
  const dedupeKey = normalizeText(input.dedupeKey || input.dedupe_key, 220);
  const contextJson = serializeContext(input.context);
  const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
  const createdByAdminId = Number.isFinite(Number(input.createdByAdminId))
    ? Number(input.createdByAdminId)
    : null;

  if (!code || !title) {
    throw new Error('admin operational alert requires code and title');
  }

  let alertRow;
  if (dedupeKey) {
    await runAsync(
      `
      INSERT INTO admin_operational_alerts (
        domain,
        level,
        code,
        title,
        message,
        context_json,
        status,
        dedupe_key,
        resolved_at,
        created_by_admin_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        domain = excluded.domain,
        level = excluded.level,
        code = excluded.code,
        title = excluded.title,
        message = excluded.message,
        context_json = excluded.context_json,
        status = excluded.status,
        updated_at = CURRENT_TIMESTAMP,
        resolved_at = CASE
          WHEN excluded.status = 'resolved' THEN COALESCE(admin_operational_alerts.resolved_at, CURRENT_TIMESTAMP)
          ELSE NULL
        END,
        resolved_by_admin_id = NULL
      `,
      [
        domain,
        level,
        code,
        title,
        message,
        contextJson,
        status,
        dedupeKey,
        resolvedAt,
        createdByAdminId,
      ]
    );
    alertRow = await getAsync(
      'SELECT * FROM admin_operational_alerts WHERE dedupe_key = ? LIMIT 1',
      [dedupeKey]
    );
  } else {
    const result = await runAsync(
      `
      INSERT INTO admin_operational_alerts (
        domain,
        level,
        code,
        title,
        message,
        context_json,
        status,
        resolved_at,
        created_by_admin_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [domain, level, code, title, message, contextJson, status, resolvedAt, createdByAdminId]
    );
    alertRow = await getAsync(
      'SELECT * FROM admin_operational_alerts WHERE id = ? LIMIT 1',
      [result.lastID]
    );
  }

  const alert = mapOperationalAlert(alertRow);
  if (input.notifyAdmins || level === 'warn' || level === 'error') {
    await notifyAdmins(alert).catch((error) => {
      console.error('[admin-operational-alerts] admin notification failed:', error);
    });
  }

  return alert;
}

module.exports = {
  createAdminOperationalAlert,
  mapOperationalAlert,
  parseContext,
};
