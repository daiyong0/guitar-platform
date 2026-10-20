'use strict';

const express = require('express');
const {
  HttpError,
  asyncHandler,
  parsePositiveInt,
  optionalString,
  escapeLike,
} = require('../utils/http');
const { serializeUser } = require('../utils/assets');
const { queryOne, queryAll } = require('../db');

function createAdminUsersRouter({ db, vault }) {
  const router = express.Router();

  /**
   * 后台管理员接口专用的用户序列化：
   * - 公开登录接口仍然只返回 phoneMasked；
   * - 只有通过 requireAdmin 的 /api/admin/users* 才会尝试解密完整手机号；
   * - 解密失败时安全回退到脱敏手机号，绝不把密文返回给前端。
   */
  function serializeAdminUser(row) {
    const base = serializeUser(row);
    let phone = '';
    try {
      if (row.phone_encrypted) phone = vault.decrypt(row.phone_encrypted);
    } catch (error) {
      console.warn('[admin-users] phone decrypt failed for user', row.id, error.message);
    }
    const phoneIsFull = /^1\d{10}$/.test(phone);
    return {
      ...base,
      phone: phoneIsFull ? phone : base.phoneMasked,
      phoneIsFull,
    };
  }

  async function statsForUser(userId) {
    const idText = String(userId);
    const stats = await queryOne(db, `
      SELECT
        (SELECT COUNT(*) FROM behavior_events WHERE user_id = ?) AS event_count,
        (SELECT COUNT(DISTINCT session_id) FROM behavior_events WHERE user_id = ?) AS session_count,
        (SELECT MAX(event_time) FROM behavior_events WHERE user_id = ?) AS last_event_at,
        (SELECT COUNT(*) FROM favorites WHERE user_id = ?) AS favorite_count
    `, [idText, idText, idText, userId]);
    return {
      eventCount: Number(stats.event_count) || 0,
      sessionCount: Number(stats.session_count) || 0,
      lastEventAt: stats.last_event_at ? new Date(stats.last_event_at).toISOString() : null,
      favoriteCount: Number(stats.favorite_count) || 0,
    };
  }

  router.get('/users', asyncHandler(async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1, { min: 1, max: 100000 });
    const pageSize = parsePositiveInt(req.query.pageSize, 20, { min: 1, max: 100 });
    const offset = (page - 1) * pageSize;
    const search = optionalString(req.query.search, '搜索关键词', { max: 60 });
    const conditions = [];
    const params = [];
    if (search) {
      const digits = search.replace(/\D/g, '');
      if (digits.length === 11 && /^1\d{10}$/.test(digits)) {
        conditions.push('u.phone_hash = ?');
        params.push(vault.hash(digits));
      } else {
        conditions.push('(u.nickname LIKE ? OR u.phone_masked LIKE ?)');
        const like = `%${escapeLike(search)}%`;
        params.push(like, like);
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = await queryOne(db, `SELECT COUNT(*) AS count FROM users u ${where}`, params);
    const total = Number(totalRow.count) || 0;
    const rows = await queryAll(db, `
      SELECT u.*,
        (SELECT COUNT(*) FROM behavior_events b WHERE b.user_id = CAST(u.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) AS event_count,
        (SELECT COUNT(DISTINCT b.session_id) FROM behavior_events b WHERE b.user_id = CAST(u.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) AS session_count,
        (SELECT MAX(b.event_time) FROM behavior_events b WHERE b.user_id = CAST(u.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci) AS last_event_at
      FROM users u
      ${where}
      ORDER BY u.last_active_at DESC, u.id DESC
      LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);

    res.json({
      items: rows.map((row) => ({
        ...serializeAdminUser(row),
        eventCount: Number(row.event_count) || 0,
        sessionCount: Number(row.session_count) || 0,
        lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : null,
      })),
      pagination: { page, pageSize, total, hasMore: offset + rows.length < total },
    });
  }));

  router.get('/users/:id', asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const row = Number.isInteger(id)
      ? await queryOne(db, 'SELECT * FROM users WHERE id = ?', [id])
      : null;
    if (!row) throw new HttpError(404, '用户不存在', 'NOT_FOUND');

    const sessionRows = await queryAll(db, `
      SELECT session_id,
             MIN(event_time) AS first_at,
             MAX(event_time) AS last_at,
             COUNT(*) AS event_count,
             SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_view_count
      FROM behavior_events
      WHERE user_id = ?
      GROUP BY session_id
      ORDER BY last_at DESC
    `, [String(id)]);
    const sessions = sessionRows.map((session) => ({
      sessionId: session.session_id,
      firstAt: new Date(session.first_at).toISOString(),
      lastAt: new Date(session.last_at).toISOString(),
      eventCount: Number(session.event_count) || 0,
      pageViewCount: Number(session.page_view_count) || 0,
    }));

    res.json({
      user: serializeAdminUser(row),
      stats: await statsForUser(row.id),
      sessions,
    });
  }));

  return router;
}

module.exports = { createAdminUsersRouter };
