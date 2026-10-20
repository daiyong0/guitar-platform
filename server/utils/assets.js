'use strict';

const { HttpError, parseJsonArray } = require('./http');

/**
 * TOS/CDN 返回的是完整 HTTPS 地址；数据库只保存这种绝对地址。
 * 不再根据请求 Host 或本地域名动态拼接，避免云端返回 localhost。
 */
function normalizeAssetUrl(value, name, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${name}不能为空`, 'VALIDATION_ERROR');
    return '';
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${name}必须是 URL 字符串`, 'VALIDATION_ERROR');
  }
  const url = value.trim();
  if (url.length > 1500) {
    throw new HttpError(400, `${name}过长`, 'VALIDATION_ERROR');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new HttpError(400, `${name}必须是完整的 HTTPS 地址`, 'VALIDATION_ERROR');
  }
  if (parsed.protocol !== 'https:') {
    throw new HttpError(400, `${name}必须是 HTTPS 地址（由 TOS 上传接口返回）`, 'VALIDATION_ERROR');
  }
  return url;
}

function serializeScore(row) {
  const images = parseJsonArray(row.images);
  return {
    id: row.id,
    title: row.title,
    tags: parseJsonArray(row.tags),
    description: row.description || '',
    images,
    // TOS 完整 https 地址直接返回，不做任何 Host 拼接。
    imageUrls: images,
    initialBpm: row.initial_bpm == null ? 80 : Number(row.initial_bpm) || 80,
    status: row.status,
    sortWeight: row.sort_weight,
    viewCount: row.view_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeVideo(row) {
  return {
    id: row.id,
    title: row.title,
    coverUrl: row.cover_url,
    videoUrl: row.video_url,
    coverPreviewUrl: row.cover_url,
    videoPreviewUrl: row.video_url,
    duration: row.duration,
    category: row.category,
    status: row.status,
    viewCount: row.view_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeUser(row) {
  return {
    id: row.id,
    phoneMasked: row.phone_masked,
    nickname: row.nickname || '吉他手',
    avatar: row.avatar || '',
    isDemo: Boolean(row.is_demo),
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

module.exports = {
  normalizeAssetUrl,
  serializeScore,
  serializeVideo,
  serializeUser,
};
