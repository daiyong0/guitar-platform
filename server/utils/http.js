'use strict';

class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR', details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function requireString(value, name, { min = 1, max = 2000, trim = true } = {}) {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${name}必须是字符串`, 'VALIDATION_ERROR');
  }
  const next = trim ? value.trim() : value;
  if (next.length < min || next.length > max) {
    throw new HttpError(400, `${name}长度需为 ${min}-${max} 个字符`, 'VALIDATION_ERROR');
  }
  return next;
}

function optionalString(value, name, { max = 2000, defaultValue = '' } = {}) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'string') {
    throw new HttpError(400, `${name}必须是字符串`, 'VALIDATION_ERROR');
  }
  const next = value.trim();
  if (next.length > max) {
    throw new HttpError(400, `${name}不能超过 ${max} 个字符`, 'VALIDATION_ERROR');
  }
  return next;
}

function requireEnum(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw new HttpError(400, `${name}必须是 ${allowed.join(' / ')} 之一`, 'VALIDATION_ERROR');
  }
  return value;
}

function toInteger(value, name, { min = -2147483648, max = 2147483647, defaultValue = 0 } = {}) {
  if ((value === undefined || value === null || value === '') && defaultValue !== undefined) {
    return defaultValue;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${name}必须是 ${min}-${max} 之间的整数`, 'VALIDATION_ERROR');
  }
  return n;
}

function parsePositiveInt(value, fallback, { min = 1, max = 100 } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
}

module.exports = {
  HttpError,
  asyncHandler,
  requireString,
  optionalString,
  requireEnum,
  toInteger,
  parsePositiveInt,
  parseJsonArray,
  parseJsonObject,
  escapeLike,
};
