'use strict';

const config = require('./utils/config');
const request = require('./utils/request');
const idUtil = require('./utils/id');
const track = require('./utils/track');
const metronome = require('./utils/metronome');

App({
  globalData: {
    sessionId: '',
    deviceId: '',
    publicConfig: {},
    phoneLoginMode: config.PHONE_MOCK_FALLBACK ? 'mock' : 'real',
    launchOptions: null,
    // 全局唯一节拍器管理器：WebAudio / InnerAudioContext 都由它跨 Page 持有。
    // 关闭弹窗、页面 onHide 都不销毁；详情页 onUnload 才调用 stopAndDestroy。
    metronome,
  },

  onLaunch(options) {
    const sessionId = idUtil.createSessionId();
    this.globalData.sessionId = sessionId;
    this.globalData.deviceId = idUtil.getDeviceId();
    this.globalData.launchOptions = options || {};

    // 一次打开生命周期内 sessionId 保持不变；后台保存的是设备 ID，用于未登录埋点。
    track.init({ sessionId });
    this.loadPublicConfig();

    if (typeof tt.onNetworkStatusChange === 'function') {
      tt.onNetworkStatusChange((res) => {
        if (res && res.isConnected) track.flushNow();
      });
    }
  },

  onShow() {
    // 应用回到前台时尝试补发上一次未成功的队列。
    track.flushNow();
  },

  onHide() {
    // onHide 立即 flush；失败的事件仍保留在队列和本地缓存中。
    track.flushNow();
  },

  loadPublicConfig() {
    request.get('/api/public-config', { auth: false, silent: true })
      .then((data) => {
        this.globalData.publicConfig = data || {};
        if (data && (data.phoneLoginMode === 'mock' || data.phoneLoginMode === 'real')) {
          this.globalData.phoneLoginMode = data.phoneLoginMode;
        }
      })
      .catch(() => {
        // 配置接口不可用时仍允许浏览。登录时会由服务端最终决定 mock/real。
        console.warn('[app] public config unavailable, continue with local defaults');
      });
  },
});
