# 数据库已迁移到抖音云 MySQL，图片/视频全部走 TOS，不再需要 node:sqlite。
# 因此可以使用抖音云稳定支持的 Node 18 基础镜像。
FROM node:18-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:18-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js ./
COPY server ./server
COPY admin ./admin
COPY shared ./shared
COPY sql ./sql
COPY static ./static
# seed 源素材仅用于执行 `node server/seed.js` 时上传 TOS，不对外提供本地静态服务。
COPY uploads/seed ./uploads/seed

RUN mkdir -p /tmp/xianjian-uploads

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
