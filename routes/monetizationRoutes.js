const express = require('express');

const db = require('../db');
const { authRequired } = require('../middleware/auth');
const {
  mergeMonetizationRawJson,
  reconcileMonetizationState,
} = require('../utils/monetizationState');
const { resolveVerifyDecision } = require('../utils/purchaseVerification');

const router = express.Router();

const ALLOWED_PLATFORMS = new Set(['apple', 'google', 'web']);

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
  const receiptData = normalizeString(body.receipt_data, 8000);

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

  return {
    platform,
    store_sku: storeSku,
    transaction_id: transactionId,
    purchase_token: purchaseToken,
    receipt_data: receiptData,
    client_meta: clientMeta,
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

    const rows = await dbAll(
      `
      SELECT
        entitlement_key,
        status,
        starts_at,
        ends_at,
        source
      FROM user_entitlements
      WHERE user_id = ?
      ORDER BY entitlement_key ASC
      `,
      [req.user.id]
    );

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

router.post('/purchases/verify', authRequired, async (req, res) => {
  const parsed = parseVerifyPayload(req.body || {});
  if (parsed.error) {
    return sendMonetizationError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  const userId = req.user.id;
  const verifyDecision = resolveVerifyDecision(parsed);

  try {
    const product = await dbGet(
      `
      SELECT
        platform,
        store_sku,
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
          SET status = ?, expires_at = ?, raw_json = ?
          WHERE id = ?
          `,
          [
            verifyDecision.purchase_status,
            nextExpiresAt,
            promotedRawJson,
            existingPurchase.id,
          ]
        );
        didUpdateExistingPurchase = Number(updateResult?.changes || 0) > 0;
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
      verification: verifyDecision.verification || null,
    });

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
          raw_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          rawJson,
        ]
      );

      const entitlementMeta = serializeRawPayload({
        source: 'iap',
        verification_mode: verifyDecision.verify_mode,
        purchase_id: insertPurchase.lastID,
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
