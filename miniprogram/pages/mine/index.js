'use strict';

const auth = require('../../utils/auth');
const request = require('../../utils/request');
const track = require('../../utils/track');
const history = require('../../utils/history');
const config = require('../../utils/config');

Page({
  data: {
    loggedIn: false,
    user: null,
    avatarText: '弦',
    isMock: true,
    historyCount: 0,
    favoriteCount: 0,
    favoriteCountText: '—',
    lastHistoryTitle: '',
    loginLoading: false,
    loginError: '',
    preparing: false,
  },

  onLoad() {
    this._pendingAction = '';
    this.setData({ isMock: auth.isMockMode() });
  },

  onShow() {
    track.pageShow(this, { pageType: 'mine' });
    const historyList = history.list();
    const last = historyList[0];
    const user = auth.getUser();
    this.setData({
      loggedIn: auth.isLoggedIn() && Boolean(user),
      user,
      avatarText: user && user.nickname ? user.nickname.slice(0, 1) : '弦',
      historyCount: historyList.length,
      lastHistoryTitle: last ? last.title : '',
      isMock: auth.isMockMode(),
    });
    this.prepareLoginCode();
    if (auth.isLoggedIn()) {
      this.refreshUser();
      this.loadFavoriteCount();
    }
  },

  onHide() {
    track.pageHide(this);
  },

  onUnload() {
    track.pageHide(this);
  },

  prepareLoginCode() {
    if (auth.isLoggedIn()) return;
    // 静默获取登录态 code，让后续 getPhoneNumber 回调可以直接消费。
    auth.prepareTtLogin().catch(() => {});
  },

  refreshUser() {
    auth.refreshMe()
      .then((user) => {
        if (!user) {
          this.setData({
            loggedIn: false,
            user: null,
            favoriteCountText: '—',
          });
          return;
        }
        this.setData({
          loggedIn: true,
          user,
          avatarText: user.nickname ? user.nickname.slice(0, 1) : '弦',
          isMock: auth.isMockMode(),
        });
      })
      .catch(() => {
        // 弱网下继续使用本地登录态，不阻断浏览。
      });
  },

  loadFavoriteCount() {
    request.get('/api/user/favorites', { silent: true })
      .then((data) => {
        const count = (data && data.items && data.items.length) || 0;
        this.setData({
          favoriteCount: count,
          favoriteCountText: String(count),
        });
      })
      .catch((error) => {
        if (error.statusCode === 401) {
          auth.logout();
          this.setData({
            loggedIn: false,
            user: null,
            favoriteCount: 0,
            favoriteCountText: '—',
          });
        } else {
          this.setData({ favoriteCountText: '—' });
        }
      });
  },

  async onGetPhone(event) {
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true, loginError: '', isMock: auth.isMockMode() });
    try {
      const data = await auth.loginWithPhone((event && event.detail) || {});
      this.setData({
        loginLoading: false,
        loggedIn: true,
        user: data.user,
        avatarText: data.user && data.user.nickname ? data.user.nickname.slice(0, 1) : '弦',
        isMock: Boolean(data.mock),
        loginError: '',
      });
      this.loadFavoriteCount();
      tt.showToast({ title: '登录成功', icon: 'success' });
    } catch (error) {
      this.setData({
        loginLoading: false,
        loginError: error.message || '登录失败，请稍后重试',
      });
    }
  },

  onOpenLoginForFavorites() {
    this._pendingAction = 'favorites';
    const sheet = this.selectComponent('#loginSheet');
    if (sheet) sheet.open();
  },

  onLoginSuccess(event) {
    const detail = (event && event.detail) || {};
    this.setData({
      loggedIn: true,
      user: detail.user || auth.getUser(),
      avatarText: detail.user && detail.user.nickname ? detail.user.nickname.slice(0, 1) : '弦',
      isMock: Boolean(detail.mock),
    });
    this.loadFavoriteCount();
    if (this._pendingAction === 'favorites') {
      this._pendingAction = '';
      tt.navigateTo({ url: '/pages/favorites/index' });
    }
  },

  onHistoryTap() {
    tt.navigateTo({ url: '/pages/history/index' });
  },

  onFavoritesTap() {
    if (!auth.isLoggedIn()) {
      this.onOpenLoginForFavorites();
      return;
    }
    tt.navigateTo({ url: '/pages/favorites/index' });
  },

  onLogoutTap() {
    const self = this;
    tt.showModal({
      title: '退出登录',
      content: '退出后将无法同步收藏，本机浏览历史仍会保留。',
      confirmText: '退出',
      confirmColor: '#C55530',
      success(res) {
        if (!res.confirm) return;
        auth.logout();
        self.setData({
          loggedIn: false,
          user: null,
          avatarText: '弦',
          favoriteCount: 0,
          favoriteCountText: '—',
          loginError: '',
          isMock: auth.isMockMode(),
        });
        tt.showToast({ title: '已退出登录', icon: 'none' });
      },
    });
  },

  onRetryLogin() {
    this.setData({ loginError: '' });
    this.prepareLoginCode();
  },
});
