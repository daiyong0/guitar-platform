'use strict';

const express = require('express');
const {
  HttpError,
  asyncHandler,
  requireString,
  optionalString,
  requireEnum,
  toInteger,
  parsePositiveInt,
  escapeLike,
  parseJsonArray,
} = require('../utils/http');
const {
  normalizeAssetUrl,
  serializeScore,
  serializeVideo,
} = require('../utils/assets');
const {
  queryOne,
  queryAll,
  execute,
  transaction,
  nowMysql,
} = require('../db');

function createAdminContentRouter({ db }) {
  const router = express.Router();

  function pagination(req, fallbackSize = 20) {
    const page = parsePositiveInt(req.query.page, 1, { min: 1, max: 100000 });
    const pageSize = parsePositiveInt(req.query.pageSize, fallbackSize, { min: 1, max: 100 });
    return { page, pageSize, offset: (page - 1) * pageSize };
  }

  function scorePayload(body, existing = null) {
    const title = requireString(body && body.title, '标题', { max: 80 });
    const tagsRaw = Array.isArray(body.tags) ? body.tags : [];
    const tags = [...new Set(tagsRaw.map((tag) => requireString(tag, '标签', { max: 20 })))].slice(0, 8);
    const description = optionalString(body.description, '描述', { max: 3000 });
    const status = requireEnum(body.status || (existing && existing.status) || 'draft', ['draft', 'published'], '状态');
    const sortWeight = toInteger(body.sortWeight, '排序权重', { min: -9999, max: 9999, defaultValue: 0 });
    const initialBpm = toInteger(
      body.initialBpm === undefined || body.initialBpm === null || body.initialBpm === ''
        ? (existing && existing.initial_bpm)
        : body.initialBpm,
      '节拍速度初始值',
      { min: 40, max: 200, defaultValue: 80 },
    );
    const imagesInput = Array.isArray(body.images)
      ? body.images
      : parseJsonArray(existing && existing.images);
    const images = [...new Set(imagesInput.map((image, index) => (
      normalizeAssetUrl(image, `第 ${index + 1} 张谱面`, { required: true })
    )))].slice(0, 20);
    if (imagesInput.length > 20) throw new HttpError(400, '最多上传 20 张谱面', 'VALIDATION_ERROR');
    if (status === 'published' && images.length === 0) {
      throw new HttpError(400, '发布上架前至少需要一张谱面图片', 'VALIDATION_ERROR');
    }
    return { title, tags, description, status, sortWeight, initialBpm, images };
  }

  function videoPayload(body, existing = null) {
    const title = requireString(body && body.title, '标题', { max: 100 });
    const coverSource = body.coverUrl !== undefined ? body.coverUrl : (existing && existing.cover_url);
    const videoSource = body.videoUrl !== undefined ? body.videoUrl : (existing && existing.video_url);
    const coverUrl = normalizeAssetUrl(coverSource, '封面图', { required: false });
    const videoUrl = normalizeAssetUrl(videoSource, '视频文件', { required: false });
    const category = optionalString(body.category, '分类', { max: 30 });
    const duration = toInteger(body.duration, '时长', { min: 0, max: 7 * 24 * 60 * 60, defaultValue: 0 });
    const status = requireEnum(body.status || (existing && existing.status) || 'draft', ['draft', 'published'], '状态');
    if (status === 'published' && (!coverUrl || !videoUrl)) {
      throw new HttpError(400, '发布上架前必须上传封面图和视频文件', 'VALIDATION_ERROR');
    }
    return { title, coverUrl, videoUrl, category, duration, status };
  }

  router.get('/scores', asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = pagination(req);
    const keyword = optionalString(req.query.keyword, '关键词', { max: 60 });
    const status = optionalString(req.query.status, '状态', { max: 20 });
    const conditions = [];
    const params = [];
    if (status && ['draft', 'published'].includes(status)) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (keyword) {
      conditions.push('title LIKE ?');
      params.push(`%${escapeLike(keyword)}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = await queryOne(
      db,
      `SELECT COUNT(*) AS count FROM guitar_scores ${where}`,
      params,
    );
    const total = Number(totalRow.count) || 0;
    const rows = await queryAll(db, `
      SELECT * FROM guitar_scores ${where}
      ORDER BY sort_weight DESC, created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);
    const allCounts = await queryOne(db, `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
             SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft
      FROM guitar_scores
    `);
    res.json({
      items: rows.map(serializeScore),
      pagination: { page, pageSize, total, hasMore: offset + rows.length < total },
      summary: {
        total: Number(allCounts.total) || 0,
        published: Number(allCounts.published) || 0,
        draft: Number(allCounts.draft) || 0,
      },
    });
  }));

  router.get('/scores/:id', asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const row = Number.isInteger(id)
      ? await queryOne(db, 'SELECT * FROM guitar_scores WHERE id = ?', [id])
      : null;
    if (!row) throw new HttpError(404, '吉他谱不存在', 'NOT_FOUND');
    res.json({ item: serializeScore(row) });
  }));

  router.post('/scores', asyncHandler(async (req, res) => {
    const payload = scorePayload(req.body);
    const now = nowMysql();
    const result = await execute(db, `
      INSERT INTO guitar_scores
        (title, tags, description, images, initial_bpm, status, sort_weight, view_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `, [
      payload.title,
      JSON.stringify(payload.tags),
      payload.description,
      JSON.stringify(payload.images),
      payload.initialBpm,
      payload.status,
      payload.sortWeight,
      now,
      now,
    ]);
    const row = await queryOne(db, 'SELECT * FROM guitar_scores WHERE id = ?', [result.insertId]);
    res.status(201).json({ item: serializeScore(row) });
  }));

  router.put('/scores/:id', asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const existing = Number.isInteger(id)
      ? await queryOne(db, 'SELECT * FROM guitar_scores WHERE id = ?', [id])
      : null;
    if (!existing) throw new HttpError(404, '吉他谱不存在', 'NOT_FOUND');
    const payload = scorePayload(req.body, existing);
    await execute(db, `
      UPDATE guitar_scores
      SET title = ?, tags = ?, description = ?, images = ?, initial_bpm = ?, status = ?, sort_weight = ?, updated_at = ?
      WHERE id = ?
    `, [
      payload.title,
      JSON.stringify(payload.tags),
      payload.description,
      JSON.stringify(payload.images),
      payload.initialBpm,
      payload.status,
      payload.sortWeight,
      nowMysql(),
      id,
    ]);
    const row = await queryOne(db, 'SELECT * FROM guitar_scores WHERE id = ?', [id]);
    res.json({ item: serializeScore(row) });
  }));

  router.patch('/scores/:id/status', asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const row = Number.isInteger(id)
      ? await queryOne(db, 'SELECT * FROM guitar_scores WHERE id = ?', [id])
      : null;
    if (!row) throw new HttpError(404, '吉他谱不存在', 'NOT_FOUND');
    const status = requireEnum(req.body && req.body.status, ['draft', 'published'], '状态');
    if (status === 'published' && parseJsonArray(row.images).length === 0) {
      throw new HttpError(400, '没有谱面图片，无法上架', 'VALIDATION_ERROR');
    }
    await execute(
      db,
      'UPDATE guitar_scores SET status = ?, updated_at = ? WHERE id = ?',
      [status, nowMysql(), id],
    );
    const updated = await queryOne(db, 'SELECT * FROM guitar_scores WHERE id = ?', [id]);
    res.json({ item: serializeScore(updated) });
  }));

  router.delete('/scores/:id', asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new HttpError(404, '吉他谱不存在', 'NOT_FOUND');
    await transaction(db, async (connection) => {
      const [result] = await connection.query('DELETE FROM guitar_scores WHERE id = ?', [id]);
      if (!result.affectedRows) throw new HttpError(404, '吉他谱不存在', 'NOT_FOUND');
      await connection.query(
        "DELETE FROM favorites WHERE content_type = 'score' AND content_id = ?",
        [id],
      );
    });
    res.json({ ok: true });
  }));

  // ---------------------------- videos ----------------------------
  router.get('/videos', asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = pagination(req);
    const keyword = optionalString(req.query.keyword, '关键词', { max: 60 });
    const status = optionalString(req.query.status, '状态', { max: 20 });
    const conditions = [];
    const params = [];
    if (status && ['draft', 'published'].includes(status)) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (keyword) {
      conditions.push('title LIKE ?');
      params.push(`%${escapeLike(keyword)}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = await queryOne(
      db,
      `SELECT COUNT(*) AS count FROM live_replays ${where}`,
      params,
    );
    const total = Number(totalRow.count) || 0;
    const rows = await queryAll(db, `
      SELECT * FROM live_replays ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);
    const allCounts = await queryOne(db, `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
             SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft
      FROM live_replays
    `);
    res.json({
      items: rows.map(serializeVideo),
      pagination: { page, pageSize, total, hasMore: offset + rows.length < total },
      summary: {
        total: Number(allCounts.total) || 0,
        published: Number(allCounts.published) || 0,
        draft: Number(allCounts.draft) || 0,
      },
    });
  }));

  router.get('/videos/:id', asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const row = Number.isInteger(id)
      ? await queryOne(db, 'SELECT * FROM live_replays WHERE id = ?', [id])
      : null;
    if (!row) throw new HttpError(404, '视频不存在', 'NOT_FOUND');
    res.json({ item: serializeVideo(row) });
  }));

  router.post('/videos', asyncHandler(async (req, res) => {
    const payload = videoPayload(req.body);
    const now = nowMysql();
    const result = await execute(db, `
      INSERT INTO live_replays (title, cover_url, video_url, duration, category, status, view_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `, [
      payload.title,
      payload.coverUrl,
      payload.videoUrl,
      payload.duration,
      payload.category,
      payload.status,
      now,
      now,
    ]);
    const row = await queryOne(db, 'SELECT * FROM live_replays WHERE id = ?', [result.insertId]);
    res.status(201).json({ item: serializeVideo(row) });
  }));

  router.put('/videos/:id', asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const existing = Number.isInteger(id)
      ? await queryOne(db, 'SELECT * FROM live_replays WHERE id = ?', [id])
      : null;
    if (!existing) throw new HttpError(404, '视频不存在', 'NOT_FOUND');
    const payload = videoPayload(req.body, existing);
    await execute(db, `
      UPDATE live_replays
      SET title = ?, cover_url = ?, video_url = ?, duration = ?, category = ?, status = ?, updated_at = ?
      WHERE id = ?
    `, [
      payload.title,
      payload.coverUrl,
      payload.videoUrl,
      payload.duration,
      payload.category,
      payload.status,
      nowMysql(),
      id,
    ]);
    const row = await queryOne(db, 'SELECT * FROM live_replays WHERE id = ?', [id]);
    res.json({ item: serializeVideo(row) });
  }));

  router.patch('/videos/:id/status', asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const row = Number.isInteger(id)
      ? await queryOne(db, 'SELECT * FROM live_replays WHERE id = ?', [id])
      : null;
    if (!row) throw new HttpError(404, '视频不存在', 'NOT_FOUND');
    const status = requireEnum(req.body && req.body.status, ['draft', 'published'], '状态');
    if (status === 'published' && (!row.cover_url || !row.video_url)) {
      throw new HttpError(400, '缺少封面或视频文件，无法上架', 'VALIDATION_ERROR');
    }
    await execute(
      db,
      'UPDATE live_replays SET status = ?, updated_at = ? WHERE id = ?',
      [status, nowMysql(), id],
    );
    const updated = await queryOne(db, 'SELECT * FROM live_replays WHERE id = ?', [id]);
    res.json({ item: serializeVideo(updated) });
  }));

  router.delete('/videos/:id', asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new HttpError(404, '视频不存在', 'NOT_FOUND');
    await transaction(db, async (connection) => {
      const [result] = await connection.query('DELETE FROM live_replays WHERE id = ?', [id]);
      if (!result.affectedRows) throw new HttpError(404, '视频不存在', 'NOT_FOUND');
      await connection.query(
        "DELETE FROM favorites WHERE content_type = 'video' AND content_id = ?",
        [id],
      );
    });
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createAdminContentRouter };
