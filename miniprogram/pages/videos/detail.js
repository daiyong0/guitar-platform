'use strict';

const request = require('../../utils/request');
const track = require('../../utils/track');
const auth = require('../../utils/auth');
const history = require('../../utils/history');
const format = require('../../utils/format');
const config = require('../../utils/config');

Page({
  data: {
    id: '',
    item: null,
    loading: true,
    error: '',
    isLoggedIn: false,
    isFavorited: false,
    favoriteLoading: false,
    viewText: '0',
    durationText: '00:00',
    publishedText: '',
    isMock: true,
  },

  onLoad(options) {
    const id = options && options.id ? String(options.id) : '';
    this._afterLoginAction = '';
    this._lastTime = 0;
    this._duration = 0;
    this._playing = false;
    this._completed = false;
    this.setData({
      id,
      isLoggedIn: auth.isLoggedIn(),
      isMock: auth.isMockMode(),
    });
    if (!id) {
      this.setData({ loading: false, error: '视频参数丢失，请返回列表重新打开。' });
      return;
    }
    this.videoContext = tt.createVideoContext ? tt.createVideoContext('replayPlayer', this) : null;
    this.fetchDetail();
    if (typeof tt.showShareMenu === 'function') {
      tt.showShareMenu({ withShareTicket: false });
    }
  },

  onShow() {
    track.pageShow(this, {
      pageType: 'video_detail',
      contentId: this.data.id,
      contentType: 'video',
    });
    const loggedIn = auth.isLoggedIn();
    if (loggedIn !== this.data.isLoggedIn) this.setData({ isLoggedIn: loggedIn });
    if (loggedIn && this.data.item) this.loadFavoriteStatus();
  },

  onHide() {
    if (this.videoContext && this._playing) {
      this.videoContext.pause();
    }
    track.pageHide(this);
  },

  onUnload() {
    track.pageHide(this);
  },

  onPullDownRefresh() {
    this.fetchDetail(true);
  },

  fetchDetail(fromPullDown) {
    const id = this.data.id;
    if (!id) return;
    if (!fromPullDown) this.setData({ loading: true, error: '' });

    request.get(`/api/videos/${encodeURIComponent(id)}`, { auth: false })
      .then((data) => {
        const item = data && data.item;
        if (!item) throw new Error('视频不存在');
        this._duration = Number(item.duration) || 0;
        this.setData({
          item,
          loading: false,
          error: '',
          viewText: format.formatViews(item.viewCount),
          durationText: format.formatClock(item.duration),
          publishedText: format.formatDate(item.createdAt),
        });
        tt.setNavigationBarTitle({ title: format.clipText(item.title, 18) || '视频回放' });
        history.add({
          contentType: 'video',
          contentId: item.id,
          title: item.title,
          coverUrl: item.coverPreviewUrl || '',
          category: item.category,
          duration: item.duration,
          route: `/pages/videos/detail?id=${item.id}`,
        });
        if (auth.isLoggedIn()) this.loadFavoriteStatus();
        if (fromPullDown) tt.stopPullDownRefresh();
      })
      .catch((error) => {
        this.setData({
          loading: false,
          error: error.message || '视频加载失败，请稍后重试',
        });
        if (fromPullDown) tt.stopPullDownRefresh();
      });
  },

  loadFavoriteStatus() {
    if (!this.data.id || !auth.isLoggedIn()) return;
    request.get('/api/user/favorites/status', {
      data: { contentType: 'video', contentId: this.data.id },
      silent: true,
    })
      .then((data) => {
        this.setData({ isFavorited: Boolean(data && data.favorited) });
      })
      .catch((error) => {
        if (error.statusCode === 401) {
          auth.logout();
          this.setData({ isLoggedIn: false, isFavorited: false });
        }
      });
  },

  onVideoPlay(event) {
    this._completed = false;
    this._playing = true;
    const detail = (event && event.detail) || {};
    const progress = Number(detail.currentTime);
    const duration = Number(detail.duration);
    if (Number.isFinite(progress) && progress >= 0) this._lastTime = progress;
    if (Number.isFinite(duration) && duration > 0) this._duration = duration;
    track.trackVideo('video_play', {
      contentId: this.data.id,
      progressSeconds: this._lastTime || 0,
      durationSeconds: this._duration || Number(this.data.item && this.data.item.duration) || 0,
    });
  },

  onVideoPause(event) {
    if (this._completed) return;
    this._playing = false;
    const detail = (event && event.detail) || {};
    const progress = Number(detail.currentTime);
    if (Number.isFinite(progress) && progress >= 0) this._lastTime = progress;
    if (detail.duration) this._duration = Number(detail.duration) || this._duration;
    track.trackVideo('video_pause', {
      contentId: this.data.id,
      progressSeconds: this._lastTime || 0,
      durationSeconds: this._duration || 0,
    });
  },

  onVideoEnded(event) {
    this._completed = true;
    this._playing = false;
    const detail = (event && event.detail) || {};
    const progress = Number(detail.currentTime);
    if (Number.isFinite(progress) && progress >= 0) this._lastTime = progress;
    const duration = Number(detail.duration) || this._duration || (this.data.item && this.data.item.duration) || 0;
    track.trackVideo('video_complete', {
      contentId: this.data.id,
      progressSeconds: duration,
      durationSeconds: duration,
    });
  },

  onTimeUpdate(event) {
    const detail = (event && event.detail) || {};
    const currentTime = Number(detail.currentTime);
    const duration = Number(detail.duration);
    if (Number.isFinite(currentTime) && currentTime >= 0) this._lastTime = currentTime;
    if (Number.isFinite(duration) && duration > 0) this._duration = duration;
  },

  openLoginSheet() {
    const sheet = this.selectComponent('#loginSheet');
    if (sheet) sheet.open();
  },

  onFavoriteTap() {
    if (!auth.isLoggedIn()) {
      this._afterLoginAction = 'favorite';
      this.openLoginSheet();
      return;
    }
    this.toggleFavorite();
  },

  onLoginSuccess(event) {
    const detail = (event && event.detail) || {};
    this.setData({ isLoggedIn: true, isMock: Boolean(detail.mock) });
    if (this._afterLoginAction === 'favorite') {
      this._afterLoginAction = '';
      this.toggleFavorite();
    } else {
      this.loadFavoriteStatus();
    }
  },

  toggleFavorite() {
    if (this.data.favoriteLoading || !this.data.item) return;
    const nextFavorite = !this.data.isFavorited;
    this.setData({ favoriteLoading: true });
    const task = nextFavorite
      ? request.post('/api/user/favorites', {
        contentType: 'video',
        contentId: this.data.item.id,
      })
      : request.del(`/api/user/favorites/video/${this.data.item.id}`);

    task
      .then(() => {
        this.setData({
          isFavorited: nextFavorite,
          favoriteLoading: false,
        });
        track.trackFavorite({
          contentId: this.data.item.id,
          contentType: 'video',
          action: nextFavorite ? 'add' : 'remove',
        });
        tt.showToast({ title: nextFavorite ? '已收藏' : '已取消收藏', icon: 'none' });
      })
      .catch((error) => {
        this.setData({ favoriteLoading: false });
        if (error.statusCode === 401) {
          auth.logout();
          this.setData({ isLoggedIn: false, isFavorited: false });
          this._afterLoginAction = 'favorite';
          this.openLoginSheet();
          return;
        }
        tt.showToast({ title: error.message || '操作失败', icon: 'none' });
      });
  },

  onShareAppMessage() {
    const item = this.data.item;
    const path = `/pages/videos/detail?id=${this.data.id}`;
    if (item) {
      track.trackShare({ contentId: item.id, contentType: 'video', sharePath: path });
    }
    const result = {
      title: item
        ? format.shareTitle(item.title, ' · 视频回放', config.SHARE_TITLE_MAX_LENGTH)
        : '弦间 · 直播回放',
      path,
      desc: '一场值得再听一次的现场，分享给你。',
    };
    // 封面本身是 TOS 公网地址，直接用于分享卡片。
    if (item && item.coverPreviewUrl) result.imageUrl = item.coverPreviewUrl;
    return result;
  },

  onRetry() {
    this.fetchDetail();
  },

  onBackList() {
    const pages = getCurrentPages();
    if (pages.length > 1) tt.navigateBack();
    else tt.switchTab({ url: '/pages/videos/index' });
  },
});
