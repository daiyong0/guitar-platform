'use strict';

const express = require('express');
const { HttpError, asyncHandler, optionalString } = require('../utils/http');
const { signUserToken } = require('../utils/tokens');
const { resolveRealIdentity } = require('../services/douyin');
const { findOrCreateUserByPhone, touchUser } = require('../services/user-service');
const { serializeUser } = require('../utils/assets');
const { queryOne } = require('../db');

function createAuthRouter({ db, config, vault, requireUser }) {
  const router = express.Router();

  /**
   * 抖音手机号授权登录。
   *
   * 资质提醒（务必阅读）：
   * - 手机号授权能力要求小程序正式上线后才能单独申请。开发/提审阶段直接
   *   调用该能力会被审核驳回（“一键获取手机号能力无法实现”）。
   * - 因此默认 PHONE_LOGIN_MODE=mock：仍然完整走 tt.login + getPhoneNumber
   *   按钮回调，但服务端不请求抖音手机号接口，返回固定测试用户。
   * - 上线并开通能力后，设置 PHONE_LOGIN_MODE=real 并配置 AppID/AppSecret。
   */
  router.post('/login', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const loginCode = optionalString(body.loginCode, 'loginCode', { max: 512 });
    const phoneCode = optionalString(body.phoneCode, 'phoneCode', { max: 512 });
    let identity;
    let isDemo = false;

    if (config.phoneLogin.mode === 'mock') {
      identity = {
        phone: config.phoneLogin.mockPhone,
        openid: `mock-openid-${config.phoneLogin.mockPhone.slice(-4)}`,
      };
      isDemo = true;
    } else {
      try {
        identity = await resolveRealIdentity(config, { loginCode, phoneCode });
      } catch (error) {
        console.error('[auth] 真实手机号换取失败:', error.message);
        throw new HttpError(502, '手机号授权失败，请重试或稍后再试', 'PHONE_LOGIN_FAILED');
      }
    }

    let user;
    try {
      user = await findOrCreateUserByPhone({
        db,
        vault,
        phone: identity.phone,
        openid: identity.openid,
        nickname: isDemo ? config.phoneLogin.mockNickname : '',
        isDemo,
      });
    } catch (error) {
      console.error('[auth] 创建用户失败:', error.message);
      throw new HttpError(502, '登录失败，手机号信息异常', 'PHONE_LOGIN_FAILED');
    }

    const token = signUserToken(config, user.id);
    res.json({
      token,
      user,
      mock: config.phoneLogin.mode === 'mock',
      meta: { phoneLoginMode: config.phoneLogin.mode },
    });
  }));

  router.get('/me', requireUser, asyncHandler(async (req, res) => {
    await touchUser(db, req.user.id);
    const user = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({
      user: serializeUser(user),
      meta: { phoneLoginMode: config.phoneLogin.mode },
    });
  }));

  router.post('/logout', (_req, res) => {
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createAuthRouter };
