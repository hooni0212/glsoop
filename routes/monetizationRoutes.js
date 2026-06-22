const crypto = require('node:crypto');
const express = require('express');

const db = require('../db');
const { authRequired } = require('../middleware/auth');
const {
  mergeMonetizationRawJson,
  reconcileMonetizationState,
} = require('../utils/monetizationState');
const { listEffectiveEntitlements } = require('../utils/entitlements');
const {
  PurchaseVerificationError,
  resolveVerifyDecision,
} = require('../utils/purchaseVerification');

const router = express.Router();

const ALLOWED_PLATFORMS = new Set(['apple', 'google', 'web']);
const ALLOWED_PURCHASE_STATUSES = new Set([
  'active',
  'expired',
  'refunded',
  'canceled',
  'pending',
]);

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

function sendMonetizationError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function normalizeString(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizeStringValue(value, maxLength = 200) {
  if (value === null || value === undefined) return null;
  return normalizeString(String(value), maxLength);
}

function normalizeEnvironment(value) {
  const normalized = normalizeStringValue(value, 40)?.toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'prod') return 'production';
  if (normalized === 'testflight') return 'sandbox';
  return normalized;
}

function normalizePlatform(value) {
  const normalized = normalizeString(value, 20)?.toLowerCase();
  if (!normalized || !ALLOWED_PLATFORMS.has(normalized)) return null;
  return normalized;
}

function parseMetaJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function serializeRawPayload(payload) {
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return null;
  }
}

function uuidFromHex(hex) {
  const normalized = String(hex || '').replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32);
  const bytes = normalized.match(/.{1,2}/g)?.map((part) => Number.parseInt(part, 16)) || [];
  if (bytes.length !== 16 || bytes.some((byte) => !Number.isFinite(byte))) {
    return null;
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const nextHex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    nextHex.slice(0, 8),
    nextHex.slice(8, 12),
    nextHex.slice(12, 16),
    nextHex.slice(16, 20),
    nextHex.slice(20, 32),
  ].join('-');
}

function buildAppAccountToken(userId) {
  const secret =
    normalizeString(process.env.MONETIZATION_APP_ACCOUNT_TOKEN_SECRET, 500) ||
    normalizeString(process.env.JWT_SECRET, 500) ||
    'glsoop-local-iap-account-token';
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`glsoop:iap:account:${userId}`)
    .digest('hex');
  return uuidFromHex(digest);
}

function parseVerifyPayload(body = {}) {
  const platform = normalizePlatform(body.platform);
  if (!platform) {
    return { error: 'platform은 apple, google, web 중 하나여야 합니다.' };
  }

  const storeSku = normalizeString(body.store_sku, 120);
  if (!storeSku) {
    return { error: 'store_sku는 필수입니다.' };
  }

  const transactionId = normalizeString(body.transaction_id, 255);
  const purchaseTokenInput = normalizeString(body.purchase_token, 400);
  const receiptData = normalizeString(body.receipt_data, 120000);

  let purchaseToken = purchaseTokenInput;
  if (!purchaseToken && platform === 'google') {
    purchaseToken = receiptData;
  }

  if (platform === 'apple' && !transactionId) {
    return { error: 'apple 결제는 transaction_id가 필요합니다.' };
  }

  if (platform === 'google' && !purchaseToken) {
    return { error: 'google 결제는 purchase_token(또는 receipt_data)이 필요합니다.' };
  }

  const clientMeta =
    body.client_meta && typeof body.client_meta === 'object' ? body.client_meta : null;
  const originalTransactionId =
    normalizeStringValue(body.original_transaction_id, 255) ||
    normalizeStringValue(clientMeta?.original_transaction_id, 255) ||
    normalizeStringValue(clientMeta?.originalTransactionId, 255) ||
    normalizeStringValue(clientMeta?.originalTransactionIdentifierIOS, 255);
  const appAccountToken =
    normalizeStringValue(body.app_account_token, 255) ||
    normalizeStringValue(body.appAccountToken, 255) ||
    normalizeStringValue(clientMeta?.app_account_token, 255) ||
    normalizeStringValue(clientMeta?.appAccountToken, 255);
  const environment = normalizeEnvironment(
    body.environment || clientMeta?.environment || clientMeta?.environmentIOS
  );
  const webOrderLineItemId =
    normalizeStringValue(body.web_order_line_item_id, 255) ||
    normalizeStringValue(body.webOrderLineItemId, 255) ||
    normalizeStringValue(clientMeta?.web_order_line_item_id, 255) ||
    normalizeStringValue(clientMeta?.webOrderLineItemId, 255);

  return {
    platform,
    store_sku: storeSku,
    transaction_id: transactionId,
    purchase_token: purchaseToken,
    receipt_data: receiptData,
    client_meta: clientMeta,
    original_transaction_id: originalTransactionId,
    app_account_token: appAccountToken,
    environment,
    web_order_line_item_id: webOrderLineItemId,
  };
}

function mapPurchaseRow(row) {
  if (!row) return null;
  return {
    platform: row.platform,
    store_sku: row.store_sku,
    status: row.status,
    purchased_at: row.purchased_at,
    expires_at: row.expires_at || null,
    ownership_id: row.ownership_id || null,
  };
}

function mapEntitlementRow(row) {
  if (!row) return null;
  return {
    entitlement_key: row.entitlement_key,
    status: row.status,
    starts_at: row.starts_at || null,
    ends_at: row.ends_at || null,
    source: row.source,
  };
}

async function findPurchaseByIdentifier(platform, transactionId, purchaseToken) {
  if (transactionId) {
    const byTransaction = await dbGet(
      `
      SELECT
        id,
        user_id,
        platform,
        store_sku,
        status,
        purchased_at,
        expires_at,
        original_transaction_id,
        app_account_token,
        environment,
        web_order_line_item_id,
        ownership_id,
        raw_json
      FROM purchases
      WHERE platform = ? AND transaction_id = ?
      LIMIT 1
      `,
      [platform, transactionId]
    );
    if (byTransaction) return byTransaction;
  }

  if (purchaseToken) {
    return dbGet(
      `
      SELECT
        id,
        user_id,
        platform,
        store_sku,
        status,
        purchased_at,
        expires_at,
        original_transaction_id,
        app_account_token,
        environment,
        web_order_line_item_id,
        ownership_id,
        raw_json
      FROM purchases
      WHERE platform = ? AND purchase_token = ?
      LIMIT 1
      `,
      [platform, purchaseToken]
    );
  }

  return null;
}

function isSubscriptionProduct(product) {
  return String(product?.product_type || '').toLowerCase() === 'subscription';
}

function resolveSubscriptionIdentity(parsed, verifyDecision, product) {
  if (!isSubscriptionProduct(product)) return null;

  return {
    platform: parsed.platform,
    store_sku: parsed.store_sku,
    environment: normalizeEnvironment(verifyDecision.environment || parsed.environment),
    original_transaction_id:
      normalizeStringValue(verifyDecision.original_transaction_id, 255) ||
      parsed.original_transaction_id ||
      parsed.transaction_id ||
      parsed.purchase_token,
    app_account_token:
      normalizeStringValue(verifyDecision.app_account_token, 255) ||
      parsed.app_account_token,
    web_order_line_item_id:
      normalizeStringValue(verifyDecision.web_order_line_item_id, 255) ||
      parsed.web_order_line_item_id,
    latest_transaction_id:
      normalizeStringValue(verifyDecision.transaction_id, 255) ||
      parsed.transaction_id ||
      null,
  };
}

async function findSubscriptionOwnership(identity) {
  if (!identity?.original_transaction_id) return null;

  return dbGet(
    `
    SELECT
      id,
      user_id,
      platform,
      store_sku,
      environment,
      original_transaction_id,
      app_account_token,
      status,
      first_transaction_id,
      latest_transaction_id,
      expires_at,
      raw_json
    FROM subscription_ownerships
    WHERE platform = ?
      AND environment = ?
      AND store_sku = ?
      AND original_transaction_id = ?
    LIMIT 1
    `,
    [
      identity.platform,
      identity.environment,
      identity.store_sku,
      identity.original_transaction_id,
    ]
  );
}

async function upsertSubscriptionOwnership({
  userId,
  identity,
  purchaseStatus,
  expiresAt,
  purchaseId,
  verifyDecision,
}) {
  if (!identity?.original_transaction_id) return null;

  const existing = await findSubscriptionOwnership(identity);
  const ownershipRawJson = mergeMonetizationRawJson(existing?.raw_json, {
    source: 'purchases/verify',
    purchase_id: purchaseId || null,
    verification_mode: verifyDecision.verify_mode,
    purchase_status: purchaseStatus,
    latest_transaction_id: identity.latest_transaction_id || null,
    web_order_line_item_id: identity.web_order_line_item_id || null,
    verification: verifyDecision.verification || null,
  });

  await dbRun(
    `
    INSERT INTO subscription_ownerships (
      user_id,
      platform,
      store_sku,
      environment,
      original_transaction_id,
      app_account_token,
      status,
      first_transaction_id,
      latest_transaction_id,
      expires_at,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, environment, store_sku, original_transaction_id)
    DO UPDATE SET
      user_id = excluded.user_id,
      app_account_token = COALESCE(excluded.app_account_token, subscription_ownerships.app_account_token),
      status = CASE
        WHEN subscription_ownerships.status = 'active' AND excluded.status = 'pending'
          THEN subscription_ownerships.status
        ELSE excluded.status
      END,
      latest_transaction_id = COALESCE(excluded.latest_transaction_id, subscription_ownerships.latest_transaction_id),
      expires_at = CASE
        WHEN subscription_ownerships.status = 'active' AND excluded.status = 'pending'
          THEN subscription_ownerships.expires_at
        ELSE excluded.expires_at
      END,
      raw_json = excluded.raw_json,
      updated_at = CURRENT_TIMESTAMP
    WHERE subscription_ownerships.user_id = excluded.user_id
    `,
    [
      userId,
      identity.platform,
      identity.store_sku,
      identity.environment,
      identity.original_transaction_id,
      identity.app_account_token,
      purchaseStatus,
      identity.latest_transaction_id,
      identity.latest_transaction_id,
      expiresAt,
      ownershipRawJson,
    ]
  );

  const latestOwnership = await findSubscriptionOwnership(identity);
  if (latestOwnership && latestOwnership.user_id !== userId) {
    const error = new Error('subscription ownership belongs to another account');
    error.code = 'SUBSCRIPTION_OWNED_BY_OTHER_ACCOUNT';
    throw error;
  }
  return latestOwnership;
}

async function attachOwnershipToPurchase({ purchaseId, identity, ownershipId }) {
  if (!purchaseId || !identity) return;

  await dbRun(
    `
    UPDATE purchases
    SET
      original_transaction_id = COALESCE(?, original_transaction_id),
      app_account_token = COALESCE(?, app_account_token),
      environment = ?,
      web_order_line_item_id = COALESCE(?, web_order_line_item_id),
      ownership_id = COALESCE(?, ownership_id)
    WHERE id = ?
    `,
    [
      identity.original_transaction_id || null,
      identity.app_account_token || null,
      identity.environment || 'unknown',
      identity.web_order_line_item_id || null,
      ownershipId || null,
      purchaseId,
    ]
  );
}

router.get('/store/catalog', async (req, res) => {
  try {
    const products = await dbAll(
      `
      SELECT
        platform,
        store_sku,
        product_type,
        entitlement_key,
        title,
        description,
        season,
        is_active,
        meta_json
      FROM products
      WHERE is_active = 1
      ORDER BY
        (season IS NULL) ASC,
        season DESC,
        platform ASC,
        id ASC
      `
    );

    return res.json({
      ok: true,
      message: '스토어 카탈로그를 불러왔습니다.',
      products: products.map((row) => ({
        store_sku: row.store_sku,
        platform: row.platform,
        product_type: row.product_type,
        entitlement_key: row.entitlement_key,
        title: row.title || null,
        description: row.description || null,
        season: row.season || null,
        is_active: Number(row.is_active || 0),
        meta: parseMetaJson(row.meta_json),
      })),
    });
  } catch (error) {
    console.error('[store/catalog] failed:', error);
    return sendMonetizationError(
      res,
      500,
      'INTERNAL_ERROR',
      '스토어 카탈로그 조회 중 오류가 발생했습니다.'
    );
  }
});

router.get('/entitlements/me', authRequired, async (req, res) => {
  try {
    await reconcileMonetizationState({ userId: req.user.id });
    const rows = await listEffectiveEntitlements(req.user.id);

    return res.json({
      ok: true,
      message: '권한 정보를 불러왔습니다.',
      entitlements: rows.map(mapEntitlementRow),
    });
  } catch (error) {
    console.error('[entitlements/me] failed:', error);
    return sendMonetizationError(
      res,
      500,
      'INTERNAL_ERROR',
      '권한 조회 중 오류가 발생했습니다.'
    );
  }
});

router.get('/iap/account-token', authRequired, async (req, res) => {
  const token = buildAppAccountToken(req.user.id);
  if (!token) {
    return sendMonetizationError(
      res,
      500,
      'INTERNAL_ERROR',
      '앱 계정 토큰 생성 중 오류가 발생했습니다.'
    );
  }

  return res.json({
    ok: true,
    app_account_token: token,
  });
});

router.post('/purchases/verify', authRequired, async (req, res) => {
  const parsed = parseVerifyPayload(req.body || {});
  if (parsed.error) {
    return sendMonetizationError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  const userId = req.user.id;

  try {
    const product = await dbGet(
      `
      SELECT
        platform,
        store_sku,
        product_type,
        entitlement_key
      FROM products
      WHERE platform = ? AND store_sku = ? AND is_active = 1
      LIMIT 1
      `,
      [parsed.platform, parsed.store_sku]
    );

    if (!product) {
      return sendMonetizationError(
        res,
        404,
        'RESOURCE_NOT_FOUND',
        '해당 스토어 상품을 찾을 수 없습니다.'
      );
    }

    const verifyDecision = await resolveVerifyDecision(parsed, {
      product_type: product.product_type,
      entitlement_key: product.entitlement_key,
    });
    if (!ALLOWED_PURCHASE_STATUSES.has(verifyDecision.purchase_status)) {
      throw new PurchaseVerificationError({
        code: 'VERIFICATION_FAILED',
        status: 502,
        message: '결제 검증 결과의 상태값이 유효하지 않습니다.',
      });
    }

    const subscriptionIdentity = resolveSubscriptionIdentity(
      parsed,
      verifyDecision,
      product
    );
    let existingOwnership = null;
    if (subscriptionIdentity) {
      if (!subscriptionIdentity.original_transaction_id) {
        return sendMonetizationError(
          res,
          400,
          'SUBSCRIPTION_IDENTITY_REQUIRED',
          '구독 결제의 원거래 식별자를 확인하지 못했습니다.'
        );
      }

      existingOwnership = await findSubscriptionOwnership(subscriptionIdentity);
      if (existingOwnership && existingOwnership.user_id !== userId) {
        return sendMonetizationError(
          res,
          409,
          'SUBSCRIPTION_OWNED_BY_OTHER_ACCOUNT',
          '이 Apple 구독은 이미 다른 글숲 계정에 연결되어 있습니다. 해당 계정으로 로그인하거나 Apple 구독 관리에서 상태를 확인해주세요.'
        );
      }
    }

    const existingPurchase = await findPurchaseByIdentifier(
      parsed.platform,
      parsed.transaction_id,
      parsed.purchase_token
    );

    if (existingPurchase) {
      if (existingPurchase.user_id !== userId) {
        return sendMonetizationError(
          res,
          409,
          'CONFLICT',
          '이미 다른 계정에서 처리된 결제입니다.'
        );
      }

      let didUpdateExistingPurchase = false;
      if (
        existingPurchase.status === 'pending' &&
        verifyDecision.purchase_status !== 'pending'
      ) {
        const nextExpiresAt =
          verifyDecision.expires_at || existingPurchase.expires_at || null;
        const promotedRawJson = mergeMonetizationRawJson(
          existingPurchase.raw_json,
          {
            verification_mode: verifyDecision.verify_mode,
            promoted_by: 'purchases/verify',
            promoted_at: new Date().toISOString(),
            verification: verifyDecision.verification || null,
          }
        );

        const updateResult = await dbRun(
          `
          UPDATE purchases
          SET
            status = ?,
            expires_at = ?,
            original_transaction_id = COALESCE(?, original_transaction_id),
            app_account_token = COALESCE(?, app_account_token),
            environment = ?,
            web_order_line_item_id = COALESCE(?, web_order_line_item_id),
            raw_json = ?
          WHERE id = ?
          `,
          [
            verifyDecision.purchase_status,
            nextExpiresAt,
            subscriptionIdentity?.original_transaction_id || null,
            subscriptionIdentity?.app_account_token || null,
            subscriptionIdentity?.environment || parsed.environment || 'unknown',
            subscriptionIdentity?.web_order_line_item_id || null,
            promotedRawJson,
            existingPurchase.id,
          ]
        );
        didUpdateExistingPurchase = Number(updateResult?.changes || 0) > 0;
      }

      let ownership = existingOwnership;
      if (subscriptionIdentity) {
        ownership = await upsertSubscriptionOwnership({
          userId,
          identity: subscriptionIdentity,
          purchaseStatus: verifyDecision.purchase_status,
          expiresAt: verifyDecision.expires_at || existingPurchase.expires_at || null,
          purchaseId: existingPurchase.id,
          verifyDecision,
        });
        await attachOwnershipToPurchase({
          purchaseId: existingPurchase.id,
          identity: subscriptionIdentity,
          ownershipId: ownership?.id || null,
        });
      }

      await reconcileMonetizationState({ userId });

      const latestPurchase = await findPurchaseByIdentifier(
        parsed.platform,
        parsed.transaction_id,
        parsed.purchase_token
      );

      const existingEntitlement = await dbGet(
        `
        SELECT entitlement_key, status, starts_at, ends_at, source
        FROM user_entitlements
        WHERE user_id = ? AND entitlement_key = ?
        LIMIT 1
        `,
        [userId, product.entitlement_key]
      );

      return res.json({
        ok: true,
        message: didUpdateExistingPurchase
          ? verifyDecision.success_message
          : '이미 처리된 결제입니다.',
        purchase: mapPurchaseRow(latestPurchase || existingPurchase),
        entitlements: existingEntitlement
          ? [mapEntitlementRow(existingEntitlement)]
          : [],
      });
    }

    const purchasedAtIso = verifyDecision.purchased_at || new Date().toISOString();
    const expiresAtIso = verifyDecision.expires_at || null;
    const rawJson = mergeMonetizationRawJson(null, {
      receipt_data: parsed.receipt_data || null,
      client_meta: parsed.client_meta || null,
      verification_mode: verifyDecision.verify_mode,
      submitted_at: purchasedAtIso,
      purchase_status: verifyDecision.purchase_status,
      subscription_identity: subscriptionIdentity || null,
      verification: verifyDecision.verification || null,
    });

    let purchaseId = null;
    let ownershipId = null;
    await dbRun('BEGIN IMMEDIATE');
    try {
      const insertPurchase = await dbRun(
        `
        INSERT INTO purchases (
          user_id,
          platform,
          store_sku,
          transaction_id,
          purchase_token,
          status,
          purchased_at,
          expires_at,
          original_transaction_id,
          app_account_token,
          environment,
          web_order_line_item_id,
          raw_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          userId,
          parsed.platform,
          parsed.store_sku,
          parsed.transaction_id,
          parsed.purchase_token,
          verifyDecision.purchase_status,
          purchasedAtIso,
          expiresAtIso,
          subscriptionIdentity?.original_transaction_id || null,
          subscriptionIdentity?.app_account_token || null,
          subscriptionIdentity?.environment || parsed.environment || 'unknown',
          subscriptionIdentity?.web_order_line_item_id || null,
          rawJson,
        ]
      );
      purchaseId = insertPurchase.lastID;

      if (subscriptionIdentity) {
        const ownership = await upsertSubscriptionOwnership({
          userId,
          identity: subscriptionIdentity,
          purchaseStatus: verifyDecision.purchase_status,
          expiresAt: expiresAtIso,
          purchaseId,
          verifyDecision,
        });
        ownershipId = ownership?.id || null;
        await attachOwnershipToPurchase({
          purchaseId,
          identity: subscriptionIdentity,
          ownershipId,
        });
      }

      const entitlementMeta = serializeRawPayload({
        source: 'iap',
        verification_mode: verifyDecision.verify_mode,
        purchase_id: purchaseId,
        ownership_id: ownershipId,
        store_sku: parsed.store_sku,
        platform: parsed.platform,
      });

      await dbRun(
        `
        INSERT OR IGNORE INTO user_entitlements (
          user_id,
          entitlement_key,
          status,
          source,
          starts_at,
          ends_at,
          meta_json
        )
        VALUES (?, ?, 'inactive', 'iap', CURRENT_TIMESTAMP, NULL, ?)
        `,
        [userId, product.entitlement_key, entitlementMeta]
      );

      await dbRun(
        `
        UPDATE user_entitlements
        SET
          source = 'iap',
          meta_json = COALESCE(?, meta_json),
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND entitlement_key = ?
        `,
        [entitlementMeta, userId, product.entitlement_key]
      );

      await dbRun('COMMIT');
    } catch (error) {
      try {
        await dbRun('ROLLBACK');
      } catch (rollbackError) {
        console.error('[purchases/verify] rollback failed:', rollbackError);
      }
      throw error;
    }

    await reconcileMonetizationState({ userId });

    const [purchaseRow, entitlementRow] = await Promise.all([
      findPurchaseByIdentifier(
        parsed.platform,
        parsed.transaction_id,
        parsed.purchase_token
      ),
      dbGet(
        `
        SELECT entitlement_key, status, starts_at, ends_at, source
        FROM user_entitlements
        WHERE user_id = ? AND entitlement_key = ?
        LIMIT 1
        `,
        [userId, product.entitlement_key]
      ),
    ]);

    return res.json({
      ok: true,
      message: verifyDecision.success_message,
      purchase: mapPurchaseRow(purchaseRow),
      entitlements: entitlementRow ? [mapEntitlementRow(entitlementRow)] : [],
    });
  } catch (error) {
    if (error instanceof PurchaseVerificationError) {
      const safeStatus =
        Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
          ? error.status
          : 502;
      const safeCode =
        typeof error.code === 'string' && error.code.trim()
          ? error.code.trim()
          : 'VERIFICATION_FAILED';
      return sendMonetizationError(
        res,
        safeStatus,
        safeCode,
        error.message || '결제 검증 중 오류가 발생했습니다.'
      );
    }
    if (error?.code === 'SUBSCRIPTION_OWNED_BY_OTHER_ACCOUNT') {
      return sendMonetizationError(
        res,
        409,
        'SUBSCRIPTION_OWNED_BY_OTHER_ACCOUNT',
        '이 Apple 구독은 이미 다른 글숲 계정에 연결되어 있습니다. 해당 계정으로 로그인하거나 Apple 구독 관리에서 상태를 확인해주세요.'
      );
    }
    if (error?.code === 'SQLITE_CONSTRAINT') {
      return sendMonetizationError(
        res,
        409,
        'CONFLICT',
        '이미 처리된 결제입니다.'
      );
    }
    console.error('[purchases/verify] failed:', error);
    return sendMonetizationError(
      res,
      500,
      'INTERNAL_ERROR',
      '결제 검증 처리 중 오류가 발생했습니다.'
    );
  }
});

module.exports = router;
