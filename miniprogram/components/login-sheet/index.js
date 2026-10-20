'use strict';

const auth = require('../../utils/auth');
const config = require('../../utils/config');

Component({
  data: {
    visible: false,
    loading: false,
    error: '',
    isMock: true,
    appName: config.APP_NAME,
  },

  attached() {
    this.setData({ isMock: auth.isMockMode() });
  },

  methods: {
    /**
     * 页面通过 selectComponent('#loginSheet').open() 主动唤起。
     * 打开时先调用 tt.login 获取登录态 code，再等待手机号授权回调。
     */
    open() {
      if (auth.isLoggedIn()) {
        this.triggerEvent('success', { user: auth.getUser(), alreadyLoggedIn: true });
        return;
      }
      this.setData({
        visible: true,
        error: '',
        isMock: auth.isMockMode(),
        loading: false,
      });
      auth.prepareTtLogin().catch((error) => {
        console.warn('[login-sheet] prefetch tt.login failed', error.message);
      });
    },

    close() {
      if (this.data.loading) return;
      this.setData({ visible: false, error: '' });
      this.triggerEvent('close');
    },

    noop() {},

    async onGetPhone(event) {
      if (this.data.loading) return;
      const detail = (event && event.detail) || {};
      this.setData({ loading: true, error: '', isMock: auth.isMockMode() });
      try {
        const data = await auth.loginWithPhone(detail);
        this.setData({ visible: false, loading: false });
        tt.showToast({ title: '登录成功', icon: 'success' });
        this.triggerEvent('success', { user: data.user, mock: Boolean(data.mock) });
      } catch (error) {
        this.setData({
          loading: false,
          error: error.message || '登录失败，请重试',
          isMock: auth.isMockMode(),
        });
      }
    },
  },
});
