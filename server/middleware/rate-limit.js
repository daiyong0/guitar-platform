'use strict';

const { HttpError } = require('../utils/http');

/**
 * Small in-memory login limiter. For multi-instance production deployments,
 * back this with Redis or put the admin login behind a gateway/WAF.
 */
function createLoginLimiter({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  const buckets = new Map();

  function prune(now) {
    if (buckets.size < 500) return;
    for (const [key, bucket] of buckets.entries()) {
      if (now - bucket.firstAt > windowMs) buckets.delete(key);
    }
  }

  return function loginLimiter(req, res, next) {
    const now = Date.now();
    prune(now);
    const username = String((req.body && req.body.username) || '').slice(0, 80).toLowerCase();
    const key = `${req.ip}|${username}`;
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.firstAt > windowMs) {
      buckets.set(key, { firstAt: now, count: 1 });
    } else {
      bucket.count += 1;
      if (bucket.count > max) {
        const retryAfter = Math.max(1, Math.ceil((windowMs - (now - bucket.firstAt)) / 1000));
        throw new HttpError(429, `登录尝试过于频繁，请 ${retryAfter} 秒后再试`, 'RATE_LIMITED');
      }
    }
    res.once('finish', () => {
      if (res.statusCode < 400) buckets.delete(key);
    });
    return next();
  };
}

module.exports = { createLoginLimiter };
