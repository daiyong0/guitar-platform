'use strict';

const express = require('express');
const {
  HttpError,
  asyncHandler,
  parsePositiveInt,
  parseJsonObject,
  parseJsonArray,
} = require('../utils/http');
const { queryOne, queryAll } = require('../db');
const {
  PAGE_LABELS,
  FUNNEL_INTERACTION_EVENTS,
} = require('../../shared/constants');

const LIST_PAGES = new Set(['pages/scores/index', 'pages/videos/index']);
const DETAIL_PAGES = new Set(['pages/scores/detail', 'pages/videos/detail']);

function pageLabel(page) {
  return PAGE_LABELS[page] || page || '未知页面';
}

function resolveRange(query) {
  if (String(query.days || '30') === 'all') {
    return { days: 0, since: 0, label: '全部时间' };
  }
  const requested = Number.parseInt(query.days, 10);
  const days = [7, 30, 90].includes(requested) ? requested : 30;
  return {
    days,
    since: Date.now() - days * 24 * 60 * 60 * 1000,
    label: `最近 ${days} 天`,
  };
}

function safeDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, 24 * 60 * 60 * 1000);
}

function createAnalyticsRouter({ db }) {
  const router = express.Router();

  async function contentMeta(type, id) {
    const numericId = Number.parseInt(id, 10);
    if (!Number.isInteger(numericId)) return { title: '已删除内容', contentAvailable: false, coverUrl: '' };
    if (type === 'score') {
      const row = await queryOne(
        db,
        'SELECT title, images, status FROM guitar_scores WHERE id = ?',
        [numericId],
      );
      if (!row) return { title: '已删除内容', contentAvailable: false, coverUrl: '' };
      const images = parseJsonArray(row.images);
      return { title: row.title, contentAvailable: row.status === 'published', coverUrl: images[0] || '' };
    }
    if (type === 'video') {
      const row = await queryOne(
        db,
        'SELECT title, cover_url, status FROM live_replays WHERE id = ?',
        [numericId],
      );
      if (!row) return { title: '已删除内容', contentAvailable: false, coverUrl: '' };
      return { title: row.title, contentAvailable: row.status === 'published', coverUrl: row.cover_url || '' };
    }
    return { title: '未知内容', contentAvailable: false, coverUrl: '' };
  }

  router.get('/overall', asyncHandler(async (req, res) => {
    const range = resolveRange(req.query);
    const since = range.since;
    const whereSince = since ? 'AND event_time >= ?' : '';
    const paramsSince = since ? [since] : [];

    const summaryRow = await queryOne(db, `
      SELECT COUNT(*) AS total_events,
             COUNT(DISTINCT user_id) AS unique_users,
             COUNT(DISTINCT session_id) AS sessions
      FROM behavior_events WHERE 1 = 1 ${whereSince}
    `, paramsSince);
    const pageViewRow = await queryOne(db, `
      SELECT COUNT(*) AS count FROM behavior_events
      WHERE event_type = 'page_view' ${whereSince}
    `, paramsSince);
    const shareRow = await queryOne(db, `
      SELECT COUNT(*) AS count FROM behavior_events
      WHERE event_type = 'share' ${whereSince}
    `, paramsSince);
    const favoriteRow = await queryOne(db, `
      SELECT COUNT(*) AS count FROM behavior_events
      WHERE event_type = 'favorite' ${whereSince}
    `, paramsSince);
    const completeRow = await queryOne(db, `
      SELECT COUNT(*) AS count FROM behavior_events
      WHERE event_type = 'video_complete' ${whereSince}
    `, paramsSince);

    const pageRows = await queryAll(db, `
      SELECT page, COUNT(*) AS views, COUNT(DISTINCT user_id) AS users
      FROM behavior_events
      WHERE event_type = 'page_view' AND page <> '' ${whereSince}
      GROUP BY page
      ORDER BY views DESC, page ASC
      LIMIT 12
    `, paramsSince);

    const durationRows = await queryAll(db, `
      SELECT page, extra FROM behavior_events
      WHERE event_type = 'page_leave' AND page <> '' ${whereSince}
    `, paramsSince);
    const durationBuckets = new Map();
    let allDurationTotal = 0;
    let allDurationSamples = 0;
    for (const row of durationRows) {
      const extra = parseJsonObject(row.extra);
      const duration = safeDuration(extra.durationMs ?? extra.duration);
      if (duration === null) continue;
      const bucket = durationBuckets.get(row.page) || { total: 0, samples: 0 };
      bucket.total += duration;
      bucket.samples += 1;
      durationBuckets.set(row.page, bucket);
      allDurationTotal += duration;
      allDurationSamples += 1;
    }
    const averageDurations = [...durationBuckets.entries()]
      .map(([page, bucket]) => ({
        page,
        pageLabel: pageLabel(page),
        avgDurationMs: Math.round(bucket.total / bucket.samples),
        samples: bucket.samples,
      }))
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs);

    const heatRows = await queryAll(db, `
      SELECT content_type, content_id,
             SUM(CASE WHEN event_type = 'content_click' THEN 1 ELSE 0 END) AS clicks,
             SUM(CASE WHEN event_type = 'video_play' THEN 1 ELSE 0 END) AS plays,
             COUNT(*) AS heat
      FROM behavior_events
      WHERE event_type IN ('content_click', 'video_play')
        AND content_id <> '' AND content_id IS NOT NULL ${whereSince}
      GROUP BY content_type, content_id
      ORDER BY heat DESC, clicks DESC
      LIMIT 12
    `, paramsSince);

    const contentHeat = [];
    for (const row of heatRows) {
      const meta = await contentMeta(row.content_type, row.content_id);
      contentHeat.push({
        contentType: row.content_type,
        contentId: row.content_id,
        title: meta.title,
        coverUrl: meta.coverUrl,
        contentAvailable: meta.contentAvailable,
        clicks: Number(row.clicks) || 0,
        plays: Number(row.plays) || 0,
        heat: Number(row.heat) || 0,
      });
    }

    const funnelRows = await queryAll(db, `
      SELECT user_id, event_type, page FROM behavior_events
      WHERE 1 = 1 ${whereSince}
    `, paramsSince);
    const stepOneUsers = new Set();
    const stepTwoCandidates = new Set();
    const stepThreeCandidates = new Set();
    for (const row of funnelRows) {
      if (row.event_type === 'page_view' && LIST_PAGES.has(row.page)) {
        stepOneUsers.add(row.user_id);
      }
      if (
        row.event_type === 'content_click'
        || (row.event_type === 'page_view' && DETAIL_PAGES.has(row.page))
      ) {
        stepTwoCandidates.add(row.user_id);
      }
      if (FUNNEL_INTERACTION_EVENTS.includes(row.event_type)) {
        stepThreeCandidates.add(row.user_id);
      }
    }
    const stepTwoUsers = new Set([...stepTwoCandidates].filter((id) => stepOneUsers.has(id)));
    const stepThreeUsers = new Set([...stepThreeCandidates].filter((id) => stepTwoUsers.has(id)));
    const funnelCounts = [stepOneUsers.size, stepTwoUsers.size, stepThreeUsers.size];
    const funnelDefinitions = [
      { key: 'list_view', label: '访问首页 / 列表', description: '吉他谱 / 视频 Tab 曝光' },
      { key: 'detail_view', label: '进入内容详情', description: '点击卡片或打开详情页' },
      { key: 'interaction', label: '分享 / 收藏 / 完播', description: '完成任一深度行为' },
    ];
    const funnel = funnelDefinitions.map((step, index) => ({
      ...step,
      users: funnelCounts[index],
      rateFromPrev: index === 0
        ? (funnelCounts[0] > 0 ? 1 : 0)
        : (funnelCounts[index - 1] > 0 ? Number((funnelCounts[index] / funnelCounts[index - 1]).toFixed(4)) : 0),
      rateFromStart: funnelCounts[0] > 0
        ? Number((funnelCounts[index] / funnelCounts[0]).toFixed(4))
        : 0,
    }));

    res.json({
      generatedAt: new Date().toISOString(),
      range: { days: range.days, since: range.since ? new Date(range.since).toISOString() : null, label: range.label },
      summary: {
        totalEvents: Number(summaryRow.total_events) || 0,
        uniqueUsers: Number(summaryRow.unique_users) || 0,
        sessions: Number(summaryRow.sessions) || 0,
        pageViews: Number(pageViewRow.count) || 0,
        shares: Number(shareRow.count) || 0,
        favorites: Number(favoriteRow.count) || 0,
        videoCompletes: Number(completeRow.count) || 0,
        avgDwellMs: allDurationSamples ? Math.round(allDurationTotal / allDurationSamples) : 0,
      },
      pageViews: pageRows.map((row) => ({
        page: row.page,
        pageLabel: pageLabel(row.page),
        views: Number(row.views) || 0,
        users: Number(row.users) || 0,
      })),
      contentHeat,
      averageDurations,
      funnel,
    });
  }));

  router.get('/user-path', asyncHandler(async (req, res) => {
    const userId = String(req.query.userId || '').trim();
    if (!userId || userId.length > 100) {
      throw new HttpError(400, 'userId 必填且长度不能超过 100', 'VALIDATION_ERROR');
    }
    const sessionId = String(req.query.sessionId || '').trim();
    if (sessionId.length > 100) throw new HttpError(400, 'sessionId 不合法', 'VALIDATION_ERROR');
    const limit = parsePositiveInt(req.query.limit, 1000, { min: 1, max: 2000 });

    const conditions = ['user_id = ?'];
    const params = [userId];
    if (sessionId) {
      conditions.push('session_id = ?');
      params.push(sessionId);
    }
    const rows = await queryAll(db, `
      SELECT id, event_id, user_id, session_id, event_type, page, content_id, content_type, extra,
             event_time AS timestamp
      FROM behavior_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY event_time ASC, id ASC
      LIMIT ?
    `, [...params, limit]);

    const contentTitles = new Map();
    async function contentTitle(type, id) {
      if (!type || !id) return '';
      const key = `${type}:${id}`;
      if (contentTitles.has(key)) return contentTitles.get(key);
      const meta = await contentMeta(type, id);
      contentTitles.set(key, meta.title);
      return meta.title;
    }

    const events = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const extra = parseJsonObject(row.extra);
      const previous = index > 0 ? rows[index - 1] : null;
      const next = index < rows.length - 1 ? rows[index + 1] : null;
      const gapFromPrevMs = previous ? Math.max(0, row.timestamp - previous.timestamp) : null;
      let dwellMs = null;
      let dwellSource = null;
      if (row.event_type === 'page_leave') {
        dwellMs = safeDuration(extra.durationMs ?? extra.duration);
        if (dwellMs !== null) dwellSource = 'page_leave';
      } else if (row.event_type === 'page_view' && next) {
        dwellMs = Math.max(0, next.timestamp - row.timestamp);
        dwellSource = 'estimated';
      }
      events.push({
        id: row.id,
        eventId: row.event_id,
        userId: row.user_id,
        sessionId: row.session_id,
        eventType: row.event_type,
        page: row.page,
        pageLabel: pageLabel(row.page),
        contentId: row.content_id,
        contentType: row.content_type,
        contentTitle: await contentTitle(row.content_type, row.content_id),
        extra,
        timestamp: row.timestamp,
        time: new Date(row.timestamp).toISOString(),
        gapFromPrevMs,
        dwellMs,
        dwellSource,
      });
    }

    /**
     * 将 page_leave 的精确停留时长回填到本次页面访问内的所有事件节点，
     * 这样时间线上的点击/分享等节点也能显示“本页停留”。
     * 如果页面被强杀没有 page_leave，则保留 page_view 的估算值。
     */
    const activeVisits = new Map();
    events.forEach((event, index) => {
      if (event.eventType === 'page_view') {
        activeVisits.set(event.sessionId, {
          startIndex: index,
          page: event.page,
          startedAt: event.timestamp,
        });
        return;
      }
      if (event.eventType !== 'page_leave') return;
      const visit = activeVisits.get(event.sessionId);
      if (!visit) return;
      const duration = safeDuration(event.extra.durationMs ?? event.extra.duration);
      if (duration !== null) {
        for (let i = visit.startIndex; i <= index; i += 1) {
          events[i].pageDwellMs = duration;
          events[i].dwellSource = 'page_leave';
        }
      }
      activeVisits.delete(event.sessionId);
    });

    const sessionRows = await queryAll(db, `
      SELECT session_id, MIN(event_time) AS first_at, MAX(event_time) AS last_at, COUNT(*) AS events
      FROM behavior_events WHERE user_id = ?
      GROUP BY session_id ORDER BY last_at DESC
    `, [userId]);

    res.json({
      userId,
      sessionId: sessionId || null,
      events,
      summary: {
        eventCount: events.length,
        sessionCount: sessionRows.length,
        firstAt: events.length ? events[0].time : null,
        lastAt: events.length ? events[events.length - 1].time : null,
        totalObservedMs: events.length ? events[events.length - 1].timestamp - events[0].timestamp : 0,
      },
      sessions: sessionRows.map((row) => ({
        sessionId: row.session_id,
        firstAt: new Date(row.first_at).toISOString(),
        lastAt: new Date(row.last_at).toISOString(),
        events: Number(row.events),
      })),
    });
  }));

  return router;
}

module.exports = { createAnalyticsRouter };
