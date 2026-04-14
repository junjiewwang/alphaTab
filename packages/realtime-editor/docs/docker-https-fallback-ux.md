# Docker HTTPS + Fallback UX 优化

> 需求：解决 Docker 部署场景下 File System Access API 因 HTTP 非安全上下文不可用的问题。

## 背景

File System Access API（`showOpenFilePicker` / `showSaveFilePicker`）要求 **Secure Context**（HTTPS 或 `localhost`）。  
原 Dockerfile 仅暴露 HTTP:80 端口，当通过非 localhost URL 访问时，浏览器检测到非安全上下文，API 不可用：

- 用户无法通过 File Picker 获取 `FileSystemFileHandle`
- Ctrl+S 保存降级为浏览器下载副本，无法写回原文件
- IndexedDB 中的 Handle 持久化机制失效

## 实施方案

### 方案 A：Dockerfile 内置 HTTPS（自签名证书）

**改动文件：**
- `Dockerfile` — Nginx 阶段增加 OpenSSL 生成自签名证书
- `nginx.conf` — 双端口配置（HTTPS:443 主服务 + HTTP:80 重定向）

**架构：**
```
用户浏览器 ──HTTPS:443──▶ Nginx (自签名证书)
         ──HTTP:80───▶ 301 → HTTPS
                        └─ /healthz 健康检查（不重定向）
```

**注意事项：**
- 自签名证书会触发浏览器安全警告，用户需点击"继续访问"
- 证书有效期 10 年（`-days 3650`），减少维护负担
- 生产环境建议使用外部反向代理（Caddy / Traefik）+ Let's Encrypt 证书

### 方案 C：增强 Fallback 体验（轻量非侵入）

**设计原则：** 不添加任何 DOM 元素，不影响布局，通过现有 UI 组件传达信息。

**改动文件：**
- `src/env-context.ts` — **新建** 环境检测模块（轻量方案）
- `src/styles.css` — 新增 `.toolbar-button--save.is-fallback` 降级视觉标记
- `src/main.ts` — 在初始化流程中调用 `setupEnvContext()`
- `src/documents.ts` — 降级保存时优化状态提示文案

**降级原因区分：**

`env-context.ts` 通过 `detectFallbackReason()` 区分两种不同的降级原因：

| 原因 | 条件 | 提示方式 |
|------|------|---------|
| `insecure-context` | `!window.isSecureContext`（HTTP + 非 localhost） | tooltip 提示切换 HTTPS |
| `unsupported-browser` | `isSecureContext` 但 API 不存在（Firefox/Safari） | tooltip 提示使用 Chrome/Edge |
| `null` | API 可用 | 无任何提示 |

**行为：**

| 场景 | 保存按钮 | Ctrl+S 行为 | 状态栏提示 |
|------|---------|-------------|-----------|
| Chrome/Edge + HTTPS/localhost | 正常蓝色渐变 + tooltip "保存" | 写回原文件 | 已保存 |
| Chrome/Edge + HTTP 非 localhost | 虚线橙色边框 + tooltip 提示原因 | 触发下载 | 已导出下载 |
| Firefox/Safari（任何环境） | 虚线橙色边框 + tooltip 提示原因 | 触发下载 | 已导出下载 |

**提示机制（三层递进）：**
1. **保存按钮视觉标记** — `.is-fallback` 虚线橙色边框，暗示功能受限（持久）
2. **保存按钮 tooltip** — 鼠标悬停显示降级原因和建议（持久）
3. **状态栏一次性提示** — 初始化时显示"保存受限"，被用户后续操作自然覆盖

## 变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `Dockerfile` | 修改 | Nginx 阶段新增 OpenSSL 自签名证书生成，暴露 443 端口 |
| `nginx.conf` | 重写 | HTTPS:443 主服务 + HTTP:80 → 301 重定向 + /healthz 健康检查 |
| `src/styles.css` | 修改 | 新增 `.toolbar-button--save.is-fallback` 降级视觉标记 |
| `src/env-context.ts` | 新建 | 环境检测 + tooltip/状态栏/按钮标记 |
| `src/main.ts` | 修改 | 导入并调用 setupEnvContext() |
| `src/documents.ts` | 修改 | 降级保存提示优化："已导出下载" + 提示查看下载目录 |

## 验证清单

- [ ] `docker build` 构建成功，Nginx 容器启动后 443 端口可访问
- [ ] 通过 HTTPS 访问时（Chrome/Edge），`window.isSecureContext === true`，File System Access API 可用，Banner 不显示
- [ ] 通过 HTTP 非 localhost 访问时（Chrome/Edge），Banner 显示"HTTP 非安全上下文"文案
- [ ] 通过 Firefox/Safari 访问时（任何环境），Banner 显示"浏览器不支持"文案
- [ ] Chrome/Edge + localhost 开发环境：Banner 不显示，完整功能可用
- [ ] Banner 关闭后刷新页面不再出现
- [ ] Ctrl+S 在降级模式下触发下载，状态栏显示"已导出下载"
- [ ] 保存按钮 tooltip 在降级模式下显示"导出下载 (Ctrl+S)"
- [ ] /healthz 端点返回 200

## 遗留与后续

- **生产部署方案**：建议提供 `docker-compose.yml` + Caddy 配置，自动获取 Let's Encrypt 证书（方案 D）
- **Safari / Firefox**：这两个浏览器不支持 File System Access API，即使在 HTTPS 下也走 Fallback 路径，Banner 同样会显示
- **自定义证书挂载**：可通过 Docker volume 挂载用户自己的证书替换自签名证书：
  ```bash
  docker run -v /path/to/cert.crt:/etc/nginx/ssl/selfsigned.crt \
             -v /path/to/cert.key:/etc/nginx/ssl/selfsigned.key \
             -p 443:443 alphatab-realtime-editor
  ```
