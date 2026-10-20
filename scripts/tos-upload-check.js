'use strict';

/**
 * 在 MySQL 审批期间，独立验证 TOS 配置和公网访问：
 *
 *   npm run tos:check
 *   npm run tos:check -- "H:\path\to\cover.jpg"
 *
 * 不连接 MySQL，不写业务表；只上传一个测试对象并输出可执行的占位 SQL。
 */
const fs = require('fs');
const path = require('path');
const { loadTosConfig } = require('../server/config');
const { createStorageAdapter } = require('../server/utils/cloud-storage');

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
};

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const filePath = path.resolve(
    args[0] || path.join(__dirname, '..', 'uploads', 'seed', 'share-default.png'),
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`测试文件不存在：${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`测试文件为空或不是文件：${filePath}`);
  }

  const tos = loadTosConfig();
  const config = { storage: { provider: 'tos', tos } };
  const storage = createStorageAdapter(config);
  const filename = path.basename(filePath);
  const key = [
    tos.keyPrefix,
    'healthcheck',
    `${Date.now()}-${filename}`,
  ].filter(Boolean).join('/');
  const contentType = CONTENT_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';

  console.log('[tos:check] 上传中...');
  console.log(`[tos:check] bucket=${tos.bucket} region=${tos.region} endpoint=${tos.endpoint}`);
  console.log(`[tos:check] key=${key}`);

  const result = await storage.uploadFileFromPath({
    filePath,
    key,
    filename,
    contentType,
    size: stat.size,
  });

  console.log('');
  console.log('[tos:check] 上传成功');
  console.log(`URL: ${result.publicUrl}`);
  console.log(`KEY: ${result.key}`);

  let headStatus = null;
  try {
    const response = await fetch(result.publicUrl, { method: 'HEAD' });
    headStatus = response.status;
    console.log(`HEAD: ${response.status} ${response.headers.get('content-type') || ''}`);
  } catch (error) {
    console.warn(`[tos:check] HEAD 检查失败（可能是网络/域名/防盗链）：${error.message}`);
  }

  console.log('');
  console.log('-- MySQL 接通后，可执行下面 SQL 插入一条占位草稿（验证后可删除）：');
  console.log(`INSERT INTO guitar_scores
  (title, tags, description, images, initial_bpm, status, sort_weight, view_count, created_at, updated_at)
VALUES
  ('TOS 上传验证', JSON_ARRAY('测试'), '临时占位数据，验证 TOS 上传后可删除。',
   JSON_ARRAY(${sqlString(result.publicUrl)}), 80, 'draft', 0, 0, NOW(3), NOW(3));`);
  console.log('');

  if (headStatus !== null && headStatus !== 200) {
    console.warn(`[tos:check] 公网 HEAD 返回 ${headStatus}；请检查 Bucket 公共读、CDN 域名和防盗链。`);
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error('[tos:check] 失败:', error.message);
  if (error.stack) console.error(error.stack);
  process.exitCode = 1;
});
