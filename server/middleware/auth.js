'use strict';

const { readBearerToken, verifyToken } = require('../utils/tokens');
const { queryOne } = require('../db');

function authFailure(res, message = '登录已失效，请重新登录') {
  return res.status(401).json({ code: 'UNAUTHORIZED', message });
}

function createRequireAdmin({ config }) {
  return function requireAdmin(req, res, next) {
    const token = readBearerToken(req);
    if (!token) return authFailure(res, '请先登录管理后台');
    try {
      const payload = verifyToken(config, token, 'admin');
      req.admin = { id: Number(payload.sub) };
      return next();
    } catch (_error) {
      return authFailure(res);
    }
  };
}

function createRequireUser({ config, db }) {
  return async function requireUser(req, res, next) {
    const token = readBearerToken(req);
    if (!token) return authFailure(res, '请先登录');
    let payload;
    try {
      payload = verifyToken(config, token, 'user');
    } catch (_error) {
      return authFailure(res);
    }
    try {
      const user = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [Number(payload.sub)]);
      if (!user) return authFailure(res, '用户不存在');
      req.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createRequireAdmin, createRequireUser };
