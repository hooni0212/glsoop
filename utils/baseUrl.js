const DEFAULT_PORT = process.env.PORT || 3000;
const DEFAULT_PRODUCTION_BASE = 'https://www.glsoop.com';
let baseUrlWarned = false;

function normalizeBaseUrl(url) {
  if (!url) return '';
  return String(url).trim().replace(/\/+$/, '');
}

function isLoopbackHost(host) {
  if (!host) return false;
  // host may include port, e.g. "127.0.0.1:3000" or "localhost:3000"
  return (
    /^localhost(?::\d+)?$/i.test(host) ||
    /^127(?:\.\d{1,3}){3}(?::\d+)?$/.test(host) ||
    /^\[::1\](?::\d+)?$/.test(host)
  );
}

/**
 * 이메일 링크 등 외부에 노출되는 URL의 기준값을 반환합니다.
 *
 * 우선순위:
 *  1) 환경변수 BASE_URL / PUBLIC_BASE_URL (운영 환경 권장)
 *  2) 프록시 전달 헤더 (x-forwarded-host / x-forwarded-proto)
 *  3) 요청의 host/protocol
 *  4) localhost 기본값
 *
 * 참고:
 *  - Nginx 뒤에서 동작할 때 `Host`가 `127.0.0.1:3000`으로 들어올 수 있습니다.
 *    ALLOW_LOOPBACK_BASE_URL을 "1"로 두지 않았다면, 메일 링크가 로컬로 찍히는
 *    문제를 막기 위해 공개용 기본 URL로 강제 변경합니다.
 */
function getBaseUrl(req) {
  const envBase = normalizeBaseUrl(process.env.BASE_URL || process.env.PUBLIC_BASE_URL);
  if (envBase) return envBase;

  const headers = (req && req.headers) || {};
  const forwardedProto = (headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = (headers['x-forwarded-host'] || '').split(',')[0].trim();

  const protocol = forwardedProto || (req && req.protocol) || 'http';
  const host = forwardedHost || (req && req.get ? req.get('host') : '') || '';

  const fallback = host ? `${protocol}://${host}` : `http://localhost:${DEFAULT_PORT}`;

  const allowLoopback = process.env.ALLOW_LOOPBACK_BASE_URL === '1';
  if (!allowLoopback && isLoopbackHost(host)) {
    if (!baseUrlWarned) {
      console.warn(
        '[warn] 외부 링크 생성 시 루프백 호스트가 감지되었습니다. 운영 환경에서는 BASE_URL을 설정하거나, ' +
          '로컬 개발 시에만 ALLOW_LOOPBACK_BASE_URL=1을 허용하세요.'
      );
      baseUrlWarned = true;
    }
    return DEFAULT_PRODUCTION_BASE;
  }

  // If the server runs in production but BASE_URL is missing, prefer the known public URL.
  if (process.env.NODE_ENV === 'production') {
    return DEFAULT_PRODUCTION_BASE;
  }

  return normalizeBaseUrl(fallback) || `http://localhost:${DEFAULT_PORT}`;
}

module.exports = { getBaseUrl };
