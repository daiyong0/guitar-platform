import { api, uploadFile } from '../api.js';
import {
  closeDialog,
  confirmAction,
  emptyState,
  errorPanel,
  escapeHtml,
  formatDateTime,
  formatNumber,
  icon,
  openDialog,
  setButtonLoading,
  statusBadge,
  toast,
} from '../ui.js';

const DEFAULT_TAGS = ['弹唱', '指弹', '入门', '进阶', '流行', '基础'];
const FALLBACK_IMAGE = '/admin/favicon.svg';
const PAGE_SIZE = 20;

function optionButtons(tags, selected) {
  return tags.map((tag) => `
    <button type="button" class="tag-option${selected.includes(tag) ? ' selected' : ''}" data-tag="${escapeHtml(tag)}" aria-pressed="${selected.includes(tag)}">${escapeHtml(tag)}</button>`).join('');
}

function uploadZoneHTML(id, { hint = '支持 PNG / JPG / WebP / GIF，单张不超过 20MB', text = '选择或拖拽图片到这里' } = {}) {
  return `
    <div class="upload-dropzone" id="${id}" tabindex="0" role="button" aria-label="上传图片">
      <input type="file" id="${id}-input" accept="image/png,image/jpeg,image/webp,image/gif" multiple />
      <span class="upload-icon">${icon('upload')}</span>
      <strong>${escapeHtml(text)}</strong>
      <span>${escapeHtml(hint)}</span>
      <div class="upload-progress hidden" id="${id}-progress">
        <div class="progress-track"><div class="progress-bar" style="width:0%"></div></div>
        <div class="progress-text"><span>正在上传</span><span>0%</span></div>
      </div>
    </div>`;
}

function renderScoreTable(items) {
  return `
    <div class="table-scroll">
      <table class="data-table" style="min-width:980px">
        <thead>
          <tr>
            <th>内容</th>
            <th>标签</th>
            <th>状态</th>
            <th>浏览量</th>
            <th>权重</th>
            <th>初始 BPM</th>
            <th>更新时间</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => {
            const cover = item.imageUrls[0] || FALLBACK_IMAGE;
            const tags = item.tags || [];
            return `
              <tr>
                <td>
                  <div class="content-cell">
                    <div class="content-thumb">
                      <img src="${escapeHtml(cover)}" alt="" loading="lazy" />
                      <span class="thumb-count">${item.images?.length || 0}</span>
                    </div>
                    <div>
                      <p class="content-title">${escapeHtml(item.title)}</p>
                      <p class="cell-sub">ID ${item.id} · 创建于 ${formatDateTime(item.createdAt).slice(0, 10)}</p>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="tag-row">
                    ${tags.slice(0, 3).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                    ${tags.length > 3 ? `<span class="tag">+${tags.length - 3}</span>` : ''}
                    ${!tags.length ? '<span class="cell-muted">未设置</span>' : ''}
                  </div>
                </td>
                <td>${statusBadge(item.status)}</td>
                <td class="numeric">${formatNumber(item.viewCount)}</td>
                <td class="numeric">${item.sortWeight}</td>
                <td class="numeric">${item.initialBpm ?? 80}</td>
                <td class="cell-muted">${formatDateTime(item.updatedAt)}</td>
                <td class="actions">
                  <button type="button" class="text-button" data-action="edit" data-id="${item.id}">编辑</button>
                  <button type="button" class="text-button ${item.status === 'published' ? 'danger' : 'success'}" data-action="toggle" data-id="${item.id}">${item.status === 'published' ? '下架' : '上架'}</button>
                  <button type="button" class="text-button danger" data-action="delete" data-id="${item.id}">删除</button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

export function render(container, context) {
  const { signal } = context;
  let page = 1;
  let keyword = '';
  let status = '';
  let items = [];
  let pagination = { page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false };
  let requestVersion = 0;
  let knownTags = new Set(DEFAULT_TAGS);
  let uploadAbort = null;

  container.innerHTML = `
    <div class="page-head-row">
      <div class="section-heading">
        <h2>谱库内容</h2>
        <p id="scores-caption">正在读取吉他谱内容…</p>
      </div>
      <div class="head-actions">
        <button class="button secondary" type="button" id="scores-refresh">${icon('refresh')}<span>刷新</span></button>
        <button class="button primary" type="button" id="new-score">${icon('plus')}<span>新建吉他谱</span></button>
      </div>
    </div>
    <div class="toolbar">
      <div class="toolbar-group">
        <form id="score-search-form" style="display:flex;gap:8px;align-items:center">
          <div class="input-group">
            ${icon('search')}
            <input class="input search-input" id="score-search" type="search" placeholder="搜索标题…" maxlength="60" autocomplete="off" />
          </div>
          <button class="button secondary small" type="submit">搜索</button>
        </form>
        <select class="select filter-select" id="score-status-filter" aria-label="状态筛选">
          <option value="">全部状态</option>
          <option value="published">已上架</option>
          <option value="draft">草稿</option>
        </select>
      </div>
    </div>
    <div class="table-panel" id="scores-table-panel">
      <div class="table-loading">正在读取内容…</div>
    </div>`;

  const tablePanel = document.getElementById('scores-table-panel');
  const caption = document.getElementById('scores-caption');
  const searchInput = document.getElementById('score-search');
  const statusFilter = document.getElementById('score-status-filter');
  const searchForm = document.getElementById('score-search-form');

  function updateCaption() {
    const start = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
    const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
    caption.textContent = keyword || status
      ? `筛选到 ${formatNumber(pagination.total)} 份内容（${start}-${end}）`
      : `共 ${formatNumber(pagination.total)} 份内容，图片按顺序在详情页上下连续阅读。`;
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

  function renderTable() {
    updateCaption();
    if (!items.length) {
      tablePanel.innerHTML = emptyState({
        title: keyword || status ? '没有找到匹配内容' : '谱库还是空的',
        description: keyword || status ? '换一个关键词或清除筛选条件再试试。' : '上传第一份吉他谱，让练习从一张谱开始。',
        action: '<button class="button primary small" type="button" data-empty-action="new">新建吉他谱</button>',
      });
      return;
    }
    tablePanel.innerHTML = `${renderScoreTable(items)}${paginationHTML()}`;
  }

  async function loadScores({ silent = false } = {}) {
    requestVersion += 1;
    const version = requestVersion;
    if (!silent) {
      tablePanel.innerHTML = '<div class="table-loading">正在读取内容…</div>';
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (keyword) params.set('keyword', keyword);
      if (status) params.set('status', status);
      const data = await api(`/admin/scores?${params.toString()}`, { signal });
      if (signal.aborted || version !== requestVersion) return;
      items = data.items;
      pagination = data.pagination;
      items.forEach((item) => {
        (item.tags || []).forEach((tag) => knownTags.add(tag));
      });
      renderTable();    } catch (error) {
      if (error.name === 'AbortError') return;
      if (version !== requestVersion) return;
      tablePanel.innerHTML = errorPanel(error.message || '读取吉他谱失败');
      tablePanel.querySelector('[data-retry]')?.addEventListener('click', () => loadScores());
      toast(error.message || '读取吉他谱失败', 'error');
    }
  }

  function collectTagOptions(extraTags = []) {
    return [...new Set([...knownTags, ...extraTags])];
  }

  function openScoreEditor(item = null) {
    if (uploadAbort) uploadAbort.abort();
    uploadAbort = new AbortController();
    const editing = Boolean(item);
    const selectedTags = [...(item?.tags || [])];
    const initialStatus = item?.status || 'draft';
    const images = (item?.images || []).map((path, index) => ({
      path,
      url: item.imageUrls?.[index] || FALLBACK_IMAGE,
    }));
    let editorStatus = initialStatus;
    let uploading = false;

    const tagList = collectTagOptions(selectedTags);
    const dialog = openDialog({
      title: editing ? '编辑吉他谱' : '新建吉他谱',
      eyebrow: editing ? `EDIT SCORE · #${item.id}` : 'NEW GUITAR SCORE',
      description: '图片顺序即小程序详情页的上下阅读顺序，第一张同时作为封面与分享图。',
      size: 'wide',
      body: `
        <div class="form-stack" id="score-editor">
          <div class="form-grid">
            <div class="field span-2">
              <label class="field-label" for="score-title">标题 <span style="color:var(--accent)">*</span></label>
              <input class="input" id="score-title" maxlength="80" placeholder="例如：夏夜微风 · 弹唱六线谱" value="${escapeHtml(item?.title || '')}" />
            </div>
            <div class="field span-2">
              <label class="field-label">标签（可多选）</label>
              <div class="tag-options" id="score-tag-options">${optionButtons(tagList, selectedTags)}</div>
              <div class="tag-picker-custom">
                <input class="input" id="custom-tag-input" maxlength="20" placeholder="添加自定义标签" />
                <button class="button secondary small" type="button" id="add-custom-tag">${icon('plus')} 添加</button>
              </div>
            </div>
            <div class="field span-2">
              <label class="field-label" for="score-description">描述</label>
              <textarea class="textarea" id="score-description" maxlength="3000" rows="3" placeholder="介绍曲目、难度、调弦或练习建议…">${escapeHtml(item?.description || '')}</textarea>
            </div>
            <div class="field span-2">
              <div class="form-section-title">谱面图片</div>
              ${uploadZoneHTML('score-upload-zone')}
              <div class="image-grid" id="score-image-grid"></div>
              <p class="field-hint">最多 20 张。可上下调整顺序，第一张作为封面。上传至 TOS 完成后再保存内容。</p>
            </div>
            <div class="field">
              <label class="field-label" for="score-initial-bpm">节拍速度初始值 (BPM) <span style="color:var(--accent)">*</span></label>
              <input
                class="input"
                id="score-initial-bpm"
                type="number"
                min="40"
                max="200"
                step="1"
                inputmode="numeric"
                value="${item?.initialBpm ?? 80}"
              />
              <p class="field-hint">详情页节拍器打开时的默认速度，40–200 BPM，新建默认 80。</p>
            </div>
            <div class="field">
              <label class="field-label" for="score-sort-weight">排序权重</label>
              <input class="input" id="score-sort-weight" type="number" min="-9999" max="9999" step="1" value="${item?.sortWeight ?? 0}" />
              <p class="field-hint">数值越大越靠前。</p>
            </div>
            <div class="field span-2">
              <label class="field-label">上架状态</label>
              <div class="segmented-status" id="score-status-control">
                <button type="button" data-status-value="draft" class="${editorStatus === 'draft' ? 'active' : ''}">保存草稿</button>
                <button type="button" data-status-value="published" class="${editorStatus === 'published' ? 'active' : ''}">立即上架</button>
              </div>
              <p class="field-inline" style="margin-top:8px"><span>上架后 C 端可见</span><input class="checkbox" type="checkbox" ${editorStatus === 'published' ? 'checked' : ''} data-role="publish-check" disabled /></p>
            </div>
          </div>
          <p class="field-error" id="score-editor-error" hidden></p>
        </div>`,
      footer: `
        <span class="foot-left" id="score-editor-hint">${editing ? `编辑 ID ${item.id}` : '保存后可在列表中继续编辑'}</span>
        <button class="button secondary" type="button" data-dialog-close>取消</button>
        <button class="button primary" type="button" id="save-score">${editing ? '保存修改' : '创建吉他谱'}</button>`,
    });

    const imageGrid = dialog.querySelector('#score-image-grid');
    const uploadZone = dialog.querySelector('#score-upload-zone');
    const uploadInput = dialog.querySelector('#score-upload-zone-input');
    const progressBox = dialog.querySelector('#score-upload-zone-progress');
    const progressBar = progressBox.querySelector('.progress-bar');
    const progressText = progressBox.querySelectorAll('.progress-text span');
    const titleInput = dialog.querySelector('#score-title');
    const customTagInput = dialog.querySelector('#custom-tag-input');
    const errorNode = dialog.querySelector('#score-editor-error');
    const saveButton = dialog.querySelector('#save-score');

    const moveIcon = (direction) => direction === 'up'
      ? '<svg viewBox="0 0 24 24" fill="none"><path d="m6 14 6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none"><path d="m6 10 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function renderImages() {
      if (!images.length) {
        imageGrid.innerHTML = '<p class="field-hint" style="grid-column:1/-1">尚未添加谱面，发布前至少需要一张图片。</p>';
        return;
      }
      imageGrid.innerHTML = images.map((image, index) => `
        <div class="image-tile${index === 0 ? ' is-cover' : ''}">
          <img src="${escapeHtml(image.url)}" alt="谱面 ${index + 1}" loading="lazy" />
          <div class="image-tile-controls">
            <button type="button" data-image-action="up" data-index="${index}" title="前移" ${index === 0 ? 'disabled' : ''}>${moveIcon('up')}</button>
            <span class="image-tile-order">${index + 1}</span>
            <button type="button" data-image-action="down" data-index="${index}" title="后移" ${index === images.length - 1 ? 'disabled' : ''}>${moveIcon('down')}</button>
            <button type="button" class="delete" data-image-action="remove" data-index="${index}" title="移除">${icon('trash')}</button>
          </div>
        </div>`).join('');
    }

    renderImages();

    function showEditorError(message) {
      errorNode.textContent = message || '';
      errorNode.hidden = !message;
      if (message) errorNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function setUploadBusy(busy) {
      uploading = busy;
      uploadZone.classList.toggle('busy', busy);
      progressBox.classList.toggle('hidden', !busy);
      saveButton.disabled = busy;
    }

    async function handleFiles(fileList) {
      const files = [...fileList].filter(Boolean);
      if (!files.length) return;
      const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
      const remaining = 20 - images.length;
      if (remaining <= 0) {
        showEditorError('最多上传 20 张谱面图片');
        return;
      }
      const selected = files.slice(0, remaining);
      const tooLarge = selected.find((file) => file.size > 20 * 1024 * 1024);
      if (tooLarge) {
        showEditorError(`「${tooLarge.name}」超过 20MB 限制`);
        return;
      }
      const badType = selected.find((file) => !allowed.has(file.type));
      if (badType) {
        showEditorError(`不支持的文件类型：${badType.type || badType.name}`);
        return;
      }
      showEditorError('');
      setUploadBusy(true);
      const abort = uploadAbort;
      try {
        for (let index = 0; index < selected.length; index += 1) {
          const file = selected[index];
          progressText[0].textContent = `正在上传 ${index + 1}/${selected.length} · ${file.name}`;
          progressBar.style.width = '0%';
          progressText[1].textContent = '0%';
          const result = await uploadFile(file, 'image', {
            signal: abort.signal,
            onProgress(percent) {
              progressBar.style.width = `${percent}%`;
              progressText[1].textContent = `${percent}%`;
            },
          });
          images.push({ path: result.storagePath, url: result.url });
          renderImages();
        }
        toast(`已上传 ${selected.length} 张图片`, 'success');
      } catch (error) {
        if (error.name !== 'AbortError' && error.code !== 'ABORTED') {
          showEditorError(error.message || '图片上传失败');
          toast(error.message || '图片上传失败', 'error');
        }
      } finally {
        setUploadBusy(false);
        uploadInput.value = '';
        progressBar.style.width = '0%';
        progressBox.classList.add('hidden');
      }
    }

    uploadZone.addEventListener('click', () => uploadInput.click());
    uploadZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        uploadInput.click();
      }
    });
    uploadZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      uploadZone.classList.add('dragging');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragging'));
    uploadZone.addEventListener('drop', (event) => {
      event.preventDefault();
      uploadZone.classList.remove('dragging');
      handleFiles(event.dataTransfer.files);
    });
    uploadInput.addEventListener('change', () => handleFiles(uploadInput.files));

    dialog.addEventListener('close', () => {
      if (uploadAbort) uploadAbort.abort();
    }, { once: true });

    imageGrid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-image-action]');
      if (!button) return;
      const index = Number(button.dataset.index);
      const action = button.dataset.imageAction;
      if (!Number.isInteger(index) || !images[index]) return;
      if (action === 'remove') {
        images.splice(index, 1);
      } else if (action === 'up' && index > 0) {
        [images[index - 1], images[index]] = [images[index], images[index - 1]];
      } else if (action === 'down' && index < images.length - 1) {
        [images[index + 1], images[index]] = [images[index], images[index + 1]];
      }
      renderImages();
    });

    function appendTag(tag) {
      if ([...dialog.querySelectorAll('[data-tag]')].some((button) => button.dataset.tag === tag)) {
        const existing = [...dialog.querySelectorAll('[data-tag]')].find((button) => button.dataset.tag === tag);
        existing.classList.add('selected');
        existing.setAttribute('aria-pressed', 'true');
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tag-option selected';
      button.dataset.tag = tag;
      button.setAttribute('aria-pressed', 'true');
      button.textContent = tag;
      dialog.querySelector('#score-tag-options').appendChild(button);
    }

    dialog.querySelector('#score-tag-options').addEventListener('click', (event) => {
      const button = event.target.closest('[data-tag]');
      if (!button) return;
      button.classList.toggle('selected');
      button.setAttribute('aria-pressed', String(button.classList.contains('selected')));
    });

    dialog.querySelector('#add-custom-tag').addEventListener('click', () => {
      const value = customTagInput.value.trim();
      if (!value) return;
      if (value.length > 20) {
        showEditorError('标签不能超过 20 个字符');
        return;
      }
      appendTag(value);
      customTagInput.value = '';
      customTagInput.focus();
    });
    customTagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        dialog.querySelector('#add-custom-tag').click();
      }
    });

    dialog.querySelector('#score-status-control').addEventListener('click', (event) => {
      const button = event.target.closest('[data-status-value]');
      if (!button) return;
      editorStatus = button.dataset.statusValue;
      dialog.querySelectorAll('[data-status-value]').forEach((node) => {
        node.classList.toggle('active', node === button);
      });
      dialog.querySelector('[data-role="publish-check"]').checked = editorStatus === 'published';
    });

    saveButton.addEventListener('click', async () => {
      if (uploading) {
        showEditorError('请等待图片上传完成');
        return;
      }
      const title = titleInput.value.trim();
      const tags = [...dialog.querySelectorAll('.tag-option.selected')].map((button) => button.dataset.tag);
      const description = dialog.querySelector('#score-description').value.trim();
      const sortWeight = Number(dialog.querySelector('#score-sort-weight').value || 0);
      const initialBpmInput = dialog.querySelector('#score-initial-bpm');
      const initialBpm = Number(initialBpmInput.value);
      if (!title) {
        showEditorError('请填写吉他谱标题');
        titleInput.focus();
        return;
      }
      if (!tags.length) {
        showEditorError('请至少选择一个标签');
        return;
      }
      if (!Number.isInteger(sortWeight) || sortWeight < -9999 || sortWeight > 9999) {
        showEditorError('排序权重需为 -9999 到 9999 之间的整数');
        return;
      }
      if (!Number.isInteger(initialBpm) || initialBpm < 40 || initialBpm > 200) {
        showEditorError('节拍速度初始值必须是 40–200 之间的整数');
        initialBpmInput.focus();
        return;
      }
      if (editorStatus === 'published' && !images.length) {
        showEditorError('上架前至少需要一张谱面图片');
        return;
      }
      showEditorError('');
      setButtonLoading(saveButton, true);
      try {
        const payload = {
          title,
          tags,
          description,
          images: images.map((image) => image.path),
          initialBpm,
          sortWeight,
          status: editorStatus,
        };
        const result = editing
          ? await api(`/admin/scores/${item.id}`, { method: 'PUT', body: payload, signal })
          : await api('/admin/scores', { method: 'POST', body: payload, signal });
        closeDialog();
        toast(editing ? '吉他谱已更新' : '吉他谱已创建', 'success');
        if (!editing) page = 1;
        await loadScores({ silent: Boolean(editing) });
        void result;
      } catch (error) {
        if (error.name !== 'AbortError') {
          showEditorError(error.message || '保存失败');
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
      await api(`/admin/scores/${item.id}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
        signal,
      });
      toast(nextStatus === 'published' ? '已上架' : '已下架', 'success');
      await loadScores({ silent: true });
    } catch (error) {
      if (error.name !== 'AbortError') toast(error.message || '状态更新失败', 'error');
    }
  }

  async function deleteScore(item) {
    const confirmed = await confirmAction({
      title: '删除这份吉他谱？',
      message: `「${item.title}」将从内容库永久移除，C 端将无法访问。此操作不可撤销。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(`/admin/scores/${item.id}`, { method: 'DELETE', signal });
      toast('吉他谱已删除', 'success');
      if (items.length === 1 && page > 1) page -= 1;
      await loadScores();
    } catch (error) {
      if (error.name !== 'AbortError') toast(error.message || '删除失败', 'error');
    }
  }

  container.addEventListener('click', (event) => {
    const newButton = event.target.closest('#new-score, [data-empty-action="new"]');
    if (newButton) {
      openScoreEditor(null);
      return;
    }
    if (event.target.closest('#scores-refresh')) {
      loadScores();
      return;
    }
    const pageButton = event.target.closest('[data-page]');
    if (pageButton && !pageButton.disabled) {
      const target = Number(pageButton.dataset.page);
      if (Number.isInteger(target) && target > 0) {
        page = target;
        loadScores();
      }
      return;
    }
    const actionButton = event.target.closest('[data-action][data-id]');
    if (actionButton) {
      const item = items.find((entry) => entry.id === Number(actionButton.dataset.id));
      if (!item) return;
      if (actionButton.dataset.action === 'edit') openScoreEditor(item);
      if (actionButton.dataset.action === 'toggle') toggleStatus(item);
      if (actionButton.dataset.action === 'delete') deleteScore(item);
    }
  });

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    keyword = searchInput.value.trim();
    page = 1;
    loadScores();
  });

  statusFilter.addEventListener('change', () => {
    status = statusFilter.value;
    page = 1;
    loadScores();
  });

  loadScores();

  return function cleanup() {
    if (uploadAbort) uploadAbort.abort();
  };
}
