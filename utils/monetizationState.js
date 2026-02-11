const db = require('../db');

const ALLOWED_PURCHASE_STATUSES = new Set([
  'active',
  'expired',
  'refunded',
  'canceled',
  'pending',
]);

const ALLOWED_VERIFY_MODES = new Set([
  'pending_only',
  'auto_active',
  'receipt_inspect',
  'live_verify',
]);

const EMPTY_RECONCILE_RESULT = {
  expired_purchases: 0,
  activated_entitlements: 0,
  deactivated_entitlements: 0,
};

const runAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const allAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

function normalizePurchaseStatus(raw) {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  return ALLOWED_PURCHASE_STATUSES.has(normalized) ? normalized : null;
}

function normalizeVerifyMode(raw) {
  if (typeof raw !== 'string') return 'pending_only';
  const normalized = raw.trim().toLowerCase();
  return ALLOWED_VERIFY_MODES.has(normalized) ? normalized : 'pending_only';
}

function safeParseObject(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function mergeMonetizationRawJson(existingRawJson, patch = {}) {
  const base = safeParseObject(existingRawJson);
  const merged = {
    ...base,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  try {
    return JSON.stringify(merged);
  } catch (error) {
    return existingRawJson || null;
  }
}

function isMissingMonetizationTableError(error) {
  const message = String(error?.message || '');
  return (
    message.includes('no such table: purchases') ||
    message.includes('no such table: products') ||
    message.includes('no such table: user_entitlements')
  );
}

function buildUserFilter(column, hasUserFilter) {
  return hasUserFilter ? `AND ${column} = ?` : '';
}

async function reconcileMonetizationState(options = {}) {
  const hasUserFilter = options.userId !== undefined && options.userId !== null;
  const userId = Number(options.userId);
  if (hasUserFilter && (!Number.isInteger(userId) || userId < 1)) {
    throw new Error('userId는 1 이상의 정수여야 합니다.');
  }
  const userParams = hasUserFilter ? [userId] : [];

  await runAsync('BEGIN IMMEDIATE;');
  try {
    const expiredPurchaseResult = await runAsync(
      `
      UPDATE purchases
      SET status = 'expired'
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND datetime(expires_at) <= datetime('now')
        ${buildUserFilter('user_id', hasUserFilter)}
      `,
      userParams
    );

    const activePurchaseRows = await allAsync(
      `
      SELECT
        p.user_id AS user_id,
        pr.entitlement_key AS entitlement_key,
        MIN(p.purchased_at) AS starts_at,
        CASE
          WHEN SUM(CASE WHEN p.expires_at IS NULL THEN 1 ELSE 0 END) > 0 THEN NULL
          ELSE MAX(p.expires_at)
        END AS ends_at
      FROM purchases p
      JOIN products pr
        ON pr.platform = p.platform
       AND pr.store_sku = p.store_sku
      WHERE p.status = 'active'
        AND (p.expires_at IS NULL OR datetime(p.expires_at) > datetime('now'))
        ${buildUserFilter('p.user_id', hasUserFilter)}
      GROUP BY p.user_id, pr.entitlement_key
      `,
      userParams
    );

    let activatedEntitlements = 0;
    for (const row of activePurchaseRows) {
      const result = await runAsync(
        `
        INSERT INTO user_entitlements (
          user_id,
          entitlement_key,
          status,
          source,
          starts_at,
          ends_at,
          meta_json
        )
        VALUES (?, ?, 'active', 'iap', COALESCE(?, CURRENT_TIMESTAMP), ?, NULL)
        ON CONFLICT(user_id, entitlement_key) DO UPDATE SET
          status = 'active',
          source = 'iap',
          starts_at = COALESCE(user_entitlements.starts_at, excluded.starts_at),
          ends_at = excluded.ends_at,
          updated_at = CURRENT_TIMESTAMP
        WHERE
          user_entitlements.status <> 'active'
          OR user_entitlements.source <> 'iap'
          OR COALESCE(user_entitlements.ends_at, '') <> COALESCE(excluded.ends_at, '')
        `,
        [row.user_id, row.entitlement_key, row.starts_at || null, row.ends_at || null]
      );
      if (Number(result?.changes || 0) > 0) {
        activatedEntitlements += 1;
      }
    }

    const deactivatedEntitlementResult = await runAsync(
      `
      UPDATE user_entitlements AS ue
      SET
        status = 'inactive',
        ends_at = COALESCE(ue.ends_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
      WHERE ue.source = 'iap'
        AND ue.status = 'active'
        ${buildUserFilter('ue.user_id', hasUserFilter)}
        AND NOT EXISTS (
          SELECT 1
          FROM purchases p
          JOIN products pr
            ON pr.platform = p.platform
           AND pr.store_sku = p.store_sku
          WHERE p.user_id = ue.user_id
            AND pr.entitlement_key = ue.entitlement_key
            AND p.status = 'active'
            AND (p.expires_at IS NULL OR datetime(p.expires_at) > datetime('now'))
        )
      `,
      userParams
    );

    await runAsync('COMMIT;');

    return {
      expired_purchases: Number(expiredPurchaseResult?.changes || 0),
      activated_entitlements: activatedEntitlements,
      deactivated_entitlements: Number(deactivatedEntitlementResult?.changes || 0),
    };
  } catch (error) {
    try {
      await runAsync('ROLLBACK;');
    } catch (rollbackError) {
      console.error('[monetization/reconcile] rollback failed:', rollbackError);
    }
    if (isMissingMonetizationTableError(error)) {
      return { ...EMPTY_RECONCILE_RESULT };
    }
    throw error;
  }
}

module.exports = {
  mergeMonetizationRawJson,
  normalizePurchaseStatus,
  normalizeVerifyMode,
  reconcileMonetizationState,
};
