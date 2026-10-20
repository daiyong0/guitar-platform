'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cors = require('cors');

const { createRequireAdmin, createRequireUser } = require('./middleware/auth');
const { createAuthRouter } = require('./routes/auth');
const { createUserRouter } = require('./routes/user');
const { createPublicContentRouter } = require('./routes/content');
const { createBehaviorRouter } = require('./routes/behavior');
const { createAdminAuthRouter } = require('./routes/admin-auth');
const { createAdminContentRouter } = require('./routes/admin-content');
const { createAdminUsersRouter } = require('./routes/admin-users');
const { createAnalyticsRouter } = require('./routes/analytics');
const { createUploadRouter } = require('./routes/upload');
const { PhoneVault } = require('./utils/phone');
const { HttpError, asyncHandler } = require('./utils/http');
const { queryOne } = require('./db');
const { createStorageAdapter } = require('./utils/cloud-storage');
const { SCORE_TAGS, VIDEO_CATEGORIES } = require('../shared/constants');

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' https: blob:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; '),
  );
  next();
}

function corsOptions(config) {
  const allowed = new Set(config.cors.origins);
  return {
    origin(origin, callback) {
      // 小程序/服务端/curl 通常没有 Origin；不因缺少 Origin 拦截。
      if (!origin) return callback(null, true);
      if (config.cors.allowAll || allowed.has(origin)) return callback(null, true);
      // 不抛错，不返回 ACAO；浏览器会拦截，服务端仍可正常处理无 Origin 请求。
      return callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials: false,
    maxAge: config.cors.maxAge,
    optionsSuccessStatus: 204,
  };
}

function createApp({ db, config, storage: injectedStorage }) {
  const app = express();
  const vault = new PhoneVault(config.phoneEncryptionKey);
  const requireAdmin = createRequireAdmin({ config });
  const requireUser = createRequireUser({ config, db });
  const storage = injectedStorage || createStorageAdapter(config);

  // 显式锚定到 server/app.js 的上一级，避免容器工作目录不同导致 /admin 404。
  // 容器内路径为 /app/server/app.js -> /app/admin。
  const adminDir = path.join(__dirname, '..', 'admin');
  if (!fs.existsSync(path.join(adminDir, 'index.html'))) {
    throw new Error(`管理后台静态目录不存在：${adminDir}`);
  }

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(cors(corsOptions(config)));
  app.use(securityHeaders);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', asyncHandler(async (_req, res) => {
    const row = await queryOne(db, 'SELECT 1 AS ok');
    res.json({
      status: row && Number(row.ok) === 1 ? 'ok' : 'degraded',
      service: 'xianjian-guitar-platform',
      database: 'mysql',
      storage: storage.driver,
      time: new Date().toISOString(),
    });
  }));

  app.get('/api/public-config', (_req, res) => {
    res.json({
      appName: '弦间',
      apiVersion: 2,
      phoneLoginMode: config.phoneLogin.mode,
      mockPhoneLogin: config.phoneLogin.mode === 'mock',
      scoreTags: SCORE_TAGS,
      videoCategories: VIDEO_CATEGORIES,
      shareTitleMaxLength: 36,
    });
  });

  app.use('/api', createPublicContentRouter({ db }));
  app.use('/api', createBehaviorRouter({ db }));
  app.use('/api/auth', createAuthRouter({ db, config, vault, requireUser }));
  app.use('/api/user', createUserRouter({ db, requireUser }));

  // Admin auth is public only for POST /login; /me checks the guard itself.
  app.use('/api/admin', createAdminAuthRouter({ db, config, requireAdmin }));
  app.use('/api/admin', requireAdmin, createAdminContentRouter({ db }));
  app.use('/api/admin', requireAdmin, createAdminUsersRouter({ db, vault }));
  app.use('/api/admin/analytics', requireAdmin, createAnalyticsRouter({ db }));
  app.use('/api/admin', requireAdmin, createUploadRouter({ config, storage }));

  // 仅用于系统级静态资源（例如节拍器回退 WAV）；用户上传的图片/视频全部在 TOS。
  app.use('/static', express.static(config.systemAssetsDir, {
    etag: true,
    maxAge: '1d',
    fallthrough: true,
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  }));

  app.get('/', (_req, res) => res.redirect(302, '/admin/'));
  // express.static handles the /admin -> /admin/ redirect itself. A route for
  // /admin would also match /admin/ (non-strict) and cause an infinite loop.
  app.use('/admin', express.static(adminDir, {
    index: 'index.html',
    etag: true,
    maxAge: config.env === 'production' ? '1h' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: '接口不存在' });
  });
  app.use((req, res) => {
    res.status(404).type('html').send(
      '<!doctype html><meta charset="utf-8"><title>404</title>'
      + '<body style="font-family:sans-serif;padding:48px"><h1>404</h1>'
      + '<p>页面不存在。管理后台入口：<a href="/admin/">/admin/</a></p></body>',
    );
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const isApi = req.path.startsWith('/api') || req.originalUrl.startsWith('/api');
    if (res.headersSent) return;
    let status = err.status || err.statusCode || 500;
    let code = err.code || 'INTERNAL_ERROR';
    let message = err.message || '服务器内部错误';

    if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      code = err.code;
      message = err.code === 'LIMIT_FILE_SIZE' ? '文件超过大小限制' : `文件上传失败：${err.message}`;
    } else if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && status === 400)) {
      status = 400;
      code = 'INVALID_JSON';
      message = '请求 JSON 格式错误';
    } else if (err instanceof HttpError) {
      status = err.status;
      code = err.code;
      message = err.message;
    } else if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      status = 409;
      code = 'CONFLICT';
      message = '数据冲突，请刷新后重试';
    }

    if (status >= 500) {
      console.error('[server]', req.method, req.originalUrl, err);
      if (config.env === 'production') message = '服务器内部错误';
    }

    if (isApi) {
      const payload = { code, message };
      if (err instanceof HttpError && err.details !== undefined) payload.details = err.details;
      res.status(status).json(payload);
    } else {
      res.status(status).type('text').send(message);
    }
  });

  return app;
}

module.exports = { createApp };
