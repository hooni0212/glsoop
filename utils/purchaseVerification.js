const crypto = require('node:crypto');

const ALLOWED_VERIFY_MODES = new Set([
  'pending_only',
  'auto_active',
  'receipt_inspect',
  'live_verify',
]);

const ALLOWED_PURCHASE_STATUSES = new Set([
  'active',
  'expired',
  'refunded',
  'canceled',
  'pending',
]);

const LIVE_VERIFY_FALLBACK_MODES = new Set(['pending_only', 'receipt_inspect']);

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ANDROID_PUBLISHER_BASE =
  'https://androidpublisher.googleapis.com/androidpublisher/v3';
const GOOGLE_ANDROID_PUBLISHER_SCOPE =
  'https://www.googleapis.com/auth/androidpublisher';

const APPLE_VERIFY_BASE = {
  sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
  production: 'https://api.storekit.itunes.apple.com',
};

const googleAccessTokenCache = {
  access_token: null,
  expires_at_ms: 0,
};

class PurchaseVerificationError extends Error {
  constructor({
    code = 'VERIFICATION_FAILED',
    message = '결제 검증 중 오류가 발생했습니다.',
    status = 502,
    details = null,
  } = {}) {
    super(message);
    this.name = 'PurchaseVerificationError';
    this.code = code;
    this.status = status;
    this.details = details || null;
  }
}

function normalizeVerifyMode(raw) {
  if (typeof raw !== 'string') return 'pending_only';
  const normalized = raw.trim().toLowerCase();
  return ALLOWED_VERIFY_MODES.has(normalized) ? normalized : 'pending_only';
}

function normalizeLiveFallbackMode(raw) {
  if (typeof raw !== 'string') return 'receipt_inspect';
  const normalized = raw.trim().toLowerCase();
  return LIVE_VERIFY_FALLBACK_MODES.has(normalized)
    ? normalized
    : 'receipt_inspect';
}

function readEnvBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseBoundedInt(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
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
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return toIsoDateTime(numeric);
      }
    }

    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
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

function normalizeIdentityString(raw, maxLength = 255) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizeIdentityEnvironment(raw) {
  const normalized = normalizeIdentityString(raw, 40)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === 'prod') return 'production';
  if (normalized === 'testflight') return 'sandbox';
  return normalized;
}

function extractStoreIdentity(source = {}) {
  const identity = {
    transaction_id: normalizeIdentityString(
      pickFirstValue(source, [
        'transactionId',
        'transaction_id',
        'id',
        'webOrderLineItemId',
      ])
    ),
    original_transaction_id: normalizeIdentityString(
      pickFirstValue(source, [
        'originalTransactionId',
        'original_transaction_id',
        'originalTransactionIdentifierIOS',
        'original_transaction_identifier_ios',
        'originalTransactionID',
      ])
    ),
    app_account_token: normalizeIdentityString(
      pickFirstValue(source, [
        'appAccountToken',
        'app_account_token',
        'applicationUsername',
        'application_username',
      ])
    ),
    environment: normalizeIdentityEnvironment(
      pickFirstValue(source, ['environment', 'environmentIOS', 'storeEnvironment'])
    ),
    web_order_line_item_id: normalizeIdentityString(
      pickFirstValue(source, ['webOrderLineItemId', 'web_order_line_item_id'])
    ),
  };

  return identity;
}

function mergeStoreIdentity(...sources) {
  return sources.reduce(
    (merged, source) => {
      if (!source || typeof source !== 'object') return merged;
      const identity = extractStoreIdentity(source);
      return {
        transaction_id: merged.transaction_id || identity.transaction_id,
        original_transaction_id:
          merged.original_transaction_id || identity.original_transaction_id,
        app_account_token: merged.app_account_token || identity.app_account_token,
        environment: merged.environment || identity.environment,
        web_order_line_item_id:
          merged.web_order_line_item_id || identity.web_order_line_item_id,
      };
    },
    {
      transaction_id: null,
      original_transaction_id: null,
      app_account_token: null,
      environment: null,
      web_order_line_item_id: null,
    }
  );
}

function attachPurchaseIdentity(decision, parsedPayload = {}) {
  const parsedIdentity = mergeStoreIdentity(parsedPayload, parsedPayload.client_meta);
  const decisionIdentity = mergeStoreIdentity(decision, decision?.verification?.identifiers);
  const identity = {
    transaction_id:
      decisionIdentity.transaction_id ||
      parsedIdentity.transaction_id ||
      normalizeIdentityString(parsedPayload.transaction_id),
    original_transaction_id:
      decisionIdentity.original_transaction_id || parsedIdentity.original_transaction_id,
    app_account_token:
      decisionIdentity.app_account_token || parsedIdentity.app_account_token,
    environment: decisionIdentity.environment || parsedIdentity.environment || null,
    web_order_line_item_id:
      decisionIdentity.web_order_line_item_id || parsedIdentity.web_order_line_item_id,
  };

  return {
    ...decision,
    ...identity,
    verification: {
      ...(decision?.verification || {}),
      identifiers: identity,
    },
  };
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

function encodeBase64UrlUtf8(raw) {
  return Buffer.from(raw)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
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

function parseReceiptPayload(rawReceipt) {
  if (!rawReceipt) return { payload: null, source: 'none' };

  if (typeof rawReceipt === 'object' && !Array.isArray(rawReceipt)) {
    return { payload: rawReceipt, source: 'object' };
  }

  if (typeof rawReceipt !== 'string') {
    return { payload: null, source: 'unsupported' };
  }

  const fromJson = safeParseJson(rawReceipt);
  if (fromJson) {
    return { payload: fromJson, source: 'json' };
  }

  const fromJwtPayload = tryDecodeJwtPayload(rawReceipt);
  if (fromJwtPayload) {
    return { payload: fromJwtPayload, source: 'jws' };
  }

  return { payload: null, source: 'unknown' };
}

function parseApplePayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { payload: null, payload_source: 'none' };
  }

  let payload = rawPayload;
  let source = 'apple_payload';

  const embeddedJws =
    pickFirstValue(payload, ['signedTransactionInfo', 'data.signedTransactionInfo']) ||
    null;
  if (typeof embeddedJws === 'string') {
    const decoded = tryDecodeJwtPayload(embeddedJws);
    if (decoded) {
      payload = { ...payload, ...decoded };
      source = 'apple_signed_transaction_info';
    }
  }

  const latestArray = pickFirstValue(payload, ['latest_receipt_info']);
  if (Array.isArray(latestArray) && latestArray.length > 0) {
    const latest = latestArray[latestArray.length - 1];
    if (latest && typeof latest === 'object') {
      payload = { ...payload, ...latest };
      source = 'apple_latest_receipt_info';
    }
  }

  return { payload, payload_source: source };
}

function inspectAppleReceipt(rawPayload, nowIso) {
  const nowMs = Date.now();
  const { payload, payload_source } = parseApplePayload(rawPayload);
  if (!payload) {
    return {
      purchase_status: 'pending',
      purchased_at: nowIso,
      expires_at: null,
      verification: {
        source: 'receipt_inspect',
        platform: 'apple',
        payload_source,
        reason: 'PAYLOAD_UNAVAILABLE',
      },
    };
  }

  const identity = extractStoreIdentity(payload);
  const revokedAtIso = toIsoDateTime(
    pickFirstValue(payload, [
      'revocationDate',
      'revocation_date',
      'revocationDateMs',
      'revocation_date_ms',
      'cancellationDate',
      'cancellation_date',
      'cancellationDateMs',
      'cancellation_date_ms',
    ])
  );

  const purchasedAtIso =
    toIsoDateTime(
      pickFirstValue(payload, [
        'purchaseDate',
        'purchase_date',
        'purchaseDateMs',
        'purchase_date_ms',
        'originalPurchaseDate',
        'original_purchase_date',
      ])
    ) || nowIso;

  const expiresAtIso = toIsoDateTime(
    pickFirstValue(payload, [
      'expiresDate',
      'expires_date',
      'expiresDateMs',
      'expires_date_ms',
      'expirationDate',
      'expiration_date',
    ])
  );

  const expiresMs = expiresAtIso ? new Date(expiresAtIso).getTime() : null;
  let purchaseStatus = 'active';
  if (revokedAtIso) {
    purchaseStatus = 'refunded';
  } else if (expiresMs !== null && Number.isFinite(expiresMs) && expiresMs <= nowMs) {
    purchaseStatus = 'expired';
  }

  return {
    purchase_status: purchaseStatus,
    purchased_at: purchasedAtIso,
    expires_at: expiresAtIso,
    ...identity,
    verification: {
      source: 'receipt_inspect',
      platform: 'apple',
      payload_source,
      revoked_at: revokedAtIso,
      identifiers: identity,
    },
  };
}

function inspectGoogleReceipt(payload, nowIso) {
  if (!payload || typeof payload !== 'object') {
    return {
      purchase_status: 'pending',
      purchased_at: nowIso,
      expires_at: null,
      verification: {
        source: 'receipt_inspect',
        platform: 'google',
        payload_source: 'none',
        reason: 'PAYLOAD_UNAVAILABLE',
      },
    };
  }

  const purchaseState = Number.parseInt(
    String(
      pickFirstValue(payload, [
        'purchaseState',
        'purchase_state',
        'paymentState',
        'payment_state',
      ]) ?? ''
    ),
    10
  );

  const cancelReasonRaw = pickFirstValue(payload, [
    'cancelReason',
    'cancel_reason',
    'userCancellationTimeMillis',
    'user_cancellation_time_millis',
  ]);

  const purchasedAtIso =
    toIsoDateTime(
      pickFirstValue(payload, [
        'purchaseTimeMillis',
        'purchase_time_millis',
        'purchaseTime',
        'purchase_time',
      ])
    ) || nowIso;

  const expiresAtIso = toIsoDateTime(
    pickFirstValue(payload, [
      'expiryTimeMillis',
      'expiry_time_millis',
      'expiresAt',
      'expires_at',
    ])
  );
  const expiresMs = expiresAtIso ? new Date(expiresAtIso).getTime() : null;
  const nowMs = Date.now();

  let purchaseStatus = 'active';
  if (Number.isFinite(purchaseState) && purchaseState === 2) {
    purchaseStatus = 'pending';
  } else if (
    (Number.isFinite(purchaseState) && purchaseState === 1) ||
    cancelReasonRaw !== null
  ) {
    purchaseStatus = 'canceled';
  } else if (expiresMs !== null && Number.isFinite(expiresMs) && expiresMs <= nowMs) {
    purchaseStatus = 'expired';
  }

  return {
    purchase_status: purchaseStatus,
    purchased_at: purchasedAtIso,
    expires_at: expiresAtIso,
    verification: {
      source: 'receipt_inspect',
      platform: 'google',
      payload_source: 'google_payload',
      purchase_state: Number.isFinite(purchaseState) ? purchaseState : null,
      cancel_reason: cancelReasonRaw || null,
    },
  };
}

function inspectWebReceipt(payload, nowIso) {
  const statusCandidate = String(
    pickFirstValue(payload, ['status', 'purchase_status']) || ''
  )
    .trim()
    .toLowerCase();
  const normalizedStatus = ALLOWED_PURCHASE_STATUSES.has(statusCandidate)
    ? statusCandidate
    : 'pending';

  return {
    purchase_status: normalizedStatus,
    purchased_at:
      toIsoDateTime(pickFirstValue(payload, ['purchased_at', 'purchasedAt'])) || nowIso,
    expires_at: toIsoDateTime(pickFirstValue(payload, ['expires_at', 'expiresAt'])),
    verification: {
      source: 'receipt_inspect',
      platform: 'web',
      payload_source: payload ? 'web_payload' : 'none',
    },
  };
}

function resolveSuccessMessage(purchaseStatus) {
  if (purchaseStatus === 'active') {
    return '결제가 확인되었습니다.';
  }
  if (purchaseStatus === 'expired') {
    return '결제 만료 상태가 반영되었습니다.';
  }
  if (purchaseStatus === 'refunded' || purchaseStatus === 'canceled') {
    return '결제 취소 상태가 반영되었습니다.';
  }
  return '결제 검증 요청이 접수되었습니다.';
}

function normalizePem(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\\n/g, '\n');
}

function buildSignedJwt({ header, payload, privateKey, algorithm }) {
  const encodedHeader = encodeBase64UrlUtf8(JSON.stringify(header));
  const encodedPayload = encodeBase64UrlUtf8(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign('SHA256');
  signer.update(signingInput);
  signer.end();

  const signOptions = {
    key: privateKey,
  };

  if (algorithm === 'ES256') {
    signOptions.dsaEncoding = 'ieee-p1363';
  }

  const signature = signer.sign(signOptions);
  const encodedSignature = signature
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${signingInput}.${encodedSignature}`;
}

function ensureFetch() {
  if (typeof fetch !== 'function') {
    throw new PurchaseVerificationError({
      code: 'VERIFICATION_UNAVAILABLE',
      status: 500,
      message: '런타임에서 fetch를 사용할 수 없습니다.',
    });
  }
}

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  ensureFetch();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const text = await response.text();
    const json = safeParseJson(text);

    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new PurchaseVerificationError({
        code: 'VERIFICATION_UNAVAILABLE',
        status: 504,
        message: '결제 검증 요청이 시간 내에 완료되지 않았습니다.',
      });
    }
    throw new PurchaseVerificationError({
      code: 'VERIFICATION_UNAVAILABLE',
      status: 503,
      message: '검증 서버에 연결할 수 없습니다.',
      details: { cause: error?.message || 'unknown_error' },
    });
  } finally {
    clearTimeout(timer);
  }
}

function getAppleConfig() {
  const issuerId = (process.env.MONETIZATION_APPLE_ISSUER_ID || '').trim();
  const keyId = (process.env.MONETIZATION_APPLE_KEY_ID || '').trim();
  const privateKey = normalizePem(process.env.MONETIZATION_APPLE_PRIVATE_KEY || '');
  const bundleId = (process.env.MONETIZATION_APPLE_BUNDLE_ID || '').trim() || null;
  const environment =
    (process.env.MONETIZATION_APPLE_ENV || '').trim().toLowerCase() === 'production'
      ? 'production'
      : 'sandbox';
  const timeoutMs = parseBoundedInt(
    process.env.MONETIZATION_VERIFY_TIMEOUT_MS,
    8000,
    1000,
    20000
  );

  const missing = [];
  if (!issuerId) missing.push('MONETIZATION_APPLE_ISSUER_ID');
  if (!keyId) missing.push('MONETIZATION_APPLE_KEY_ID');
  if (!privateKey) missing.push('MONETIZATION_APPLE_PRIVATE_KEY');

  return {
    available: missing.length === 0,
    missing,
    issuerId,
    keyId,
    privateKey,
    bundleId,
    environment,
    timeoutMs,
    baseUrl: APPLE_VERIFY_BASE[environment],
  };
}

function buildAppleVerifyToken(config) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return buildSignedJwt({
    header: {
      alg: 'ES256',
      kid: config.keyId,
      typ: 'JWT',
    },
    payload: {
      iss: config.issuerId,
      iat: nowSeconds,
      exp: nowSeconds + 300,
      aud: 'appstoreconnect-v1',
      ...(config.bundleId ? { bid: config.bundleId } : {}),
    },
    privateKey: config.privateKey,
    algorithm: 'ES256',
  });
}

function inspectAppleLivePayload(rawPayload, nowIso) {
  const { payload, payload_source } = parseApplePayload(rawPayload);
  if (!payload) {
    throw new PurchaseVerificationError({
      code: 'VERIFICATION_FAILED',
      status: 502,
      message: 'Apple 검증 응답을 해석할 수 없습니다.',
      details: { provider: 'apple', reason: 'INVALID_RESPONSE_PAYLOAD' },
    });
  }

  const identity = extractStoreIdentity(payload);
  const purchasedAtIso =
    toIsoDateTime(
      pickFirstValue(payload, [
        'purchaseDate',
        'purchaseDateMs',
        'originalPurchaseDate',
        'signedDate',
      ])
    ) || nowIso;

  const expiresAtIso = toIsoDateTime(
    pickFirstValue(payload, ['expiresDate', 'expiresDateMs', 'expires_at'])
  );

  const revokedAtIso = toIsoDateTime(
    pickFirstValue(payload, ['revocationDate', 'revocationDateMs'])
  );

  const expiresMs = expiresAtIso ? new Date(expiresAtIso).getTime() : null;
  const nowMs = Date.now();

  let purchaseStatus = 'active';
  if (revokedAtIso) {
    purchaseStatus = 'refunded';
  } else if (expiresMs !== null && Number.isFinite(expiresMs) && expiresMs <= nowMs) {
    purchaseStatus = 'expired';
  }

  return {
    purchase_status: purchaseStatus,
    purchased_at: purchasedAtIso,
    expires_at: expiresAtIso,
    product_id: pickFirstValue(payload, ['productId', 'product_id']),
    bundle_id: pickFirstValue(payload, ['bundleId', 'bundle_id']),
    ...identity,
    verification: {
      source: 'live_verify',
      provider: 'apple',
      payload_source,
      revoked_at: revokedAtIso,
      identifiers: identity,
    },
  };
}

async function verifyApplePurchase(parsedPayload = {}, nowIso) {
  const config = getAppleConfig();
  if (!config.available) {
    throw new PurchaseVerificationError({
      code: 'VERIFICATION_UNAVAILABLE',
      status: 503,
      message: 'Apple 검증 설정이 누락되었습니다.',
      details: { provider: 'apple', missing: config.missing },
    });
  }

  if (!parsedPayload.transaction_id) {
    throw new PurchaseVerificationError({
      code: 'INVALID_REQUEST',
      status: 400,
      message: 'Apple 실검증에는 transaction_id가 필요합니다.',
    });
  }

  const accessToken = buildAppleVerifyToken(config);
  const endpoint = `${config.baseUrl}/inApps/v1/transactions/${encodeURIComponent(
    parsedPayload.transaction_id
  )}`;

  const response = await fetchJson(
    endpoint,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    config.timeoutMs
  );

  if (!response.ok) {
    if (response.status === 404 || response.status === 400) {
      throw new PurchaseVerificationError({
        code: 'VERIFICATION_FAILED',
        status: 400,
        message: 'Apple 결제 정보를 찾을 수 없습니다.',
        details: { provider: 'apple', http_status: response.status },
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new PurchaseVerificationError({
        code: 'VERIFICATION_UNAVAILABLE',
        status: 503,
        message: 'Apple 검증 인증에 실패했습니다.',
        details: { provider: 'apple', http_status: response.status },
      });
    }

    throw new PurchaseVerificationError({
      code: 'VERIFICATION_FAILED',
      status: 502,
      message: 'Apple 검증 요청에 실패했습니다.',
      details: { provider: 'apple', http_status: response.status },
    });
  }

  const inspected = inspectAppleLivePayload(response.json || {}, nowIso);

  if (
    parsedPayload.store_sku &&
    inspected.product_id &&
    parsedPayload.store_sku !== inspected.product_id
  ) {
    throw new PurchaseVerificationError({
      code: 'VERIFICATION_FAILED',
      status: 400,
      message: 'Apple 검증 결과의 상품 정보가 요청과 일치하지 않습니다.',
      details: {
        provider: 'apple',
        requested_store_sku: parsedPayload.store_sku,
        verified_product_id: inspected.product_id,
      },
    });
  }

  if (config.bundleId && inspected.bundle_id && config.bundleId !== inspected.bundle_id) {
    throw new PurchaseVerificationError({
      code: 'VERIFICATION_FAILED',
      status: 400,
      message: 'Apple 검증 결과의 앱 번들 식별자가 일치하지 않습니다.',
      details: {
        provider: 'apple',
        expected_bundle_id: config.bundleId,
        verified_bundle_id: inspected.bundle_id,
      },
    });
  }

  return {
    verify_mode: 'live_verify',
    purchase_status: inspected.purchase_status,
    purchased_at: inspected.purchased_at || nowIso,
    expires_at: inspected.expires_at || null,
    transaction_id: inspected.transaction_id || parsedPayload.transaction_id || null,
    original_transaction_id: inspected.original_transaction_id || null,
    app_account_token: inspected.app_account_token || null,
    environment: inspected.environment || config.environment,
    web_order_line_item_id: inspected.web_order_line_item_id || null,
    verification: {
      ...inspected.verification,
      environment: config.environment,
      http_status: response.status,
      product_id: inspected.product_id || null,
      bundle_id: inspected.bundle_id || null,
    },
    success_message: resolveSuccessMessage(inspected.purchase_status),
  };
}

function getGoogleConfig() {
  const packageName = (process.env.MONETIZATION_GOOGLE_PACKAGE_NAME || '').trim();

  let clientEmail = (process.env.MONETIZATION_GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  let privateKey = normalizePem(
    process.env.MONETIZATION_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''
  );

  const serviceAccountJson = safeParseJson(
    process.env.MONETIZATION_GOOGLE_SERVICE_ACCOUNT_JSON || ''
  );
  if (serviceAccountJson) {
    clientEmail =
      clientEmail ||
      (typeof serviceAccountJson.client_email === 'string'
        ? serviceAccountJson.client_email.trim()
        : '');
    privateKey =
      privateKey ||
      normalizePem(
        typeof serviceAccountJson.private_key === 'string'
          ? serviceAccountJson.private_key
          : ''
      );
  }

  const timeoutMs = parseBoundedInt(
    process.env.MONETIZATION_VERIFY_TIMEOUT_MS,
    8000,
    1000,
    20000
  );

  const missing = [];
  if (!packageName) missing.push('MONETIZATION_GOOGLE_PACKAGE_NAME');
  if (!clientEmail) missing.push('MONETIZATION_GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!privateKey) missing.push('MONETIZATION_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');

  return {
    available: missing.length === 0,
    missing,
    packageName,
    clientEmail,
    privateKey,
    timeoutMs,
  };
}

async function fetchGoogleAccessToken(config) {
  const nowMs = Date.now();
  if (
    googleAccessTokenCache.access_token &&
    googleAccessTokenCache.expires_at_ms > nowMs + 60 * 1000
  ) {
    return googleAccessTokenCache.access_token;
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const assertion = buildSignedJwt({
    header: {
      alg: 'RS256',
      typ: 'JWT',
    },
    payload: {
      iss: config.clientEmail,
      scope: GOOGLE_ANDROID_PUBLISHER_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: nowSeconds + 3600,
      iat: nowSeconds,
    },
    privateKey: config.privateKey,
    algorithm: 'RS256',
  });

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }).toString();

  const response = await fetchJson(
    GOOGLE_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
    config.timeoutMs
  );

  if (!response.ok) {
    throw new PurchaseVerificationError({
      code: 'VERIFICATION_UNAVAILABLE',
      status: 503,
      message: 'Google 검증 토큰 발급에 실패했습니다.',
      details: {
        provider: 'google',
        http_status: response.status,
      },
    });
  }

  const accessToken =
    response.json && typeof response.json.access_token === 'string'
      ? response.json.access_token
      : '';
  const expiresInSeconds = Number.parseInt(
    String(response.json?.expires_in ?? 3600),
    10
  );

  if (!accessToken) {
    throw new PurchaseVerificationError({
      code: 'VERIFICATION_UNAVAILABLE',
      status: 503,
      message: 'Google 검증 토큰 응답이 올바르지 않습니다.',
      details: { provider: 'google', reason: 'INVALID_ACCESS_TOKEN_RESPONSE' },
    });
  }

  const safeExpiresIn =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? expiresInSeconds
      : 3600;

  googleAccessTokenCache.access_token = accessToken;
  googleAccessTokenCache.expires_at_ms = Date.now() + safeExpiresIn * 1000;

  return accessToken;
}

function inspectGoogleProductLivePayload(payload, nowIso) {
  if (!payload || typeof payload !== 'object') {
    throw new PurchaseVerificationError({
      code: 'VERIFICATION_FAILED',
      status: 502,
      message: 'Google 검증 응답을 해석할 수 없습니다.',
      details: { provider: 'google', reason: 'INVALID_PRODUCT_RESPONSE' },
    });
  }

  const purchaseState = Number.parseInt(String(payload.purchaseState ?? ''), 10);
  const purchasedAtIso = toIsoDateTime(payload.purchaseTimeMillis) || nowIso;
  const expiresAtIso = toIsoDateTime(
    payload.expiryTimeMillis || payload.expiry_time_millis || payload.expiresAt
  );

  const expiresMs = expiresAtIso ? new Date(expiresAtIso).getTime() : null;
  const nowMs = Date.now();

  let purchaseStatus = 'active';
  if (Number.isFinite(purchaseState) && purchaseState === 2) {
    purchaseStatus = 'pending';
  } else if (Number.isFinite(purchaseState) && purchaseState === 1) {
    purchaseStatus = 'canceled';
  } else if (expiresMs !== null && Number.isFinite(expiresMs) && expiresMs <= nowMs) {
    purchaseStatus = 'expired';
  }

  return {
    purchase_status: purchaseStatus,
    purchased_at: purchasedAtIso,
    expires_at: expiresAtIso,
    verification: {
      source: 'live_verify',
      provider: 'google',
      endpoint: 'products',
      purchase_state: Number.isFinite(purchaseState) ? purchaseState : null,
      acknowledgement_state: Number.parseInt(
        String(payload.acknowledgementState ?? ''),
        10
      ),
      consumption_state: Number.parseInt(String(payload.consumptionState ?? ''), 10),
      order_id: typeof payload.orderId === 'string' ? payload.orderId : null,
    },
  };
}

function inspectGoogleSubscriptionLivePayload(payload, nowIso) {
  if (!payload || typeof payload !== 'object') {
    throw new PurchaseVerificationError({
      code: 'VERIFICATION_FAILED',
      status: 502,
      message: 'Google 구독 검증 응답을 해석할 수 없습니다.',
      details: { provider: 'google', reason: 'INVALID_SUBSCRIPTION_RESPONSE' },
    });
  }

  const subscriptionState = String(payload.subscriptionState || '')
    .trim()
    .toUpperCase();

  const lineItems = Array.isArray(payload.lineItems) ? payload.lineItems : [];
  const firstLineItem = lineItems[0] || null;
  const purchasedAtIso =
    toIsoDateTime(payload.startTime || firstLineItem?.startTime) || nowIso;
  const expiresAtIso = toIsoDateTime(
    pickFirstValue(payload, ['lineItems.0.expiryTime', 'lineItems.0.expiry_time'])
  );

  const expiresMs = expiresAtIso ? new Date(expiresAtIso).getTime() : null;
  const nowMs = Date.now();

  let purchaseStatus = 'active';
  if (subscriptionState.includes('PENDING')) {
    purchaseStatus = 'pending';
  } else if (subscriptionState.includes('EXPIRED')) {
    purchaseStatus = 'expired';
  } else if (
    subscriptionState.includes('CANCELED') ||
    subscriptionState.includes('ON_HOLD') ||
    subscriptionState.includes('PAUSED') ||
    payload.canceledStateContext
  ) {
    purchaseStatus = 'canceled';
  } else if (expiresMs !== null && Number.isFinite(expiresMs) && expiresMs <= nowMs) {
    purchaseStatus = 'expired';
  }

  return {
    purchase_status: purchaseStatus,
    purchased_at: purchasedAtIso,
    expires_at: expiresAtIso,
    verification: {
      source: 'live_verify',
      provider: 'google',
      endpoint: 'subscriptionsv2',
      subscription_state: subscriptionState || null,
      latest_order_id:
        typeof firstLineItem?.latestSuccessfulOrderId === 'string'
          ? firstLineItem.latestSuccessfulOrderId
          : null,
      line_item_count: lineItems.length,
    },
  };
}

async function verifyGooglePurchase(parsedPayload = {}, nowIso, options = {}) {
  const config = getGoogleConfig();
  if (!config.available) {
    throw new PurchaseVerificationError({
      code: 'VERIFICATION_UNAVAILABLE',
      status: 503,
      message: 'Google 검증 설정이 누락되었습니다.',
      details: { provider: 'google', missing: config.missing },
    });
  }

  if (!parsedPayload.purchase_token) {
    throw new PurchaseVerificationError({
      code: 'INVALID_REQUEST',
      status: 400,
      message: 'Google 실검증에는 purchase_token이 필요합니다.',
    });
  }

  const accessToken = await fetchGoogleAccessToken(config);
  const isSubscription = String(options.product_type || '').toLowerCase() === 'subscription';

  const endpoint = isSubscription
    ? `${GOOGLE_ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(
        config.packageName
      )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(
        parsedPayload.purchase_token
      )}`
    : `${GOOGLE_ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(
        config.packageName
      )}/purchases/products/${encodeURIComponent(
        parsedPayload.store_sku
      )}/tokens/${encodeURIComponent(parsedPayload.purchase_token)}`;

  const response = await fetchJson(
    endpoint,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    config.timeoutMs
  );

  if (!response.ok) {
    if (response.status === 404 || response.status === 400) {
      throw new PurchaseVerificationError({
        code: 'VERIFICATION_FAILED',
        status: 400,
        message: 'Google 결제 정보를 찾을 수 없습니다.',
        details: { provider: 'google', http_status: response.status },
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new PurchaseVerificationError({
        code: 'VERIFICATION_UNAVAILABLE',
        status: 503,
        message: 'Google 검증 인증에 실패했습니다.',
        details: { provider: 'google', http_status: response.status },
      });
    }

    throw new PurchaseVerificationError({
      code: 'VERIFICATION_FAILED',
      status: 502,
      message: 'Google 검증 요청에 실패했습니다.',
      details: { provider: 'google', http_status: response.status },
    });
  }

  const inspected = isSubscription
    ? inspectGoogleSubscriptionLivePayload(response.json || {}, nowIso)
    : inspectGoogleProductLivePayload(response.json || {}, nowIso);

  return {
    verify_mode: 'live_verify',
    purchase_status: inspected.purchase_status,
    purchased_at: inspected.purchased_at || nowIso,
    expires_at: inspected.expires_at || null,
    verification: {
      ...inspected.verification,
      http_status: response.status,
      package_name: config.packageName,
    },
    success_message: resolveSuccessMessage(inspected.purchase_status),
  };
}

function buildReceiptInspectDecision(parsedPayload = {}, nowIso, verifyMode) {
  const receipt = parseReceiptPayload(parsedPayload.receipt_data);
  let inspected = null;
  if (parsedPayload.platform === 'apple') {
    inspected = inspectAppleReceipt(receipt.payload, nowIso);
  } else if (parsedPayload.platform === 'google') {
    inspected = inspectGoogleReceipt(receipt.payload, nowIso);
  } else {
    inspected = inspectWebReceipt(receipt.payload, nowIso);
  }

  return {
    verify_mode: verifyMode,
    purchase_status: inspected.purchase_status,
    purchased_at: inspected.purchased_at || nowIso,
    expires_at: inspected.expires_at || null,
    transaction_id: inspected.transaction_id || null,
    original_transaction_id: inspected.original_transaction_id || null,
    app_account_token: inspected.app_account_token || null,
    environment: inspected.environment || null,
    web_order_line_item_id: inspected.web_order_line_item_id || null,
    verification: {
      ...inspected.verification,
      receipt_source: receipt.source,
    },
    success_message: resolveSuccessMessage(inspected.purchase_status),
  };
}

async function resolveLiveVerifyDecision(parsedPayload = {}, options = {}, nowIso) {
  if (parsedPayload.platform === 'apple') {
    return verifyApplePurchase(parsedPayload, nowIso);
  }
  if (parsedPayload.platform === 'google') {
    return verifyGooglePurchase(parsedPayload, nowIso, options);
  }

  const inspected = inspectWebReceipt(parseReceiptPayload(parsedPayload.receipt_data).payload, nowIso);
  return {
    verify_mode: 'live_verify',
    purchase_status: inspected.purchase_status,
    purchased_at: inspected.purchased_at || nowIso,
    expires_at: inspected.expires_at || null,
    verification: {
      ...inspected.verification,
      source: 'live_verify',
      provider: 'web',
      reason: 'WEB_PLATFORM_USES_RECEIPT_INSPECT',
    },
    success_message: resolveSuccessMessage(inspected.purchase_status),
  };
}

function applyLiveFallback(parsedPayload, nowIso, fallbackMode, verifyError) {
  const fallbackDecision =
    fallbackMode === 'pending_only'
      ? {
          verify_mode: 'live_verify',
          purchase_status: 'pending',
          purchased_at: nowIso,
          expires_at: null,
          verification: {
            source: 'live_verify',
            mode: 'fallback',
            fallback_mode: 'pending_only',
          },
          success_message: '결제 검증 요청이 접수되었습니다.',
        }
      : buildReceiptInspectDecision(parsedPayload, nowIso, 'live_verify');

  return {
    ...fallbackDecision,
    verification: {
      ...(fallbackDecision.verification || {}),
      fallback_mode: fallbackMode,
      live_verify_error: {
        code: verifyError.code || 'VERIFICATION_FAILED',
        status: verifyError.status || 502,
        message: verifyError.message || '결제 검증 실패',
        details: verifyError.details || null,
      },
    },
  };
}

async function resolveVerifyDecision(parsedPayload = {}, options = {}) {
  const verifyMode = normalizeVerifyMode(
    process.env.MONETIZATION_VERIFY_MODE || 'pending_only'
  );
  const nowIso = new Date().toISOString();
  let decision = null;

  if (verifyMode === 'auto_active') {
    decision = {
      verify_mode: verifyMode,
      purchase_status: 'active',
      purchased_at: nowIso,
      expires_at: null,
      verification: {
        source: 'mode_override',
        mode: verifyMode,
      },
      success_message: '결제가 확인되었습니다.',
    };
    return attachPurchaseIdentity(decision, parsedPayload);
  }

  if (verifyMode === 'receipt_inspect') {
    decision = buildReceiptInspectDecision(parsedPayload, nowIso, verifyMode);
    return attachPurchaseIdentity(decision, parsedPayload);
  }

  if (verifyMode === 'live_verify') {
    try {
      decision = await resolveLiveVerifyDecision(parsedPayload, options, nowIso);
      return attachPurchaseIdentity(decision, parsedPayload);
    } catch (error) {
      if (!(error instanceof PurchaseVerificationError)) {
        throw new PurchaseVerificationError({
          code: 'VERIFICATION_FAILED',
          status: 502,
          message: '실검증 처리 중 예기치 못한 오류가 발생했습니다.',
          details: { cause: error?.message || 'unknown_error' },
        });
      }

      const isStrict = readEnvBoolean(
        process.env.MONETIZATION_VERIFY_LIVE_STRICT,
        false
      );
      if (isStrict) {
        throw error;
      }

      const fallbackMode = normalizeLiveFallbackMode(
        process.env.MONETIZATION_VERIFY_LIVE_FALLBACK_MODE || 'receipt_inspect'
      );
      decision = applyLiveFallback(parsedPayload, nowIso, fallbackMode, error);
      return attachPurchaseIdentity(decision, parsedPayload);
    }
  }

  decision = {
    verify_mode: verifyMode,
    purchase_status: 'pending',
    purchased_at: nowIso,
    expires_at: null,
    verification: {
      source: 'mode_override',
      mode: verifyMode,
    },
    success_message: '결제 검증 요청이 접수되었습니다.',
  };
  return attachPurchaseIdentity(decision, parsedPayload);
}

module.exports = {
  PurchaseVerificationError,
  normalizeVerifyMode,
  resolveVerifyDecision,
};
