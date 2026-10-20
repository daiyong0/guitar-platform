'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { ROOT } = require('./config');

function toMysqlDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('无效的时间值');
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function nowMysql() {
  return toMysqlDate(new Date());
}

function baseConnectionOptions(config) {
  const options = {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    connectTimeout: 10000,
  };
  if (config.mysql.ssl) options.ssl = config.mysql.ssl;
  return options;
}

function createPool(config) {
  return mysql.createPool({
    ...baseConnectionOptions(config),
    waitForConnections: true,
    connectionLimit: config.mysql.connectionLimit,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
}

async function waitForDatabase(pool) {
  const attempts = 20;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`MySQL 连接失败：${lastError && lastError.message}`);
}

async function applySchema(config) {
  const schemaPath = path.join(ROOT, 'sql', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const connection = await mysql.createConnection({
    ...baseConnectionOptions(config),
    multipleStatements: true,
  });
  try {
    await connection.query(schema);
  } finally {
    await connection.end();
  }
}

async function ensureDefaultAdmin(pool, config) {
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM admin_users');
  if (Number(rows[0].count) > 0) return false;

  const { username, password } = config.defaultAdmin;
  if (!username || !password || password.length < 8) {
    throw new Error('首次启动需要 ADMIN_DEFAULT_USERNAME 与至少 8 位的 ADMIN_DEFAULT_PASSWORD');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    'INSERT IGNORE INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)',
    [username, passwordHash, nowMysql()],
  );
  if (result.affectedRows > 0) {
    console.log(`[init] 已创建默认管理员「${username}」，请登录后台后尽快修改密码。`);
  }
  return result.affectedRows > 0;
}

async function openDatabase(config) {
  if (!config.mysql || !config.mysql.host || !config.mysql.user || !config.mysql.database) {
    throw new Error('MySQL 配置不完整，请检查 DB_HOST / DB_USER / DB_NAME');
  }
  const pool = createPool(config);
  await waitForDatabase(pool);
  await applySchema(config);
  await ensureDefaultAdmin(pool, config);
  return pool;
}

async function closeDatabase(pool) {
  if (!pool) return;
  try {
    await pool.end();
  } catch (error) {
    console.warn('[db] close failed:', error.message);
  }
}

async function queryAll(db, sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows;
}

async function queryOne(db, sql, params = []) {
  const rows = await queryAll(db, sql, params);
  return rows[0] || null;
}

async function execute(db, sql, params = []) {
  const [result] = await db.query(sql, params);
  return result;
}

async function transaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch (_rollbackError) { /* ignore */ }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  openDatabase,
  closeDatabase,
  ensureDefaultAdmin,
  queryAll,
  queryOne,
  execute,
  transaction,
  nowMysql,
  toMysqlDate,
};
