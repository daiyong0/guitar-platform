import { api } from '../api.js';
import {
  emptyState,
  errorPanel,
  escapeHtml,
  formatDateShort,
  formatDateTime,
  formatDurationMs,
  formatNumber,
  formatPercent,
  formatTime,
  icon,
  toast,
} from '../ui.js';

const EVENT_META = {
  page_view: { label: '页面访问', tone: '', icon: '<path d="M3.5 12S6.7 6.8 12 6.8 20.5 12 20.5 12 17.3 17.2 12 17.2 3.5 12 3.5 12Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.6"/>' },
  page_leave: { label: '离开页面', tone: 'leave', icon: '<path d="M9.5 5.8H6.4A1.4 1.4 0 0 0 5 7.2v9.6a1.4 1.4 0 0 0 1.4 1.4h3.1M14 8.2l4 3.8-4 3.8M18 12H9.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
  search: { label: '搜索', tone: 'search', icon: '<circle cx="10.6" cy="10.6" r="5.4" stroke="currentColor" stroke-width="1.6"/><path d="m14.8 14.8 3.8 3.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
  content_click: { label: '内容点击', tone: '', icon: '<path d="m6 5 12 7-5.4 1.2L10 19 6 5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  video_play: { label: '开始播放', tone: 'video', icon: '<path d="m9 7 8 5-8 5V7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' },
  video_pause: { label: '暂停播放', tone: 'video', icon: '<path d="M9.5 7v10M14.5 7v10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  video_complete: { label: '视频完播', tone: 'convert', icon: '<path d="m5.5 12.3 4.2 4.2 8.8-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
  share: { label: '分享', tone: 'convert', icon: '<circle cx="6.5" cy="12" r="2.3" stroke="currentColor" stroke-width="1.4"/><circle cx="17.5" cy="6.5" r="2.3" stroke="currentColor" stroke-width="1.4"/><circle cx="17.5" cy="17.5" r="2.3" stroke="currentColor" stroke-width="1.4"/><path d="m8.5 10.8 6.8-3.3m-6.8 5.7 6.8 3.3" stroke="currentColor" stroke-width="1.4"/>' },
  favorite: { label: '收藏', tone: 'convert', icon: '<path d="m12 4.8 2.1 4.6 5 .6-3.7 3.5 1 5-4.4-2.5-4.4 2.5 1-5-3.7-3.5 5-.6L12 4.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
};

function eventMeta(eventType) {
  return EVENT_META[eventType] || {
    label: eventType,
    tone: '',
    icon: '<circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.6"/>',
  };
}

function shortSession(sessionId) {
  if (!sessionId) return '';
  if (sessionId.length <= 22) return sessionId;
  return `${sessionId.slice(0, 9)}…${sessionId.slice(-7)}`;
}

function extrasChips(event) {
  const extra = event.extra || {};
  const chips = [];
  const add = (label, value) => {
    if (value === undefined || value === null || value === '') return;
    chips.push(`<span class="event-chip">${escapeHtml(label)} <b>${escapeHtml(value)}</b></span>`);
  };
  if (event.page) {
    chips.push(`<span class="event-chip">页面 <b>${escapeHtml(event.pageLabel || event.page)}</b></span>`);
  }
  if (event.contentId) {
    add('内容ID', event.contentId);
    if (event.contentType) add('类型', event.contentType === 'video' ? '视频' : '吉他谱');
    if (event.contentTitle) add('标题', event.contentTitle);
  }
  if (event.eventType === 'page_view') {
    add('来源页', extra.fromPage);
  }
  if (event.eventType === 'search') {
    add('关键词', extra.keyword || '（空）');
    add('结果', extra.resultCount);
    add('来源 Tab', extra.tab);
  }
  if (['video_play', 'video_pause', 'video_complete'].includes(event.eventType)) {
    const progress = Number(extra.progressSeconds);
    const duration = Number(extra.durationSeconds);
    if (Number.isFinite(progress)) add('播放进度', `${Math.round(progress)} 秒`);
    if (Number.isFinite(duration)) add('总时长', `${Math.round(duration)} 秒`);
    if (Number.isFinite(progress) && duration > 0) add('完成度', formatPercent(progress / duration, 0));
  }
  if (event.eventType === 'share') {
    add('分享路径', extra.sharePath);
  }
  if (event.eventType === 'favorite') {
    add('动作', extra.action === 'remove' ? '取消收藏' : '添加收藏');
  }
  if (extra.position !== undefined) add('位置', `第 ${extra.position} 位`);
  return chips.join('');
}

function pageDwellHTML(event) {
  // pageDwellMs 由后端根据 page_leave.extra.duration 回填到本次页面访问的所有事件；
  // 若页面被强杀没有 page_leave，则退回 page_view 的“到下一步”估算值。
  const value = event.pageDwellMs ?? event.dwellMs
    ?? event.extra?.durationMs ?? event.extra?.duration;
  if (value === null || value === undefined) return '';
  const approximate = event.pageDwellMs == null
    && (event.dwellSource === 'estimated' || event.eventType === 'page_view');
  return `
    <div class="event-dwell">
      本页停留：<b>${formatDurationMs(value)}</b>
      ${approximate ? '<em>估算至下一步</em>' : ''}
    </div>`;
}

function timelineHTML(data, selectedSession) {
  if (!data.events.length) {
    return emptyState({
      title: '这段会话还没有行为事件',
      description: '用户打开小程序后产生的 page_view 会实时出现在这里。',
    });
  }
  return `
    <div class="timeline" aria-label="用户行为时间线">
      ${data.events.map((event, index) => {
        const meta = eventMeta(event.eventType);
        const gap = event.gapFromPrevMs === null || event.gapFromPrevMs === undefined
          ? '<span class="event-gap">起点</span>'
          : `<span class="event-gap">距上一步 <em>+${formatDurationMs(event.gapFromPrevMs)}</em></span>`;
        return `
          <article class="timeline-event">
            <div class="timeline-time" title="${escapeHtml(event.time)}">
              <strong>${formatTime(event.time)}</strong>
              <span>${formatDateShort(event.time)}</span>
            </div>
            <div class="timeline-line">
              <span class="timeline-dot ${meta.tone}">
                <svg viewBox="0 0 24 24" fill="none">${meta.icon}</svg>
              </span>
            </div>
            <div class="timeline-card">
              <div class="timeline-card-head">
                <div class="event-name">
                  <span>${escapeHtml(meta.label)}</span>
                  <span class="badge plain">#${String(index + 1).padStart(2, '0')}</span>
                  ${selectedSession ? '' : (event.sessionId ? `<span class="badge plain">会话 ${escapeHtml(shortSession(event.sessionId))}</span>` : '')}
                </div>
                ${gap}
              </div>
              <p class="event-page">${escapeHtml(event.pageLabel || '—')} <code>${escapeHtml(event.page || '')}</code></p>
              ${pageDwellHTML(event)}
              <div class="event-details">${extrasChips(event)}</div>
            </div>
          </article>`;
      }).join('')}
    </div>
    <div class="timeline-footer-note">
      <span class="live-dot" style="width:5px;height:5px;margin:0;background:#9fae94;box-shadow:none"></span>
      共 ${formatNumber(data.events.length)} 条事件${selectedSession ? '' : '，跨会话展示时时间间隔包含会话间空档'} · 时间按进入事件的时间戳升序排列
    </div>`;
}

export async function render(container, context) {
  const { signal, params } = context;
  const userId = params.id;
  let userData;
  try {
    userData = await api(`/admin/users/${encodeURIComponent(userId)}`, { signal });
  } catch (error) {
    if (signal.aborted || error.name === 'AbortError') return () => {};
    container.innerHTML = `
      <button class="back-link" type="button" data-back>${icon('back')} 返回用户列表</button>
      <div class="panel" style="margin-top:7px">
        ${errorPanel(error.message || '读取用户信息失败')}
      </div>`;
    container.querySelector('[data-back]')?.addEventListener('click', () => { window.location.hash = '#/users'; });
    container.querySelector('[data-retry]')?.addEventListener('click', () => window.location.reload());
    return () => {};
  }

  if (signal.aborted) return () => {};
  const { user, stats, sessions } = userData;
  const displayPhone = user.phone || user.phoneMasked || '—';
  let currentSession = '';
  let pathRequestVersion = 0;

  const sessionsHTML = [
    `
      <button class="session-item all active" type="button" data-session-id="">
        <div class="session-date">全部会话 <span>${sessions.length}</span></div>
        <div class="session-meta">${formatNumber(sessions.reduce((sum, item) => sum + item.eventCount, 0))} 条事件 · 按时间串联</div>
      </button>`,
    ...sessions.map((session, index) => `
      <button class="session-item" type="button" data-session-id="${escapeHtml(session.sessionId)}">
        <div class="session-date">${formatDateShort(session.firstAt)} <span>${formatTime(session.firstAt)}–${formatTime(session.lastAt)}</span></div>
        <div class="session-meta">会话 ${String(index + 1).padStart(2, '0')} · ${session.pageViewCount} 次访问 · ${session.eventCount} 条事件</div>
      </button>`),
  ].join('');

  const avatarContent = user.avatar
    ? `<img src="${escapeHtml(user.avatar)}" alt="" />`
    : escapeHtml((user.nickname || '吉').slice(0, 1));

  container.innerHTML = `
    <div class="user-detail-head">
      <button class="back-link" type="button" data-back>${icon('back')} 返回用户列表</button>
      <section class="profile-hero">
        <div class="profile-main">
          <span class="profile-avatar">${avatarContent}</span>
          <div>
            <div class="profile-name-row">
              <h2 class="profile-name">${escapeHtml(user.nickname || '吉他手')}</h2>
              ${user.isDemo ? '<span class="badge demo">演示用户</span>' : ''}
            </div>
            <div class="profile-meta">
              <span>${escapeHtml(displayPhone)}</span>
              <span>用户 ID <strong>${user.id}</strong></span>
              <span>注册于 <strong>${formatDateTime(user.createdAt)}</strong></span>
              <span>最后活跃 <strong>${formatDateTime(user.lastActiveAt)}</strong></span>
            </div>
          </div>
        </div>
        <div class="profile-stats">
          <div class="profile-stat"><span>行为事件</span><strong>${formatNumber(stats.eventCount)}</strong></div>
          <div class="profile-stat"><span>浏览会话</span><strong>${formatNumber(stats.sessionCount)}</strong></div>
          <div class="profile-stat"><span>收藏内容</span><strong>${formatNumber(stats.favoriteCount)}</strong></div>
        </div>
      </section>
    </div>
    <div class="detail-layout">
      <aside class="session-panel">
        <div class="panel-heading">
          <h3>浏览会话</h3>
          <p>选择会话以查看单次访问路径</p>
        </div>
        <div class="session-list" id="session-list">${sessionsHTML}</div>
      </aside>
      <section class="timeline-panel">
        <div class="timeline-head">
          <div>
            <h3>行为时间线</h3>
            <p id="timeline-subtitle">正在读取全部事件…</p>
          </div>
          <button class="button secondary small" type="button" id="reload-path">${icon('refresh')} 刷新</button>
        </div>
        <div id="timeline-slot">
          <div class="timeline-skeleton">
            <div class="skeleton"></div>
            <div class="skeleton"></div>
            <div class="skeleton"></div>
            <div class="skeleton"></div>
          </div>
        </div>
      </section>
    </div>`;

  const sessionList = document.getElementById('session-list');
  const timelineSlot = document.getElementById('timeline-slot');
  const timelineSubtitle = document.getElementById('timeline-subtitle');
  const reloadButton = document.getElementById('reload-path');

  async function loadPath(sessionId = currentSession, { showLoading = true } = {}) {
    pathRequestVersion += 1;
    const version = pathRequestVersion;
    if (showLoading) {
      timelineSlot.innerHTML = `
        <div class="timeline-skeleton">
          <div class="skeleton"></div>
          <div class="skeleton"></div>
          <div class="skeleton"></div>
          <div class="skeleton"></div>
        </div>`;
    }
    const query = new URLSearchParams({ userId: String(user.id), limit: '2000' });
    if (sessionId) query.set('sessionId', sessionId);
    try {
      const data = await api(`/admin/analytics/user-path?${query.toString()}`, { signal });
      if (signal.aborted || version !== pathRequestVersion) return;
      currentSession = sessionId;
      sessionList.querySelectorAll('[data-session-id]').forEach((button) => {
        button.classList.toggle('active', button.dataset.sessionId === sessionId);
      });
      timelineSubtitle.textContent = sessionId
        ? `单次会话 · ${formatNumber(data.events.length)} 条事件 · ${formatDateTime(data.summary.firstAt)}`
        : `全部会话 · ${formatNumber(data.events.length)} 条事件 · ${data.sessions.length} 个会话`;
      timelineSlot.innerHTML = timelineHTML(data, sessionId);
      if (data.events.length) {
        timelineSlot.querySelector('.timeline')?.scrollTo({ top: 0 });
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (version !== pathRequestVersion) return;
      timelineSubtitle.textContent = '路径读取失败';
      timelineSlot.innerHTML = `<div style="padding:20px">${errorPanel(error.message || '读取用户路径失败')}</div>`;
      timelineSlot.querySelector('[data-retry]')?.addEventListener('click', () => loadPath(currentSession));
      toast(error.message || '读取用户路径失败', 'error');
    }
  }

  sessionList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-session-id]');
    if (!button || button.dataset.sessionId === currentSession) return;
    loadPath(button.dataset.sessionId || '');
  });

  document.querySelector('[data-back]')?.addEventListener('click', () => {
    window.location.hash = '#/users';
  });

  reloadButton.addEventListener('click', () => loadPath(currentSession, { showLoading: true }));

  loadPath('');

  return function cleanup() {
    pathRequestVersion += 1;
  };
}
