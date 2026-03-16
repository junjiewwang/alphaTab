# 页面加载白屏优化

## 需求背景

在资源（JS module、CSS、Monaco Editor、WASM 等）未加载完成时，页面呈现白屏状态，对用户体验不友好。

## 问题分析

| 问题 | 原因 |
|------|------|
| 白屏 | CSS 通过 JS module `import './styles.css'` 加载，JS 未解析完则无样式 |
| 无反馈 | 整个初始化过程（Monaco + WASM + LSP）可能耗时数秒，无加载指示 |
| 闪烁 | 主界面在未完全初始化前就展示，导致布局闪动 |

## 优化方案

采用 **内联关键 CSS + Loading Overlay + 渐进显示** 策略：

### 1. 内联关键 CSS（index.html `<head>`）

在 `<head>` 中内联极少量关键 CSS：
- 设置 `html, body` 背景为深色渐变，消除白屏
- `.app-shell` 初始 `opacity: 0`，防止未初始化 UI 闪现
- `.app-shell.is-ready` 触发 `opacity: 1` 渐入

### 2. Loading Overlay（index.html `<body>` 最前面）

添加一个轻量的 loading overlay：
- 固定全屏覆盖，`z-index: 9999`
- 包含旋转 spinner + "正在加载编辑器…" 文案
- 与页面背景颜色一致，视觉上无跳跃

### 3. JS 初始化完成后渐入（main.ts）

`initialize()` 函数完成后调用 `dismissLoading()`：
- 给 `.app-shell` 添加 `.is-ready` class 触发渐入
- loading overlay 淡出后从 DOM 移除
- 即使初始化失败也会显示界面（让用户看到错误信息）
- 设有 400ms 兜底 timeout，确保 `transitionend` 未触发时也能移除

### 4. styles.css 同步更新

在 `styles.css` 的 `.app-shell` 规则中也添加了 `opacity: 0` 和 `transition`，与内联 CSS 保持一致。新增 `.app-shell.is-ready` 选择器。

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `index.html` | `<head>` 添加内联关键 CSS；`<body>` 添加 loading overlay |
| `src/main.ts` | `initialize()` 完成/失败时调用 `dismissLoading()` |
| `src/styles.css` | `.app-shell` 添加 opacity 过渡；新增 `.is-ready` 状态 |

## 实施状态

- [x] index.html: 内联关键 CSS + Loading Overlay
- [x] styles.css: app-shell 渐入过渡样式
- [x] main.ts: 初始化完成后移除 loading 并显示主界面

## 遗留问题

- 暂无
