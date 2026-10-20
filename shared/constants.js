'use strict';

// Shared labels used by the API/admin. The miniprogram keeps a small copy of
// the tag/category constants in miniprogram/utils/constants.js because Douyin
// native packages cannot require files outside the project root.
const SCORE_TAGS = ['弹唱', '指弹', '入门', '进阶', '流行', '基础'];
const VIDEO_CATEGORIES = ['现场回放', '教学回放', '幕后', '技巧', '设备', '乐理'];

const PAGE_LABELS = {
  'pages/scores/index': '吉他谱列表',
  'pages/scores/detail': '吉他谱详情',
  'pages/videos/index': '视频列表',
  'pages/videos/detail': '视频详情',
  'pages/mine/index': '我的',
  'pages/history/index': '浏览历史',
  'pages/favorites/index': '我的收藏',
};

const EVENT_TYPES = [
  'page_view',
  'page_leave',
  'search',
  'content_click',
  'video_play',
  'video_pause',
  'video_complete',
  'share',
  'favorite',
];

const FUNNEL_INTERACTION_EVENTS = ['share', 'favorite', 'video_complete'];

module.exports = {
  SCORE_TAGS,
  VIDEO_CATEGORIES,
  PAGE_LABELS,
  EVENT_TYPES,
  FUNNEL_INTERACTION_EVENTS,
};
