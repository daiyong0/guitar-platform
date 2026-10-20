'use strict';

const express = require('express');
const { HttpError, asyncHandler, requireEnum, toInteger, parseJsonArray } = require('../utils/http');
const { queryAll, queryOne, execute, nowMysql } = require('../db');

function createUserRouter({ db, requireUser }) {
  const router = express.Router();
  router.use(requireUser);

  async function loadFavoriteContent(type, id) {
    if (type === 'score') {
      const row = await queryOne(
        db,
        "SELECT * FROM guitar_scores WHERE id = ? AND status = 'published'",
        [id],
      );
      if (!row) return null;
      return {
        contentType: 'score',
        contentId: row.id,
        title: row.title,
        coverUrl: parseJsonArray(row.images)[0] || '',
        description: row.description,
        tags: parseJsonArray(row.tags),
      };
    }
    const row = await queryOne(
      db,
      "SELECT * FROM live_replays WHERE id = ? AND status = 'published'",
      [id],
    );
    if (!row) return null;
    return {
      contentType: 'video',
      contentId: row.id,
      title: row.title,
      coverUrl: row.cover_url,
      category: row.category,
      duration: row.duration,
    };
  }

  router.get('/favorites', asyncHandler(async (req, res) => {
    const rows = await queryAll(
      db,
      'SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC, id DESC',
      [req.user.id],
    );
    const items = [];
    for (const row of rows) {
      const content = await loadFavoriteContent(row.content_type, row.content_id);
      if (!content) continue;
      items.push({ ...content, savedAt: row.created_at });
    }
    res.json({ items });
  }));

  router.get('/favorites/status', asyncHandler(async (req, res) => {
    const contentType = requireEnum(req.query.contentType, ['score', 'video'], 'contentType');
    const contentId = toInteger(req.query.contentId, 'contentId', { min: 1 });
    const row = await queryOne(
      db,
      'SELECT id FROM favorites WHERE user_id = ? AND content_type = ? AND content_id = ?',
      [req.user.id, contentType, contentId],
    );
    res.json({ favorited: Boolean(row) });
  }));

  router.post('/favorites', asyncHandler(async (req, res) => {
    const contentType = requireEnum(req.body && req.body.contentType, ['score', 'video'], 'contentType');
    const contentId = toInteger(req.body && req.body.contentId, 'contentId', { min: 1 });
    const content = await loadFavoriteContent(contentType, contentId);
    if (!content) throw new HttpError(404, '内容不存在或已下架', 'NOT_FOUND');

    await execute(db, `
      INSERT IGNORE INTO favorites (user_id, content_type, content_id, created_at)
      VALUES (?, ?, ?, ?)
    `, [req.user.id, contentType, contentId, nowMysql()]);
    res.json({ favorited: true, content });
  }));

  router.delete('/favorites/:contentType/:contentId', asyncHandler(async (req, res) => {
    const contentType = requireEnum(req.params.contentType, ['score', 'video'], 'contentType');
    const contentId = toInteger(req.params.contentId, 'contentId', { min: 1 });
    await execute(db, `
      DELETE FROM favorites WHERE user_id = ? AND content_type = ? AND content_id = ?
    `, [req.user.id, contentType, contentId]);
    res.json({ favorited: false });
  }));

  return router;
}

module.exports = { createUserRouter };
