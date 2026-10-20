'use strict';

const crypto = require('crypto');

/**
 * Phone numbers are never stored in plaintext.
 * - phone_encrypted: AES-256-GCM ciphertext (v1.iv.tag.cipher, base64url)
 * - phone_hash: HMAC-SHA256 blind index used to find a user without decrypting
 * - phone_masked: the only representation returned to clients/admin UI
 */
class PhoneVault {
  constructor(secret) {
    const keyMaterial = /^[a-f0-9]{64}$/i.test(secret)
      ? Buffer.from(secret, 'hex')
      : crypto.createHash('sha256').update(String(secret)).digest();
    this.key = keyMaterial;
    this.hmacKey = crypto.createHash('sha256').update(`${secret}:blind-index`).digest();
  }

  normalize(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.startsWith('86') && digits.length === 13) digits = digits.slice(2);
    if (!/^1\d{10}$/.test(digits)) {
      throw new Error('手机号格式不正确');
    }
    return digits;
  }

  mask(phone) {
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }

  hash(phone) {
    return crypto.createHmac('sha256', this.hmacKey).update(phone).digest('hex');
  }

  encrypt(phone) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(phone, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
  }

  decrypt(payload) {
    const [version, ivB64, tagB64, dataB64] = String(payload).split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('不支持的手机号密文格式');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

module.exports = { PhoneVault };
