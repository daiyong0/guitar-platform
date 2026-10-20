import { loginRequest, setToken, getToken, clearToken, verifySession } from './api.js';

const form = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const errorBox = document.getElementById('login-error');
const submitButton = document.getElementById('login-submit');
const toggleButton = document.getElementById('toggle-password');

function setLoading(loading) {
  submitButton.disabled = loading;
  if (loading) {
    submitButton.classList.add('loading');
    submitButton.querySelector('span').textContent = '正在验证';
  } else {
    submitButton.classList.remove('loading');
    submitButton.querySelector('span').textContent = '登录运营后台';
  }
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

async function redirectIfAlreadyLoggedIn() {
  if (!getToken()) return;
  try {
    await verifySession();
    window.location.replace('/admin/');
  } catch (_error) {
    clearToken();
  }
}

toggleButton.addEventListener('click', () => {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  toggleButton.setAttribute('aria-label', isPassword ? '隐藏密码' : '显示密码');
  passwordInput.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username) {
    showError('请输入管理员账号');
    usernameInput.focus();
    return;
  }
  if (!password) {
    showError('请输入登录密码');
    passwordInput.focus();
    return;
  }

  setLoading(true);
  try {
    const data = await loginRequest(username, password);
    setToken(data.token);
    window.location.replace('/admin/');
  } catch (error) {
    showError(error.message || '登录失败，请重试');
    setLoading(false);
    passwordInput.select();
  }
});

usernameInput.addEventListener('input', () => showError(''));
passwordInput.addEventListener('input', () => showError(''));

redirectIfAlreadyLoggedIn();
if (!usernameInput.value) window.setTimeout(() => usernameInput.focus(), 80);
