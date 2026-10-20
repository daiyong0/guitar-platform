'use strict';

const jwt = require('jsonwebtoken');

function signAdminToken(config, adminId) {
  return jwt.sign(
    { role: 'admin' },
    config.jwtSecret,
    { subject: String(adminId), expiresIn: config.adminTokenTtl, issuer: 'xianjian-admin' },
  );
}

function signUserToken(config, userId) {
  return jwt.sign(
    { role: 'user' },
    config.jwtSecret,
    { subject: String(userId), expiresIn: config.userTokenTtl, issuer: 'xianjian-miniapp' },
  );
}

function readBearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function verifyToken(config, token, expectedRole) {
  const payload = jwt.verify(token, config.jwtSecret, {
    issuer: expectedRole === 'admin' ? 'xianjian-admin' : 'xianjian-miniapp',
  });
  if (!payload || payload.role !== expectedRole || !payload.sub) {
    const error = new Error('登录状态无效');
    error.status = 401;
    throw error;
  }
  return payload;
}

module.exports = { signAdminToken, signUserToken, readBearerToken, verifyToken };
