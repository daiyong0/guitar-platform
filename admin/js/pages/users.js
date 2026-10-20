import { api } from '../api.js';
import {
  emptyState,
  errorPanel,
  escapeHtml,
  formatDateTime,
  formatNumber,
  icon,
  toast,
} from '../ui.js';

const PAGE_SIZE = 20;

function renderUserRows(items) {
  return items.map((user) => {
    // 管理后台接口会返回解密后的完整手机号；若解密失败则回退到脱敏号码。
    const phone = user.phone || user.phoneMasked || '—';
    return `
    <tr data-user-id="${user.id}" style="cursor:pointer">
      <td>
        <div class="user-cell">
          <span class="user-avatar${user.isDemo ? ' demo' : ''}">${escapeHtml((user.nickname || '吉').slice(0, 1))}</span>
          <div>
            <div class="user-name">${escapeHtml(user.nickname || '吉他手')} ${user.isDemo ? '<span class="badge demo">演示用户</span>' : ''}</div>
            <div class="user-phone" title="${user.phoneIsFull ? '完整手机号' : '脱敏手机号'}">${escapeHtml(phone)} · ID ${user.id}</div>
          </div>
        </div>
      </td>
      <td>
        <div class="cell-main">${formatNumber(user.eventCount)} <span class="cell-muted">条事件</span></div>
        <div class="cell-sub">${formatNumber(user.sessionCount)} 个会话</div>
      </td>
      <td>
        <div class="cell-muted">${formatDateTime(user.createdAt)}</div>
      </td>
      <td>
        <div class="cell-main">${formatDateTime(user.lastActiveAt)}</div>
        <div class="cell-sub">${user.lastEventAt ? `最后事件 ${formatDateTime(user.lastEventAt)}` : '等待首次行为上报'}</div>
      </td>
      <td style="text-align:right">
        <a class="row-link" href="#/users/${user.id}">路径回放 ${icon('arrow')}</a>
      </td>
    </tr>`;
  }).join('');
}

export function render(container, context) {
  const { signal } = context;
  let page = 1;
  let keyword = '';
  let items = [];
  let pagination = { page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false };
  let requestVersion = 0;

  container.innerHTML = `
    <div class="page-head-row">
      <div class="section-heading">
        <h2>听众档案</h2>
        <p id="users-caption">正在读取用户…</p>
      </div>
      <div class="head-actions">
        <button class="button secondary" type="button" id="users-refresh">${icon('refresh')}<span>刷新</span></button>
      </div>
    </div>
    <div class="toolbar">
      <div class="toolbar-group">
        <form id="user-search-form" style="display:flex;gap:8px;align-items:center">
          <div class="input-group">
            ${icon('search')}
            <input class="input search-input" id="user-search" type="search" placeholder="昵称 / 脱敏手机号 / 完整手机号…" maxlength="60" autocomplete="off" style="width:288px" />
          </div>
          <button class="button secondary small" type="submit">搜索</button>
        </form>
      </div>
      <p class="field-hint">点击用户行进入完整行为路径回放</p>
    </div>
    <div class="table-panel" id="users-table-panel">
      <div class="table-loading">正在读取用户…</div>
    </div>`;

  const tablePanel = document.getElementById('users-table-panel');
  const caption = document.getElementById('users-caption');
  const searchForm = document.getElementById('user-search-form');
  const searchInput = document.getElementById('user-search');

  function paginationHTML() {
    const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
    return `
      <div class="pagination-bar">
        <span>共 ${formatNumber(pagination.total)} 位用户 · 第 ${pagination.page} / ${totalPages} 页</span>
        <div class="pagination-controls">
          <button type="button" data-page="${pagination.page - 1}" ${pagination.page <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="page-current" style="min-width:27px;text-align:center">${pagination.page}</span>
          <button type="button" data-page="${pagination.page + 1}" ${!pagination.hasMore ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
  }

  function renderRows() {
    caption.textContent = keyword
      ? `搜索“${keyword}”找到 ${formatNumber(pagination.total)} 位用户`
      : `共 ${formatNumber(pagination.total)} 位已登录用户。未登录设备的行为会以匿名设备 ID 参与整体分析。`;
    if (!items.length) {
      tablePanel.innerHTML = emptyState({
        title: keyword ? '没有找到用户' : '还没有登录用户',
        description: keyword ? '可以尝试昵称或手机号后四位。' : '在小程序中使用「抖音手机号授权登录」后，用户会出现在这里。',
      });
      return;
    }
    tablePanel.innerHTML = `
      <div class="table-scroll">
        <table class="data-table" style="min-width:880px">
          <thead>
            <tr>
              <th>用户</th>
              <th>行为规模</th>
              <th>注册时间</th>
              <th>最后活跃</th>
              <th style="text-align:right">路径</th>
            </tr>
          </thead>
          <tbody>${renderUserRows(items)}</tbody>
        </table>
      </div>
      ${paginationHTML()}`;
  }

  async function loadUsers() {
    requestVersion += 1;
    const version = requestVersion;
    tablePanel.innerHTML = '<div class="table-loading">正在读取用户…</div>';
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (keyword) params.set('search', keyword);
      const data = await api(`/admin/users?${params.toString()}`, { signal });
      if (signal.aborted || version !== requestVersion) return;
      items = data.items;
      pagination = data.pagination;
      renderRows();
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (version !== requestVersion) return;
      tablePanel.innerHTML = errorPanel(error.message || '读取用户失败');
      tablePanel.querySelector('[data-retry]')?.addEventListener('click', loadUsers);
      toast(error.message || '读取用户失败', 'error');
    }
  }

  tablePanel.addEventListener('click', (event) => {
    if (event.target.closest('a')) return;
    const pageButton = event.target.closest('[data-page]');
    if (pageButton && !pageButton.disabled) {
      const target = Number(pageButton.dataset.page);
      if (Number.isInteger(target) && target > 0) {
        page = target;
        loadUsers();
      }
      return;
    }
    const row = event.target.closest('tr[data-user-id]');
    if (row && !window.getSelection().toString()) {
      window.location.hash = `#/users/${row.dataset.userId}`;
    }
  });

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    keyword = searchInput.value.trim();
    page = 1;
    loadUsers();
  });

  document.getElementById('users-refresh').addEventListener('click', loadUsers);

  loadUsers();

  return function cleanup() {
    // fetch is tied to the route AbortController; nothing else to dispose.
  };
}
