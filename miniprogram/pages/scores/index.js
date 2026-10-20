'use strict';

const request = require('../../utils/request');
const track = require('../../utils/track');
const format = require('../../utils/format');
const { SCORE_TAGS } = require('../../utils/constants');

const PAGE_SIZE = 10;
const FALLBACK_COVER = '/assets/images/cover-fallback.png';

function decorateScore(item) {
  const images = item.imageUrls || [];
  const tags = item.tags || [];
  return {
    ...item,
    cover: images[0] || FALLBACK_COVER,
    pageCount: (item.images || []).length,
    cardTags: tags.slice(0, 2),
    primaryTag: tags[0] || '吉他谱',
    viewText: format.formatViews(item.viewCount),
    coverPagesText: `${(item.images || []).length} 页谱`,
  };
}

Page({
  data: {
    tags: ['全部'].concat(SCORE_TAGS),
    activeTag: '全部',
    keyword: '',
    list: [],
    page: 1,
    total: 0,
    hasMore: true,
    loading: true,
    loadingMore: false,
    error: '',
    skeletons: [1, 2, 3, 4, 5, 6],
    searchFocused: false,
  },

  onLoad() {
    this._seq = 0;
    this._pendingSearch = false;
    this.loadTags();
    this.loadList({ reset: true });
  },

  onShow() {
    track.pageShow(this, { pageType: 'score_list' });
  },

  onHide() {
    track.pageHide(this);
  },

  onUnload() {
    track.pageHide(this);
  },

  onPullDownRefresh() {
    this.loadList({ reset: true, fromPullDown: true });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) {
      this.loadList({ reset: false });
    }
  },

  loadTags() {
    request.get('/api/scores/tags', { auth: false })
      .then((data) => {
        const tags = (data && data.tags) || [];
        const merged = ['全部'];
        tags.forEach((tag) => {
          if (typeof tag === 'string' && tag && merged.indexOf(tag) < 0) merged.push(tag);
        });
        if (merged.length > 1) {
          const activeTag = merged.indexOf(this.data.activeTag) >= 0 ? this.data.activeTag : '全部';
          this.setData({ tags: merged, activeTag });
        }
      })
      .catch(() => {
        // 标签获取失败时继续使用本地默认标签，不阻塞内容浏览。
      });
  },

  loadList(options) {
    const opts = options || {};
    const reset = Boolean(opts.reset);
    if (!reset && (this.data.loading || this.data.loadingMore || !this.data.hasMore)) return;

    const seq = ++this._seq;
    const nextPage = reset ? 1 : this.data.page + 1;
    if (reset) {
      this.setData({ loading: true, error: '', loadingMore: false });
    } else {
      this.setData({ loadingMore: true });
    }

    const data = {
      page: nextPage,
      pageSize: PAGE_SIZE,
    };
    if (this.data.activeTag && this.data.activeTag !== '全部') data.tag = this.data.activeTag;
    if (this.data.keyword.trim()) data.keyword = this.data.keyword.trim();

    request.get('/api/scores', { data, auth: false })
      .then((res) => {
        if (seq !== this._seq) return;
        const pagination = (res && res.pagination) || {};
        const newItems = ((res && res.items) || []).map(decorateScore);
        const list = reset ? newItems : this.data.list.concat(newItems);
        this.setData({
          list,
          page: nextPage,
          total: pagination.total || 0,
          hasMore: Boolean(pagination.hasMore),
          loading: false,
          loadingMore: false,
          error: '',
        });

        if (this._pendingSearch) {
          this._pendingSearch = false;
          track.trackSearch(this.data.keyword.trim(), pagination.total || 0, 'scores');
        }
        if (opts.fromPullDown) tt.stopPullDownRefresh();
      })
      .catch((error) => {
        if (seq !== this._seq) return;
        this._pendingSearch = false;
        this.setData({
          loading: false,
          loadingMore: false,
          error: this.data.list.length ? '' : (error.message || '吉他谱加载失败'),
        });
        if (this.data.list.length) {
          tt.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
        }
        if (opts.fromPullDown) tt.stopPullDownRefresh();
      });
  },

  onSearchInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  onSearchFocus() {
    this.setData({ searchFocused: true });
  },

  onSearchBlur() {
    this.setData({ searchFocused: false });
  },

  onSearchTap() {
    this.submitSearch();
  },

  onSearchConfirm() {
    this.submitSearch();
  },

  onClearKeyword() {
    this.setData({ keyword: '' });
    this._pendingSearch = false;
    this.loadList({ reset: true });
  },

  submitSearch() {
    const keyword = this.data.keyword.trim();
    this.setData({ keyword });
    this._pendingSearch = Boolean(keyword);
    this.loadList({ reset: true });
  },

  onTagTap(event) {
    const tag = event.currentTarget.dataset.tag;
    if (!tag || tag === this.data.activeTag) return;
    this._pendingSearch = false;
    this.setData({ activeTag: tag });
    this.loadList({ reset: true });
  },

  onCardTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.list[index];
    if (!item) return;
    track.trackContentClick({ contentId: item.id, contentType: 'score' });
    tt.navigateTo({ url: `/pages/scores/detail?id=${item.id}` });
  },

  onCoverError(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    this.setData({ [`list[${index}].cover`]: FALLBACK_COVER });
  },

  onRetry() {
    this.loadList({ reset: true });
  },
});
