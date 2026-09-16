const jwt = require('jsonwebtoken');
const env = require('../config/env');

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name, type: 'access' }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, type: 'refresh' }, env.jwtSecret, { expiresIn: env.refreshExpiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

module.exports = { signAccessToken, signRefreshToken, verifyToken };
