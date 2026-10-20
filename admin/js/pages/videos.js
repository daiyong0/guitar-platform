import { api, uploadFile } from '../api.js';
import {
  closeDialog,
  confirmAction,
  emptyState,
  errorPanel,
  escapeHtml,
  formatClock,
  formatDateTime,
  formatFileSize,
  formatNumber,
  icon,
  openDialog,
  setButtonLoading,
  statusBadge,
  toast,
} from '../ui.js';

const FALLBACK_IMAGE = '/admin/favicon.svg';
const PAGE_SIZE = 20;
const DEFAULT_CATEGORIES = ['现场回放', '教学回放', '幕后', '技巧', '设备', '乐理'];

function coverCell(item) {
  return `
    <div class="content-thumb landscape">
      <img src="${escapeHtml(item.coverPreviewUrl || FALLBACK_IMAGE)}" alt="" loading="lazy" />
      <span class="play-overlay">${icon('play')}</span>
      <span class="thumb-count">${formatClock(item.duration)}</span>
    </div>`;
}

function uploadZoneHTML(id, { title, hint, accept, multiple = false }) {
  return `
    <div class="upload-dropzone" id="${id}" tabindex="0" role="button">
      <input type="file" id="${id}-input" accept="${escapeHtml(accept)}" ${multiple ? 'multiple' : ''} />
      <span class="upload-icon">${icon('upload')}</span>
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(hint)}</span>
      <div class="upload-progress hidden" id="${id}-progress">
        <div class="progress-track"><div class="progress-bar" style="width:0%"></div></div>
        <div class="progress-text"><span>正在上传</span><span>0%</span></div>
      </div>
    </div>`;
}

function renderTable(items) {
  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>视频内容</th>
            <th>分类</th>
            <th>时长</th>
            <th>播放量</th>
            <th>状态</th>
            <th>创建时间</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>
                <div class="content-cell">
                  ${coverCell(item)}
                  <div>
                    <p class="content-title">${escapeHtml(item.title)}</p>
                    <p class="cell-sub">ID ${item.id} · 直播回放</p>
                  </div>
                </div>
              </td>
              <td>${item.category ? `<span class="badge plain">${escapeHtml(item.category)}</span>` : '<span class="cell-muted">未分类</span>'}</td>
              <td class="numeric">${formatClock(item.duration)}</td>
              <td class="numeric">${formatNumber(item.viewCount)}</td>
              <td>${statusBadge(item.status)}</td>
              <td class="cell-muted">${formatDateTime(item.createdAt)}</td>
              <td class="actions">
                <button type="button" class="text-button" data-action="preview" data-id="${item.id}">预览</button>
                <button type="button" class="text-button" data-action="edit" data-id="${item.id}">编辑</button>
                <button type="button" class="text-button ${item.status === 'published' ? 'danger' : 'success'}" data-action="toggle" data-id="${item.id}">${item.status === 'published' ? '下架' : '上架'}</button>
                <button type="button" class="text-button danger" data-action="delete" data-id="${item.id}">删除</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function readVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const finish = (duration) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
      resolve(duration);
    };
    video.preload = 'metadata';
    video.muted = true;
    video.addEventListener('loadedmetadata', () => {
      const duration = Number(video.duration);
      finish(Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0);
    });
    video.addEventListener('error', () => finish(0));
    window.setTimeout(() => finish(0), 8000);
    video.src = url;
  });
}

export function render(container, context) {
  const { signal } = context;
  let page = 1;
  let keyword = '';
  let status = '';
  let items = [];
  let pagination = { page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false };
  let requestVersion = 0;
  let uploadAbort = null;
  const knownCategories = new Set(DEFAULT_CATEGORIES);

  container.innerHTML = `
    <div class="page-head-row">
      <div class="section-heading">
        <h2>回放内容</h2>
        <p id="videos-caption">正在读取视频内容…</p>
      </div>
      <div class="head-actions">
        <button class="button secondary" type="button" id="videos-refresh">${icon('refresh')}<span>刷新</span></button>
        <button class="button primary" type="button" id="new-video">${icon('plus')}<span>新增视频回放</span></button>
      </div>
    </div>
    <div class="toolbar">
      <div class="toolbar-group">
        <form id="video-search-form" style="display:flex;gap:8px;align-items:center">
          <div class="input-group">
            ${icon('search')}
            <input class="input search-input" id="video-search" type="search" placeholder="搜索视频标题…" maxlength="60" autocomplete="off" />
          </div>
          <button class="button secondary small" type="submit">搜索</button>
        </form>
        <select class="select filter-select" id="video-status-filter" aria-label="状态筛选">
          <option value="">全部状态</option>
          <option value="published">已上架</option>
          <option value="draft">草稿</option>
        </select>
      </div>
    </div>
    <div class="table-panel" id="videos-table-panel">
      <div class="table-loading">正在读取视频内容…</div>
    </div>`;

  const tablePanel = document.getElementById('videos-table-panel');
  const caption = document.getElementById('videos-caption');
  const searchInput = document.getElementById('video-search');
  const statusFilter = document.getElementById('video-status-filter');
  const searchForm = document.getElementById('video-search-form');

  function updateCaption() {
    caption.textContent = keyword || status
      ? `筛选到 ${formatNumber(pagination.total)} 个回放`
      : `共 ${formatNumber(pagination.total)} 个视频回放，本地选择文件后直传 TOS。`;
  }

  function paginationHTML() {
    const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
    return `
      <div class="pagination-bar">
        <span>第 ${pagination.page} / ${totalPages} 页 · 每页 ${pagination.pageSize} 条</span>
        <div class="pagination-controls">
          <button type="button" data-page="${pagination.page - 1}" ${pagination.page <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="page-current" style="min-width:27px;text-align:center">${pagination.page}</span>
          <button type="button" data-page="${pagination.page + 1}" ${!pagination.hasMore ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
  }

  function renderRows() {
    updateCaption();
    if (!items.length) {
      tablePanel.innerHTML = emptyState({
        title: keyword || status ? '没有找到匹配视频' : '还没有视频回放',
        description: keyword || status ? '换一个关键词，或清除筛选后再试。' : '上传一场现场回放，与听众再见一次。',
        action: '<button class="button primary small" type="button" data-empty-action="new">新增视频回放</button>',
      });
      return;
    }
    tablePanel.innerHTML = `${renderTable(items)}${paginationHTML()}`;
  }

  async function loadVideos({ silent = false } = {}) {
    requestVersion += 1;
    const version = requestVersion;
    if (!silent) tablePanel.innerHTML = '<div class="table-loading">正在读取视频内容…</div>';
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (keyword) params.set('keyword', keyword);
      if (status) params.set('status', status);
      const data = await api(`/admin/videos?${params.toString()}`, { signal });
      if (signal.aborted || version !== requestVersion) return;
      items = data.items;
      pagination = data.pagination;
      items.forEach((item) => {
        if (item.category) knownCategories.add(item.category);
      });
      renderRows();
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (version !== requestVersion) return;
      tablePanel.innerHTML = errorPanel(error.message || '读取视频失败');
      tablePanel.querySelector('[data-retry]')?.addEventListener('click', () => loadVideos());
      toast(error.message || '读取视频失败', 'error');
    }
  }

  function openPreview(item) {
    const source = item.videoPreviewUrl || item.videoUrl;
    openDialog({
      title: item.title,
      eyebrow: 'VIDEO PREVIEW',
      description: `${item.category || '未分类'} · ${formatClock(item.duration)} · ${formatNumber(item.viewCount)} 次播放`,
      size: 'wide',
      body: source
        ? `<video class="video-preview-player" src="${escapeHtml(source)}" poster="${escapeHtml(item.coverPreviewUrl || '')}" controls playsinline preload="metadata"></video>
           <p class="field-hint" style="margin-top:9px">文件：${escapeHtml(item.videoUrl)}</p>`
        : '<p class="field-error">该视频未配置可播放文件。</p>',
      footer: '<button class="button secondary" type="button" data-dialog-close>关闭预览</button>',
    });
  }

  function openEditor(item = null) {
    if (uploadAbort) uploadAbort.abort();
    uploadAbort = new AbortController();
    const editing = Boolean(item);
    let editorStatus = item?.status || 'draft';
    let cover = item?.coverUrl
      ? { path: item.coverUrl, url: item.coverPreviewUrl || FALLBACK_IMAGE }
      : null;
    let video = item?.videoUrl
      ? {
        path: item.videoUrl,
        url: item.videoPreviewUrl || item.videoUrl,
        name: decodeURIComponent((item.videoUrl || '').split('/').pop() || '已上传视频'),
        size: 0,
      }
      : null;
    let uploadingCover = false;
    let uploadingVideo = false;
    const categories = [...new Set([...DEFAULT_CATEGORIES, ...knownCategories])];

    const dialog = openDialog({
      title: editing ? '编辑视频回放' : '新增视频回放',
      eyebrow: editing ? `EDIT VIDEO · #${item.id}` : 'NEW LIVE REPLAY',
      description: '封面与视频均上传至 TOS，数据库只保存完整 HTTPS 地址。',
      size: 'wide',
      body: `
        <div class="form-stack" id="video-editor">
          <div class="form-grid">
            <div class="field span-2">
              <label class="field-label" for="video-title">标题 <span style="color:var(--accent)">*</span></label>
              <input class="input" id="video-title" maxlength="100" placeholder="例如：Live 回放｜夏夜微风指弹现场" value="${escapeHtml(item?.title || '')}" />
            </div>
            <div class="field">
              <label class="field-label" for="video-category">分类</label>
              <input class="input" id="video-category" maxlength="30" list="video-category-list" placeholder="选择或输入分类" value="${escapeHtml(item?.category || '')}" />
              <datalist id="video-category-list">${categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join('')}</datalist>
            </div>
            <div class="field">
              <label class="field-label" for="video-duration">时长（秒）</label>
              <input class="input" id="video-duration" type="number" min="0" max="604800" step="1" value="${Number(item?.duration) || 0}" />
              <p class="field-hint" id="video-duration-hint">${formatClock(item?.duration || 0)}，选择视频文件后将自动读取时长。</p>
            </div>
            <div class="field span-2">
              <div class="form-section-title">封面图</div>
              <div class="image-grid" id="video-cover-grid"></div>
              ${uploadZoneHTML('video-cover-zone', {
                title: '上传或替换封面图',
                hint: '建议 16:9，PNG / JPG / WebP，不超过 20MB',
                accept: 'image/png,image/jpeg,image/webp,image/gif',
              })}
            </div>
            <div class="field span-2">
              <div class="form-section-title">视频文件</div>
              <div id="video-source-slot"></div>
              ${uploadZoneHTML('video-file-zone', {
                title: '上传回放视频文件',
                hint: 'MP4 / MOV / WebM，不超过 500MB',
                accept: 'video/mp4,video/quicktime,video/webm,video/x-m4v',
              })}
            </div>
            <div class="field span-2">
              <label class="field-label">上架状态</label>
              <div class="segmented-status" id="video-status-control" style="max-width:330px">
                <button type="button" data-status-value="draft" class="${editorStatus === 'draft' ? 'active' : ''}">保存草稿</button>
                <button type="button" data-status-value="published" class="${editorStatus === 'published' ? 'active' : ''}">立即上架</button>
              </div>
            </div>
          </div>
          <p class="field-error" id="video-editor-error" hidden></p>
        </div>`,
      footer: `
        <span class="foot-left">${editing ? `编辑 ID ${item.id}` : '视频与封面保存后才能上架'}</span>
        <button class="button secondary" type="button" data-dialog-close>取消</button>
        <button class="button primary" type="button" id="save-video">${editing ? '保存修改' : '创建视频'}</button>`,
    });

    const coverGrid = dialog.querySelector('#video-cover-grid');
    const coverZone = dialog.querySelector('#video-cover-zone');
    const coverInput = dialog.querySelector('#video-cover-zone-input');
    const coverProgress = dialog.querySelector('#video-cover-zone-progress');
    const coverProgressBar = coverProgress.querySelector('.progress-bar');
    const coverProgressText = coverProgress.querySelectorAll('.progress-text span');
    const fileZone = dialog.querySelector('#video-file-zone');
    const fileInput = dialog.querySelector('#video-file-zone-input');
    const fileProgress = dialog.querySelector('#video-file-zone-progress');
    const fileProgressBar = fileProgress.querySelector('.progress-bar');
    const fileProgressText = fileProgress.querySelectorAll('.progress-text span');
    const sourceSlot = dialog.querySelector('#video-source-slot');
    const durationInput = dialog.querySelector('#video-duration');
    const durationHint = dialog.querySelector('#video-duration-hint');
    const titleInput = dialog.querySelector('#video-title');
    const errorNode = dialog.querySelector('#video-editor-error');
    const saveButton = dialog.querySelector('#save-video');

    function showError(message) {
      errorNode.textContent = message || '';
      errorNode.hidden = !message;
      if (message) errorNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function syncUploadState() {
      saveButton.disabled = uploadingCover || uploadingVideo;
      coverZone.classList.toggle('busy', uploadingCover);
      fileZone.classList.toggle('busy', uploadingVideo);
      coverProgress.classList.toggle('hidden', !uploadingCover);
      fileProgress.classList.toggle('hidden', !uploadingVideo);
    }

    function renderCover() {
      if (!cover) {
        coverGrid.innerHTML = '<p class="field-hint" style="grid-column:1/-1">尚未上传封面图。</p>';
        return;
      }
      coverGrid.innerHTML = `
        <div class="image-tile landscape" style="grid-column:1/-1;max-width:330px">
          <img src="${escapeHtml(cover.url)}" alt="视频封面" />
          <div class="image-tile-controls" style="opacity:1">
            <span class="image-tile-order">封面</span>
            <button type="button" data-cover-remove title="移除封面">${icon('trash')}</button>
          </div>
        </div>`;
    }

    function renderVideoSource() {
      if (!video) {
        sourceSlot.innerHTML = '<p class="field-hint" style="margin-bottom:8px">尚未上传视频文件。</p>';
        return;
      }
      sourceSlot.innerHTML = `
        <div class="video-source-chip" style="margin-bottom:8px">
          <span class="video-glyph">${icon('play')}</span>
          <div class="video-meta">
            <strong>${escapeHtml(video.name || '已上传视频')}</strong>
            <span>${video.size ? formatFileSize(video.size) : '远端文件'} · ${escapeHtml(video.path)}</span>
          </div>
          <button class="button secondary small" type="button" data-preview-uploaded>预览</button>
        </div>`;
    }

    function updateDurationHint() {
      const value = Number(durationInput.value) || 0;
      durationHint.textContent = `${formatClock(value)}，选择视频文件后将自动读取时长。`;
    }

    renderCover();
    renderVideoSource();
    syncUploadState();

    function bindZone(zone, input, handler) {
      zone.addEventListener('click', () => input.click());
      zone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          input.click();
        }
      });
      zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        zone.classList.add('dragging');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
      zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('dragging');
        handler(event.dataTransfer.files[0]);
      });
      input.addEventListener('change', () => {
        handler(input.files[0]);
        input.value = '';
      });
    }

    async function handleCover(file) {
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
        showError('封面仅支持 PNG / JPG / WebP / GIF');
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        showError('封面图片不能超过 20MB');
        return;
      }
      showError('');
      uploadingCover = true;
      syncUploadState();
      coverProgressBar.style.width = '0%';
      coverProgressText[0].textContent = '正在上传封面';
      coverProgressText[1].textContent = '0%';
      try {
        const result = await uploadFile(file, 'image', {
          signal: uploadAbort.signal,
          onProgress(percent) {
            coverProgressBar.style.width = `${percent}%`;
            coverProgressText[1].textContent = `${percent}%`;
          },
        });
        cover = { path: result.storagePath, url: result.url };
        renderCover();
        toast('封面已上传', 'success');
      } catch (error) {
        if (error.code !== 'ABORTED') {
          showError(error.message || '封面上传失败');
          toast(error.message || '封面上传失败', 'error');
        }
      } finally {
        uploadingCover = false;
        syncUploadState();
      }
    }

    async function handleVideo(file) {
      if (!file) return;
      if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) {
        showError('视频仅支持 MP4 / MOV / WebM');
        return;
      }
      if (file.size > 500 * 1024 * 1024) {
        showError('视频文件不能超过 500MB');
        return;
      }
      showError('');
      uploadingVideo = true;
      syncUploadState();
      fileProgressBar.style.width = '0%';
      fileProgressText[0].textContent = `正在上传 · ${file.name}`;
      fileProgressText[1].textContent = '0%';

      const detected = await readVideoDuration(file);
      if (detected > 0) {
        durationInput.value = String(detected);
        updateDurationHint();
      }

      try {
        const result = await uploadFile(file, 'video', {
          signal: uploadAbort.signal,
          onProgress(percent) {
            fileProgressBar.style.width = `${percent}%`;
            fileProgressText[1].textContent = `${percent}%`;
          },
        });
        video = {
          path: result.storagePath,
          url: result.url,
          name: file.name,
          size: file.size,
        };
        renderVideoSource();
        toast('视频文件已上传', 'success');
      } catch (error) {
        if (error.code !== 'ABORTED') {
          showError(error.message || '视频上传失败');
          toast(error.message || '视频上传失败', 'error');
        }
      } finally {
        uploadingVideo = false;
        syncUploadState();
      }
    }

    bindZone(coverZone, coverInput, handleCover);
    bindZone(fileZone, fileInput, handleVideo);

    coverGrid.addEventListener('click', (event) => {
      if (event.target.closest('[data-cover-remove]')) {
        cover = null;
        renderCover();
      }
    });

    sourceSlot.addEventListener('click', (event) => {
      if (!event.target.closest('[data-preview-uploaded]') || !video) return;
      const existing = sourceSlot.querySelector('.video-inline-preview');
      if (existing) {
        existing.remove();
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'video-inline-preview';
      const player = document.createElement('video');
      player.src = video.url;
      player.controls = true;
      player.playsInline = true;
      player.preload = 'metadata';
      wrap.appendChild(player);
      sourceSlot.appendChild(wrap);
    });

    dialog.addEventListener('close', () => {
      if (uploadAbort) uploadAbort.abort();
    }, { once: true });

    durationInput.addEventListener('input', updateDurationHint);

    dialog.querySelector('#video-status-control').addEventListener('click', (event) => {
      const button = event.target.closest('[data-status-value]');
      if (!button) return;
      editorStatus = button.dataset.statusValue;
      dialog.querySelectorAll('[data-status-value]').forEach((node) => {
        node.classList.toggle('active', node === button);
      });
    });

    saveButton.addEventListener('click', async () => {
      if (uploadingCover || uploadingVideo) {
        showError('请等待文件上传完成');
        return;
      }
      const title = titleInput.value.trim();
      const category = dialog.querySelector('#video-category').value.trim();
      const duration = Number(durationInput.value || 0);
      if (!title) {
        showError('请填写视频标题');
        titleInput.focus();
        return;
      }
      if (!Number.isInteger(duration) || duration < 0 || duration > 604800) {
        showError('时长需为 0 到 604800 秒之间的整数');
        return;
      }
      if (editorStatus === 'published' && (!cover || !video)) {
        showError('上架前必须上传封面和视频文件');
        return;
      }
      showError('');
      setButtonLoading(saveButton, true);
      try {
        const payload = {
          title,
          category,
          duration,
          coverUrl: cover?.path || '',
          videoUrl: video?.path || '',
          status: editorStatus,
        };
        await (editing
          ? api(`/admin/videos/${item.id}`, { method: 'PUT', body: payload, signal })
          : api('/admin/videos', { method: 'POST', body: payload, signal }));
        closeDialog();
        toast(editing ? '视频回放已更新' : '视频回放已创建', 'success');
        if (!editing) page = 1;
        await loadVideos({ silent: editing });
      } catch (error) {
        if (error.name !== 'AbortError') {
          showError(error.message || '保存失败');
          toast(error.message || '保存失败', 'error');
        }
      } finally {
        setButtonLoading(saveButton, false);
      }
    });

    window.setTimeout(() => titleInput.focus(), 60);
  }

  async function toggleStatus(item) {
    const nextStatus = item.status === 'published' ? 'draft' : 'published';
    try {
      await api(`/admin/videos/${item.id}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
        signal,
      });
      toast(nextStatus === 'published' ? '视频已上架' : '视频已下架', 'success');
      await loadVideos({ silent: true });
    } catch (error) {
      if (error.name !== 'AbortError') toast(error.message || '状态更新失败', 'error');
    }
  }

  async function deleteVideo(item) {
    const confirmed = await confirmAction({
      title: '删除这个视频回放？',
      message: `「${item.title}」将从内容库永久移除，C 端将无法访问。此操作不可撤销。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(`/admin/videos/${item.id}`, { method: 'DELETE', signal });
      toast('视频回放已删除', 'success');
      if (items.length === 1 && page > 1) page -= 1;
      await loadVideos();
    } catch (error) {
      if (error.name !== 'AbortError') toast(error.message || '删除失败', 'error');
    }
  }

  container.addEventListener('click', (event) => {
    if (event.target.closest('#new-video, [data-empty-action="new"]')) {
      openEditor(null);
      return;
    }
    if (event.target.closest('#videos-refresh')) {
      loadVideos();
      return;
    }
    const pageButton = event.target.closest('[data-page]');
    if (pageButton && !pageButton.disabled) {
      const target = Number(pageButton.dataset.page);
      if (Number.isInteger(target) && target > 0) {
        page = target;
        loadVideos();
      }
      return;
    }
    const actionButton = event.target.closest('[data-action][data-id]');
    if (!actionButton) return;
    const item = items.find((entry) => entry.id === Number(actionButton.dataset.id));
    if (!item) return;
    if (actionButton.dataset.action === 'preview') openPreview(item);
    if (actionButton.dataset.action === 'edit') openEditor(item);
    if (actionButton.dataset.action === 'toggle') toggleStatus(item);
    if (actionButton.dataset.action === 'delete') deleteVideo(item);
  });

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    keyword = searchInput.value.trim();
    page = 1;
    loadVideos();
  });

  statusFilter.addEventListener('change', () => {
    status = statusFilter.value;
    page = 1;
    loadVideos();
  });

  loadVideos();

  return function cleanup() {
    if (uploadAbort) uploadAbort.abort();
  };
}
