// public/js/analytics.js
// 최소 계측 유틸
// - 세션/익명 식별자 관리
// - /api/ux-events 전송(sendBeacon + fetch keepalive)

(function bootstrapAnalytics() {
  const ENDPOINT = '/api/ux-events';
  const ANON_KEY = 'glsoop:analytics:anonymous_id';
  const SESSION_KEY = 'glsoop:analytics:session_id';

  function safeRead(storage, key) {
    try {
      return storage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeWrite(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch (error) {
      // storage가 비활성화된 브라우저 환경에선 무시
    }
  }

  function createId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}_${window.crypto.randomUUID()}`;
    }
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${random}`;
  }

  function getAnonymousId() {
    const cached = safeRead(window.localStorage, ANON_KEY);
    if (cached) return cached;
    const generated = createId('anon');
    safeWrite(window.localStorage, ANON_KEY, generated);
    return generated;
  }

  function getSessionId() {
    const cached = safeRead(window.sessionStorage, SESSION_KEY);
    if (cached) return cached;
    const generated = createId('sess');
    safeWrite(window.sessionStorage, SESSION_KEY, generated);
    return generated;
  }

  function normalizeEventName(name) {
    if (typeof name !== 'string') return '';
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return '';
    if (!/^[a-z0-9_]+$/.test(trimmed)) return '';
    return trimmed;
  }

  function normalizeProperties(properties) {
    if (!properties || typeof properties !== 'object') {
      return {};
    }
    return properties;
  }

  function sendPayload(payload, options = {}) {
    const { useBeacon = false } = options;
    const json = JSON.stringify(payload);

    if (useBeacon && navigator.sendBeacon) {
      try {
        const blob = new Blob([json], { type: 'application/json' });
        if (navigator.sendBeacon(ENDPOINT, blob)) {
          return Promise.resolve(true);
        }
      } catch (error) {
        // beacon 실패 시 fetch fallback
      }
    }

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: json,
    })
      .then(() => true)
      .catch(() => false);
  }

  function trackEvent(eventName, properties = {}, options = {}) {
    const normalizedName = normalizeEventName(eventName);
    if (!normalizedName) return;

    const payload = {
      event_name: normalizedName,
      session_id: getSessionId(),
      anonymous_id: getAnonymousId(),
      page_path: `${window.location.pathname}${window.location.search || ''}`,
      referrer: document.referrer || null,
      properties: normalizeProperties(properties),
    };

    sendPayload(payload, options).catch(() => {
      // 계측 전송 실패는 UX 흐름을 막지 않는다.
    });
  }

  window.glsoopAnalytics = {
    trackEvent,
  };
})();
