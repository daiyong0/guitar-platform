'use strict';

const express = require('express');
const crypto = require('crypto');
const { HttpError, asyncHandler, parseJsonObject } = require('../utils/http');
const { transaction, nowMysql } = require('../db');
const { EVENT_TYPES } = require('../../shared/constants');

const CONTENT_TYPES = new Set(['score', 'video', '']);
const EVENT_TYPE_SET = new Set(EVENT_TYPES);

function asShortText(value, { max = 160, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error('缺少必填字段');
    return '';
  }
  const text = String(value).trim();
  if (required && !text) throw new Error('缺少必填字段');
  if (text.length > max) throw new Error('字段超长');
  return text;
}

function asNonNegativeNumber(value, { required = false, max = 24 * 60 * 60 * 1000 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('缺少进度字段');
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error('数值字段不合法');
  return Math.round(n);
}

function validateEvent(raw, { requestReceivedAt }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('事件必须是对象');
  const eventType = asShortText(raw.eventType, { max: 40, required: true });
  if (!EVENT_TYPE_SET.has(eventType)) throw new Error('未知事件类型');

  const userId = asShortText(raw.userId, { max: 100, required: true });
  const sessionId = asShortText(raw.sessionId, { max: 100, required: true });
  const page = asShortText(raw.page, { max: 200 });
  const contentTypeRaw = asShortText(raw.contentType, { max: 20 });
  const contentType = CONTENT_TYPES.has(contentTypeRaw) ? contentTypeRaw : (() => {
    throw new Error('contentType 不合法');
  })();
  const contentId = raw.contentId === undefined || raw.contentId === null
    ? ''
    : asShortText(raw.contentId, { max: 100 });
  const extra = parseJsonObject(raw.extra);
  if (JSON.stringify(extra).length > 8000) throw new Error('extra 数据过大');

  let timestamp = Number(raw.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    timestamp = requestReceivedAt;
  }
  timestamp = Math.round(timestamp);
  // Prevent obviously corrupted client clocks from polluting ranges, while
  // retaining a generous window for retried offline queues.
  const now = Date.now();
  if (timestamp > now + 24 * 60 * 60 * 1000) timestamp = now;
  if (timestamp < now - 90 * 24 * 60 * 60 * 1000) timestamp = now - 90 * 24 * 60 * 60 * 1000;

  if (eventType === 'page_view') {
    if (!page) throw new Error('page_view 缺少页面路径');
    extra.enteredAt = Number(extra.enteredAt) || timestamp;
    extra.fromPage = asShortText(extra.fromPage, { max: 200 }) || 'direct';
  }
  if (eventType === 'page_leave') {
    const durationMs = asNonNegativeNumber(extra.durationMs ?? extra.duration, { required: true });
    extra.durationMs = durationMs;
  }
  if (eventType === 'search') {
    extra.keyword = asShortText(extra.keyword, { max: 100 });
    const resultCount = Number(extra.resultCount);
    if (!Number.isFinite(resultCount) || resultCount < 0 || resultCount > 10_000_000) {
      throw new Error('search.resultCount 不合法');
    }
    extra.resultCount = Math.round(resultCount);
    extra.tab = ['scores', 'videos'].includes(extra.tab) ? extra.tab : 'scores';
  }
  if (eventType === 'content_click' || eventType === 'share' || eventType === 'favorite') {
    if (!contentId || !contentType) throw new Error(`${eventType} 缺少内容信息`);
  }
  if (['video_play', 'video_pause', 'video_complete'].includes(eventType)) {
    if (!contentId) throw new Error(`${eventType} 缺少 contentId`);
    extra.progressSeconds = asNonNegativeNumber(extra.progressSeconds, { required: true, max: 7 * 24 * 60 * 60 });
    extra.durationSeconds = asNonNegativeNumber(extra.durationSeconds, { required: true, max: 7 * 24 * 60 * 60 });
  }

  const eventId = raw.eventId
    ? asShortText(raw.eventId, { max: 100 })
    : `srv_${crypto.randomUUID()}`;

  return {
    eventId,
    userId,
    sessionId,
    eventType,
    page,
    contentId,
    contentType,
    extra,
    timestamp,
  };
}

function createBehaviorRouter({ db }) {
  const router = express.Router();

  // POST /api/behavior/batch — intentionally uses no third-party analytics SDK.
  router.post('/behavior/batch', asyncHandler(async (req, res) => {
    const events = req.body && req.body.events;
    if (!Array.isArray(events) || events.length === 0) {
      throw new HttpError(400, 'events 必须是非空数组', 'VALIDATION_ERROR');
    }
    if (events.length > 200) {
      throw new HttpError(413, '单批次最多接收 200 条事件', 'BATCH_TOO_LARGE');
    }

    const receivedAt = nowMysql();
    const valid = [];
    const errors = [];
    events.forEach((event, index) => {
      try {
        valid.push(validateEvent(event, { requestReceivedAt: Date.now() }));
      } catch (error) {
        if (errors.length < 20) errors.push({ index, message: error.message });
      }
    });

    let inserted = 0;
    let duplicates = 0;
    await transaction(db, async (connection) => {
      for (const event of valid) {
        const [result] = await connection.query(`
          INSERT IGNORE INTO behavior_events
            (event_id, user_id, session_id, event_type, page, content_id, content_type, extra, event_time, received_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          event.eventId,
          event.userId,
          event.sessionId,
          event.eventType,
          event.page,
          event.contentId,
          event.contentType,
          JSON.stringify(event.extra),
          event.timestamp,
          receivedAt,
        ]);
        if (Number(result.affectedRows) > 0) inserted += 1;
        else duplicates += 1;
      }
    });

    res.status(202).json({
      accepted: inserted,
      duplicates,
      rejected: events.length - valid.length,
      errors,
    });
  }));

  return router;
}

module.exports = { createBehaviorRouter, validateEvent };
