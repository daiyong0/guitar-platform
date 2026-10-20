'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const {
  openDatabase,
  closeDatabase,
  transaction,
  toMysqlDate,
} = require('./db');
const { createStorageAdapter } = require('./utils/cloud-storage');

const SCORE_SEEDS = [
  {
    title: '夏夜微风',
    initialBpm: 80,
    tags: ['弹唱', '入门', '流行'],
    description: '四个开放和弦就能完成的夏夜小歌。附前奏、主歌与副歌完整谱面，适合作为第一首完整弹唱曲目。',
    sortWeight: 100,
    viewCount: 1286,
    createdDaysAgo: 8,
    imageSlug: 'summer-breeze',
  },
  {
    title: '暮色公路',
    initialBpm: 96,
    tags: ['弹唱', '进阶'],
    description: '公路感扫弦编配，重点是右手切音与副歌力度的层次推进。谱面含和弦图与节奏型示意。',
    sortWeight: 90,
    viewCount: 986,
    createdDaysAgo: 13,
    imageSlug: 'dusk-highway',
  },
  {
    title: '星河入梦',
    initialBpm: 72,
    tags: ['指弹', '进阶'],
    description: 'DADGAD 调弦的指弹小品，包含泛音与琶音段落。建议先熟悉特殊调弦再开始练习。',
    sortWeight: 80,
    viewCount: 1537,
    createdDaysAgo: 18,
    imageSlug: 'starlight',
  },
  {
    title: '木吉他第一课',
    initialBpm: 68,
    tags: ['入门', '基础'],
    description: '从持琴、拨弦到第一个 C 和弦。为完全零基础的同学准备的图文练习谱。',
    sortWeight: 70,
    viewCount: 2280,
    createdDaysAgo: 26,
    imageSlug: 'first-lesson',
  },
  {
    title: '雨巷',
    initialBpm: 84,
    tags: ['弹唱', '入门'],
    description: '3/4 拍的分解和弦弹唱，附简化和弦版本。适合练习右手稳定性和轻声演唱。',
    sortWeight: 60,
    viewCount: 645,
    createdDaysAgo: 31,
    imageSlug: 'rain-lane',
  },
  {
    title: '逆光生长',
    initialBpm: 92,
    tags: ['指弹', '进阶'],
    description: '高把位指弹编配，含击勾弦与滑音标记。建议从第 1 页第 3 小节开始分段慢练。',
    sortWeight: 50,
    viewCount: 430,
    createdDaysAgo: 39,
    imageSlug: 'grow-in-light',
  },
];

const VIDEO_SEEDS = [
  {
    title: 'Live 回放｜《夏夜微风》指弹现场',
    coverSlug: 'video-live-summer',
    duration: 30,
    category: '现场回放',
    viewCount: 3204,
    createdDaysAgo: 5,
  },
  {
    title: '扫弦节奏训练 01｜四分与八分',
    coverSlug: 'video-rhythm-class',
    duration: 30,
    category: '教学回放',
    viewCount: 1890,
    createdDaysAgo: 11,
  },
  {
    title: '录音棚日记｜暮色公路吉他分轨',
    coverSlug: 'video-studio-diary',
    duration: 30,
    category: '幕后',
    viewCount: 1264,
    createdDaysAgo: 19,
  },
  {
    title: '指弹泛音示范｜星河入梦段落拆解',
    coverSlug: 'video-harmonic-demo',
    duration: 30,
    category: '技巧',
    viewCount: 932,
    createdDaysAgo: 27,
  },
];

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.wav': 'audio/wav',
};

function daysAgo(days) {
  return toMysqlDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

function encodeAssetName(filename) {
  return String(filename).split('/').map(encodeURIComponent).join('/');
}

function createSeedAssetResolver(config, storage) {
  const cache = new Map();
  const baseUrl = config.seedAssetBaseUrl;

  function contentTypeFor(filename) {
    return CONTENT_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';
  }

  async function resolve(filename) {
    if (cache.has(filename)) return cache.get(filename);
    let url;
    if (baseUrl) {
      url = `${baseUrl}/${encodeAssetName(filename)}`;
    } else {
      const filePath = path.join(config.seedAssetsDir, filename);
      if (!fs.existsSync(filePath)) {
        throw new Error(`缺少 seed 素材：${filePath}`);
      }
      const result = await storage.uploadFileFromPath({
        filePath,
        key: [config.storage.tos.keyPrefix, 'seed', filename].filter(Boolean).join('/'),
        filename,
        contentType: contentTypeFor(filename),
        size: fs.statSync(filePath).size,
      });
      url = result.publicUrl;
    }
    cache.set(filename, url);
    return url;
  }

  return { resolve };
}

async function resetData(pool) {
  await transaction(pool, async (connection) => {
    await connection.query('DELETE FROM favorites');
    await connection.query('DELETE FROM behavior_events');
    await connection.query('DELETE FROM live_replays');
    await connection.query('DELETE FROM guitar_scores');
    await connection.query('DELETE FROM users');
  });
}

async function seedDatabase(config, options = {}) {
  const ownsPool = !options.db;
  const pool = options.db || await openDatabase(config);
  const storage = options.storage || createStorageAdapter(config);
  try {
    if (options.reset) {
      await resetData(pool);
      console.log('[seed] 已清空内容、用户、行为事件与收藏（管理员账号保留）。');
    } else {
      const [rows] = await pool.query(
        'SELECT (SELECT COUNT(*) FROM guitar_scores) AS scores, (SELECT COUNT(*) FROM live_replays) AS videos',
      );
      const counts = rows[0];
      if (Number(counts.scores) > 0 || Number(counts.videos) > 0) {
        console.log('[seed] MySQL 中已存在内容，跳过。需要重建请使用 --reset。');
        return {
          scoreCount: Number(counts.scores) || 0,
          videoCount: Number(counts.videos) || 0,
        };
      }
    }

    const resolver = createSeedAssetResolver(config, storage);
    const scoreCount = SCORE_SEEDS.length;
    const videoCount = VIDEO_SEEDS.length;

    // 先上传素材，再开事务；TOS 上传可能较慢，避免长事务占锁。
    const scoreImages = [];
    for (const item of SCORE_SEEDS) {
      scoreImages.push([
        await resolver.resolve(`cover-${item.imageSlug}.jpg`),
        await resolver.resolve(`tab-${item.imageSlug}-1.png`),
        await resolver.resolve(`tab-${item.imageSlug}-2.png`),
      ]);
    }
    const videoCovers = [];
    for (const item of VIDEO_SEEDS) {
      videoCovers.push(await resolver.resolve(`${item.coverSlug}.jpg`));
    }
    const videoUrl = await resolver.resolve('flower.mp4');

    await transaction(pool, async (connection) => {
      for (let i = 0; i < SCORE_SEEDS.length; i += 1) {
        const item = SCORE_SEEDS[i];
        const now = daysAgo(item.createdDaysAgo);
        await connection.query(`
          INSERT INTO guitar_scores
            (title, tags, description, images, initial_bpm, status, sort_weight, view_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)
        `, [
          item.title,
          JSON.stringify(item.tags),
          item.description,
          JSON.stringify(scoreImages[i]),
          item.initialBpm ?? 80,
          item.sortWeight,
          item.viewCount,
          now,
          now,
        ]);
      }
      for (let i = 0; i < VIDEO_SEEDS.length; i += 1) {
        const item = VIDEO_SEEDS[i];
        const now = daysAgo(item.createdDaysAgo);
        await connection.query(`
          INSERT INTO live_replays
            (title, cover_url, video_url, duration, category, status, view_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?)
        `, [
          item.title,
          videoCovers[i],
          videoUrl,
          item.duration,
          item.category,
          item.viewCount,
          now,
          now,
        ]);
      }
    });

    console.log(`[seed] 已写入 ${scoreCount} 份吉他谱、${videoCount} 个视频回放；封面/谱面/视频均为 TOS 地址。`);
    if (config.seedAssetBaseUrl) {
      console.log(`[seed] 素材使用 SEED_ASSET_BASE_URL=${config.seedAssetBaseUrl}`);
    }
    return { scoreCount, videoCount };
  } finally {
    if (ownsPool) await closeDatabase(pool);
  }
}

async function run() {
  const config = loadConfig();
  const reset = process.argv.includes('--reset');
  const result = await seedDatabase(config, { reset });
  console.log('[seed] 完成:', result);
}

if (require.main === module) {
  run().catch((error) => {
    console.error('[seed] 失败:', error);
    process.exit(1);
  });
}

module.exports = {
  seedDatabase,
  SCORE_SEEDS,
  VIDEO_SEEDS,
  createSeedAssetResolver,
};
