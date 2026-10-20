# 抖音云部署指南（MySQL + TOS + Node 18）

本项目已彻底移除 SQLite，生产运行链路为：

```text
抖音小程序
  └─ tt.createCloud({ envID, serviceID }).callContainer
       └─ 抖音云容器服务（Express，0.0.0.0:8000）
            ├─ /api/*           业务 API
            ├─ /admin/*         静态管理后台
            ├─ /static/*        仅系统音频（节拍器 WAV）
            ├─ MySQL            用户/内容/行为/收藏/管理员
            └─ TOS               图片/视频，数据库保存完整 https URL
```

关键变化：

- 数据库：抖音云 MySQL 8.0，全部通过 `DB_*` 环境变量连接。
- 上传：只允许 TOS，不再写本地磁盘，不再提供 `/uploads`。
- `/api/scores` 直接返回数据库中的 TOS 完整 HTTPS URL，不再拼 Host。
- Dockerfile 使用 `node:18-alpine`，`CMD ["node", "server.js"]`。
- 管理后台仍由 Express 托管在 `/admin/`。

官方参考：

- [10 分钟快速部署自定义服务](https://developer.open-douyin.com/docs/resource/zh-CN/developer/tools/cloud/quick-start/deploy-custom-ervice-in10minutes)
- [抖音云 CLI 工具](https://developer.open-douyin.com/docs/resource/zh-CN/developer/tools/cloud/develop-guide/local-develop/douyin-cloud-features/cli-tools)
- [调用云托管服务 / callContainer](https://developer.open-douyin.com/docs/resource/zh-CN/developer/tools/cloud/api-reference/cloud-hosting/cloud-sdk)
- [对象存储服务端 API](https://developer.open-douyin.com/docs/resource/zh-CN/developer/tools/cloud/api-reference/tos/server)
- [容器服务概述](https://developer.open-douyin.com/docs/resource/zh-CN/developer/tools/cloud/function-service/cloud-service/container-service/overview)

---

## 1. 前置准备

1. 已开通抖音云的小程序应用。
2. 已创建「容器」服务，记下：
   - 环境 ID：`envID`
   - 服务 ID：`serviceID`
   - 服务名称
3. 本地 Node.js **18+**、npm、Docker（支持 linux/amd64）。
4. 抖音云 MySQL 实例。
5. 火山引擎 TOS Bucket、AK/SK、Region、Endpoint。
6. 抖音开放平台已绑定邮箱（CLI 只支持邮箱登录）。

---

## 2. MySQL 初始化

### 2.1 创建数据库

在抖音云 MySQL 控制台创建数据库，例如：

```sql
CREATE DATABASE xianjian CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

创建业务账号，授予该库 `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX` 权限。

### 2.2 环境变量

```env
DB_HOST=<mysql-host>
DB_PORT=3306
DB_USER=<mysql-user>
DB_PASSWORD=<mysql-password>
DB_NAME=xianjian
DB_CONNECTION_LIMIT=10
# 云 MySQL 要求 TLS 时
DB_SSL=0
DB_SSL_REJECT_UNAUTHORIZED=1
DB_SSL_CA_PATH=
```

代码位置：[server/config.js](../server/config.js)、[server/db.js](../server/db.js)。

服务启动时会自动执行 [sql/schema.sql](../sql/schema.sql)（`CREATE TABLE IF NOT EXISTS`），并创建默认管理员。也可以手工执行：

```bash
mysql -h <host> -u <user> -p <database> < sql/schema.sql
```

### 2.3 MySQL 表

完整建表语句见 [sql/schema.sql](../sql/schema.sql)，包含：

- `users`
- `guitar_scores`
- `live_replays`
- `behavior_events`
- `favorites`
- `admin_users`

时间字段使用 `DATETIME(3)`；行为事件排序字段为 `event_time BIGINT`（毫秒时间戳）。

### 2.4 Seed 初始化

先配置好 MySQL 和 TOS，然后执行：

```bash
node server/seed.js
```

Seed 会：

- 读取 `SCORE_SEEDS` / `VIDEO_SEEDS`；
- 把 `uploads/seed/` 中的封面、谱面、视频上传到 TOS（key 形如 `seed/cover-xxx.jpg`）；
- 把 TOS 返回的完整 HTTPS URL 写入 `guitar_scores.images` 和 `live_replays.cover_url/video_url`；
- 写入 6 份吉他谱与 4 个视频回放。

如果已经手动上传素材，可设置：

```env
SEED_ASSET_BASE_URL=https://cdn.example.com/seed
```

然后 Seed 会直接拼接公共 URL，不再上传。

重建数据：

```bash
node server/seed.js --reset
```

> `--reset` 会删除内容、用户、行为事件与收藏，保留管理员账号。

> 云端部署不需要执行上述命令：设置 `SEED_ON_START=1`，服务首次启动会自动上传
> `uploads/seed/` 素材并写入 6 谱 + 4 视频；已有内容会自动跳过。

### 2.5 从旧 SQLite 迁移

如果只是演示数据，建议直接 Seed。若要保留旧数据：

1. 用 SQLite 工具导出内容/用户/收藏/事件为 JSON 或 CSV；
2. 将图片/视频上传到 TOS，得到完整 HTTPS URL；
3. 映射字段写入 MySQL：
   - `guitar_scores.images` 改为 TOS URL 数组；
   - `live_replays.cover_url/video_url` 改为 TOS URL；
   - `behavior_events.timestamp` 改名为 `event_time`；
   - 其余时间字段转为 `YYYY-MM-DD HH:mm:ss.SSS`；
4. 不要迁移 SQLite 的 `sqlite_sequence`、`PRAGMA` 等结构。

---

## 3. TOS 对象存储

1. 抖音云控制台 → 对象存储 → 开通/创建 Bucket。
2. 记录：
   - `TOS_ACCESS_KEY_ID`
   - `TOS_ACCESS_KEY_SECRET`
   - `TOS_REGION`
   - `TOS_ENDPOINT`
   - `TOS_BUCKET`
3. 配置 Bucket 公共读，或绑定 CDN/自定义域名。
4. 环境变量：

```env
TOS_ACCESS_KEY_ID=...
TOS_ACCESS_KEY_SECRET=...
TOS_REGION=cn-beijing
TOS_ENDPOINT=tos-cn-beijing.volces.com
TOS_BUCKET=...
TOS_PUBLIC_BASE_URL=https://cdn.example.com   # 可选
TOS_KEY_PREFIX=xianjian
TOS_OBJECT_ACL=public-read
```

上传逻辑：[server/routes/upload.js](../server/routes/upload.js) + [server/utils/cloud-storage.js](../server/utils/cloud-storage.js)。

- 管理后台上传接口：`POST /api/admin/upload?kind=image|video`；
- 服务端先写临时目录，再 `putObjectFromFile` 到 TOS；
- 数据库存 TOS 返回的完整 `https://` URL；
- 临时文件在 `finally` 删除；
- 没有 `STORAGE_DRIVER`、没有本地 `/uploads` 部署模式。

TOS 上传验证（不需要 MySQL）：

```bash
npm run tos:check
```

TOS Bucket 跨域规则、控制台入口和 XML/JSON 示例：
[`docs/tos-cors-and-upload.md`](tos-cors-and-upload.md)。

小程序需要：

- 把 TOS/CDN 公开域名加入 **downloadFile 合法域名**；
- 如 `<image>` / `<video>` 需要，也按平台要求加入下载/业务域名；
- 管理后台直接用 TOS 图片，无需域名白名单。

---

## 4. 完整环境变量

模板：[.env.cloud.example](../.env.cloud.example)

核心 Key：

```env
NODE_ENV=production
PORT=8000
HOST=0.0.0.0
TRUST_PROXY=1

DB_HOST=...
DB_PORT=3306
DB_USER=...
DB_PASSWORD=...
DB_NAME=...
DB_CONNECTION_LIMIT=10
DB_SSL=0

JWT_SECRET=至少32字符随机值
PHONE_ENCRYPTION_KEY=独立随机值
ADMIN_DEFAULT_USERNAME=admin
ADMIN_DEFAULT_PASSWORD=强密码

TMP_UPLOAD_DIR=/tmp/xianjian-uploads
MAX_IMAGE_MB=20
MAX_VIDEO_MB=500

# 管理后台若与 API 不同源，填其 origin；生产禁止 *
CORS_ORIGINS=https://admin.example.com
CORS_ALLOW_ALL=0
CORS_MAX_AGE=600

TOS_ACCESS_KEY_ID=...
TOS_ACCESS_KEY_SECRET=...
TOS_REGION=...
TOS_ENDPOINT=...
TOS_BUCKET=...
TOS_PUBLIC_BASE_URL=...
TOS_KEY_PREFIX=xianjian
TOS_OBJECT_ACL=public-read

# 首次启动自动上传 seed 并写入默认内容；已有内容会跳过
SEED_ON_START=1

PHONE_LOGIN_MODE=mock
```

生产环境无法在缺少 MySQL/TOS 配置时启动，这是有意为之。

---

## 5. 构建镜像

```bash
docker buildx build --platform linux/amd64 \
  -t guitar-platform:v1.0.0 \
  --load .
```

Windows PowerShell 把 `\` 换成反引号，或写成一行。

Dockerfile 关键点：

```dockerfile
FROM node:18-alpine
WORKDIR /app
ENV PORT=8000 HOST=0.0.0.0
COPY uploads/seed ./uploads/seed   # 只作为 seed 上传源
COPY static ./static               # 系统音频
EXPOSE 8000
CMD ["node", "server.js"]
```

本地验证（需真实 MySQL/TOS 或测试环境）：

```bash
docker run --rm -p 8000:8000 \
  --env-file .env \
  guitar-platform:v1.0.0
```

打开：

```text
http://127.0.0.1:8000/api/health
http://127.0.0.1:8000/admin/
```

健康响应：

```json
{"status":"ok","database":"mysql","storage":"tos"}
```

---

## 6. 安装 CLI、登录与推送

### 6.1 安装

```bash
npm install -g @open-dy/cloud-cli --registry=https://registry.npmmirror.com/
dycloud --version
```

Windows PowerShell 如果 npm.ps1 被拦截：

```powershell
npm.cmd install -g @open-dy/cloud-cli --registry=https://registry.npmmirror.com/
```

### 6.2 登录与选择环境

```bash
dycloud login
# 或
dycloud login -e your-email@example.com -p 'your-password'

dycloud env:list
dycloud env:switch --app-name "你的应用名称" --env dev
dycloud container:list
```

CLI 只支持邮箱登录，先在抖音开放平台绑定邮箱。没有单独的 project init，服务先在控制台创建。

### 6.3 推送镜像

```bash
dycloud container:push \
  --service-name "xianjian" \
  --image-id guitar-platform:v1.0.0 \
  --tag v1.0.0 \
  --remark "mysql + tos production"
```

如果 `--image-id` 需要镜像 ID：

```bash
docker images --format "{{.ID}}  {{.Repository}}:{{.Tag}}" | grep guitar-platform
```

Tag 建议 `v1.0.0` / `v1.0.1` / `20261020-1`，每次唯一。

---

## 7. 控制台发布

1. 进入容器服务详情。
2. 镜像部署，选择刚推送的 tag。
3. 端口填 **8000**。
4. 配置全部 `DB_*`、`TOS_*`、`JWT_SECRET`、`ADMIN_DEFAULT_PASSWORD`。
5. 不需要挂载数据云盘（数据库已改为外部 MySQL）。
6. 先发布 dev/测试环境。
7. 验证：
   - `/api/health` 返回 `status=ok`、`database=mysql`、`storage=tos`
   - `/admin/` 可登录
   - 上传图片返回 TOS `https://` URL
8. 发布 prod，按灰度放量。

---

## 8. 小程序 callContainer

修改 [miniprogram/utils/config.js](../miniprogram/utils/config.js)：

```js
const CLOUD_ENV_ID = '环境ID';
const CLOUD_SERVICE_ID = '服务ID';
const CLOUD_PUBLIC_BASE_URL = 'https://服务外网域名';
```

[request.js](../miniprogram/utils/request.js) 已实现：

- `tt.createCloud({ envID, serviceID })`；
- `callContainer` 的 `path`、`method`、`headers`、`data`、`timeout`；
- GET 参数拼接；
- `data` 字符串 JSON.parse；
- 基础库 <2.70 或 `createCloud` 不可用时回退 `tt.request`；
- 埋点也复用该封装。

要求基础库 >= **2.70.0**。

---

## 9. Seed 素材与分享图

- `uploads/seed/` 只作为 Seed 上传源，不再通过 `/uploads` 静态暴露。
- `node server/seed.js` 会把素材上传到 TOS，并把 TOS URL 写入 MySQL。
- 谱面/视频/分享图都直接使用 TOS 完整 URL，不再拼 `BASE_URL` 或 Host。
- 节拍器回退音频是系统静态资源 `/static/metronome-click.wav`，Docker 会复制 `static/`。

验证：

```bash
mysql -h ... -e "SELECT images FROM guitar_scores LIMIT 1;"
```

应类似：

```json
["https://cdn.example.com/seed/cover-summer-breeze.jpg", ...]
```

`/api/scores` 会原样返回这些 HTTPS URL。

---

## 10. 最容易报错的环节

1. **MySQL 连接失败**  
   检查 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`、白名单、账号权限、TLS 设置。

2. **表不存在**  
   服务启动会自动执行 `schema.sql`；若账号无 `CREATE` 权限，请先手工执行。

3. **JSON 字段报错**  
   `images/tags/extra` 必须是合法 JSON 字符串；Seed 和上传接口已处理。

4. **TOS 上传 502 / 403**  
   检查 AK/SK、Region、Endpoint、Bucket、对象 ACL；Bucket 需公共读或 CDN。

5. **图片 URL 仍是 localhost**  
   本项目已取消 Host 拼接；如果出现，说明运行的是旧镜像/旧数据库，重新部署新 tag 并重新 Seed。

6. **`/api/scores` 返回相对路径**  
   旧 SQLite 数据被迁入；需把 images 替换为 TOS 完整 URL。

7. **Seed 失败**  
   检查 TOS 配置和 `uploads/seed` 是否存在；也可设置 `SEED_ASSET_BASE_URL` 直接使用已上传素材。

8. **容器启动后立即退出**  
   查看日志，最常见是缺少 `DB_*` 或 `TOS_*` 环境变量。

9. **`callContainer` 失败**  
   检查 `envID`/`serviceID`、服务是否发布、基础库 >=2.70、是否开启外网访问。

10. **上传返回 413**  
   检查 `MAX_IMAGE_MB/MAX_VIDEO_MB` 和网关/容器上传限制。

---

## 11. 上线检查清单

- [ ] MySQL 8 已创建，`schema.sql` 已应用
- [ ] `DB_*` 全部配置，连接正常
- [ ] TOS Bucket/域名已配置，对象可公开访问
- [ ] `TOS_*` 全部配置
- [ ] `JWT_SECRET` / `PHONE_ENCRYPTION_KEY` / 管理员密码已替换
- [ ] `node server/seed.js` 成功，图片为 TOS URL
- [ ] `/api/scores` 的 imageUrls 全部为 `https://`
- [ ] `/admin/` 可登录，上传返回 TOS URL
- [ ] `/api/health` 返回 `database=mysql`、`storage=tos`
- [ ] 小程序 envID/serviceID/公网域名已填
- [ ] 基础库 >=2.70
- [ ] TOS 域名已加入小程序 downloadFile/业务域名
- [ ] callContainer 登录、列表、详情、收藏、埋点回归通过
- [ ] 发布 dev 验证后再灰度 prod
