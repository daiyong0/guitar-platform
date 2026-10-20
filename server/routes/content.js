'use strict';

const express = require('express');
const {
  HttpError,
  asyncHandler,
  parsePositiveInt,
  optionalString,
  escapeLike,
  parseJsonArray,
} = require('../utils/http');
const { serializeScore, serializeVideo } = require('../utils/assets');
const { queryOne, queryAll, execute } = require('../db');
const { SCORE_TAGS, VIDEO_CATEGORIES } = require('../../shared/constants');

function createPublicContentRouter({ db }) {
  const router = express.Router();

  function pagination(req) {
    const page = parsePositiveInt(req.query.page, 1, { min: 1, max: 100000 });
    const pageSize = parsePositiveInt(req.query.pageSize, 12, { min: 1, max: 50 });
    return { page, pageSize, offset: (page - 1) * pageSize };
  }

  router.get('/scores/tags', asyncHandler(async (_req, res) => {
    const rows = await queryAll(
      db,
      "SELECT tags FROM guitar_scores WHERE status = 'published'",
    );
    const used = new Set();
    for (const row of rows) {
      for (const tag of parseJsonArray(row.tags)) used.add(tag);
    }
    res.json({ tags: [...new Set([...SCORE_TAGS, ...used])] });
  }));

  router.get('/scores', asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = pagination(req);
    const keyword = optionalString(req.query.keyword, '关键词', { max: 60 });
    const tag = optionalString(req.query.tag, '标签', { max: 20 });
    const conditions = ["s.status = 'published'"];
    const params = [];
    if (keyword) {
      const like = `%${escapeLike(keyword)}%`;
      conditions.push('(s.title LIKE ? OR s.description LIKE ?)');
      params.push(like, like);
    }
    if (tag) {
      // MySQL JSON 数组包含指定字符串：JSON_CONTAINS(tags, JSON_QUOTE(?))
      conditions.push('JSON_CONTAINS(s.tags, JSON_QUOTE(?))');
      params.push(tag);
    }
    const where = conditions.join(' AND ');
    const totalRow = await queryOne(
      db,
      `SELECT COUNT(*) AS count FROM guitar_scores s WHERE ${where}`,
      params,
    );
    const total = Number(totalRow.count) || 0;
    const rows = await queryAll(db, `
      SELECT s.* FROM guitar_scores s
      WHERE ${where}
      ORDER BY s.sort_weight DESC, s.created_at DESC, s.id DESC
      LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);
    res.json({
      items: rows.map(serializeScore),
      pagination: { page, pageSize, total, hasMore: offset + rows.length < total },
    });
  }));

  router.get('/scores/:id', asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, '吉他谱 ID 不正确', 'VALIDATION_ERROR');
    const found = await queryOne(
      db,
      "SELECT * FROM guitar_scores WHERE id = ? AND status = 'published'",
      [id],
    );
    if (!found) throw new HttpError(404, '吉他谱不存在或已下架', 'NOT_FOUND');
    await execute(db, 'UPDATE guitar_scores SET view_count = view_count + 1 WHERE id = ?', [id]);
    const row = await queryOne(db, 'SELECT * FROM guitar_scores WHERE id = ?', [id]);
    res.json({ item: serializeScore(row) });
  }));

  router.get('/videos/categories', asyncHandler(async (_req, res) => {
    const rows = await queryAll(
      db,
      "SELECT category FROM live_replays WHERE status = 'published' AND category <> ''",
    );
    const categories = [...new Set([...VIDEO_CATEGORIES, ...rows.map((row) => row.category)])];
    res.json({ categories });
  }));

  router.get('/videos', asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = pagination(req);
    const keyword = optionalString(req.query.keyword, '关键词', { max: 60 });
    const category = optionalString(req.query.category, '分类', { max: 30 });
    const conditions = ["status = 'published'"];
    const params = [];
    if (keyword) {
      const like = `%${escapeLike(keyword)}%`;
      conditions.push('title LIKE ?');
      params.push(like);
    }
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    const where = conditions.join(' AND ');
    const totalRow = await queryOne(
      db,
      `SELECT COUNT(*) AS count FROM live_replays WHERE ${where}`,
      params,
    );
    const total = Number(totalRow.count) || 0;
    const rows = await queryAll(db, `
      SELECT * FROM live_replays WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);
    res.json({
      items: rows.map(serializeVideo),
      pagination: { page, pageSize, total, hasMore: offset + rows.length < total },
    });
  }));

  router.get('/videos/:id', asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, '视频 ID 不正确', 'VALIDATION_ERROR');
    const found = await queryOne(
      db,
      "SELECT * FROM live_replays WHERE id = ? AND status = 'published'",
      [id],
    );
    if (!found) throw new HttpError(404, '视频不存在或已下架', 'NOT_FOUND');
    await execute(db, 'UPDATE live_replays SET view_count = view_count + 1 WHERE id = ?', [id]);
    const row = await queryOne(db, 'SELECT * FROM live_replays WHERE id = ?', [id]);
    res.json({ item: serializeVideo(row) });
  }));

  return router;
}

module.exports = { createPublicContentRouter };
