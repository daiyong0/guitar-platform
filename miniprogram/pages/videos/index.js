'use strict';

const request = require('../../utils/request');
const track = require('../../utils/track');
const format = require('../../utils/format');
const { VIDEO_CATEGORIES } = require('../../utils/constants');

const PAGE_SIZE = 8;
const FALLBACK_COVER = '/assets/images/cover-fallback.png';

function decorateVideo(item) {
  return {
    ...item,
    cover: item.coverPreviewUrl || FALLBACK_COVER,
    durationText: format.formatClock(item.duration),
    viewText: format.formatViews(item.viewCount),
    publishedText: format.formatDate(item.createdAt, { short: true }),
    categoryText: item.category || '回放',
  };
}

Page({
  data: {
    categories: ['全部'].concat(VIDEO_CATEGORIES),
    activeCategory: '全部',
    list: [],
    page: 1,
    total: 0,
    hasMore: true,
    loading: true,
    loadingMore: false,
    error: '',
    skeletons: [1, 2],
  },

  onLoad() {
    this._seq = 0;
    this.loadCategories();
    this.loadVideos({ reset: true });
  },

  onShow() {
    track.pageShow(this, { pageType: 'video_list' });
  },

  onHide() {
    track.pageHide(this);
  },

  onUnload() {
    track.pageHide(this);
  },

  onPullDownRefresh() {
    this.loadVideos({ reset: true, fromPullDown: true });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) {
      this.loadVideos({ reset: false });
    }
  },

  loadCategories() {
    request.get('/api/videos/categories', { auth: false })
      .then((data) => {
        const fromServer = (data && data.categories) || [];
        const merged = ['全部'];
        fromServer.forEach((category) => {
          if (typeof category === 'string' && category && merged.indexOf(category) < 0) merged.push(category);
        });
        if (merged.length > 1) {
          const activeCategory = merged.indexOf(this.data.activeCategory) >= 0
            ? this.data.activeCategory
            : '全部';
          this.setData({ categories: merged, activeCategory });
        }
      })
      .catch(() => {});
  },

  loadVideos(options) {
    const opts = options || {};
    const reset = Boolean(opts.reset);
    if (!reset && (this.data.loading || this.data.loadingMore || !this.data.hasMore)) return;

    const seq = ++this._seq;
    const nextPage = reset ? 1 : this.data.page + 1;
    if (reset) this.setData({ loading: true, error: '', loadingMore: false });
    else this.setData({ loadingMore: true });

    const data = { page: nextPage, pageSize: PAGE_SIZE };
    if (this.data.activeCategory !== '全部') data.category = this.data.activeCategory;

    request.get('/api/videos', { data, auth: false })
      .then((res) => {
        if (seq !== this._seq) return;
        const pagination = (res && res.pagination) || {};
        const newItems = ((res && res.items) || []).map(decorateVideo);
        this.setData({
          list: reset ? newItems : this.data.list.concat(newItems),
          page: nextPage,
          total: pagination.total || 0,
          hasMore: Boolean(pagination.hasMore),
          loading: false,
          loadingMore: false,
          error: '',
        });
        if (opts.fromPullDown) tt.stopPullDownRefresh();
      })
      .catch((error) => {
        if (seq !== this._seq) return;
        this.setData({
          loading: false,
          loadingMore: false,
          error: this.data.list.length ? '' : (error.message || '视频加载失败'),
        });
        if (this.data.list.length) tt.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
        if (opts.fromPullDown) tt.stopPullDownRefresh();
      });
  },

  onCategoryTap(event) {
    const category = event.currentTarget.dataset.category;
    if (!category || category === this.data.activeCategory) return;
    this.setData({ activeCategory: category });
    this.loadVideos({ reset: true });
  },

  onVideoTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.list[index];
    if (!item) return;
    track.trackContentClick({ contentId: item.id, contentType: 'video' });
    tt.navigateTo({ url: `/pages/videos/detail?id=${item.id}` });
  },

  onCoverError(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    this.setData({ [`list[${index}].cover`]: FALLBACK_COVER });
  },

  onRetry() {
    this.loadVideos({ reset: true });
  },
});
