const ALLOWED_VERIFY_MODES = new Set([
  'pending_only',
  'auto_active',
  'receipt_inspect',
]);

function normalizeVerifyMode(raw) {
  if (typeof raw !== 'string') return 'pending_only';
  const normalized = raw.trim().toLowerCase();
  return ALLOWED_VERIFY_MODES.has(normalized) ? normalized : 'pending_only';
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
    verification: {
      source: 'receipt_inspect',
      platform: 'apple',
      payload_source,
      revoked_at: revokedAtIso,
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
  const normalizedStatus = ['active', 'expired', 'refunded', 'canceled', 'pending'].includes(
    statusCandidate
  )
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

function resolveVerifyDecision(parsedPayload = {}) {
  const verifyMode = normalizeVerifyMode(
    process.env.MONETIZATION_VERIFY_MODE || 'pending_only'
  );
  const nowIso = new Date().toISOString();

  if (verifyMode === 'auto_active') {
    return {
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
  }

  if (verifyMode === 'receipt_inspect') {
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
      verification: {
        ...inspected.verification,
        receipt_source: receipt.source,
      },
      success_message: resolveSuccessMessage(inspected.purchase_status),
    };
  }

  return {
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
}

module.exports = {
  resolveVerifyDecision,
};
