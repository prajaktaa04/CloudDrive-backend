const { verifyToken } = require('../utils/auth');
const { apiError } = require('../utils/errors');

function requireAuth(req, _res, next) {
  try {
    const token = req.cookies?.access_token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return next(apiError(401, 'UNAUTHORIZED', 'Authentication required.'));
    const payload = verifyToken(token);
    if (payload.type !== 'access') return next(apiError(401, 'UNAUTHORIZED', 'Invalid access token.'));
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch {
    next(apiError(401, 'UNAUTHORIZED', 'Session expired.'));
  }
}

module.exports = { requireAuth };
