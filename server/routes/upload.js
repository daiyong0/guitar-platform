'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { HttpError } = require('../utils/http');
const { createStorageAdapter } = require('../utils/cloud-storage');

const IMAGE_TYPES = new Map([
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
  ['image/webp', ['.webp']],
  ['image/gif', ['.gif']],
]);
const VIDEO_TYPES = new Map([
  ['video/mp4', ['.mp4']],
  ['video/quicktime', ['.mov']],
  ['video/webm', ['.webm']],
  ['video/x-m4v', ['.m4v']],
]);

function safeUnlink(filePath) {
  if (!filePath) return;
  fsp.unlink(filePath).catch(() => {});
}

function createUploadRouter({ config, storage: injectedStorage }) {
  const router = express.Router();
  const storage = injectedStorage || createStorageAdapter(config);
  const tempDir = config.tempUploadsDir || path.join(os.tmpdir(), 'xianjian-uploads');
  fs.mkdirSync(tempDir, { recursive: true });

  function uploaderFor(kind) {
    const allowed = kind === 'video' ? VIDEO_TYPES : IMAGE_TYPES;
    const maxBytes = kind === 'video' ? config.maxVideoBytes : config.maxImageBytes;
    const storageEngine = multer.diskStorage({
      destination(_req, _file, cb) {
        cb(null, tempDir);
      },
      filename(_req, file, cb) {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const expected = allowed.get(file.mimetype);
        const safeExt = expected && expected.includes(ext) ? ext : (expected ? expected[0] : '');
        const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`;
        cb(null, unique);
      },
    });

    return multer({
      storage: storageEngine,
      limits: { fileSize: maxBytes, files: 1, fields: 4 },
      fileFilter(_req, file, cb) {
        const expectedExtensions = allowed.get(file.mimetype);
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (!expectedExtensions || !expectedExtensions.includes(ext)) {
          return cb(new HttpError(415, `不支持的文件类型：${file.mimetype || 'unknown'} ${ext}`, 'UNSUPPORTED_FILE'));
        }
        return cb(null, true);
      },
    });
  }

  router.post('/upload', (req, res, next) => {
    const kind = String(req.query.kind || 'image').toLowerCase();
    if (!['image', 'video'].includes(kind)) {
      return next(new HttpError(400, 'kind 必须是 image 或 video', 'VALIDATION_ERROR'));
    }

    uploaderFor(kind).single('file')(req, res, async (error) => {
      if (error) {
        safeUnlink(req.file && req.file.path);
        return next(error);
      }
      if (!req.file) return next(new HttpError(400, '请选择要上传的文件', 'VALIDATION_ERROR'));

      try {
        const stored = await storage.saveUploadedFile(req.file);
        return res.status(201).json({
          url: stored.publicUrl,
          storagePath: stored.storagePath,
          storageDriver: 'tos',
          kind,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
        });
      } catch (saveError) {
        return next(saveError);
      } finally {
        safeUnlink(req.file.path);
      }
    });
  });

  return router;
}

module.exports = { createUploadRouter, IMAGE_TYPES, VIDEO_TYPES };
