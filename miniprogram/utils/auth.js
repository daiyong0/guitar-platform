'use strict';

const request = require('./request');
const config = require('./config');
const KEYS = require('./storage-keys');
const track = require('./track');

let cachedLogin = null;
let loginPromise = null;

function safeGetApp() {
  try {
    return typeof getApp === 'function' ? getApp() : null;
  } catch (error) {
    return null;
  }
}

function parseStoredUser(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function getToken() {
  try {
    return tt.getStorageSync(KEYS.TOKEN) || '';
  } catch (error) {
    return '';
  }
}

function getUser() {
  try {
    return parseStoredUser(tt.getStorageSync(KEYS.USER));
  } catch (error) {
    return null;
  }
}

function isLoggedIn() {
  return Boolean(getToken() && getUser());
}

function saveSession(token, user) {
  try {
    tt.setStorageSync(KEYS.TOKEN, token);
    tt.setStorageSync(KEYS.USER, JSON.stringify(user));
  } catch (error) {
    console.error('[auth] persist session failed', error);
  }
  track.identify(user.id);
}

function clearSession() {
  try {
    tt.removeStorageSync(KEYS.TOKEN);
    tt.removeStorageSync(KEYS.USER);
  } catch (error) {
    // ignore
  }
  cachedLogin = null;
  track.identify('');
}

function isMockMode() {
  const app = safeGetApp();
  const mode = app && app.globalData ? app.globalData.phoneLoginMode : '';
  if (mode === 'mock' || mode === 'real') return mode === 'mock';
  return Boolean(config.PHONE_MOCK_FALLBACK);
}

function requestTtLogin() {
  return new Promise((resolve, reject) => {
    if (typeof tt.login !== 'function') {
      reject(new Error('当前环境不支持 tt.login'));
      return;
    }
    tt.login({
      force: true,
      success(res) {
        if (res && res.code) resolve(res.code);
        else reject(new Error('tt.login 未返回有效 code'));
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || 'tt.login 失败'));
      },
    });
  });
}

/**
 * 先通过 tt.login 获取登录态 code。缓存只在 4 分钟内复用；code 仅能消费一次。
 */
async function prepareTtLogin(options) {
  const force = Boolean(options && options.force);
  if (!force && cachedLogin && Date.now() - cachedLogin.at < 4 * 60 * 1000) {
    return cachedLogin.code;
  }
  if (loginPromise) return loginPromise;

  loginPromise = requestTtLogin()
    .then((code) => {
      cachedLogin = { code, at: Date.now() };
      return code;
    })
    .finally(() => {
      loginPromise = null;
    });
  return loginPromise;
}

/**
 * 手机号授权回调 → 后端换取手机号 → 保存登录态。
 *
 * 重要：开发/提审阶段服务端保持 PHONE_LOGIN_MODE=mock，接受无手机号 code
 * 的固定测试用户；正式上线且手机号能力开通后，服务端切 real，这里会严格
 * 要求 getPhoneNumber 返回的 e.detail.code。
 */
async function loginWithPhone(detail) {
  const phoneDetail = detail || {};
  const phoneCode = phoneDetail.code || '';
  const mock = isMockMode();

  if (!phoneCode && !mock) {
    const message = (phoneDetail.errMsg && phoneDetail.errMsg.indexOf('deny') >= 0)
      ? '你取消了手机号授权，无法完成登录'
      : '未能获取手机号授权，请重试';
    throw new Error(message);
  }

  let loginCode = '';
  try {
    loginCode = await prepareTtLogin({ force: false });
  } catch (error) {
    if (!mock) {
      throw new Error('抖音登录态获取失败，请重试');
    }
    console.warn('[auth] tt.login failed in mock mode, continue for local demo', error.message);
  }

  try {
    const data = await request.post('/api/auth/login', {
      loginCode,
      phoneCode,
    }, { auth: false, timeout: 15000 });

    if (!data || !data.token || !data.user) {
      throw new Error('登录响应异常');
    }

    cachedLogin = null;
    saveSession(data.token, data.user);
    const app = safeGetApp();
    if (app && app.globalData) {
      app.globalData.phoneLoginMode = data.mock ? 'mock' : 'real';
    }
    return data;
  } catch (error) {
    // 登录 code 已被服务端消费或过期，下次必须重新 tt.login。
    cachedLogin = null;
    throw error;
  }
}

async function refreshMe() {
  if (!getToken()) return null;
  try {
    const data = await request.get('/api/auth/me');
    if (data && data.user) {
      try {
        tt.setStorageSync(KEYS.USER, JSON.stringify(data.user));
      } catch (error) {
        // ignore
      }
      return data.user;
    }
    return getUser();
  } catch (error) {
    if (error.statusCode === 401) {
      clearSession();
      return null;
    }
    throw error;
  }
}

function logout() {
  clearSession();
}

module.exports = {
  getToken,
  getUser,
  isLoggedIn,
  isMockMode,
  prepareTtLogin,
  loginWithPhone,
  refreshMe,
  logout,
};
