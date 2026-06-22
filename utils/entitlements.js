const db = require('../db');

const ACTIVE_STATUS_SQL = `
  status = 'active'
  AND (starts_at IS NULL OR datetime(starts_at) <= datetime('now'))
  AND (ends_at IS NULL OR datetime(ends_at) > datetime('now'))
`;

const allAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) return reject(error);
      resolve(rows || []);
    });
  });

const getAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) return reject(error);
      resolve(row || null);
    });
  });

function normalizeEntitlementKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeEntitlementKeys(values) {
  const source = Array.isArray(values) ? values : [values];
  return source
    .map(normalizeEntitlementKey)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

function buildCandidatesSql({ withKeyFilter = false } = {}) {
  const keyFilter = withKeyFilter ? 'AND entitlement_key = ?' : '';
  return `
    SELECT
      entitlement_key,
      status,
      'iap' AS source,
      starts_at,
      ends_at,
      created_at,
      updated_at,
      CASE WHEN ${ACTIVE_STATUS_SQL} THEN 1 ELSE 0 END AS is_effectively_active,
      1 AS source_priority
    FROM user_entitlements
    WHERE user_id = ?
      AND source = 'iap'
      ${keyFilter}

    UNION ALL

    SELECT
      entitlement_key,
      status,
      source,
      starts_at,
      ends_at,
      created_at,
      updated_at,
      CASE WHEN ${ACTIVE_STATUS_SQL} THEN 1 ELSE 0 END AS is_effectively_active,
      CASE source WHEN 'admin' THEN 3 WHEN 'promo' THEN 2 ELSE 0 END AS source_priority
    FROM user_entitlement_grants
    WHERE user_id = ?
      ${keyFilter}
  `;
}

async function listEffectiveEntitlements(userId) {
  return allAsync(
    `
      WITH candidates AS (
        ${buildCandidatesSql()}
      ), ranked AS (
        SELECT
          entitlement_key,
          CASE WHEN is_effectively_active = 1 THEN 'active' ELSE 'inactive' END AS status,
          source,
          starts_at,
          ends_at,
          ROW_NUMBER() OVER (
            PARTITION BY entitlement_key
            ORDER BY
              is_effectively_active DESC,
              source_priority DESC,
              datetime(COALESCE(updated_at, created_at, '1970-01-01')) DESC
          ) AS row_number
        FROM candidates
      )
      SELECT entitlement_key, status, source, starts_at, ends_at
      FROM ranked
      WHERE row_number = 1
      ORDER BY entitlement_key ASC
    `,
    [userId, userId]
  );
}

async function getEffectiveEntitlement(userId, entitlementKey) {
  const normalizedKey = normalizeEntitlementKey(entitlementKey);
  if (!normalizedKey) return null;

  return getAsync(
    `
      WITH candidates AS (
        ${buildCandidatesSql({ withKeyFilter: true })}
      )
      SELECT
        entitlement_key,
        CASE WHEN is_effectively_active = 1 THEN 'active' ELSE 'inactive' END AS status,
        source,
        starts_at,
        ends_at
      FROM candidates
      ORDER BY
        is_effectively_active DESC,
        source_priority DESC,
        datetime(COALESCE(updated_at, created_at, '1970-01-01')) DESC
      LIMIT 1
    `,
    [userId, normalizedKey, userId, normalizedKey]
  );
}

async function hasActiveEntitlement(userId, entitlementKey) {
  const entitlement = await getEffectiveEntitlement(userId, entitlementKey);
  return entitlement?.status === 'active';
}

async function hasAnyActiveEntitlement(userId, entitlementKeys) {
  const keys = normalizeEntitlementKeys(entitlementKeys);
  if (!userId || keys.length === 0) return false;

  const placeholders = keys.map(() => '?').join(', ');
  const row = await getAsync(
    `
      SELECT 1 AS present
      FROM (
        SELECT entitlement_key, status, starts_at, ends_at
        FROM user_entitlements
        WHERE user_id = ? AND source = 'iap'

        UNION ALL

        SELECT entitlement_key, status, starts_at, ends_at
        FROM user_entitlement_grants
        WHERE user_id = ?
      ) candidates
      WHERE entitlement_key IN (${placeholders})
        AND ${ACTIVE_STATUS_SQL}
      LIMIT 1
    `,
    [userId, userId, ...keys]
  );
  return Boolean(row?.present);
}

async function listActiveEntitlementKeys(userId) {
  const rows = await allAsync(
    `
      SELECT DISTINCT entitlement_key
      FROM (
        SELECT entitlement_key, status, starts_at, ends_at
        FROM user_entitlements
        WHERE user_id = ? AND source = 'iap'

        UNION ALL

        SELECT entitlement_key, status, starts_at, ends_at
        FROM user_entitlement_grants
        WHERE user_id = ?
      ) candidates
      WHERE ${ACTIVE_STATUS_SQL}
      ORDER BY entitlement_key ASC
    `,
    [userId, userId]
  );
  return rows.map((row) => row.entitlement_key).filter(Boolean);
}

module.exports = {
  getEffectiveEntitlement,
  hasActiveEntitlement,
  hasAnyActiveEntitlement,
  listActiveEntitlementKeys,
  listEffectiveEntitlements,
};
