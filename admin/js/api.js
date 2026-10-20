const TOKEN_KEY = 'xianjian_admin_token';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_ERROR', details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch (_error) {
    return '';
  }
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function redirectToLogin() {
  if (window.location.pathname.endsWith('/login.html')) return;
  window.location.replace('/admin/login.html');
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  let payload = null;
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => '');
    payload = text ? { message: text } : null;
  }
  if (!response.ok) {
    throw new ApiError(
      (payload && payload.message) || `请求失败（HTTP ${response.status}）`,
      {
        status: response.status,
        code: (payload && payload.code) || 'HTTP_ERROR',
        details: payload && payload.details,
      },
    );
  }
  return payload;
}

/**
 * Authenticated admin API request.
 * A 401 clears the local token and sends the operator to the login screen.
 */
export async function api(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const token = getToken();
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (token) requestHeaders.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('无法连接服务器，请检查后端是否运行', { code: 'NETWORK_ERROR' });
  }

  if (response.status === 401 && token) {
    clearToken();
    redirectToLogin();
    throw new ApiError('登录已失效，请重新登录', { status: 401, code: 'UNAUTHORIZED' });
  }
  return parseResponse(response);
}

/** Login endpoint without token / automatic redirect semantics. */
export async function loginRequest(username, password) {
  let response;
  try {
    response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (_error) {
    throw new ApiError('无法连接服务器，请检查后端是否运行', { code: 'NETWORK_ERROR' });
  }
  return parseResponse(response);
}

export async function verifySession() {
  return api('/admin/me');
}

/**
 * Uploads one file with XHR so the admin can display real progress for videos.
 * `kind` must be image or video; the server validates MIME + extension.
 */
export function uploadFile(file, kind, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/admin/upload?kind=${encodeURIComponent(kind)}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'text';

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });

    xhr.addEventListener('load', () => {
      let payload = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch (_error) {
        payload = null;
      }
      if (xhr.status === 401) {
        clearToken();
        redirectToLogin();
        reject(new ApiError('登录已失效，请重新登录', { status: 401, code: 'UNAUTHORIZED' }));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(
          (payload && payload.message) || `上传失败（HTTP ${xhr.status}）`,
          { status: xhr.status, code: (payload && payload.code) || 'UPLOAD_ERROR' },
        ));
        return;
      }
      if (!payload) {
        reject(new ApiError('上传响应格式不正确', { code: 'UPLOAD_ERROR' }));
        return;
      }
      const assetUrl = payload.url || payload.storagePath;
      if (!assetUrl || !/^https:\/\//i.test(assetUrl)) {
        reject(new ApiError('上传接口未返回 TOS HTTPS 绝对地址', { code: 'UPLOAD_ERROR' }));
        return;
      }
      resolve({ ...payload, url: assetUrl, storagePath: assetUrl });
    });

    xhr.addEventListener('error', () => {
      reject(new ApiError('上传网络中断，请重试', { code: 'NETWORK_ERROR' }));
    });
    xhr.addEventListener('abort', () => {
      reject(new ApiError('上传已取消', { code: 'ABORTED' }));
    });
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
