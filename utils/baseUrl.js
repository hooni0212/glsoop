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
 * Return the base URL for external links (emails, etc.).
 *
 * Priority:
 *  1) env BASE_URL / PUBLIC_BASE_URL (recommended for production)
 *  2) forwarded headers (x-forwarded-host / x-forwarded-proto)
 *  3) request host/protocol
 *  4) localhost fallback
 *
 * Note:
 *  - When running behind Nginx, the request host can be "127.0.0.1:3000".
 *    In that case, if ALLOW_LOOPBACK_BASE_URL is not set to "1", we fall back
 *    to the public production base to avoid sending localhost links in emails.
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
        '[warn] Detected loopback host for external link generation. Set BASE_URL (recommended) ' +
          'or set ALLOW_LOOPBACK_BASE_URL=1 for local development.'
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
