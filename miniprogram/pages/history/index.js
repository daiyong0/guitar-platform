'use strict';

const history = require('../../utils/history');
const track = require('../../utils/track');
const format = require('../../utils/format');

const FALLBACK_COVER = '/assets/images/cover-fallback.png';

function decorate(record) {
  const typeLabel = record.contentType === 'video' ? '视频回放' : '吉他谱';
  const route = record.route || (record.contentType === 'video'
    ? `/pages/videos/detail?id=${record.contentId}`
    : `/pages/scores/detail?id=${record.contentId}`);
  return {
    ...record,
    cover: record.coverUrl || FALLBACK_COVER,
    typeLabel,
    route,
    timeText: format.timeLabel(record.viewedAt),
    dayText: format.dayLabel(record.viewedAt),
    metaText: record.contentType === 'video'
      ? `${record.category || '视频回放'} · ${format.formatClock(record.duration)}`
      : (record.tags || []).join(' · ') || '吉他谱',
  };
}

Page({
  data: {
    groups: [],
    count: 0,
    isEmpty: true,
  },

  onShow() {
    track.pageShow(this, { pageType: 'history' });
    this.refreshHistory();
  },

  onHide() {
    track.pageHide(this);
  },

  onUnload() {
    track.pageHide(this);
  },

  refreshHistory() {
    const records = history.list().map(decorate);
    const groups = [];
    records.forEach((record) => {
      let group = groups[groups.length - 1];
      if (!group || group.label !== record.dayText) {
        group = { label: record.dayText, items: [] };
        groups.push(group);
      }
      group.items.push(record);
    });
    this.setData({
      groups,
      count: records.length,
      isEmpty: records.length === 0,
    });
  },

  onRecordTap(event) {
    const dataset = event.currentTarget.dataset;
    const group = this.data.groups[Number(dataset.groupIndex)];
    const item = group && group.items[Number(dataset.itemIndex)];
    if (!item) return;
    track.trackContentClick({ contentId: item.contentId, contentType: item.contentType });
    tt.navigateTo({
      url: item.route,
      fail() {
        tt.showToast({ title: '内容已下架或参数失效', icon: 'none' });
      },
    });
  },

  onCoverError(event) {
    const dataset = event.currentTarget.dataset;
    const groupIndex = Number(dataset.groupIndex);
    const itemIndex = Number(dataset.itemIndex);
    if (!Number.isInteger(groupIndex) || !Number.isInteger(itemIndex)) return;
    this.setData({ [`groups[${groupIndex}].items[${itemIndex}].cover`]: FALLBACK_COVER });
  },

  onClearTap() {
    if (!this.data.count) return;
    const self = this;
    tt.showModal({
      title: '清空浏览历史',
      content: '只会清除本机缓存，不影响登录状态和收藏。确定清空吗？',
      confirmText: '清空',
      confirmColor: '#C55530',
      success(res) {
        if (!res.confirm) return;
        history.clear();
        self.refreshHistory();
        tt.showToast({ title: '已清空', icon: 'none' });
      },
    });
  },

  onGoBrowse() {
    tt.switchTab({ url: '/pages/scores/index' });
  },
});
