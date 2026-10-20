'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { HttpError, asyncHandler, requireString } = require('../utils/http');
const { signAdminToken } = require('../utils/tokens');
const { createLoginLimiter } = require('../middleware/rate-limit');
const { queryOne } = require('../db');

const DUMMY_HASH = '$2b$10$5kGUUxLXA34de1jnlI1p9.AEPUUibGjegV9dECVL26Oe5jKpa7tMu';

function createAdminAuthRouter({ db, config, requireAdmin }) {
  const router = express.Router();
  const loginLimiter = createLoginLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

  router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
    const username = requireString(req.body && req.body.username, '用户名', { min: 1, max: 60 });
    const password = requireString(req.body && req.body.password, '密码', { min: 1, max: 200 });
    // MySQL 表使用 utf8mb4_unicode_ci，用户名比较天然大小写不敏感。
    const admin = await queryOne(db, 'SELECT * FROM admin_users WHERE username = ?', [username]);
    const passwordHash = admin ? admin.password_hash : DUMMY_HASH;
    const ok = await bcrypt.compare(password, passwordHash);
    if (!admin || !ok) {
      throw new HttpError(401, '用户名或密码错误', 'INVALID_CREDENTIALS');
    }

    const token = signAdminToken(config, admin.id);
    res.json({
      token,
      admin: { id: admin.id, username: admin.username, createdAt: admin.created_at },
    });
  }));

  router.get('/me', requireAdmin, asyncHandler(async (req, res) => {
    const admin = await queryOne(
      db,
      'SELECT id, username, created_at FROM admin_users WHERE id = ?',
      [req.admin.id],
    );
    if (!admin) throw new HttpError(401, '管理员不存在', 'UNAUTHORIZED');
    res.json({ admin: { id: admin.id, username: admin.username, createdAt: admin.created_at } });
  }));

  return router;
}

module.exports = { createAdminAuthRouter };
