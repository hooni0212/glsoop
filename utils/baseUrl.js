const DEFAULT_PRODUCTION_BASE = 'https://www.glsoop.com';

/**
 * Return the base URL for external links (emails, etc.).
 * Prefers process.env.BASE_URL, uses the production domain when host is local,
 * and otherwise falls back to the request host/protocol.
 */
function getBaseUrl(req) {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }

  const host = req && req.get ? req.get('host') : undefined;
  const protocol = (req && req.protocol) || 'http';
  const isLocalHost = host ? /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) : false;

  if (process.env.NODE_ENV === 'production' || isLocalHost || !host) {
    return DEFAULT_PRODUCTION_BASE;
  }

  return `${protocol}://${host}`;
}

module.exports = { getBaseUrl };
