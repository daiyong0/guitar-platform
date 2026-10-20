const SVG_ICONS = {
  empty: '<svg viewBox="0 0 24 24" fill="none"><path d="M5.2 6.8h13.6v10.4H5.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.4 10.5h7.2M8.4 13.7h4.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none"><circle cx="10.8" cy="10.8" r="5.6" stroke="currentColor" stroke-width="1.6"/><path d="m15.2 15.2 3.7 3.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 16V5m0 0L8 9m4-4 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 16v2.2A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8V16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none"><path d="m9 7 8 5-8 5V7Z" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none"><path d="M19 12H5m5 5-5-5 5-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none"><path d="M19.5 8.2A8 8 0 1 0 20 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M19.5 4.2v4h-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none"><path d="M3.5 12S6.7 6.8 12 6.8 20.5 12 20.5 12 17.3 17.2 12 17.2 3.5 12 3.5 12Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.6"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.7v5.2m0 3.1v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M5.5 7.5h13M9.2 7.5V5.4h5.6v2.1m-7.5 0 .7 11.1h8l.7-11.1M10.4 11v4.6M13.6 11v4.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none"><path d="m14.8 5.2 4 4M6 18l.8-4.9L16.5 3.4a1.6 1.6 0 0 1 2.3 0l1.8 1.8a1.6 1.6 0 0 1 0 2.3l-9.7 9.7L6 18Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8.2" r="3.5" stroke="currentColor" stroke-width="1.7"/><path d="M5.2 19.6c.5-3.5 3-5.5 6.8-5.5s6.3 2 6.8 5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

export function icon(name) {
  return SVG_ICONS[name] || '';
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatNumber(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('zh-CN').format(n);
}

export function formatDateTime(value, { withYear = true } = {}) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${withYear ? `${year}-` : ''}${month}-${day} ${hours}:${minutes}`;
}

export function formatDateShort(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`;
}

export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatWithinDay(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDurationMs(ms, { compact = false } = {}) {
  const n = Math.max(0, Math.round(Number(ms) || 0));
  if (n < 1000) return `${n} 毫秒`;
  const seconds = n / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remain = Math.round(seconds % 60);
  if (minutes < 60) return compact ? `${minutes}分${remain}秒` : `${minutes} 分 ${remain} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

export function formatPercent(value, digits = 0) {
  return `${((Number(value) || 0) * 100).toFixed(digits)}%`;
}

export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function statusBadge(status) {
  return status === 'published'
    ? '<span class="badge published">已上架</span>'
    : '<span class="badge draft">草稿</span>';
}

export function toast(message, type = 'info', duration = 3000) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  stack.appendChild(node);
  window.setTimeout(() => {
    node.classList.add('leaving');
    window.setTimeout(() => node.remove(), 220);
  }, duration);
}

export function setButtonLoading(button, loading, loadingText = '处理中') {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalText) button.dataset.originalText = button.innerHTML;
    button.classList.add('loading');
    button.disabled = true;
    button.setAttribute('aria-label', loadingText);
  } else {
    button.classList.remove('loading');
    button.disabled = false;
    if (button.dataset.originalText) {
      button.innerHTML = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

export function emptyState({ title = '暂无数据', description = '', action = '' } = {}) {
  return `
    <div class="empty-state">
      <span class="empty-icon">${icon('empty')}</span>
      <strong>${escapeHtml(title)}</strong>
      ${description ? `<p>${escapeHtml(description)}</p>` : ''}
      ${action}
    </div>`;
}

export function openDialog({ title, eyebrow = 'EDITOR', description = '', body = '', footer = '', size = 'normal', id = '' }) {
  const dialog = document.getElementById('app-dialog');
  if (!dialog) throw new Error('缺少全局对话框');
  dialog.className = `app-dialog${size === 'wide' ? ' wide' : ''}`;
  dialog.id = id || 'app-dialog';
  dialog.innerHTML = `
    <div class="dialog-shell">
      <div class="dialog-head">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${escapeHtml(title)}</h2>
          ${description ? `<p>${escapeHtml(description)}</p>` : ''}
        </div>
        <button class="dialog-close" type="button" data-dialog-close aria-label="关闭">${icon('close')}</button>
      </div>
      <div class="dialog-body">${body}</div>
      <div class="dialog-foot">${footer || '<button class="button secondary" type="button" data-dialog-close>关闭</button>'}</div>
    </div>`;
  dialog.querySelectorAll('[data-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => closeDialog());
  });
  if (!dialog.open) dialog.showModal();
  return dialog;
}

export function closeDialog() {
  const dialog = document.getElementById('app-dialog');
  if (dialog && dialog.open) dialog.close();
}

export function confirmAction({ title = '确认操作', message = '', confirmText = '确认', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('confirm-dialog');
    if (!dialog) {
      resolve(window.confirm(message || title));
      return;
    }
    dialog.innerHTML = `
      <div class="confirm-shell">
        <span class="confirm-icon${danger ? ' danger' : ''}">${danger ? icon('trash') : icon('alert')}</span>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button class="button secondary" type="button" data-confirm-cancel>${escapeHtml(cancelText)}</button>
          <button class="button ${danger ? 'danger' : 'primary'}" type="button" data-confirm-ok>${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    dialog.querySelector('[data-confirm-cancel]').addEventListener('click', () => finish(false));
    dialog.querySelector('[data-confirm-ok]').addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    }, { once: true });
    if (!dialog.open) dialog.showModal();
  });
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('脚本加载失败'));
    document.head.appendChild(script);
  });
}

let echartsPromise = null;
export async function ensureECharts() {
  if (window.echarts) return window.echarts;
  if (!echartsPromise) {
    echartsPromise = loadScript('./vendor/echarts.min.js')
      .then(() => {
        if (!window.echarts) throw new Error('ECharts 未就绪');
        return window.echarts;
      })
      .catch((error) => {
        echartsPromise = null;
        throw error;
      });
  }
  return echartsPromise;
}

export function debounce(fn, delay = 300) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), delay);
  };
}

export function errorPanel(message, retryLabel = '重新加载') {
  return `
    <div class="error-state">
      <p>${escapeHtml(message || '加载失败，请稍后重试')}</p>
      <button class="button secondary small" type="button" data-retry>${escapeHtml(retryLabel)}</button>
    </div>`;
}

export function pageHeader({ eyebrow = '', title = '', subtitle = '' }) {
  return `
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    <h2>${escapeHtml(title)}</h2>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}`;
}
