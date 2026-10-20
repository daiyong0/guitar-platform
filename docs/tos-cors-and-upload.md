# TOS 上传、CORS 与管理后台适配

本文对应代码：

- [server/utils/cloud-storage.js](../server/utils/cloud-storage.js)
- [server/routes/upload.js](../server/routes/upload.js)
- [server/app.js](../server/app.js)
- [admin/js/api.js](../admin/js/api.js)
- [scripts/tos-upload-check.js](../scripts/tos-upload-check.js)

---

## 1. 当前上传链路

```text
管理后台 <input type="file">
  └─ XHR POST /api/admin/upload?kind=image|video
       └─ Express + multer 写入 /tmp 临时目录
            └─ TOS SDK putObjectFromFile
                 └─ 返回 https://cdn.example.com/xianjian/2026-10/xxx.png
                      ├─ 响应 { url, storagePath, storageDriver: "tos" }
                      └─ 管理后台存入 images / coverUrl / videoUrl
```

特点：

- TOS 凭据只在服务端环境变量中，绝不下发浏览器；
- 浏览器不直接访问 TOS AccessKey；
- 上传成功后临时文件立即删除；
- 没有 `/uploads` 静态目录；
- 数据库只保存完整 `https://` URL；
- `/api/scores` 直接返回数据库中的 URL，**不做任何 Host 拼接**。

> 注意：服务端上传使用 TOS SDK，**不依赖 TOS 的浏览器 CORS**。  
> TOS CORS 主要用于浏览器 `fetch`/`XHR`/`canvas` 直接读取 TOS，或未来改为浏览器直传时。

---

## 2. 环境变量与获取位置

完整模板：[.env.example](../.env.example)、[.env.cloud.example](../.env.cloud.example)。

### 2.1 TOS 参数

```env
TOS_ACCESS_KEY_ID=
TOS_ACCESS_KEY_SECRET=
TOS_REGION=cn-beijing
TOS_ENDPOINT=tos-cn-beijing.volces.com
TOS_BUCKET=
TOS_PUBLIC_BASE_URL=https://cdn.example.com
TOS_KEY_PREFIX=xianjian
TOS_OBJECT_ACL=public-read
```

| 变量 | 在控制台哪里找 |
|---|---|
| `TOS_ACCESS_KEY_ID` | 火山引擎控制台 → 访问控制 IAM → 用户 → 访问密钥；或账号头像 → 密钥管理 |
| `TOS_ACCESS_KEY_SECRET` | 创建 AccessKey 时生成；只显示一次，丢失需新建 |
| `TOS_REGION` | TOS 控制台 → 桶列表 → 目标 Bucket → 概览 → 地域，例如 `cn-beijing` |
| `TOS_ENDPOINT` | Bucket 概览 → 访问域名；通常为 `tos-<region>.volces.com` |
| `TOS_BUCKET` | TOS 控制台 → 桶列表 → Bucket 名称 |
| `TOS_PUBLIC_BASE_URL` | Bucket 概览的访问域名，或绑定的 CDN/自定义 HTTPS 域名，**不要带结尾 `/`** |
| `TOS_KEY_PREFIX` | 自定义对象前缀，例如 `xianjian`，用于隔离环境 |
| `TOS_OBJECT_ACL` | 通常 `public-read`；如果 Bucket 禁止对象 ACL，则用桶策略公共读 |

抖音云控制台入口通常是：

```text
抖音云控制台 → 对象存储 → 桶列表 / Bucket 详情
```

不同版本控制台可能把“密钥管理”“访问控制”“跨域设置”放在不同菜单，认准上述名称即可。火山引擎 TOS 官方文档：

- [PutBucketCORS](https://docs.volcengine.com/docs/TorchObjectStorage/PutBucketCORS)
- [Web 直传实践](https://docs.volcengine.com/docs/TorchObjectStorage/UploadingdatafromwebbrowserstoTOS)

### 2.2 Express CORS 参数

```env
# 管理后台/网页前端的 origin，逗号分隔；只填协议+域名+端口
CORS_ORIGINS=https://admin.example.com,http://localhost:8000
CORS_ALLOW_ALL=0
CORS_MAX_AGE=600
```

- 小程序 `tt.request` / `callContainer` 通常不发送浏览器 `Origin`，不受 Express CORS 影响；
- 如果管理后台与 API 同源，可以留空或只填本地调试地址；
- 生产禁止 `CORS_ALLOW_ALL=1` 和 `CORS_ORIGINS=*`，启动时会直接报错；
- 多个 origin 用英文逗号分隔，不能带路径；
- 允许的请求头包含 `Authorization`、`Content-Type`，支持 JWT 上传。

---

## 3. Express CORS 配置

[server/app.js](../server/app.js)：

```js
const cors = require('cors');

function corsOptions(config) {
  const allowed = new Set(config.cors.origins);
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true); // 小程序/curl/服务端
      if (config.cors.allowAll || allowed.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
    credentials: false,
    maxAge: config.cors.maxAge,
    optionsSuccessStatus: 204,
  };
}

app.use(cors(corsOptions(config)));
```

行为：

- 允许的 Origin 返回 `Access-Control-Allow-Origin`；
- 未配置的 Origin 不返回该头，浏览器拦截；
- 无 Origin 的请求正常处理；
- `OPTIONS` 预检返回 204；
- JWT 使用 `Authorization` 头，不需要 Cookie，所以 `credentials: false`。

---

## 4. TOS Bucket CORS 规则

### 4.1 什么时候需要

| 场景 | 是否需要 TOS CORS |
|---|---|
| 管理后台 `<img>` 显示 TOS 图片 | 通常不需要 |
| 管理后台 `<video>` 播放 TOS 视频 | 通常不需要 |
| 浏览器 `fetch` / `XHR` 读取 TOS | 需要 |
| Canvas 读取 TOS 图片像素 | 需要 |
| 浏览器直接 PUT/POST 到 TOS（直传） | 需要 |
| 小程序 `tt.downloadFile` 下载 TOS | 不走浏览器 CORS，需要配置小程序下载域名 |
| 当前项目的服务端 SDK 上传 | 不需要 TOS CORS |

如果只是当前这套“后端上传、前端展示”的链路，TOS CORS 不是上传成功的前提；但为了管理后台未来做 Canvas 预览、浏览器 fetch、或者切换直传，建议配置只读 CORS。

### 4.2 推荐规则（XML）

火山引擎 TOS 的 CORS API 使用 S3 风格的 `CORSConfiguration`。把域名替换成你的管理后台/网页域名：

```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://admin.example.com</AllowedOrigin>
    <AllowedOrigin>http://localhost:8000</AllowedOrigin>
    <AllowedOrigin>http://127.0.0.1:8000</AllowedOrigin>

    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>

    <AllowedHeader>*</AllowedHeader>

    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-tos-request-id</ExposeHeader>

    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
```

如果未来改成**浏览器直传 TOS**，再加：

```xml
<AllowedMethod>PUT</AllowedMethod>
<AllowedMethod>POST</AllowedMethod>
```

但当前项目不需要；不要为了“上传”盲目放开 `PUT`/`POST`。

### 4.3 等价 JSON（控制台/脚本参考）

不同版本控制台可能接受 JSON 视图，字段名以实际控制台为准；等价的只读规则如下：

```json
{
  "CORSConfiguration": {
    "CORSRules": [
      {
        "AllowedOrigins": [
          "https://admin.example.com",
          "http://localhost:8000",
          "http://127.0.0.1:8000"
        ],
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag", "x-tos-request-id"],
        "MaxAgeSeconds": 3600
      }
    ]
  }
}
```

### 4.4 不要只配 CORS

- CORS 只控制浏览器跨域读取，**不会让私有对象变为公开可读**；
- Bucket 需要公共读，或通过桶策略/CDN 允许匿名 GET；
- 如果开了 Referer 防盗链，要把管理后台域名加入白名单，否则 `<img>` 可能 403；
- 使用 CDN 时，CDN 域名也要允许相应 CORS/防盗链策略；
- 不要把 `AllowedOrigin` 设成 `*` 并同时依赖 Cookie；本项目用 Bearer，不使用 Cookie，仍建议显式域名。

### 4.5 配置入口

```text
TOS 控制台 → 桶列表 → 目标 Bucket → 权限管理 → 跨域设置
```

保存后可用浏览器开发者工具检查响应头：

```text
Access-Control-Allow-Origin: https://admin.example.com
Access-Control-Allow-Methods: GET, HEAD
```

---

## 5. 数据库未接通时先测 TOS

新增脚本：[scripts/tos-upload-check.js](../scripts/tos-upload-check.js)

```bash
npm run tos:check
# 或上传指定文件
npm run tos:check -- "H:\path\to\cover.jpg"
```

脚本：

- 只读取 TOS 环境变量，**不连接 MySQL**；
- 上传到 `TOS_KEY_PREFIX/healthcheck/...`；
- 输出完整 HTTPS URL；
- 尝试 `HEAD` 验证公网访问；
- 输出一条可直接执行的 MySQL 占位 SQL。

预期输出：

```text
[tos:check] 上传成功
URL: https://cdn.example.com/xianjian/healthcheck/1720000000000-share-default.png
KEY: xianjian/healthcheck/1720000000000-share-default.png
HEAD: 200 image/png

-- MySQL 接通后可执行：
INSERT INTO guitar_scores
  (title, tags, description, images, initial_bpm, status, sort_weight, view_count, created_at, updated_at)
VALUES
  ('TOS 上传验证', JSON_ARRAY('测试'), '临时占位数据，验证 TOS 上传后可删除。',
   JSON_ARRAY('https://cdn.example.com/...'), 80, 'draft', 0, 0, NOW(3), NOW(3));
```

数据库接通后：

1. 执行这条 SQL；
2. 管理后台会看到一条草稿；
3. 确认 `/api/scores` 不返回它（draft）；
4. 发布后可验证 `/api/scores` 的 `imageUrls` 是 TOS URL；
5. 验证完成后删除这条占位数据。

---

## 6. 管理后台适配

[admin/js/api.js](../admin/js/api.js) 上传成功后会校验：

```js
const assetUrl = payload.url || payload.storagePath;
if (!assetUrl || !/^https:\/\//i.test(assetUrl)) {
  throw new ApiError('上传接口未返回 TOS HTTPS 绝对地址', { code: 'UPLOAD_ERROR' });
}
resolve({ ...payload, url: assetUrl, storagePath: assetUrl });
```

因此：

- 图片组件拿到 `result.url` / `result.storagePath` 都是完整 HTTPS；
- 视频组件拿到完整 `videoUrl`；
- 列表直接 `<img src="${item.imageUrls[0]}">`；
- 视频预览 `<video src="${item.videoPreviewUrl}">`；
- 时间线/用户头像使用绝对 `avatar`；
- 不存在“前端再拼 `/api` 或 localhost”的逻辑。

上传接口：

```text
POST /api/admin/upload?kind=image
POST /api/admin/upload?kind=video
Authorization: Bearer <admin token>
Content-Type: multipart/form-data
字段名: file
```

响应：

```json
{
  "url": "https://cdn.example.com/xianjian/2026-10/xxx.png",
  "storagePath": "https://cdn.example.com/xianjian/2026-10/xxx.png",
  "storageDriver": "tos",
  "kind": "image",
  "filename": "cover.png",
  "mimeType": "image/png",
  "size": 123456
}
```

---

## 7. 常见问题

**上传 401**  
管理后台 token 过期；重新登录。

**上传 413**  
超过 `MAX_IMAGE_MB` / `MAX_VIDEO_MB` 或网关限制。

**上传 502 / STORAGE_UPLOAD_FAILED**  
检查 TOS AK/SK、Region、Endpoint、Bucket、ACL、网络。

**上传成功但图片 403**  
Bucket 不是公共读，或 Referer 防盗链拦截；CORS 不是访问权限本身。

**图片能显示但 canvas 报跨域**  
配置 TOS CORS 并确保 `<img crossorigin="anonymous">`；当前列表普通 `<img>` 不需要。

**`/api/scores` 仍有 localhost**  
运行了旧镜像或旧数据库；重新部署并确认 `images` 是 TOS URL。

**小程序真机图片不显示**  
把 TOS/CDN 域名加入小程序 downloadFile 合法域名；`tt.request` 的 API 域名和 TOS 下载域名是两套配置。

**管理后台跨域 403/CORS error**  
把管理后台 origin 填到 `CORS_ORIGINS`，重启服务；不要带路径或结尾 `/`。
