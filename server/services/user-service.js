'use strict';

const { serializeUser } = require('../utils/assets');
const { queryOne, execute, nowMysql } = require('../db');

/**
 * Finds/creates a user by blind-indexed phone number. Raw phone numbers never
 * leave this function and are not persisted.
 */
async function findOrCreateUserByPhone({
  db,
  vault,
  phone,
  openid = '',
  nickname = '',
  avatar = '',
  isDemo = false,
}) {
  const normalized = vault.normalize(phone);
  const phoneHash = vault.hash(normalized);
  const phoneMasked = vault.mask(normalized);
  const now = nowMysql();
  let user = await queryOne(db, 'SELECT * FROM users WHERE phone_hash = ?', [phoneHash]);

  if (user) {
    await execute(db, `
      UPDATE users
      SET openid = COALESCE(NULLIF(?, ''), openid),
          nickname = CASE WHEN nickname = '' THEN ? ELSE nickname END,
          avatar = COALESCE(NULLIF(?, ''), avatar),
          last_active_at = ?,
          is_demo = CASE WHEN ? = 1 THEN 1 ELSE is_demo END
      WHERE id = ?
    `, [openid, nickname, avatar, now, isDemo ? 1 : 0, user.id]);
  } else {
    const encrypted = vault.encrypt(normalized);
    const fallbackNickname = nickname || `吉他手${normalized.slice(-4)}`;
    try {
      const result = await execute(db, `
        INSERT INTO users
          (phone_encrypted, phone_hash, phone_masked, openid, nickname, avatar, is_demo, created_at, last_active_at)
        VALUES (?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, ?)
      `, [encrypted, phoneHash, phoneMasked, openid, fallbackNickname, avatar, isDemo ? 1 : 0, now, now]);
      user = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [result.insertId]);
    } catch (error) {
      // Handles a race between two concurrent logins for the same phone/openid.
      user = await queryOne(db, 'SELECT * FROM users WHERE phone_hash = ?', [phoneHash]);
      if (!user) throw error;
      await execute(db, 'UPDATE users SET last_active_at = ? WHERE id = ?', [now, user.id]);
    }
  }

  user = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [user.id]);
  return serializeUser(user);
}

async function touchUser(db, userId) {
  await execute(db, 'UPDATE users SET last_active_at = ? WHERE id = ?', [nowMysql(), userId]);
}

module.exports = { findOrCreateUserByPhone, touchUser };
