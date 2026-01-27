const db = require('../db');

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

async function resolvePendingExpiryWhere(maxAgeHours = 24) {
  // Legacy DBs may have `expires_at`; newer schemas may only have `created_at`.
  // We pick the safest available predicate.
  const cols = await dbAll("PRAGMA table_info('pending_signups')");
  const names = new Set(cols.map((c) => c.name));

  if (names.has('expires_at')) {
    return { whereSql: "expires_at < datetime('now')", params: [] };
  }

  // Fallback: treat rows older than maxAgeHours as expired.
  // Works with the current migration baseline schema (created_at default CURRENT_TIMESTAMP).
  if (names.has('created_at')) {
    return {
      whereSql: "created_at < datetime('now', ?)",
      params: [`-${maxAgeHours} hours`],
    };
  }

  // Last resort: do nothing safely.
  return { whereSql: '1=0', params: [] };
}

async function cleanupExpiredPending({ maxAgeHours = 24 } = {}) {
  const { whereSql, params } = await resolvePendingExpiryWhere(maxAgeHours);

  // Child-first deletes make this resilient even if legacy schemas lack ON DELETE CASCADE.
  await dbRun(
    `DELETE FROM pending_otp_verifications
     WHERE pending_id IN (
       SELECT id FROM pending_signups WHERE ${whereSql}
     )`,
    params
  );

  await dbRun(`DELETE FROM pending_signups WHERE ${whereSql}`, params);
}

module.exports = { cleanupExpiredPending };
