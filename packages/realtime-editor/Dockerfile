FROM node:22-alpine AS builder

WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com

# 1) 先拷贝依赖描述文件
COPY package.json ./
COPY tsconfig.base.json ./

COPY packages/realtime-editor/package.json ./packages/realtime-editor/
COPY packages/realtime-editor/tsconfig.json ./packages/realtime-editor/

COPY packages/alphatab/package.json ./packages/alphatab/
COPY packages/alphatab/tsconfig.json ./packages/alphatab/

COPY packages/monaco/package.json ./packages/monaco/
COPY packages/monaco/tsconfig.json ./packages/monaco/

COPY packages/lsp/package.json ./packages/lsp/
COPY packages/lsp/tsconfig.json ./packages/lsp/

COPY packages/alphatex/package.json ./packages/alphatex/
COPY packages/alphatex/tsconfig.json ./packages/alphatex/

# 2) 安装依赖（单独成层，最大化缓存）
RUN --mount=type=cache,target=/root/.npm npm install --include=optional

# 3) 再拷贝源码和构建输入
COPY packages/realtime-editor/vite.config.ts ./packages/realtime-editor/
COPY packages/realtime-editor/vite.plugin.assets.ts ./packages/realtime-editor/
COPY packages/realtime-editor/index.html ./packages/realtime-editor/
COPY packages/realtime-editor/types/ ./packages/realtime-editor/types/
COPY packages/realtime-editor/src/ ./packages/realtime-editor/src/

COPY packages/alphatab/src/ ./packages/alphatab/src/
COPY packages/alphatab/font/ ./packages/alphatab/font/

COPY packages/monaco/src/ ./packages/monaco/src/
COPY packages/lsp/src/ ./packages/lsp/src/
COPY packages/alphatex/src/ ./packages/alphatex/src/

# 4) 构建
RUN npm run build --workspace=packages/realtime-editor


FROM nginx:alpine
COPY --from=builder /app/packages/realtime-editor/dist /usr/share/nginx/html
COPY packages/realtime-editor/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
