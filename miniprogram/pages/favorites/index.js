'use strict';

const request = require('../../utils/request');
const track = require('../../utils/track');
const auth = require('../../utils/auth');
const format = require('../../utils/format');

const FALLBACK_COVER = '/assets/images/cover-fallback.png';

function decorate(item) {
  return {
    ...item,
    cover: item.coverUrl || FALLBACK_COVER,
    typeLabel: item.contentType === 'video' ? '视频回放' : '吉他谱',
    savedText: format.formatDate(item.savedAt),
    metaText: item.contentType === 'video'
      ? `${item.category || '视频回放'} · ${format.formatClock(item.duration)}`
      : (item.tags || []).join(' · ') || '吉他谱',
    route: item.contentType === 'video'
      ? `/pages/videos/detail?id=${item.contentId}`
      : `/pages/scores/detail?id=${item.contentId}`,
  };
}

Page({
  data: {
    loggedIn: false,
    loading: true,
    error: '',
    items: [],
    count: 0,
    removingKey: '',
    isMock: true,
    skeletonItems: [1, 2, 3],
  },

  onLoad() {
    this.setData({
      loggedIn: auth.isLoggedIn(),
      isMock: auth.isMockMode(),
    });
  },

  onShow() {
    track.pageShow(this, { pageType: 'favorites' });
    const loggedIn = auth.isLoggedIn();
    this.setData({ loggedIn, isMock: auth.isMockMode() });
    if (loggedIn) this.loadFavorites();
    else this.setData({ loading: false, items: [], count: 0 });
  },

  onHide() {
    track.pageHide(this);
  },

  onUnload() {
    track.pageHide(this);
  },

  onPullDownRefresh() {
    if (!auth.isLoggedIn()) {
      tt.stopPullDownRefresh();
      return;
    }
    this.loadFavorites(true);
  },

  loadFavorites(fromPullDown) {
    this.setData({ loading: true, error: '' });
    request.get('/api/user/favorites', { silent: true })
      .then((data) => {
        const items = ((data && data.items) || []).map(decorate);
        this.setData({
          items,
          count: items.length,
          loading: false,
          error: '',
        });
        if (fromPullDown) tt.stopPullDownRefresh();
      })
      .catch((error) => {
        if (error.statusCode === 401) {
          auth.logout();
          this.setData({
            loggedIn: false,
            loading: false,
            items: [],
            count: 0,
            error: '',
          });
        } else {
          this.setData({
            loading: false,
            error: error.message || '收藏加载失败',
          });
        }
        if (fromPullDown) tt.stopPullDownRefresh();
      });
  },

  openLoginSheet() {
    const sheet = this.selectComponent('#loginSheet');
    if (sheet) sheet.open();
  },

  onLoginSuccess(event) {
    const detail = (event && event.detail) || {};
    this.setData({
      loggedIn: true,
      isMock: Boolean(detail.mock),
    });
    this.loadFavorites();
  },

  onLoginTap() {
    this.openLoginSheet();
  },

  onItemTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.items[index];
    if (!item) return;
    track.trackContentClick({ contentId: item.contentId, contentType: item.contentType });
    tt.navigateTo({ url: item.route });
  },

  onRemoveTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.items[index];
    if (!item || this.data.removingKey) return;
    const key = `${item.contentType}:${item.contentId}`;
    const itemsWithBusy = this.data.items.map((entry) => ({
      ...entry,
      removing: `${entry.contentType}:${entry.contentId}` === key,
    }));
    this.setData({ removingKey: key, items: itemsWithBusy });
    request.del(`/api/user/favorites/${item.contentType}/${item.contentId}`)
      .then(() => {
        const items = this.data.items.filter((entry) => (
          !(entry.contentType === item.contentType && String(entry.contentId) === String(item.contentId))
        ));
        this.setData({
          items,
          count: items.length,
          removingKey: '',
        });
        track.trackFavorite({
          contentId: item.contentId,
          contentType: item.contentType,
          action: 'remove',
        });
        tt.showToast({ title: '已取消收藏', icon: 'none' });
      })
      .catch((error) => {
        this.setData({
          removingKey: '',
          items: this.data.items.map((entry) => ({ ...entry, removing: false })),
        });
        if (error.statusCode === 401) {
          auth.logout();
          this.setData({ loggedIn: false, items: [], count: 0 });
          this.openLoginSheet();
          return;
        }
        tt.showToast({ title: error.message || '操作失败', icon: 'none' });
      });
  },

  onCoverError(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    this.setData({ [`items[${index}].cover`]: FALLBACK_COVER });
  },

  onRetry() {
    this.loadFavorites();
  },

  onGoScores() {
    tt.switchTab({ url: '/pages/scores/index' });
  },
});
