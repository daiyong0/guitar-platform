'use strict';

const os = require('os');
const { loadConfig } = require('./config');
const { openDatabase, closeDatabase } = require('./db');
const { createApp } = require('./app');
const { createStorageAdapter } = require('./utils/cloud-storage');
const { seedDatabase } = require('./seed');

function lanAddresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach((name) => {
    (interfaces[name] || []).forEach((info) => {
      const family = typeof info.family === 'string' ? info.family : '';
      if (family === 'IPv4' && !info.internal) addresses.push({ name, address: info.address });
    });
  });
  return addresses;
}

async function start() {
  let config;
  let db;
  try {
    config = loadConfig();
    db = await openDatabase(config);
    const storage = createStorageAdapter(config);
    if (config.autoSeed) {
      // 云端首次启动自动上传 seed 素材到 TOS 并写入默认内容；
      // 已有内容时 seedDatabase 会自动跳过，重启不会重复插入。
      await seedDatabase(config, { db, storage });
    }
    const app = createApp({ db, config, storage });
    // 抖音云容器强制 8000；保留 process.env.PORT 覆盖，HOST 固定 0.0.0.0。
    const port = Number.parseInt(process.env.PORT || String(config.port) || '8000', 10);
    const host = process.env.HOST || config.host || '0.0.0.0';
    const server = app.listen(port, host, () => {
      const shownHost = host === '0.0.0.0' ? '127.0.0.1' : host;
      console.log('');
      console.log('  弦间 · 吉他谱与直播回放平台');
      console.log(`  管理后台: http://${shownHost}:${port}/admin/`);
      console.log(`  API 健康检查: http://${shownHost}:${port}/api/health`);
      lanAddresses().forEach((item) => {
        console.log(`  手机真机访问（${item.name}）: http://${item.address}:${port}`);
      });
      console.log(`  手机号登录模式: ${config.phoneLogin.mode.toUpperCase()}${config.phoneLogin.mode === 'mock' ? '（开发演示用户，不调用抖音手机号接口）' : ''}`);
      console.log(`  运行环境: ${config.env} ｜ 数据库: MySQL ｜ 文件存储: TOS`);
      console.log(`  MySQL: ${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`);
      console.log('');
    });

    function shutdown(signal) {
      console.log(`\n[server] 收到 ${signal}，正在关闭...`);
      server.close(async () => {
        await closeDatabase(db);
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 8000).unref();
    }
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[startup]', error);
    await closeDatabase(db);
    process.exit(1);
  }
}

if (require.main === module) start();

module.exports = { start };
