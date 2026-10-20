import { api } from '../api.js';
import {
  ensureECharts,
  escapeHtml,
  formatDateTime,
  formatDurationMs,
  formatNumber,
  formatPercent,
  formatTime,
  icon,
  toast,
} from '../ui.js';

const RANGE_OPTIONS = [
  { value: '7', label: '近 7 天' },
  { value: '30', label: '近 30 天' },
  { value: '90', label: '近 90 天' },
  { value: 'all', label: '全部' },
];

const CHART_COLORS = {
  accent: '#d95f34',
  accentLight: '#eaa27d',
  green: '#4f7460',
  gold: '#c29a5c',
  blue: '#66879b',
  ink: '#44554b',
  muted: '#9d9385',
  line: '#f0e8dc',
  card: '#fffdf9',
};

function statIcon(name) {
  const paths = {
    activity: '<path d="M3.8 12h4l2.1-5.4 4 10.8 2-5.4h4.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    users: '<circle cx="9.4" cy="8.3" r="3.2" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 19.2c.4-3 2.5-4.7 5.9-4.7s5.5 1.7 5.9 4.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M15.3 5.7a3 3 0 0 1 0 5.7m1.7 3.2c2 .6 3.2 2.1 3.5 4.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    eye: '<path d="M3.5 12S6.7 6.8 12 6.8 20.5 12 20.5 12 17.3 17.2 12 17.2 3.5 12 3.5 12Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.6"/>',
    clock: '<circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.8v4.6l3 1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none">${paths[name] || ''}</svg>`;
}

function statCard({ label, value, unit = '', foot = '', iconName = 'activity', accent = false }) {
  return `
    <article class="stat-card${accent ? ' accent' : ''}">
      <div class="stat-top">
        <span class="stat-label">${escapeHtml(label)}</span>
        <span class="stat-icon">${statIcon(iconName)}</span>
      </div>
      <p class="stat-value">${value}${unit ? `<span class="unit">${escapeHtml(unit)}</span>` : ''}</p>
      <div class="stat-foot">${foot}</div>
    </article>`;
}

function summaryHTML(data) {
  const s = data.summary;
  return [
    statCard({
      label: '总行为事件',
      value: formatNumber(s.totalEvents),
      iconName: 'activity',
      foot: `<span class="stat-trend">自建埋点</span><span>${formatNumber(s.shares)} 分享 · ${formatNumber(s.favorites)} 收藏</span>`,
    }),
    statCard({
      label: '活跃用户数',
      value: formatNumber(s.uniqueUsers),
      unit: 'UV',
      iconName: 'users',
      accent: true,
      foot: `<span>${formatNumber(s.sessions)} 个浏览会话</span>`,
    }),
    statCard({
      label: '页面浏览量',
      value: formatNumber(s.pageViews),
      unit: 'PV',
      iconName: 'eye',
      foot: `<span>${formatNumber(s.videoCompletes)} 次视频完播</span>`,
    }),
    statCard({
      label: '平均页面停留',
      value: formatDurationMs(s.avgDwellMs, { compact: true }).replace(/\s+/g, ''),
      iconName: 'clock',
      foot: '<span>来自 page_leave.durationMs</span>',
    }),
  ].join('');
}

function chartCard({ id, title, subtitle, legend = '', extra = '', wide = false, narrow = false }) {
  return `
    <section class="chart-card${wide ? ' wide' : ''}${narrow ? ' narrow' : ''}">
      <div class="chart-head">
        <div>
          <div class="chart-title"><span></span><strong>${escapeHtml(title)}</strong></div>
          <p class="chart-sub">${escapeHtml(subtitle)}</p>
        </div>
        ${legend}
      </div>
      <div class="chart-body" id="${id}-body">
        <div class="chart-canvas" id="${id}-chart"></div>
        <div class="chart-empty" id="${id}-empty" hidden>
          ${icon('empty')}
          <span>当前范围内暂无数据</span>
        </div>
      </div>
      ${extra}
    </section>`;
}

function insightsHTML(data) {
  const topContents = data.contentHeat.slice(0, 5);
  const topPages = [...data.pageViews].sort((a, b) => b.views - a.views).slice(0, 5);
  return `
    <div class="insight-grid">
      <section class="insight-card">
        <h3>内容热度速览</h3>
        <p>点击与视频播放合并排序，最多展示 5 条。</p>
        <div class="insight-list">
          ${topContents.length ? topContents.map((item, index) => `
            <div class="insight-row">
              <span class="insight-rank">${String(index + 1).padStart(2, '0')}</span>
              <div class="insight-main">
                <strong>${escapeHtml(item.title)}</strong>
                <span>${item.contentType === 'video' ? '视频回放' : '吉他谱'} · ${formatNumber(item.clicks)} 点击 · ${formatNumber(item.plays)} 播放</span>
              </div>
              <span class="insight-number">${formatNumber(item.heat)}<em>热度</em></span>
            </div>`).join('') : '<p class="field-hint">暂无内容互动数据。</p>'}
        </div>
      </section>
      <section class="insight-card">
        <h3>流量入口</h3>
        <p>按 page_view 统计的页面访问量。</p>
        <div class="insight-list">
          ${topPages.length ? topPages.map((page, index) => `
            <div class="insight-row">
              <span class="insight-rank">${String(index + 1).padStart(2, '0')}</span>
              <div class="insight-main">
                <strong>${escapeHtml(page.pageLabel)}</strong>
                <span>${escapeHtml(page.page)}</span>
              </div>
              <span class="insight-number">${formatNumber(page.views)}<em>次</em></span>
            </div>`).join('') : '<p class="field-hint">暂无页面访问数据。</p>'}
        </div>
      </section>
    </div>`;
}

export function render(container, context) {
  const { signal, query } = context;
  const initialDays = RANGE_OPTIONS.some((option) => option.value === query.get('days'))
    ? query.get('days')
    : '30';

  let currentDays = initialDays;
  let requestVersion = 0;
  let echarts = null;
  let charts = {};
  let resizeObserver = null;
  let currentData = null;

  container.innerHTML = `
    <div class="page-toolbar">
      <div class="range-caption" id="range-caption">正在读取分析数据…</div>
      <div class="analytics-meta">
        <div class="segmented" id="range-switcher" role="group" aria-label="数据时间范围">
          ${RANGE_OPTIONS.map((option) => `<button type="button" data-days="${option.value}" class="${option.value === currentDays ? 'active' : ''}">${option.label}</button>`).join('')}
        </div>
        <button class="button secondary small" type="button" id="analytics-refresh">
          <span>刷新</span>
        </button>
      </div>
    </div>
    <div class="summary-grid" id="analytics-summary">
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>
    <div class="chart-grid">
      ${chartCard({
        id: 'chart-pages',
        title: '页面访问排行',
        subtitle: '按 page_view 事件统计 · TOP 12',
        wide: true,
      })}
      ${chartCard({
        id: 'chart-content',
        title: '内容热度排行',
        subtitle: 'content_click + video_play · TOP 12',
        narrow: true,
        legend: '<div class="chart-legend"><span><i></i>点击</span><span><i class="alt"></i>播放</span></div>',
      })}
      ${chartCard({
        id: 'chart-duration',
        title: '平均停留时长',
        subtitle: '按页面聚合 page_leave.durationMs',
      })}
      ${chartCard({
        id: 'chart-funnel',
        title: '内容转化漏斗',
        subtitle: '去重用户 · 首页/列表 → 详情 → 深度行为',
        extra: '<div class="funnel-summary" id="funnel-summary"></div>',
      })}
    </div>
    <div id="analytics-insights"></div>`;

  const summaryNode = document.getElementById('analytics-summary');
  const captionNode = document.getElementById('range-caption');
  const insightsNode = document.getElementById('analytics-insights');
  const rangeSwitcher = document.getElementById('range-switcher');
  const refreshButton = document.getElementById('analytics-refresh');

  function setRangeButtons() {
    rangeSwitcher.querySelectorAll('[data-days]').forEach((button) => {
      button.classList.toggle('active', button.dataset.days === currentDays);
    });
  }

  function chartNode(name) {
    return document.getElementById(`chart-${name}-chart`);
  }

  function setEmpty(name, empty, message = '当前范围内暂无数据') {
    const node = document.getElementById(`chart-${name}-empty`);
    const canvas = chartNode(name);
    if (!node || !canvas) return;
    node.hidden = !empty;
    node.querySelector('span').textContent = message;
    canvas.style.visibility = empty ? 'hidden' : 'visible';
  }

  function makeChart(name) {
    if (!echarts) return null;
    if (charts[name]) return charts[name];
    const node = chartNode(name);
    if (!node) return null;
    const chart = echarts.init(node, null, { renderer: 'canvas' });
    charts[name] = chart;
    if (resizeObserver) resizeObserver.observe(node);
    return chart;
  }

  function baseTooltip() {
    return {
      renderMode: 'richText',
      backgroundColor: 'rgba(30, 44, 38, .96)',
      borderWidth: 0,
      padding: [8, 11],
      textStyle: {
        color: '#fdf8ef',
        fontSize: 11,
        fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif',
      },
      extraCssText: 'border-radius:8px;box-shadow:0 8px 26px rgba(30,38,34,.18)',
    };
  }

  function renderPageChart(data) {
    const items = data.pageViews;
    setEmpty('pages', !items.length);
    if (!items.length) return;
    const chart = makeChart('pages');
    if (!chart) return;
    const maxLabelLength = Math.max(...items.map((item) => item.pageLabel.length));
    chart.setOption({
      animationDuration: 520,
      color: [CHART_COLORS.accent],
      grid: { left: 8, right: 12, top: 34, bottom: 8, containLabel: true },
      tooltip: {
        ...baseTooltip(),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(221,99,56,.05)' } },
        formatter(params) {
          const item = params[0];
          const source = items[item.dataIndex];
          return `{name|${source.pageLabel}}\n{value|${formatNumber(source.views)} 次浏览}  {muted|/ ${formatNumber(source.users)} 位用户}\n{path|${source.page}}`;
        },
        rich: {
          name: { color: '#fff8ef', fontWeight: 600, lineHeight: 18 },
          value: { color: '#f1b28f', fontSize: 12, fontWeight: 600, lineHeight: 20 },
          muted: { color: 'rgba(255,248,239,.45)', fontSize: 9 },
          path: { color: 'rgba(255,248,239,.38)', fontSize: 9, lineHeight: 16 },
        },
      },
      xAxis: {
        type: 'category',
        data: items.map((item) => item.pageLabel),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#e8dfd2' } },
        axisLabel: {
          color: CHART_COLORS.muted,
          fontSize: 9.5,
          interval: 0,
          rotate: maxLabelLength > 6 ? 22 : 0,
          margin: 11,
        },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: '#b0a696', fontSize: 9, fontFamily: 'Consolas, monospace' },
        splitLine: { lineStyle: { color: CHART_COLORS.line, type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [{
        name: '页面访问',
        type: 'bar',
        data: items.map((item) => item.views),
        barMaxWidth: 29,
        itemStyle: {
          borderRadius: [5, 5, 1, 1],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#e78a5f' },
            { offset: 1, color: '#d45b31' },
          ]),
        },
        emphasis: { itemStyle: { color: '#c94c23' } },
        label: {
          show: true,
          position: 'top',
          distance: 6,
          color: '#8c7f6f',
          fontSize: 9,
          fontFamily: 'Consolas, monospace',
        },
      }],
    }, true);
  }

  function renderContentChart(data) {
    const items = [...data.contentHeat].reverse();
    setEmpty('content', !items.length);
    if (!items.length) return;
    const chart = makeChart('content');
    if (!chart) return;
    const label = (item) => {
      const title = item.title.length > 18 ? `${item.title.slice(0, 18)}…` : item.title;
      return title;
    };
    chart.setOption({
      animationDuration: 520,
      grid: { left: 8, right: 25, top: 18, bottom: 8, containLabel: true },
      tooltip: {
        ...baseTooltip(),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(79,116,96,.05)' } },
        formatter(params) {
          const item = items[params[0].dataIndex];
          return `{name|${item.title}}\n{value|${formatNumber(item.heat)} 热度}  {muted|${item.contentType === 'video' ? '视频回放' : '吉他谱'}}\n{muted|点击 ${formatNumber(item.clicks)} 次}   {muted|播放 ${formatNumber(item.plays)} 次}`;
        },
        rich: {
          name: { color: '#fff8ef', fontWeight: 600, width: 220, overflow: 'break', lineHeight: 18 },
          value: { color: '#f1b28f', fontSize: 12, fontWeight: 600, lineHeight: 20 },
          muted: { color: 'rgba(255,248,239,.48)', fontSize: 9.5 },
        },
      },
      xAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: '#b0a696', fontSize: 9, fontFamily: 'Consolas, monospace' },
        splitLine: { lineStyle: { color: CHART_COLORS.line, type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: items.map(label),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: {
          color: CHART_COLORS.muted,
          fontSize: 9.5,
          width: 150,
          overflow: 'truncate',
          margin: 10,
        },
      },
      series: [
        {
          name: '点击',
          type: 'bar',
          stack: 'heat',
          data: items.map((item) => item.clicks),
          barMaxWidth: 14,
          itemStyle: { color: CHART_COLORS.accent, borderRadius: [3, 0, 0, 3] },
        },
        {
          name: '播放',
          type: 'bar',
          stack: 'heat',
          data: items.map((item) => item.plays),
          barMaxWidth: 14,
          itemStyle: { color: '#9ab09f', borderRadius: [0, 3, 3, 0] },
        },
      ],
    }, true);
  }

  function renderDurationChart(data) {
    const items = [...data.averageDurations].sort((a, b) => b.avgDurationMs - a.avgDurationMs);
    setEmpty('duration', !items.length);
    if (!items.length) return;
    const chart = makeChart('duration');
    if (!chart) return;
    const ordered = [...items].reverse();
    chart.setOption({
      animationDuration: 520,
      grid: { left: 8, right: 35, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        ...baseTooltip(),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(194,154,92,.06)' } },
        formatter(params) {
          const item = ordered[params[0].dataIndex];
          return `{name|${item.pageLabel}}\n{value|${formatDurationMs(item.avgDurationMs)}}\n{muted|${formatNumber(item.samples)} 次页面离开样本}`;
        },
        rich: {
          name: { color: '#fff8ef', fontWeight: 600, lineHeight: 18 },
          value: { color: '#f0c48f', fontSize: 12, fontWeight: 600, lineHeight: 20 },
          muted: { color: 'rgba(255,248,239,.45)', fontSize: 9 },
        },
      },
      xAxis: {
        type: 'value',
        axisLabel: {
          color: '#b0a696',
          fontSize: 9,
          formatter: (value) => `${Math.round(value)}s`,
        },
        splitLine: { lineStyle: { color: CHART_COLORS.line, type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: ordered.map((item) => item.pageLabel),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: CHART_COLORS.muted, fontSize: 10 },
      },
      series: [{
        type: 'bar',
        data: ordered.map((item) => Math.round(item.avgDurationMs / 1000)),
        barMaxWidth: 17,
        showBackground: true,
        backgroundStyle: { color: '#f7f1e7', borderRadius: 4 },
        itemStyle: {
          borderRadius: 4,
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: '#dfc39d' },
            { offset: 1, color: '#bd8d50' },
          ]),
        },
        label: {
          show: true,
          position: 'right',
          distance: 8,
          color: '#8b7a67',
          fontSize: 9,
          fontFamily: 'Consolas, monospace',
          formatter: (params) => formatDurationMs(ordered[params.dataIndex].avgDurationMs, { compact: true }),
        },
      }],
    }, true);
  }

  function renderFunnelChart(data) {
    const steps = data.funnel;
    const total = steps[0]?.users || 0;
    setEmpty('funnel', !total);
    const summary = document.getElementById('funnel-summary');
    if (summary) {
      summary.innerHTML = steps.map((step, index) => `
        <div class="funnel-step">
          <span>${escapeHtml(step.label)}</span>
          <strong>${formatNumber(step.users)}${index > 0 ? `<em>${formatPercent(step.rateFromPrev, 0)}</em>` : ''}</strong>
        </div>`).join('');
    }
    if (!total) return;
    const chart = makeChart('funnel');
    if (!chart) return;
    const colors = ['#2d4539', '#6c806f', '#d37149'];
    chart.setOption({
      animationDuration: 650,
      tooltip: {
        ...baseTooltip(),
        trigger: 'item',
        formatter(params) {
          const step = steps[params.dataIndex];
          return `{name|${step.label}}\n{value|${formatNumber(step.users)} 位用户}\n{muted|较上一步 ${formatPercent(step.rateFromPrev, 1)} · 较首步 ${formatPercent(step.rateFromStart, 1)}}`;
        },
        rich: {
          name: { color: '#fff8ef', fontWeight: 600, lineHeight: 18 },
          value: { color: '#f1b28f', fontSize: 12, fontWeight: 600, lineHeight: 20 },
          muted: { color: 'rgba(255,248,239,.45)', fontSize: 9 },
        },
      },
      series: [{
        name: '转化漏斗',
        type: 'funnel',
        left: '12%',
        right: '12%',
        top: 9,
        bottom: 12,
        minSize: '28%',
        maxSize: '96%',
        sort: 'descending',
        gap: 3,
        label: {
          show: true,
          position: 'inside',
          color: '#fdf8ef',
          fontSize: 9.5,
          lineHeight: 16,
          formatter: (params) => `${params.name}\n${formatNumber(params.value)} 人`,
        },
        labelLine: { show: false },
        itemStyle: { borderColor: '#fffdf9', borderWidth: 2 },
        emphasis: { label: { fontSize: 10.5, fontWeight: 600 } },
        data: steps.map((step, index) => ({
          name: step.label,
          value: step.users,
          itemStyle: { color: colors[index] },
        })),
      }],
    }, true);
  }

  function renderCharts(data) {
    renderPageChart(data);
    renderContentChart(data);
    renderDurationChart(data);
    renderFunnelChart(data);
  }

  async function loadData({ silent = false } = {}) {
    requestVersion += 1;
    const version = requestVersion;
    if (!silent) {
      captionNode.textContent = '正在读取分析数据…';
      refreshButton.classList.add('loading');
      refreshButton.disabled = true;
    }
    try {
      const data = await api(`/admin/analytics/overall?days=${encodeURIComponent(currentDays)}`, { signal });
      if (signal.aborted || version !== requestVersion) return;
      currentData = data;
      summaryNode.innerHTML = summaryHTML(data);
      captionNode.innerHTML = `统计范围：<strong>${escapeHtml(data.range.label)}</strong> · 更新于 ${formatDateTime(data.generatedAt)}`;
      insightsNode.innerHTML = insightsHTML(data);
      try {
        echarts = await ensureECharts();
        if (signal.aborted || version !== requestVersion) return;
        renderCharts(data);
      } catch (chartError) {
        console.error(chartError);
        ['pages', 'content', 'duration', 'funnel'].forEach((name) => {
          setEmpty(name, true, '图表库加载失败，请检查网络或 vendor 文件');
        });
        toast('ECharts 加载失败，请检查网络连接', 'error');
      }
      if (!silent) {
        const url = new URL(window.location.href);
        const prefix = `#${context.parsed.path}`;
        const hash = `${prefix}?days=${currentDays}`;
        history.replaceState(null, '', `${url.pathname}${url.search}${hash}`);
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(error);
      if (version !== requestVersion) return;
      captionNode.textContent = `数据加载失败：${error.message || '请稍后重试'}`;
      if (!silent) toast(error.message || '分析数据加载失败', 'error');
    } finally {
      if (version === requestVersion) {
        refreshButton.classList.remove('loading');
        refreshButton.disabled = false;
      }
    }
  }

  rangeSwitcher.addEventListener('click', (event) => {
    const button = event.target.closest('[data-days]');
    if (!button || button.dataset.days === currentDays) return;
    currentDays = button.dataset.days;
    setRangeButtons();
    loadData();
  });

  refreshButton.addEventListener('click', () => loadData());

  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      Object.values(charts).forEach((chart) => {
        if (chart && !chart.isDisposed()) chart.resize();
      });
    });
  }

  loadData();

  return function cleanup() {
    if (resizeObserver) resizeObserver.disconnect();
    Object.values(charts).forEach((chart) => {
      try { chart.dispose(); } catch (_error) { /* noop */ }
    });
    charts = {};
    currentData = null;
  };
}
