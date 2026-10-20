'use strict';

/**
 * Usage:
 *   npm run admin:password -- admin "A-strong-new-password"
 *
 * 连接环境变量指定的 MySQL，更新或创建管理员账号。
 */
const bcrypt = require('bcryptjs');
const { loadConfig } = require('./config');
const {
  openDatabase,
  closeDatabase,
  queryOne,
  execute,
  nowMysql,
} = require('./db');

async function main() {
  const args = process.argv.slice(2).filter((value) => value !== '--');
  const username = (args[0] || process.env.ADMIN_DEFAULT_USERNAME || 'admin').trim();
  const password = args[1] || '';
  if (!username) throw new Error('缺少管理员用户名');
  if (!password || password.length < 8) throw new Error('新密码至少需要 8 个字符');

  const config = loadConfig();
  const db = await openDatabase(config);
  try {
    const existing = await queryOne(
      db,
      'SELECT id FROM admin_users WHERE username = ?',
      [username],
    );
    const hash = await bcrypt.hash(password, 12);
    if (existing) {
      await execute(db, 'UPDATE admin_users SET password_hash = ? WHERE id = ?', [hash, existing.id]);
      console.log(`[admin] 已更新管理员「${username}」的密码。`);
    } else {
      await execute(
        db,
        'INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)',
        [username, hash, nowMysql()],
      );
      console.log(`[admin] 已创建管理员「${username}」。`);
    }
  } finally {
    await closeDatabase(db);
  }
}

main().catch((error) => {
  console.error('[admin] 修改密码失败:', error.message);
  process.exitCode = 1;
});
