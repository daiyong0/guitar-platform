'use strict';

const path = require('path');
const { HttpError } = require('./http');

function monthDir(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

function endpointHost(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) throw new Error('TOS_ENDPOINT 不能为空');
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return new URL(withProtocol).host;
}

function encodeObjectKey(key) {
  return String(key)
    .split('/')
    .filter((part) => part !== '')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

/**
 * 生成 TOS 对象的公开访问地址。
 * 优先 TOS_PUBLIC_BASE_URL（CDN/自定义域名），否则使用
 * https://<bucket>.<endpoint>/<key>。
 */
function buildTosPublicUrl(tos, key) {
  const encodedKey = encodeObjectKey(key);
  if (tos.publicBaseUrl) {
    return `${String(tos.publicBaseUrl).replace(/\/+$/, '')}/${encodedKey}`;
  }
  return `https://${tos.bucket}.${endpointHost(tos.endpoint)}/${encodedKey}`;
}

function createTosAdapter(config, deps = {}) {
  const tos = config.storage.tos;
  let TosClient = deps.TosClient;
  if (!TosClient) {
    try {
      ({ TosClient } = require('@volcengine/tos-sdk'));
    } catch (error) {
      throw new Error('对象存储依赖 @volcengine/tos-sdk 未安装，请执行 npm ci');
    }
  }

  const client = deps.client || new TosClient({
    accessKeyId: tos.accessKeyId,
    accessKeySecret: tos.accessKeySecret,
    region: tos.region,
    endpoint: tos.endpoint,
  });

  function objectPrefix() {
    return String(tos.keyPrefix || '').replace(/^\/+|\/+$/g, '');
  }

  async function uploadFileFromPath({
    filePath,
    key,
    filename,
    contentType,
    size,
  }) {
    const objectKey = key || [objectPrefix(), monthDir(), path.basename(filename || filePath)]
      .filter(Boolean)
      .join('/');
    try {
      await client.putObjectFromFile({
        bucket: tos.bucket,
        key: objectKey,
        filePath,
        contentType,
        contentLength: size,
        acl: tos.objectAcl || 'public-read',
      });
    } catch (error) {
      console.error('[storage] TOS upload failed:', error && (error.message || error));
      throw new HttpError(
        502,
        '文件上传到云存储失败，请检查 TOS 配置、Bucket 权限和网络',
        'STORAGE_UPLOAD_FAILED',
      );
    }
    const publicUrl = buildTosPublicUrl(tos, objectKey);
    return {
      provider: 'tos',
      storagePath: publicUrl,
      key: objectKey,
      publicUrl,
    };
  }

  return {
    driver: 'tos',
    async saveUploadedFile(file) {
      return uploadFileFromPath({
        filePath: file.path,
        filename: file.filename,
        contentType: file.mimetype,
        size: file.size,
      });
    },
    uploadFileFromPath,
    buildPublicUrl(key) {
      return buildTosPublicUrl(tos, key);
    },
  };
}

function createStorageAdapter(config, deps = {}) {
  if (!config || !config.storage || !config.storage.tos) {
    throw new Error('缺少 TOS 对象存储配置');
  }
  return createTosAdapter(config, deps);
}

module.exports = {
  createStorageAdapter,
  createTosAdapter,
  buildTosPublicUrl,
  encodeObjectKey,
  monthDir,
};
