const crypto = require('node:crypto');
const express = require('express');

const db = require('../db');
const {
  mergeMonetizationRawJson,
  normalizePurchaseStatus,
  reconcileMonetizationState,
} = require('../utils/monetizationState');

const router = express.Router();

const SUPPORTED_PROVIDERS = new Set(['apple', 'google']);

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

function sendWebhookError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function normalizeString(raw, maxLength = 255) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizeStringValue(raw, maxLength = 255) {
  if (raw === null || raw === undefined) return null;
  return normalizeString(String(raw), maxLength);
}

function normalizeEnvironment(raw) {
  const normalized = normalizeStringValue(raw, 40)?.toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'prod') return 'production';
  if (normalized === 'testflight') return 'sandbox';
  return normalized;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return null;
  }
}

function safeParseJson(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function getByPath(source, path) {
  if (!source || typeof source !== 'object') return undefined;
  const parts = path.split('.');
  let cursor = source;

  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor)) {
      const index = Number.parseInt(part, 10);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
        return undefined;
      }
      cursor = cursor[index];
      continue;
    }
    if (typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function pickFirstValue(source, paths = []) {
  for (const path of paths) {
    const value = getByPath(source, path);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function decodeBase64UrlUtf8(segment) {
  if (typeof segment !== 'string' || !segment) return null;
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = normalized.length % 4;
    const padded =
      padLength === 0 ? normalized : normalized + '='.repeat(4 - padLength);
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch (error) {
    return null;
  }
}

function decodeBase64Utf8(segment) {
  if (typeof segment !== 'string' || !segment) return null;
  try {
    return Buffer.from(segment, 'base64').toString('utf8');
  } catch (error) {
    return null;
  }
}

function tryDecodeJwtPayload(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) return null;
  const payloadJson = decodeBase64UrlUtf8(parts[1]);
  if (!payloadJson) return null;
  return safeParseJson(payloadJson);
}

function toIsoDateTime(raw) {
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const numeric = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : raw;
    const date = new Date(numeric);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      return toIsoDateTime(Number(trimmed));
    }

    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function mapWebhookStatus(raw) {
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return normalizePurchaseStatus(String(raw));
  }

  const normalized = normalizeString(String(raw), 80)?.toLowerCase();
  if (!normalized) return null;

  const direct = normalizePurchaseStatus(normalized);
  if (direct) return direct;

  if (
    [
      'purchased',
      'purchase',
      'renewed',
      'recovered',
      'subscribed',
      'did_renew',
      'didrenew',
      'didchange_renewal_status_on',
    ].includes(normalized)
  ) {
    return 'active';
  }
  if (['expired', 'expire', 'did_fail_to_renew', 'didfailtorenew'].includes(normalized)) {
    return 'expired';
  }
  if (['refunded', 'refund', 'revoked', 'revoke'].includes(normalized)) {
    return 'refunded';
  }
  if (
    ['canceled', 'cancelled', 'cancel', 'did_change_renewal_status_off', 'didchangerenewalstatusoff'].includes(
      normalized
    )
  ) {
    return 'canceled';
  }
  if (['pending', 'deferred', 'on_hold', 'onhold', 'paused', 'grace_period'].includes(normalized)) {
    return 'pending';
  }

  return null;
}

function mapGoogleNotificationTypeToStatus(rawType) {
  const typeNumber = Number.parseInt(String(rawType ?? ''), 10);
  if (!Number.isInteger(typeNumber)) return null;

  switch (typeNumber) {
    case 1:
    case 2:
    case 4:
    case 7:
    case 8:
    case 9:
      return 'active';
    case 3:
      return 'canceled';
    case 5:
    case 6:
    case 10:
    case 11:
      return 'pending';
    case 12:
      return 'refunded';
    case 13:
      return 'expired';
    default:
      return null;
  }
}

function sha256Hex(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function parseGoogleEnvelope(body) {
  if (!body || typeof body !== 'object') return body;
  const encodedData = pickFirstValue(body, ['message.data']);
  if (typeof encodedData !== 'string') return body;

  const decoded = decodeBase64Utf8(encodedData);
  const parsed = decoded ? safeParseJson(decoded) : null;
  if (!parsed) return body;

  return {
    ...body,
    decoded_data: parsed,
  };
}

function parseAppleEnvelope(body) {
  if (!body || typeof body !== 'object') return body;
  const signedTransactionInfo = pickFirstValue(body, [
    'data.signedTransactionInfo',
    'signedTransactionInfo',
  ]);

  if (typeof signedTransactionInfo !== 'string') {
    return body;
  }

  const decodedTransaction = tryDecodeJwtPayload(signedTransactionInfo);
  if (!decodedTransaction) {
    return body;
  }

  return {
    ...body,
    decoded_transaction: decodedTransaction,
  };
}

function deriveWebhookPayload(provider, rawBody) {
  if (!rawBody || typeof rawBody !== 'object') return null;
  if (provider === 'apple') return parseAppleEnvelope(rawBody);
  if (provider === 'google') return parseGoogleEnvelope(rawBody);
  return rawBody;
}

function parseWebhookEvent(provider, rawBody) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return { error: '지원하지 않는 provider입니다.' };
  }

  const payload = deriveWebhookPayload(provider, rawBody);
  if (!payload || typeof payload !== 'object') {
    return { error: 'body는 JSON object여야 합니다.' };
  }

  const payloadJson = safeStringify(payload);
  const eventIdCandidate = normalizeString(
    String(
      pickFirstValue(payload, [
        'notificationUUID',
        'event_id',
        'eventId',
        'id',
        'message.messageId',
        'decoded_data.eventId',
      ]) || ''
    ),
    255
  );

  const eventTypeCandidate = normalizeString(
    String(
      pickFirstValue(payload, [
        'notificationType',
        'event_type',
        'eventType',
        'type',
        'decoded_data.subscriptionNotification.notificationType',
      ]) || ''
    ),
    120
  );

  const transactionId = normalizeString(
    String(
      pickFirstValue(payload, [
        'transaction_id',
        'transactionId',
        'decoded_transaction.transactionId',
      ]) || ''
    ),
    255
  );

  const originalTransactionId = normalizeString(
    String(
      pickFirstValue(payload, [
        'original_transaction_id',
        'originalTransactionId',
        'decoded_transaction.originalTransactionId',
      ]) || ''
    ),
    255
  );

  const appAccountToken = normalizeString(
    String(
      pickFirstValue(payload, [
        'app_account_token',
        'appAccountToken',
        'decoded_transaction.appAccountToken',
      ]) || ''
    ),
    255
  );

  const environment = normalizeEnvironment(
    pickFirstValue(payload, [
      'environment',
      'decoded_transaction.environment',
      'data.environment',
    ])
  );

  const storeSku = normalizeString(
    String(
      pickFirstValue(payload, [
        'store_sku',
        'product_id',
        'productId',
        'decoded_transaction.productId',
        'decoded_data.subscriptionNotification.subscriptionId',
        'decoded_data.oneTimeProductNotification.sku',
      ]) || ''
    ),
    120
  );

  const purchaseToken = normalizeString(
    String(
      pickFirstValue(payload, [
        'purchase_token',
        'purchaseToken',
        'decoded_data.subscriptionNotification.purchaseToken',
        'decoded_data.oneTimeProductNotification.purchaseToken',
      ]) || ''
    ),
    400
  );

  let purchaseStatus = mapWebhookStatus(
    pickFirstValue(payload, [
      'status',
      'purchase_status',
      'decoded_data.purchaseState',
      'decoded_transaction.type',
    ])
  );

  if (!purchaseStatus && provider === 'google') {
    purchaseStatus = mapGoogleNotificationTypeToStatus(
      pickFirstValue(payload, [
        'decoded_data.subscriptionNotification.notificationType',
      ])
    );
  }

  if (!purchaseStatus && provider === 'apple') {
    purchaseStatus = mapWebhookStatus(
      pickFirstValue(payload, ['notificationType', 'subtype'])
    );
  }

  const expiresAt = toIsoDateTime(
    pickFirstValue(payload, [
      'expires_at',
      'expiresAt',
      'expiryTimeMillis',
      'decoded_transaction.expiresDate',
      'decoded_transaction.expiresDateMs',
    ])
  );

  const eventId =
    eventIdCandidate ||
    sha256Hex(`${provider}:${payloadJson || safeStringify(rawBody) || 'unknown'}`);

  return {
    provider,
    event_id: eventId,
    event_type: eventTypeCandidate || null,
    payload_json: payloadJson,
    transaction_id: transactionId || null,
    original_transaction_id: originalTransactionId || null,
    app_account_token: appAccountToken || null,
    environment,
    store_sku: storeSku || null,
    purchase_token: purchaseToken || null,
    purchase_status: purchaseStatus || null,
    expires_at: expiresAt || null,
  };
}

function getExpectedWebhookSecret(provider) {
  if (provider === 'apple') {
    return (
      normalizeString(process.env.MONETIZATION_APPLE_WEBHOOK_SECRET, 300) ||
      normalizeString(process.env.MONETIZATION_WEBHOOK_SECRET, 300)
    );
  }
  if (provider === 'google') {
    return (
      normalizeString(process.env.MONETIZATION_GOOGLE_WEBHOOK_SECRET, 300) ||
      normalizeString(process.env.MONETIZATION_WEBHOOK_SECRET, 300)
    );
  }
  return normalizeString(process.env.MONETIZATION_WEBHOOK_SECRET, 300);
}

function extractWebhookToken(req) {
  const fromHeader = normalizeString(req.get('x-monetization-webhook-secret'), 300);
  if (fromHeader) return fromHeader;

  const authHeader = normalizeString(req.get('authorization'), 500);
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return normalizeString(authHeader.replace(/^Bearer\s+/i, ''), 300);
  }

  return normalizeString(req.query?.token, 300);
}

function timingSafeEqualString(a, b) {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

async function insertMonetizationAlert({ level = 'warn', code, title, message, context }) {
  const contextJson = safeStringify(context || null);
  await dbRun(
    `
    INSERT INTO monetization_alerts (
      level,
      code,
      title,
      message,
      context_json,
      status
    )
    VALUES (?, ?, ?, ?, ?, 'open')
    `,
    [level, code, title, message || null, contextJson]
  );
}

async function fetchPurchaseByIdentifiers(transactionId, purchaseToken) {
  if (transactionId) {
    const row = await dbGet(
      `
      SELECT
        p.id,
        p.user_id,
        p.platform,
        p.store_sku,
        p.ownership_id,
        p.original_transaction_id,
        p.app_account_token,
        p.environment,
        p.status,
        p.expires_at,
        p.raw_json,
        pr.entitlement_key
      FROM purchases p
      LEFT JOIN products pr
        ON pr.platform = p.platform
       AND pr.store_sku = p.store_sku
      WHERE p.transaction_id = ?
      ORDER BY p.id DESC
      LIMIT 1
      `,
      [transactionId]
    );
    if (row) return row;
  }

  if (purchaseToken) {
    return dbGet(
      `
      SELECT
        p.id,
        p.user_id,
        p.platform,
        p.store_sku,
        p.ownership_id,
        p.original_transaction_id,
        p.app_account_token,
        p.environment,
        p.status,
        p.expires_at,
        p.raw_json,
        pr.entitlement_key
      FROM purchases p
      LEFT JOIN products pr
        ON pr.platform = p.platform
       AND pr.store_sku = p.store_sku
      WHERE p.purchase_token = ?
      ORDER BY p.id DESC
      LIMIT 1
      `,
      [purchaseToken]
    );
  }

  return null;
}

async function fetchOwnershipByOriginalTransaction({
  provider,
  originalTransactionId,
  storeSku,
  environment,
}) {
  if (!originalTransactionId) return null;

  const params = [provider, originalTransactionId];
  const storeSkuClause = storeSku ? 'AND so.store_sku = ?' : '';
  if (storeSku) params.push(storeSku);

  const environmentClause =
    environment && environment !== 'unknown'
      ? 'AND so.environment IN (?, ?)'
      : '';
  if (environment && environment !== 'unknown') {
    params.push(environment, 'unknown');
  }

  const ownership = await dbGet(
    `
    SELECT
      so.id,
      so.user_id,
      so.platform,
      so.store_sku,
      so.environment,
      so.original_transaction_id,
      so.app_account_token,
      so.status,
      so.expires_at,
      so.raw_json,
      pr.entitlement_key
    FROM subscription_ownerships so
    LEFT JOIN products pr
      ON pr.platform = so.platform
     AND pr.store_sku = so.store_sku
    WHERE so.platform = ?
      AND so.original_transaction_id = ?
      ${storeSkuClause}
      ${environmentClause}
    ORDER BY
      CASE WHEN so.environment = ? THEN 0 ELSE 1 END,
      so.updated_at DESC,
      so.id DESC
    LIMIT 1
    `,
    [...params, environment || 'unknown']
  );

  if (!ownership) return null;

  const latestPurchase = await dbGet(
    `
    SELECT
      p.id,
      p.user_id,
      p.platform,
      p.store_sku,
      p.ownership_id,
      p.original_transaction_id,
      p.app_account_token,
      p.environment,
      p.status,
      p.expires_at,
      p.raw_json
    FROM purchases p
    WHERE p.ownership_id = ?
    ORDER BY p.id DESC
    LIMIT 1
    `,
    [ownership.id]
  );

  return {
    ...(latestPurchase || {}),
    id: latestPurchase?.id || null,
    user_id: ownership.user_id,
    platform: ownership.platform,
    store_sku: ownership.store_sku,
    ownership_id: ownership.id,
    original_transaction_id: ownership.original_transaction_id,
    app_account_token: ownership.app_account_token,
    environment: ownership.environment,
    status: latestPurchase?.status || ownership.status,
    expires_at: latestPurchase?.expires_at || ownership.expires_at || null,
    raw_json: latestPurchase?.raw_json || ownership.raw_json,
    entitlement_key: ownership.entitlement_key,
    matched_by_ownership: true,
  };
}

async function finalizeWebhookEvent({
  provider,
  eventId,
  processState,
  processMessage,
  purchaseId,
  ownershipId,
  userId,
}) {
  await dbRun(
    `
    UPDATE monetization_webhook_events
    SET
      process_state = ?,
      process_message = ?,
      purchase_id = ?,
      ownership_id = ?,
      user_id = ?,
      processed_at = CURRENT_TIMESTAMP
    WHERE provider = ? AND event_id = ?
    `,
    [
      processState,
      processMessage || null,
      purchaseId || null,
      ownershipId || null,
      userId || null,
      provider,
      eventId,
    ]
  );
}

async function handleWebhook(provider, req, res) {
  const expectedSecret = getExpectedWebhookSecret(provider);
  if (!expectedSecret) {
    return sendWebhookError(
      res,
      503,
      'VERIFICATION_UNAVAILABLE',
      '웹훅 시크릿이 설정되지 않았습니다.'
    );
  }

  const submittedToken = extractWebhookToken(req);
  if (!submittedToken || !timingSafeEqualString(expectedSecret, submittedToken)) {
    return sendWebhookError(res, 401, 'AUTH_FORBIDDEN', '웹훅 인증에 실패했습니다.');
  }

  const parsed = parseWebhookEvent(provider, req.body || {});
  if (parsed.error) {
    return sendWebhookError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  try {
    const insertResult = await dbRun(
      `
      INSERT OR IGNORE INTO monetization_webhook_events (
        provider,
        event_id,
        event_type,
        payload_json,
        transaction_id,
        original_transaction_id,
        app_account_token,
        environment,
        store_sku,
        purchase_token,
        purchase_status,
        expires_at,
        process_state
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')
      `,
      [
        parsed.provider,
        parsed.event_id,
        parsed.event_type,
        parsed.payload_json,
        parsed.transaction_id,
        parsed.original_transaction_id,
        parsed.app_account_token,
        parsed.environment,
        parsed.store_sku,
        parsed.purchase_token,
        parsed.purchase_status,
        parsed.expires_at,
      ]
    );

    if (Number(insertResult?.changes || 0) === 0) {
      return res.json({
        ok: true,
        message: '이미 처리된 웹훅 이벤트입니다.',
        duplicated: true,
        event: {
          provider: parsed.provider,
          event_id: parsed.event_id,
          event_type: parsed.event_type,
        },
      });
    }

    let purchase = await fetchPurchaseByIdentifiers(
      parsed.transaction_id,
      parsed.purchase_token
    );
    if (!purchase && parsed.original_transaction_id) {
      purchase = await fetchOwnershipByOriginalTransaction({
        provider: parsed.provider,
        originalTransactionId: parsed.original_transaction_id,
        storeSku: parsed.store_sku,
        environment: parsed.environment,
      });
    }

    if (!purchase) {
      const ignoreMessage = '결제 레코드를 찾을 수 없어 이벤트를 보류했습니다.';
      await finalizeWebhookEvent({
        provider: parsed.provider,
        eventId: parsed.event_id,
        processState: 'ignored',
        processMessage: ignoreMessage,
        purchaseId: null,
        userId: null,
      });

      await insertMonetizationAlert({
        level: 'warn',
        code: 'WEBHOOK_PURCHASE_NOT_FOUND',
        title: '웹훅 결제 매칭 실패',
        message: ignoreMessage,
        context: {
          provider: parsed.provider,
          event_id: parsed.event_id,
          transaction_id: parsed.transaction_id,
          original_transaction_id: parsed.original_transaction_id,
          environment: parsed.environment,
          store_sku: parsed.store_sku,
          purchase_token: parsed.purchase_token,
          event_type: parsed.event_type,
        },
      });

      return res.status(202).json({
        ok: true,
        message: ignoreMessage,
        event: {
          provider: parsed.provider,
          event_id: parsed.event_id,
          state: 'ignored',
        },
      });
    }

    const nextStatus = parsed.purchase_status || purchase.status;
    const nextExpiresAt = parsed.expires_at || purchase.expires_at || null;

    const webhookRawJson = mergeMonetizationRawJson(purchase.raw_json, {
      webhook: {
        provider: parsed.provider,
        event_id: parsed.event_id,
        event_type: parsed.event_type,
        purchase_status: parsed.purchase_status,
        expires_at: parsed.expires_at,
        transaction_id: parsed.transaction_id,
        original_transaction_id: parsed.original_transaction_id,
        app_account_token: parsed.app_account_token,
        environment: parsed.environment,
        store_sku: parsed.store_sku,
        received_at: new Date().toISOString(),
      },
    });

    if (purchase.id) {
      await dbRun(
        `
        UPDATE purchases
        SET
          status = ?,
          expires_at = ?,
          original_transaction_id = COALESCE(?, original_transaction_id),
          app_account_token = COALESCE(?, app_account_token),
          environment = ?,
          raw_json = ?
        WHERE id = ?
        `,
        [
          nextStatus,
          nextExpiresAt,
          parsed.original_transaction_id || null,
          parsed.app_account_token || null,
          parsed.environment || purchase.environment || 'unknown',
          webhookRawJson,
          purchase.id,
        ]
      );
    }

    if (purchase.ownership_id) {
      const ownershipRawJson = mergeMonetizationRawJson(purchase.raw_json, {
        webhook: {
          provider: parsed.provider,
          event_id: parsed.event_id,
          event_type: parsed.event_type,
          purchase_status: parsed.purchase_status,
          expires_at: parsed.expires_at,
          transaction_id: parsed.transaction_id,
          original_transaction_id: parsed.original_transaction_id,
          app_account_token: parsed.app_account_token,
          environment: parsed.environment,
          store_sku: parsed.store_sku,
          received_at: new Date().toISOString(),
        },
      });

      await dbRun(
        `
        UPDATE subscription_ownerships
        SET
          status = ?,
          expires_at = ?,
          latest_transaction_id = COALESCE(?, latest_transaction_id),
          app_account_token = COALESCE(?, app_account_token),
          raw_json = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [
          nextStatus,
          nextExpiresAt,
          parsed.transaction_id || null,
          parsed.app_account_token || null,
          ownershipRawJson,
          purchase.ownership_id,
        ]
      );
    }

    const summary = await reconcileMonetizationState({ userId: purchase.user_id });

    await finalizeWebhookEvent({
      provider: parsed.provider,
      eventId: parsed.event_id,
      processState: 'processed',
      processMessage: '웹훅 이벤트 처리가 완료되었습니다.',
      purchaseId: purchase.id,
      ownershipId: purchase.ownership_id,
      userId: purchase.user_id,
    });

    const entitlement = purchase.entitlement_key
      ? await dbGet(
          `
          SELECT entitlement_key, status, starts_at, ends_at, source
          FROM user_entitlements
          WHERE user_id = ? AND entitlement_key = ?
          LIMIT 1
          `,
          [purchase.user_id, purchase.entitlement_key]
        )
      : null;

    return res.json({
      ok: true,
      message: '웹훅 이벤트를 처리했습니다.',
      event: {
        provider: parsed.provider,
        event_id: parsed.event_id,
        event_type: parsed.event_type,
        state: 'processed',
        matched_by_ownership: Boolean(purchase.matched_by_ownership),
      },
      purchase: {
        id: purchase.id,
        user_id: purchase.user_id,
        platform: purchase.platform,
        store_sku: purchase.store_sku,
        status: nextStatus,
        expires_at: nextExpiresAt,
      },
      entitlement: entitlement
        ? {
            entitlement_key: entitlement.entitlement_key,
            status: entitlement.status,
            starts_at: entitlement.starts_at || null,
            ends_at: entitlement.ends_at || null,
            source: entitlement.source,
          }
        : null,
      summary,
    });
  } catch (error) {
    console.error(`[monetization/webhooks/${provider}] failed:`, error);

    try {
      await finalizeWebhookEvent({
        provider: parsed.provider,
        eventId: parsed.event_id,
        processState: 'failed',
        processMessage: error?.message || 'unknown_error',
        purchaseId: null,
        userId: null,
      });

      await insertMonetizationAlert({
        level: 'error',
        code: 'WEBHOOK_PROCESSING_FAILED',
        title: '웹훅 처리 실패',
        message: error?.message || 'unknown_error',
        context: {
          provider: parsed.provider,
          event_id: parsed.event_id,
          event_type: parsed.event_type,
        },
      });
    } catch (sideEffectError) {
      console.error('[monetization/webhook] side effect failed:', sideEffectError);
    }

    return sendWebhookError(
      res,
      500,
      'INTERNAL_ERROR',
      '웹훅 처리 중 오류가 발생했습니다.'
    );
  }
}

router.post('/monetization/webhooks/apple', async (req, res) => {
  return handleWebhook('apple', req, res);
});

router.post('/monetization/webhooks/google', async (req, res) => {
  return handleWebhook('google', req, res);
});

module.exports = router;
