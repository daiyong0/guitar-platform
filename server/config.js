'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const DEFAULT_JWT_SECRET = 'xianjian-local-development-secret-change-before-production';

function integer(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function resolveInsideRoot(value, fallback) {
  const raw = value || fallback;
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(ROOT, raw);
}

function looksPlaceholder(value) {
  return /replace|change[-_ ]?me|example|your[-_ ]|todo/i.test(String(value || ''));
}

function mysqlSsl(env) {
  if (String(env.DB_SSL || '0') !== '1') return null;
  const ssl = {
    rejectUnauthorized: String(env.DB_SSL_REJECT_UNAUTHORIZED || '1') !== '0',
  };
  if (env.DB_SSL_CA_PATH) {
    const caPath = path.isAbsolute(env.DB_SSL_CA_PATH)
      ? env.DB_SSL_CA_PATH
      : path.resolve(ROOT, env.DB_SSL_CA_PATH);
    ssl.ca = fs.readFileSync(caPath, 'utf8');
  }
  return ssl;
}

function parseCorsOrigins(value) {
  const entries = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const origins = [];
  for (const entry of entries) {
    if (entry === '*') {
      origins.push('*');
      continue;
    }
    let parsed;
    try {
      parsed = new URL(entry);
    } catch (_error) {
      throw new Error(`CORS_ORIGINS 中的地址不合法：${entry}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`CORS_ORIGINS 只支持 http/https：${entry}`);
    }
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error(`CORS_ORIGINS 只能填 origin，不要带路径：${entry}`);
    }
    if (!origins.includes(parsed.origin)) origins.push(parsed.origin);
  }
  return origins;
}

function buildTosConfig(env) {
  return {
    accessKeyId: env.TOS_ACCESS_KEY_ID || env.TOS_ACCESS_KEY || '',
    accessKeySecret: env.TOS_ACCESS_KEY_SECRET || env.TOS_SECRET_KEY || '',
    region: env.TOS_REGION || '',
    endpoint: env.TOS_ENDPOINT || '',
    bucket: env.TOS_BUCKET || '',
    publicBaseUrl: String(env.TOS_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    keyPrefix: String(env.TOS_KEY_PREFIX || 'xianjian').replace(/^\/+|\/+$/g, ''),
    objectAcl: env.TOS_OBJECT_ACL || 'public-read',
  };
}

function assertTosConfig(tos) {
  const missing = [
    ['TOS_ACCESS_KEY_ID', tos.accessKeyId],
    ['TOS_ACCESS_KEY_SECRET', tos.accessKeySecret],
    ['TOS_REGION', tos.region],
    ['TOS_ENDPOINT', tos.endpoint],
    ['TOS_BUCKET', tos.bucket],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`对象存储配置不完整，缺少：${missing.join(', ')}（本项目只允许 TOS 存储）`);
  }
  return tos;
}

/**
 * 只加载 TOS 配置，不要求 MySQL。
 * 用于 scripts/tos-upload-check.js 在数据库审批期间独立验证签名与公网访问。
 */
function loadTosConfig(overrides = {}) {
  const env = { ...process.env, ...overrides.env };
  return assertTosConfig(buildTosConfig(env));
}


/**
 * Load runtime configuration. Tests may pass overrides to point at an
 * ephemeral MySQL instance and a fake storage adapter.
 */
function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides.env };
  const phoneMode = String(env.PHONE_LOGIN_MODE || 'mock').toLowerCase() === 'real' ? 'real' : 'mock';
  const jwtSecret = env.JWT_SECRET || DEFAULT_JWT_SECRET;

  const config = {
    root: ROOT,
    env: env.NODE_ENV || 'development',
    port: Number.parseInt(env.PORT || '8000', 10),
    host: env.HOST || '0.0.0.0',
    trustProxy: String(env.TRUST_PROXY || '0') === '1',
    jwtSecret,
    adminTokenTtl: env.ADMIN_TOKEN_TTL || '12h',
    userTokenTtl: env.USER_TOKEN_TTL || '30d',
    phoneEncryptionKey: env.PHONE_ENCRYPTION_KEY || `${jwtSecret}:phone:v1`,
    defaultAdmin: {
      username: env.ADMIN_DEFAULT_USERNAME || 'admin',
      password: env.ADMIN_DEFAULT_PASSWORD || 'Guitar@2026',
    },
    mysql: {
      host: env.DB_HOST || env.MYSQL_HOST || '',
      port: integer(env.DB_PORT || env.MYSQL_PORT, 3306, { min: 1, max: 65535 }),
      user: env.DB_USER || env.MYSQL_USER || '',
      password: env.DB_PASSWORD || env.MYSQL_PASSWORD || '',
      database: env.DB_NAME || env.MYSQL_DATABASE || '',
      connectionLimit: integer(env.DB_CONNECTION_LIMIT, 10, { min: 1, max: 100 }),
      ssl: mysqlSsl(env),
    },
    tempUploadsDir: path.resolve(
      env.TMP_UPLOAD_DIR || path.join(os.tmpdir(), 'xianjian-uploads'),
    ),
    seedAssetsDir: resolveInsideRoot(env.SEED_ASSET_DIR, './uploads/seed'),
    seedAssetBaseUrl: String(env.SEED_ASSET_BASE_URL || '').replace(/\/+$/, ''),
    autoSeed: String(env.SEED_ON_START || '0') === '1',
    systemAssetsDir: resolveInsideRoot(env.SYSTEM_ASSETS_DIR, './static'),
    maxImageBytes: integer(env.MAX_IMAGE_MB, 20, { min: 1, max: 100 }) * 1024 * 1024,
    maxVideoBytes: integer(env.MAX_VIDEO_MB, 500, { min: 1, max: 2048 }) * 1024 * 1024,
    cors: {
      origins: parseCorsOrigins(env.CORS_ORIGINS),
      allowAll: String(env.CORS_ALLOW_ALL || '0') === '1' || env.CORS_ORIGINS === '*',
      maxAge: integer(env.CORS_MAX_AGE, 600, { min: 0, max: 86400 }),
    },
    storage: {
      provider: 'tos',
      tos: buildTosConfig(env),
    },
    phoneLogin: {
      mode: phoneMode,
      mockPhone: String(env.MOCK_PHONE || '13800138000').replace(/\D/g, ''),
      mockNickname: env.MOCK_NICKNAME || '弦间体验用户',
      appId: env.DOUYIN_APP_ID || '',
      appSecret: env.DOUYIN_APP_SECRET || '',
      tokenUrl: env.DOUYIN_TOKEN_URL || 'https://developer.toutiao.com/api/apps/v2/token',
      code2SessionUrl: env.DOUYIN_CODE2SESSION_URL || 'https://developer.toutiao.com/api/apps/v2/jscode2session',
      phoneUrl: env.DOUYIN_PHONE_URL || 'https://developer.toutiao.com/api/apps/v2/phonenumber/getPhoneNumber',
    },
  };

  config.phoneEncryptionKey = crypto
    .createHash('sha256')
    .update(String(config.phoneEncryptionKey))
    .digest('hex');

  if (!config.mysql.host || !config.mysql.user || !config.mysql.database) {
    throw new Error('MySQL 配置不完整：必须设置 DB_HOST、DB_USER、DB_NAME（以及 DB_PASSWORD/DB_PORT）');
  }

  assertTosConfig(config.storage.tos);

  if (config.env === 'production') {
    if (config.cors.allowAll) {
      throw new Error('生产环境禁止 CORS_ALLOW_ALL=1 / CORS_ORIGINS=*，请填写明确的管理后台域名');
    }
    if (
      !env.JWT_SECRET
      || env.JWT_SECRET === DEFAULT_JWT_SECRET
      || looksPlaceholder(env.JWT_SECRET)
      || config.jwtSecret.length < 32
    ) {
      throw new Error('生产环境必须设置至少 32 字符的随机 JWT_SECRET，不能使用示例/占位值');
    }
    if (
      !env.ADMIN_DEFAULT_PASSWORD
      || env.ADMIN_DEFAULT_PASSWORD === 'Guitar@2026'
      || looksPlaceholder(env.ADMIN_DEFAULT_PASSWORD)
      || env.ADMIN_DEFAULT_PASSWORD.length < 8
    ) {
      throw new Error('生产环境必须设置强 ADMIN_DEFAULT_PASSWORD，不能使用默认/占位密码');
    }
    if (env.PHONE_ENCRYPTION_KEY && looksPlaceholder(env.PHONE_ENCRYPTION_KEY)) {
      throw new Error('生产环境 PHONE_ENCRYPTION_KEY 不能使用示例/占位值');
    }
    if (config.phoneLogin.mode === 'real' && (!config.phoneLogin.appId || !config.phoneLogin.appSecret)) {
      throw new Error('PHONE_LOGIN_MODE=real 时必须配置 DOUYIN_APP_ID 与 DOUYIN_APP_SECRET');
    }
  }

  if (phoneMode === 'real' && (!config.phoneLogin.appId || !config.phoneLogin.appSecret)) {
    console.warn('[auth] PHONE_LOGIN_MODE=real 但缺少抖音 AppID/AppSecret，真实手机号登录将失败。');
  }

  return config;
}

module.exports = {
  loadConfig,
  loadTosConfig,
  parseCorsOrigins,
  ROOT,
  DEFAULT_JWT_SECRET,
};
