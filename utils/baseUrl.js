const DEFAULT_PORT = process.env.PORT || 3000;
const DEFAULT_PRODUCTION_BASE = 'https://www.glsoop.com';
let baseUrlWarned = false;

/**
 * Return the base URL for external links (emails, etc.).
 * Prefers process.env.BASE_URL, falls back to request-based host/protocol,
 * and finally localhost with the configured port.
 */
function getBaseUrl(req) {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }

  if (process.env.NODE_ENV === 'production') {
    return DEFAULT_PRODUCTION_BASE;
  }

  const host = req && req.get ? req.get('host') : undefined;
  const protocol = (req && req.protocol) || 'http';
  const fallback = host ? `${protocol}://${host}` : `http://localhost:${DEFAULT_PORT}`;

  if (process.env.NODE_ENV === 'production' && !baseUrlWarned) {
    console.warn(
      '[security] BASE_URL is not set; falling back to request host. Configure BASE_URL in production.'
    );
    baseUrlWarned = true;
  }

  return fallback;
}

module.exports = { getBaseUrl };
