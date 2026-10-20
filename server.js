'use strict';

// 抖音云容器 CMD 固定使用 node server.js；
// 实际启动逻辑在 server/index.js，保留本地 `node server/index.js` 兼容。
require('./server/index.js').start();
