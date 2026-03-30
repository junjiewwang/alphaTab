# ── Stage 1: 构建 ──────────────────────────────────────────────
# 构建上下文为 monorepo 根目录 (../..)，所有路径相对于根目录
FROM node:22-alpine AS builder

WORKDIR /app

# 使用国内 npm 镜像加速（Dockerfile 内部专用，不影响宿主机配置）
RUN npm config set registry https://registry.npmmirror.com

# 根目录 package 文件（不复制 package-lock.json，避免宿主机 lockfile 污染容器平台解析）
COPY package.json ./
COPY tsconfig.base.json ./

# realtime-editor 包
COPY packages/realtime-editor/package.json ./packages/realtime-editor/
COPY packages/realtime-editor/tsconfig.json ./packages/realtime-editor/
COPY packages/realtime-editor/vite.config.ts ./packages/realtime-editor/
COPY packages/realtime-editor/vite.plugin.assets.ts ./packages/realtime-editor/
COPY packages/realtime-editor/index.html ./packages/realtime-editor/
COPY packages/realtime-editor/src/ ./packages/realtime-editor/src/
COPY packages/realtime-editor/types/ ./packages/realtime-editor/types/

# alphatab 源码（monorepo workspace 依赖）
COPY packages/alphatab/package.json ./packages/alphatab/
COPY packages/alphatab/tsconfig.json ./packages/alphatab/
COPY packages/alphatab/src/ ./packages/alphatab/src/
COPY packages/alphatab/font/ ./packages/alphatab/font/

# alphatab-monaco 源码
COPY packages/monaco/package.json ./packages/monaco/
COPY packages/monaco/tsconfig.json ./packages/monaco/
COPY packages/monaco/src/ ./packages/monaco/src/

# alphatab-language-server 源码
COPY packages/lsp/package.json ./packages/lsp/
COPY packages/lsp/tsconfig.json ./packages/lsp/
COPY packages/lsp/src/ ./packages/lsp/src/

# alphatex 源码
COPY packages/alphatex/package.json ./packages/alphatex/
COPY packages/alphatex/tsconfig.json ./packages/alphatex/
COPY packages/alphatex/src/ ./packages/alphatex/src/

# 不复用宿主机生成的 lockfile，避免跨平台 optional deps（如 Rollup 原生模块）安装错误
RUN npm install --include=optional
RUN npm run build --workspace=packages/realtime-editor

# ── Stage 2: 部署 ──────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/packages/realtime-editor/dist /usr/share/nginx/html
COPY packages/realtime-editor/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
