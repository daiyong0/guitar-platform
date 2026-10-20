'use strict';

const request = require('../../utils/request');
const track = require('../../utils/track');
const auth = require('../../utils/auth');
const history = require('../../utils/history');
const format = require('../../utils/format');
const config = require('../../utils/config');
const metronomeFallback = require('../../utils/metronome');

const FALLBACK_COVER = '/assets/images/cover-fallback.png';
const DEFAULT_IMAGE_RATIO = 4 / 3;
const BPM_MIN = 40;
const BPM_MAX = 200;
const BPM_DEFAULT = 80;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeBpm(value, fallback = BPM_DEFAULT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(Math.round(parsed), BPM_MIN, BPM_MAX);
}

Page({
  data: {
    id: '',
    item: null,
    imageUrls: [],
    totalPages: 0,
    loading: true,
    error: '',

    activePage: 1,
    readPercent: 0,
    readingScrollTop: 0,
    downloadLoading: false,

    isLoggedIn: false,
    isFavorited: false,
    favoriteLoading: false,
    viewText: '0',
    publishedText: '',
    isMock: true,

    // 节拍器底部弹窗
    metronomePanelVisible: false,
    metronomeOn: false,
    metronomeConfigured: false,
    bpm: BPM_DEFAULT,
    bpmMin: BPM_MIN,
    bpmMax: BPM_MAX,
    bpmCanDec: true,
    bpmCanInc: true,
    beatDuration: Math.round(60000 / BPM_DEFAULT),
  },

  onLoad(options) {
    this._unloaded = false;
    this._imageRatios = [];
    this._normalWidth = 0;
    this._normalViewportHeight = 0;
    this._normalContentHeight = 0;
    this._normalMaxScroll = 0;
    this._normalScrollTop = 0;
    this._normalActiveIndex = 0;
    this._normalUiAt = 0;
    this._metricsTimer = null;
    this._imageMetaSeq = 0;
    this._afterLoginAction = '';
    // 用于区分“首次进入/切换曲谱”和用户在本页手动调整过的 BPM。
    this._bpmInitialized = false;
    this._bpmScoreId = '';
    this._bpmUserAdjusted = false;

    const app = getApp();
    this._metronome = (app && app.globalData && app.globalData.metronome) || metronomeFallback;
    this._handleMetronomeError = this.onMetronomeAudioError.bind(this);

    const id = options && options.id ? String(options.id) : '';
    this.setData({
      id,
      isLoggedIn: auth.isLoggedIn(),
      isMock: auth.isMockMode(),
      metronomeConfigured: this._metronome.isConfigured(),
      bpm: BPM_DEFAULT,
      bpmCanDec: true,
      bpmCanInc: true,
      beatDuration: Math.round(60000 / BPM_DEFAULT),
    });

    if (!id) {
      this.setData({ loading: false, error: '谱面参数丢失，请返回列表重新打开。' });
      return;
    }

    this.fetchDetail();
    if (typeof tt.showShareMenu === 'function') {
      tt.showShareMenu({ withShareTicket: false });
    }
  },

  onShow() {
    const id = this.data.id;
    track.pageShow(this, {
      pageType: 'score_detail',
      contentId: id,
      contentType: 'score',
    });

    const loggedIn = auth.isLoggedIn();
    if (loggedIn !== this.data.isLoggedIn) this.setData({ isLoggedIn: loggedIn });
    if (loggedIn && this.data.item) this.loadFavoriteStatus();

    // 音频实例是全局单例，返回页面时同步真实播放状态。
    if (this._metronome && this._metronome.isRunning() && !this.data.metronomeOn) {
      const bpm = this._metronome.getBpm();
      this.setData({
        metronomeOn: true,
        bpm,
        beatDuration: Math.round(60000 / bpm),
        bpmCanDec: bpm > BPM_MIN,
        bpmCanInc: bpm < BPM_MAX,
      });
    } else if (this._metronome && !this._metronome.isRunning() && this.data.metronomeOn) {
      this.setData({ metronomeOn: false });
    }
  },

  onHide() {
    track.pageHide(this);
    // 注意：节拍器不在 onHide 停止。关闭弹窗或切后台时保留播放状态。
  },

  onUnload() {
    this._unloaded = true;
    track.pageHide(this);
    clearTimeout(this._metricsTimer);
    this._metricsTimer = null;
    this._imageMetaSeq += 1;

    // 离开当前详情页才彻底销毁全局音频实例。
    if (this._metronome) {
      this._metronome.stopAndDestroy();
      this._metronome = null;
    }
  },

  onPullDownRefresh() {
    this.fetchDetail(true);
  },

  onShareAppMessage() {
    const item = this.data.item;
    const id = this.data.id;
    const path = `/pages/scores/detail?id=${id}`;
    if (item) {
      track.trackShare({ contentId: item.id, contentType: 'score', sharePath: path });
    }
    const title = item
      ? format.shareTitle(item.title, ' · 吉他谱', config.SHARE_TITLE_MAX_LENGTH)
      : '弦间 · 吉他谱';
    const desc = item
      ? format.clipText(item.description || '一张谱，一把琴，把喜欢的歌慢慢弹会。', 40)
      : '在弦间，找到下一首要弹的歌。';
    const result = {
      title,
      path,
      desc,
    };
    // 分享图直接使用当前谱面的 TOS 首图，不再依赖本地 /uploads。
    const shareImage = this.data.imageUrls[0];
    if (shareImage) result.imageUrl = shareImage;
    return result;
  },

  fetchDetail(fromPullDown) {
    const id = this.data.id;
    if (!id) return;
    if (!fromPullDown) this.setData({ loading: true, error: '' });

    request.get(`/api/scores/${encodeURIComponent(id)}`, { auth: false })
      .then((data) => {
        const item = data && data.item;
        if (!item) throw new Error('吉他谱不存在');
        const imageUrls = item.imageUrls && item.imageUrls.length
          ? item.imageUrls
          : [FALLBACK_COVER];

        this._imageMetaSeq += 1;
        this._imageRatios = new Array(imageUrls.length).fill(DEFAULT_IMAGE_RATIO);
        this._normalScrollTop = 0;
        this._normalActiveIndex = 0;
        this._normalMaxScroll = 0;

        // 进入详情页/切换曲谱时，以后端 initialBpm 作为节拍器默认值。
        // 同一曲谱下拉刷新时不覆盖用户刚才手动调整的 BPM。
        const scoreId = String(item.id);
        const shouldSyncInitialBpm = !this._bpmInitialized
          || this._bpmScoreId !== scoreId
          || !this._bpmUserAdjusted;
        const initialBpm = normalizeBpm(item.initialBpm, BPM_DEFAULT);
        const nextBpm = shouldSyncInitialBpm ? initialBpm : this.data.bpm;
        const globalMetronomeRunning = Boolean(this._metronome && this._metronome.isRunning());
        if (shouldSyncInitialBpm) {
          this._bpmInitialized = true;
          this._bpmScoreId = scoreId;
          this._bpmUserAdjusted = false;
        }

        this.setData({
          item,
          imageUrls,
          totalPages: imageUrls.length,
          loading: false,
          error: '',
          activePage: 1,
          readPercent: 0,
          readingScrollTop: 0,
          viewText: format.formatViews(item.viewCount),
          publishedText: format.formatDate(item.createdAt),
          metronomeOn: this.data.metronomeOn || globalMetronomeRunning,
          bpm: nextBpm,
          beatDuration: Math.round(60000 / nextBpm),
          bpmCanDec: nextBpm > BPM_MIN,
          bpmCanInc: nextBpm < BPM_MAX,
        }, () => {
          this.loadImageRatios(imageUrls);
          this.measureNormalViewport();
          setTimeout(() => this.measureNormalViewport(), 260);
        });

        // 同步全局单例的当前 BPM：即使节拍器尚未开启，打开开关时也会用本谱初始值；
        // 若已在播放，setBpm 只重排定时器，不 stop/destroy，切谱不断音。
        if (this._metronome) {
          this._metronome.setBpm(nextBpm);
        }

        tt.setNavigationBarTitle({ title: item.title || '吉他谱详情' });
        history.add({
          contentType: 'score',
          contentId: item.id,
          title: item.title,
          coverUrl: imageUrls[0] || FALLBACK_COVER,
          route: `/pages/scores/detail?id=${item.id}`,
          tags: item.tags || [],
        });

        if (auth.isLoggedIn()) this.loadFavoriteStatus();
        if (fromPullDown) tt.stopPullDownRefresh();
      })
      .catch((error) => {
        this.setData({
          loading: false,
          error: error.message || '谱面加载失败，请稍后重试',
        });
        if (fromPullDown) tt.stopPullDownRefresh();
      });
  },

  // -------------------- 竖向阅读与当前页 --------------------

  /**
   * 获取每张谱面的宽高比，用于计算竖向堆叠的阅读位置与“下载当前页”。
   * bindload 的真实宽高会覆盖这里的预估值。
   */
  loadImageRatios(imageUrls) {
    if (typeof tt.getImageInfo !== 'function' || !imageUrls.length) return;
    const seq = this._imageMetaSeq;
    const tasks = imageUrls.map((src, index) => new Promise((resolve) => {
      tt.getImageInfo({
        src,
        success(res) {
          const width = Number(res.width);
          const height = Number(res.height);
          const ratio = width > 0 && height > 0 ? height / width : DEFAULT_IMAGE_RATIO;
          resolve({ index, ratio });
        },
        fail() {
          resolve({ index, ratio: DEFAULT_IMAGE_RATIO });
        },
      });
    }));

    Promise.all(tasks)
      .then((list) => {
        if (this._unloaded || seq !== this._imageMetaSeq) return;
        list.forEach((entry) => {
          if (entry.ratio >= 0.2 && entry.ratio <= 10) {
            this._imageRatios[entry.index] = entry.ratio;
          }
        });
        this.measureNormalViewport();
      })
      .catch(() => {});
  },

  onSheetImageLoad(event) {
    if (this._unloaded) return;
    const index = Number(event.currentTarget.dataset.index);
    const detail = (event && event.detail) || {};
    if (!Number.isInteger(index) || !detail.width || !detail.height) return;
    const ratio = Number(detail.height) / Number(detail.width);
    if (!Number.isFinite(ratio) || ratio < 0.2 || ratio > 10) return;
    this._imageRatios[index] = ratio;
    clearTimeout(this._metricsTimer);
    this._metricsTimer = setTimeout(() => {
      if (!this._unloaded) this.measureNormalViewport();
    }, 120);
  },

  measureNormalViewport() {
    if (this._unloaded) return;
    const query = tt.createSelectorQuery().in(this);
    query.select('.normal-score-scroll').boundingClientRect();
    query.exec((result) => {
      const rect = result && result[0];
      if (!rect || !rect.width || !rect.height) return;
      this._normalWidth = rect.width;
      this._normalViewportHeight = rect.height;
      this.recalculateReadingMetrics();
    });
  },

  getContentHeight(width) {
    return this.data.imageUrls.reduce((total, _url, index) => {
      const ratio = this._imageRatios[index] || DEFAULT_IMAGE_RATIO;
      return total + width * ratio;
    }, 0);
  },

  recalculateReadingMetrics() {
    if (!this._normalWidth || !this._normalViewportHeight) return;
    this._normalContentHeight = this.getContentHeight(this._normalWidth);
    this._normalMaxScroll = Math.max(0, this._normalContentHeight - this._normalViewportHeight);
    this._normalScrollTop = clamp(this._normalScrollTop, 0, this._normalMaxScroll);
    this.updateReadingState(this._normalScrollTop, true);
  },

  findVisiblePageIndex(scrollTop) {
    const count = this.data.imageUrls.length;
    if (!count) return 0;
    if (!this._normalWidth) {
      return clamp((Number(this.data.activePage) || 1) - 1, 0, count - 1);
    }
    // 以视口上方约 30% 的位置判断当前阅读页，避免页缝处来回跳页。
    const marker = Math.max(0, scrollTop)
      + Math.min(96, Math.max(32, this._normalViewportHeight * 0.3));
    let top = 0;
    for (let i = 0; i < count; i += 1) {
      const height = this._normalWidth * (this._imageRatios[i] || DEFAULT_IMAGE_RATIO);
      if (marker < top + height || i === count - 1) return i;
      top += height;
    }
    return 0;
  },

  updateReadingState(scrollTop, force) {
    this._normalScrollTop = Math.max(0, Number(scrollTop) || 0);
    if (!this._normalWidth || !this._normalViewportHeight) return;
    const index = this.findVisiblePageIndex(this._normalScrollTop);
    const percent = this._normalMaxScroll > 0
      ? clamp(Math.round((this._normalScrollTop / this._normalMaxScroll) * 100), 0, 100)
      : 0;
    const now = Date.now();
    if (force || index !== this._normalActiveIndex || now - this._normalUiAt > 160) {
      this._normalActiveIndex = index;
      this._normalUiAt = now;
      this.setData({
        activePage: index + 1,
        readPercent: percent,
      });
    }
  },

  onSheetScroll(event) {
    const detail = (event && event.detail) || {};
    this.updateReadingState(detail.scrollTop, false);
  },

  /**
   * 使用抖音原生图片预览：
   * - 双指缩放、双击缩放、多图左右切换均由原生 API 处理；
   * - 传入当前图 URL 与完整 urls 数组，保证从当前页开始预览。
   */
  onPreviewImage(event) {
    const index = Number(event.currentTarget.dataset.index) || 0;
    const current = this.data.imageUrls[index];
    if (!current) return;
    tt.previewImage({
      current,
      urls: this.data.imageUrls,
    });
  },

  // -------------------- 下载当前页 --------------------

  getCurrentDownloadIndex() {
    if (!this.data.imageUrls.length) return 0;
    if (!this._normalWidth || !this._normalViewportHeight) {
      return clamp((Number(this.data.activePage) || 1) - 1, 0, this.data.imageUrls.length - 1);
    }
    return this.findVisiblePageIndex(this._normalScrollTop);
  },

  /**
   * 下载当前可见谱面并保存到相册。
   *
   * 上线前必须：
   * 1. 在抖音开放平台把谱面图片域名加入 downloadFile 合法域名；
   * 2. 在隐私协议中声明“保存图片到相册”，并通过 app.json 的 scope.album
   *    展示授权用途说明。
   */
  onDownloadTap() {
    if (this.data.downloadLoading || !this.data.imageUrls.length) return;
    const index = this.getCurrentDownloadIndex();
    const url = this.data.imageUrls[index];
    if (!url) {
      tt.showToast({ title: '当前页图片地址无效', icon: 'none' });
      return;
    }

    this.setData({ downloadLoading: true });
    tt.showLoading({ title: `正在下载第 ${index + 1} 页` });

    tt.downloadFile({
      url,
      success: (res) => {
        const statusCode = Number(res.statusCode);
        if ((statusCode && statusCode !== 200) || !res.tempFilePath) {
          this.handleDownloadFailure({ errMsg: `下载状态异常（HTTP ${statusCode || 'unknown'}）` });
          return;
        }
        tt.hideLoading();
        this.saveTempFileToAlbum(res.tempFilePath, index);
      },
      fail: (error) => {
        this.handleDownloadFailure(error);
      },
    });
  },

  saveTempFileToAlbum(tempFilePath, index) {
    tt.saveImageToPhotosAlbum({
      filePath: tempFilePath,
      success: () => {
        tt.hideLoading();
        this.setData({ downloadLoading: false });
        tt.showToast({ title: `第 ${index + 1} 页已保存到相册`, icon: 'success' });
      },
      fail: (error) => {
        tt.hideLoading();
        this.setData({ downloadLoading: false });
        this.handleAlbumSaveFailure(error);
      },
    });
  },

  handleDownloadFailure(error) {
    tt.hideLoading();
    this.setData({ downloadLoading: false });
    const errMsg = (error && (error.errMsg || error.message)) || '未知错误';
    console.error('[score-download] downloadFile failed:', errMsg);
    tt.showModal({
      title: '谱面下载失败',
      content: '请检查网络后重试；若持续失败，请联系运营。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  handleAlbumSaveFailure(error) {
    const errMsg = (error && (error.errMsg || error.message)) || '';
    const errorCode = Number(error && (error.errorCode || error.errCode || error.errNo));
    console.warn('[score-download] saveImageToPhotosAlbum failed:', errorCode, errMsg);

    if (/saveImageToPhotosAlbum:fail\s+cancel|fail cancel/i.test(errMsg)) {
      tt.showToast({ title: '已取消保存', icon: 'none' });
      return;
    }

    const systemDenied = errorCode === 112089 || /system auth deny/i.test(errMsg);
    const appDenied = errorCode === 112090 || /auth deny/i.test(errMsg);
    const privacyIssue = errorCode === 112079 || errorCode === 112080 || /privacy|隐私协议/i.test(errMsg);

    if (systemDenied) {
      tt.showModal({
        title: '系统相册权限未开启',
        content: '请前往手机「设置 → 抖音 → 照片/相册」允许访问相册，然后回到小程序重新下载。',
        showCancel: false,
        confirmText: '我知道了',
      });
      return;
    }

    if (appDenied) {
      tt.showModal({
        title: '需要相册权限',
        content: '保存谱面需要访问相册。点击“去设置”允许相册权限后，再重新点击下载。',
        confirmText: '去设置',
        cancelText: '取消',
        success: (res) => {
          if (!res.confirm) return;
          tt.openSetting({
            success: () => {
              tt.showToast({ title: '开启相册权限后请重新下载', icon: 'none' });
            },
            fail: () => {
              tt.showToast({ title: '请在设置中手动开启相册权限', icon: 'none' });
            },
          });
        },
      });
      return;
    }

    if (privacyIssue) {
      tt.showModal({
        title: '相册保存暂不可用',
        content: '相册保存能力未完成隐私授权配置，请联系运营或稍后再试。',
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }

    tt.showModal({
      title: '保存失败',
      content: errMsg || '未能保存到相册，请稍后重试。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  // -------------------- 节拍器弹窗 --------------------

  openMetronomePanel() {
    this.setData({ metronomePanelVisible: true });
  },

  /**
   * 收起弹窗只隐藏 UI，不停止节拍器。
   * 只有在弹窗里关闭开关，或页面 onUnload 时才 stop/destroy。
   */
  closeMetronomePanel() {
    // 重新启用 scroll-y 时显式恢复原位置，避免个别基础库在切换 scroll-y 后跳回顶部。
    this.setData({
      metronomePanelVisible: false,
      readingScrollTop: this._normalScrollTop || 0,
    });
  },

  noop() {},

  // 配合 catchtouchmove 阻止弹窗背后的谱面/页面跟随手指滑动。
  blockTouchMove() {},

  onMetronomeToggle(event) {
    const enabled = Boolean(event && event.detail && event.detail.value);
    if (!enabled) {
      if (this._metronome) this._metronome.stopAndDestroy();
      this.setData({ metronomeOn: false });
      return;
    }

    if (!this._metronome || !this._metronome.isConfigured()) {
      this.setData({ metronomeOn: false, metronomeConfigured: false });
      tt.showModal({
        title: '节拍器音频未配置',
        content: '节拍器暂时无法发声，请稍后再试。',
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }

    try {
      const started = this._metronome.start({
        bpm: this.data.bpm,
        onError: this._handleMetronomeError,
      });
      if (!started) throw new Error('节拍器启动失败');
      const bpm = this._metronome.getBpm();
      this.setData({
        metronomeOn: true,
        metronomeConfigured: true,
        bpm,
        beatDuration: Math.round(60000 / bpm),
        bpmCanDec: bpm > BPM_MIN,
        bpmCanInc: bpm < BPM_MAX,
      });
    } catch (error) {
      if (this._metronome) this._metronome.stopAndDestroy();
      this.setData({ metronomeOn: false });
      tt.showToast({
        title: error.message || '节拍器音频加载失败',
        icon: 'none',
      });
    }
  },

  onBpmMinus() {
    this.changeBpm(this.data.bpm - 1);
  },

  onBpmPlus() {
    this.changeBpm(this.data.bpm + 1);
  },

  /**
   * 修复自定义 BPM 无反应：不再依赖被遮挡的 picker 热区，
   * 直接调用抖音原生可输入弹窗。success.content 是字符串，必须显式转数字并校验范围。
   */
  openBpmInput() {
    tt.showModal({
      title: '设置节拍速度',
      editable: true,
      placeholderText: `请输入 40-200 的整数（当前 ${this.data.bpm}）`,
      confirmText: '确定',
      cancelText: '取消',
      success: (res) => {
        if (!res || !res.confirm) return;
        const raw = String(res.content === undefined || res.content === null ? '' : res.content).trim();
        // 严格拒绝空值、小数、负数和带单位的输入，避免 Number('') === 0 的隐式陷阱。
        if (!/^\d{1,3}$/.test(raw)) {
          this.showBpmInputError();
          return;
        }
        const bpm = Number(raw);
        if (!Number.isInteger(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) {
          this.showBpmInputError();
          return;
        }
        this.changeBpm(bpm);
      },
      fail: (error) => {
        console.warn('[metronome] showModal editable failed:', error);
        tt.showToast({
          title: '当前抖音版本不支持键盘输入，请升级后重试',
          icon: 'none',
        });
      },
    });
  },

  showBpmInputError() {
    tt.showToast({
      title: `请输入 ${BPM_MIN}-${BPM_MAX} 之间的整数 BPM`,
      icon: 'none',
      duration: 2400,
    });
  },

  changeBpm(nextValue) {
    const bpm = clamp(Math.round(Number(nextValue) || BPM_DEFAULT), BPM_MIN, BPM_MAX);
    if (bpm === this.data.bpm) return;
    this._bpmUserAdjusted = true;
    this.setData({
      bpm,
      beatDuration: Math.round(60000 / bpm),
      bpmCanDec: bpm > BPM_MIN,
      bpmCanInc: bpm < BPM_MAX,
    });
    // 即使当前未播放，也同步全局单例的 BPM，保证下次打开开关直接使用最新值。
    // setBpm 不 stop/destroy，不会中断已有播放。
    if (this._metronome) {
      this._metronome.setBpm(bpm);
    }
  },

  onMetronomeAudioError(error) {
    if (this._unloaded) return;
    console.warn('[metronome] audio error:', error && error.message, error && error.detail);
    this.setData({ metronomeOn: false });
    tt.showToast({
      title: '节拍器音频播放失败，请检查设备音量或静音设置',
      icon: 'none',
      duration: 3000,
    });
  },

  // -------------------- 登录 / 收藏 --------------------

  loadFavoriteStatus() {
    if (!this.data.id || !auth.isLoggedIn()) return;
    request.get('/api/user/favorites/status', {
      data: { contentType: 'score', contentId: this.data.id },
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
    const detail = event && event.detail ? event.detail : {};
    this.setData({
      isLoggedIn: true,
      isMock: Boolean(detail.mock),
    });
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
    const requestTask = nextFavorite
      ? request.post('/api/user/favorites', {
        contentType: 'score',
        contentId: this.data.item.id,
      })
      : request.del(`/api/user/favorites/score/${this.data.item.id}`);

    requestTask
      .then(() => {
        this.setData({
          isFavorited: nextFavorite,
          favoriteLoading: false,
        });
        track.trackFavorite({
          contentId: this.data.item.id,
          contentType: 'score',
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

  onRetry() {
    this.fetchDetail();
  },

  onBackList() {
    const pages = getCurrentPages();
    if (pages.length > 1) tt.navigateBack();
    else tt.switchTab({ url: '/pages/scores/index' });
  },
});

/*
 * 真机测试建议：
 * 1. 用真实 iPhone/Android 验证 tt.previewImage 的双指缩放、左右切换和返回手势。
 * 2. 配置 downloadFile 合法域名，验证下载、相册拒绝授权、系统相册拒绝三条分支。
 * 3. 不填 clickAudioUrl 时应走 WebAudio 合成；不支持 WebAudio 的宿主回退服务端 WAV。
 * 4. 点击 BPM 数字，测试可输入弹窗：空值/小数/0/201/999 均应被拒绝，40~200 应成功。
 * 5. 弹窗打开时上下拖动遮罩和面板，确认背后谱面 scroll-view 不移动；关闭后恢复滚动且位置不跳顶。
 * 6. 关闭节拍器弹窗后音频应继续；离开详情页（onUnload）应彻底停止。
 * 7. 切换不同 initialBpm 的曲谱，确认弹窗 BPM 与节拍速度同步更新。
 * 8. iOS 开启静音键测试 WebAudio 与 InnerAudio 回退两种路径；Android 测试单音频实例抢占。
 * 9. 确认小程序后台隐私协议包含“保存图片到相册”，否则相册保存会被 112080 拒绝。
 */
