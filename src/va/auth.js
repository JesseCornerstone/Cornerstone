const crypto = require('crypto');

function createVaApiAuth() {
  const keys = getConfiguredKeys();
  const requireHttps =
    process.env.VA_REQUIRE_HTTPS === 'true' ||
    (process.env.VA_REQUIRE_HTTPS !== 'false' && process.env.NODE_ENV === 'production');

  return function requireVaApiKey(req, res, next) {
    if (requireHttps && !isHttps(req)) {
      return res.status(403).json({
        ok: false,
        error: 'VA API requires HTTPS.'
      });
    }

    if (!keys.length) {
      return res.status(503).json({
        ok: false,
        error: 'VA API is not configured. Set VA_API_KEY or VA_API_KEYS.'
      });
    }

    const supplied = getSuppliedKey(req);
    if (!supplied || !keys.some(key => safeEqual(supplied, key))) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid or missing VA API key.'
      });
    }

    req.vaClient = {
      keyId: fingerprint(supplied),
      ip:
        req.headers['x-forwarded-for'] ||
        req.socket?.remoteAddress ||
        req.ip ||
        null
    };
    next();
  };
}

function getConfiguredKeys() {
  return [process.env.VA_API_KEY, process.env.VA_API_KEYS]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean);
}

function getSuppliedKey(req) {
  const headerKey = req.get('x-api-key');
  if (headerKey) return headerKey.trim();

  const auth = req.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function isHttps(req) {
  return (
    req.secure ||
    String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() ===
      'https'
  );
}

module.exports = {
  createVaApiAuth
};
