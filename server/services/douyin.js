'use strict';

/**
 * Minimal server-side client for the Douyin open platform.
 *
 * IMPORTANT: Phone-number authorization can only be requested after the
 * miniprogram has been officially published ("手机号快速验证" capability).
 * Keep PHONE_LOGIN_MODE=mock throughout development/review. This file is ready
 * for the production switch, but the exact endpoints can change on the open
 * platform; URL overrides are exposed in .env so no route code needs editing.
 */

const REQUEST_TIMEOUT_MS = 10_000;
let tokenCache = null;

async function requestJson(url, { method = 'POST', body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_error) {
    payload = { err_tips: `抖音接口返回非 JSON 内容（HTTP ${response.status}）` };
  }
  if (!response.ok) {
    const message = payload.err_tips || payload.message || `抖音接口 HTTP ${response.status}`;
    throw new Error(message);
  }
  const errorCode = payload.err_no ?? payload.errcode;
  if (errorCode !== undefined && Number(errorCode) !== 0) {
    throw new Error(payload.err_tips || payload.errmsg || `抖音接口错误 ${errorCode}`);
  }
  return payload.data && typeof payload.data === 'object' ? payload.data : payload;
}

async function getAccessToken(config) {
  const { appId, appSecret, tokenUrl } = config.phoneLogin;
  if (!appId || !appSecret) throw new Error('缺少抖音 AppID/AppSecret 配置');
  if (tokenCache && tokenCache.appId === appId && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const data = await requestJson(tokenUrl, {
    body: { appid: appId, secret: appSecret, grant_type: 'client_credential' },
  });
  const token = data.access_token || data.accessToken;
  if (!token) throw new Error('抖音 access_token 响应缺少 access_token');
  const expiresIn = Number(data.expires_in || data.expiresIn || 7200);
  tokenCache = { appId, token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

async function exchangeLoginCode(config, loginCode) {
  const { appId, appSecret, code2SessionUrl } = config.phoneLogin;
  const data = await requestJson(code2SessionUrl, {
    body: { appid: appId, secret: appSecret, code: loginCode },
  });
  if (!data.openid) throw new Error('code2Session 响应缺少 openid');
  return { openid: data.openid, sessionKey: data.session_key || '', unionid: data.unionid || '' };
}

async function exchangePhoneCode(config, phoneCode) {
  const token = await getAccessToken(config);
  const separator = config.phoneLogin.phoneUrl.includes('?') ? '&' : '?';
  const url = `${config.phoneLogin.phoneUrl}${separator}access_token=${encodeURIComponent(token)}`;
  const data = await requestJson(url, { body: { code: phoneCode } });
  const phone = data.phone_number || data.phoneNumber || data.purePhoneNumber || data.phone;
  if (!phone) throw new Error('获取手机号响应缺少 phone_number');
  return String(phone).replace(/\D/g, '');
}

async function resolveRealIdentity(config, { loginCode, phoneCode }) {
  if (!loginCode) throw new Error('缺少 tt.login 登录 code');
  if (!phoneCode) throw new Error('缺少手机号授权 code');
  const session = await exchangeLoginCode(config, loginCode);
  const phone = await exchangePhoneCode(config, phoneCode);
  return { phone, openid: session.openid };
}

module.exports = { resolveRealIdentity };
