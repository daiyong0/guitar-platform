import { getToken, clearToken, verifySession } from './api.js';
import { closeDialog, escapeHtml, icon, toast } from './ui.js';
import * as AnalyticsPage from './pages/analytics.js';
import * as ScoresPage from './pages/scores.js';
import * as VideosPage from './pages/videos.js';
import * as UsersPage from './pages/users.js';
import * as UserDetailPage from './pages/user-detail.js';

const pageContent = document.getElementById('page-content');
const pageTitle = document.getElementById('page-title');
const pageEyebrow = document.getElementById('page-eyebrow');
const pageSubtitle = document.getElementById('page-subtitle');
const sidebar = document.getElementById('sidebar');
const backdrop = document.querySelector('[data-sidebar-close]');
const menuToggle = document.getElementById('menu-toggle');
const topbarDate = document.getElementById('topbar-date');

const routes = [
  {
    key: 'analytics',
    match: (path) => path === '/analytics' || path === '/' || path === '',
    module: AnalyticsPage,
    nav: 'analytics',
    eyebrow: 'DATA & INSIGHT',
    title: '数据分析',
    subtitle: '页面访问、内容热度、停留时长与转化漏斗。',
  },
  {
    key: 'scores',
    match: (path) => path === '/scores',
    module: ScoresPage,
    nav: 'scores',
    eyebrow: 'CONTENT OPERATIONS',
    title: '吉他谱管理',
    subtitle: '维护多图谱面、标签与上架状态，让好内容被听见。',
  },
  {
    key: 'videos',
    match: (path) => path === '/videos',
    module: VideosPage,
    nav: 'videos',
    eyebrow: 'CONTENT OPERATIONS',
    title: '视频回放',
    subtitle: '上传直播回放、封面与分类，管理每一次现场记录。',
  },
  {
    key: 'users',
    match: (path) => path === '/users',
    module: UsersPage,
    nav: 'users',
    eyebrow: 'AUDIENCE & JOURNEY',
    title: '用户管理',
    subtitle: '查看用户概况，并回放每一位听众的完整行为路径。',
  },
  {
    key: 'user-detail',
    match: (path) => /^\/users\/\d+$/.test(path),
    module: UserDetailPage,
    nav: 'users',
    eyebrow: 'BEHAVIOR TIMELINE',
    title: '用户路径回放',
    subtitle: '按会话还原浏览、搜索、播放与转化行为。',
  },
];

let currentCleanup = null;
let routeVersion = 0;
let currentAbort = null;

function redirectToLogin() {
  window.location.replace('/admin/login.html');
}

function skeletonHTML() {
  return `
    <div class="page-loading" aria-label="正在加载">
      <div class="skeleton skeleton-title"></div>
      <div class="summary-grid">
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
      </div>
      <div class="chart-grid">
        <div class="skeleton skeleton-chart"></div>
        <div class="skeleton skeleton-chart"></div>
      </div>
    </div>`;
}

function parseRoute() {
  let raw = window.location.hash.replace(/^#/, '');
  if (!raw) raw = '/analytics';
  if (!raw.startsWith('/')) raw = `/${raw}`;
  const questionIndex = raw.indexOf('?');
  let path = questionIndex >= 0 ? raw.slice(0, questionIndex) : raw;
  const query = new URLSearchParams(questionIndex >= 0 ? raw.slice(questionIndex + 1) : '');
  path = path.replace(/\/+$/, '') || '/';
  const route = routes.find((entry) => entry.match(path));
  const userMatch = path.match(/^\/users\/(\d+)$/);
  return {
    path,
    query,
    route,
    params: userMatch ? { id: userMatch[1] } : {},
  };
}

function setActiveNav(nav) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === nav);
  });
}

function setHeader(route) {
  pageEyebrow.textContent = route.eyebrow;
  pageTitle.textContent = route.title;
  pageSubtitle.textContent = route.subtitle;
  document.title = `${route.title} · 弦间运营台`;
}

function closeMobileSidebar() {
  sidebar.classList.remove('open');
  backdrop.hidden = true;
  menuToggle.setAttribute('aria-expanded', 'false');
}

function openMobileSidebar() {
  sidebar.classList.add('open');
  backdrop.hidden = false;
  menuToggle.setAttribute('aria-expanded', 'true');
}

function renderFatal(message) {
  pageContent.innerHTML = `
    <div class="error-state" style="margin-top:20px">
      <p>${escapeHtml(message || '后台初始化失败，请检查服务是否启动。')}</p>
      <button class="button secondary small" type="button" id="bootstrap-retry">重新加载</button>
    </div>`;
  document.getElementById('bootstrap-retry')?.addEventListener('click', () => window.location.reload());
}

async function renderRoute() {
  const parsed = parseRoute();
  if (!parsed.route) {
    pageEyebrow.textContent = 'NOT FOUND';
    pageTitle.textContent = '页面不存在';
    pageSubtitle.textContent = '请通过左侧导航返回管理功能。';
    setActiveNav('');
    pageContent.innerHTML = `
      <div class="panel" style="margin-top:4px">
        <div class="empty-state">
          <span class="empty-icon">${icon('empty')}</span>
          <strong>找不到这个页面</strong>
          <p>地址可能已经改变，返回数据分析继续浏览。</p>
          <a class="button secondary small" href="#/analytics">回到数据分析</a>
        </div>
      </div>`;
    return;
  }

  document.title = `${parsed.route.title} · 弦间运营台`;
  setHeader(parsed.route);
  setActiveNav(parsed.route.nav);
  closeMobileSidebar();
  closeDialog();

  routeVersion += 1;
  const version = routeVersion;
  if (currentAbort) currentAbort.abort();
  currentAbort = new AbortController();
  const { signal } = currentAbort;

  if (currentCleanup) {
    try { currentCleanup(); } catch (error) { console.warn('页面清理失败', error); }
    currentCleanup = null;
  }

  pageContent.innerHTML = skeletonHTML();
  window.scrollTo({ top: 0, behavior: 'instant' });

  try {
    const cleanup = await parsed.route.module.render(pageContent, {
      parsed,
      route: parsed.route,
      params: parsed.params,
      query: parsed.query,
      signal,
    });
    if (version !== routeVersion) {
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (error) {
    if (signal.aborted || error.name === 'AbortError') return;
    if (version !== routeVersion) return;
    console.error('[admin] page render failed', error);
    pageContent.innerHTML = `
      <div class="error-state" style="margin-top:4px">
        <p>${escapeHtml(error.message || '页面加载失败')}</p>
        <button class="button secondary small" type="button" id="route-retry">重新加载</button>
      </div>`;
    document.getElementById('route-retry')?.addEventListener('click', renderRoute);
  }
}

function bindShell() {
  menuToggle.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) closeMobileSidebar();
    else openMobileSidebar();
  });
  backdrop.addEventListener('click', closeMobileSidebar);
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.addEventListener('click', closeMobileSidebar);
  });
  document.getElementById('logout-button').addEventListener('click', () => {
    clearToken();
    window.location.replace('/admin/login.html');
  });
  window.addEventListener('hashchange', renderRoute);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) closeMobileSidebar();
  });
}

function setDateLabel() {
  const now = new Date();
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  topbarDate.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · 周${weekday}`;
}

async function bootstrap() {
  bindShell();
  setDateLabel();

  const token = getToken();
  if (!token) {
    redirectToLogin();
    return;
  }

  try {
    const { admin } = await verifySession();
    const name = admin.username || '管理员';
    document.getElementById('admin-name').textContent = name;
    document.getElementById('admin-avatar').textContent = name.slice(0, 1).toUpperCase();
    if (!window.location.hash) {
      window.location.hash = '#/analytics';
      return;
    }
    await renderRoute();
  } catch (error) {
    if (error.status === 401) {
      redirectToLogin();
      return;
    }
    renderFatal(error.message || '无法读取登录状态');
  }
}

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && event.reason.name === 'AbortError') return;
  console.error('[admin] unhandled rejection', event.reason);
  toast(event.reason?.message || '出现未预期的错误', 'error');
});

bootstrap();
