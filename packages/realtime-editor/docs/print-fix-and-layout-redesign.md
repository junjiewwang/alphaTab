## 打印空白页修复 & 页面布局重新设计

### 需求背景

1. **打印按钮点击后显示空白页**：之前提交的版本可以正常打印，当前版本点击后弹出的新窗口内容为空白
2. **页面布局不友好**：当前布局层级过多、信息冗余，需要重新设计为美观、简洁、对用户友好的三区布局

---

### 问题一：打印空白页

#### 根因分析

`printCurrentPreviewSnapshot()` 通过 `dom.alphaTabRoot.cloneNode(true)` 克隆整个 `#alphaTab` DOM 树到新窗口。但之前修复白屏时重构了 `clearPreview()`，现在 `#alphaTab` 内部结构变了：

- `.at-cursors`（cursor 层，`position: absolute; z-index: 1000`）
- `.at-surface`（主画布，alphaTab 内部管理的 canvas 元素）

克隆到打印窗口后存在几个问题：

1. `.at-cursors` 是绝对定位 + 高 z-index 的空 cursor 层，盖在内容上方
2. `window.open('', '_blank', 'noopener,noreferrer')` — `noopener` 可能在部分浏览器下导致 `printWindow.document` 访问受限
3. 克隆的 `<link rel="stylesheet">` 中的相对路径 CSS 在 `about:blank` 窗口下无法解析
4. `.at-surface` 内部 SVG 子节点的绝对定位依赖父容器约束，打印窗口中缺少正确的容器宽度

#### 修复方案

| 改动点 | 说明 |
|--------|------|
| 只克隆 `.at-surface` | 不再 `cloneNode` 整个 `#alphaTab`，只取主画布 |
| 移除 `noopener,noreferrer` | `window.open('', '_blank')` 确保可访问新窗口 document |
| 只复制内联 `<style>` | 跳过 `<link rel="stylesheet">`，避免相对路径在 about:blank 下加载失败 |
| 锁定克隆体宽度 | `surface.getBoundingClientRect().width` 固定宽度避免打印窗口重排 |
| 设置 `position: relative; overflow: visible` | 确保 SVG 子节点正确定位和显示 |

#### 状态：✅ 已完成

---

### 问题二：页面布局优化

#### 设计目标

- 三区布局：上方工具栏/状态栏、编辑区、预览区
- 极致压缩非核心区域，最大化编辑和预览空间
- 美观、简洁、对用户友好

#### 布局结构（改造后）

```
┌──────────────────────────────────────────────────────────────────┐
│  Topbar（单行）                                                    │
│  [品牌] [标签页…] [+📂📋⬇🖨] │ [拆分|编辑|预览] [状态胶囊]      │
├─────────────────────┬──┬─────────────────────────────────────────┤
│  Editor Panel       │G │  Preview Panel                           │
│  ┌─infobar────────┐ │U │  ┌─preview-card───────────────────────┐ │
│  │ 标题 | 副标题   │ │T │  │ [浮动轨道抽屉]                     │ │
│  └────────────────┘ │T │  │                                     │ │
│  ┌─editor-surface─┐ │E │  │     alphaTab 乐谱渲染区             │ │
│  │  Monaco Editor  │ │R │  │                                     │ │
│  │                 │ │  │  │                                     │ │
│  └────────────────┘ │  │  └─────────────────────────────────────┘ │
│  ┌─diagnostics───┐  │  │  ┌─transport (精简单行)─────────────────┐│
│  └───────────────┘  │  │  │ ▶ ■ 00:00 ━━━━━━━━ 1× 100% Parch. ││
│                     │  │  └──────────────────────────────────────┘│
└─────────────────────┴──┴─────────────────────────────────────────┘
```

#### 关键改动

| 区域 | 改动 |
|------|------|
| **Topbar** | 合并品牌标题 + 文档标签栏 + 工具按钮 + 视图切换 + 状态胶囊为单行；工具按钮改为纯图标（SVG icon） |
| **编辑器面板** | 移除 "Script / AlphaTex 编辑器" panel header，改为紧凑 infobar（标题 + 副标题 + 摘要） |
| **预览面板** | 移除 "Preview / 实时乐谱预览" panel header；轨道面板从 grid 侧边栏改为绝对定位浮动抽屉（默认收起，点击展开） |
| **Transport** | 从 grid 三列改为 flex 单行；`<label>` + `<select>` 改为内联 `<select class="toolbar-select">`；≤1320px 隐藏设置 select |
| **App Shell** | 从三行 grid (`auto auto 1fr`) 改为两行 (`auto 1fr`)；减少 padding 和 gap |

#### 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `toolbar.ts` | 修复 | 打印克隆逻辑重写 |
| `index.html` | 重构 | 合并 topbar + 标签栏；移除 panel header；工具按钮改图标；transport 精简 |
| `styles.css` | 重构 | 两行 grid；单行 topbar；浮动轨道抽屉；flex transport；移除 toolbar-field |
| `state.ts` | 调整 | trackDock 选择器从 `.track-dock` 改为 `#trackDock` |
| `main.ts` | 调整 | setupTrackDockToggle 从 `is-collapsed` 改为 `is-expanded` 模式 |

---

### 实施进展

- [x] 修复打印空白页（toolbar.ts）
- [x] 页面布局重构：HTML 结构（index.html）
- [x] 页面布局重构：CSS 样式（styles.css）
- [x] 页面布局重构：JS 适配（state.ts, main.ts）
- [x] TypeCheck 编译验证（tsc --noEmit 通过）
- [x] 更新文档

### 遗留问题 / 风险

- 需要浏览器实际验证打印效果（不同浏览器的打印行为可能有差异）
- 轨道浮动抽屉在极窄预览面板下可能遮挡部分内容
- 移动端（≤640px）轨道抽屉已隐藏，不受影响

---

## 第二轮修复（2026-04-03 11:14）— 初步尝试

> 初步尝试修复编辑区域被覆盖和打印效果问题，但修复不够彻底。

- 修改了 grid-template-rows 为 `minmax(0, auto)` 和 `.diagnostics-panel` 加 `overflow: hidden` — 编辑器仍不显示
- 添加了 `max-width` + `margin: 0 auto` 居中和 `@page` 规则 — 打印效果仍有差距

---

## 第三轮彻底修复（2026-04-03 11:23）

### 问题三（彻底修复）：编辑区域完全不可见

#### 现象

编辑器面板中，Monaco 编辑区（`.editor-surface`）高度坍缩为零。诊断面板展开状态下完全占据了编辑器面板的可见空间。

#### 根因深入分析

1. **诊断面板默认展开**：HTML 中 `<section class="diagnostics-panel">` 没有 `is-collapsed` class，初始即为展开状态
2. **展开时 body 高度大**：`.diagnostics-panel__body` 的 `max-height: 220px` + toggle 高度 ≈ 260px，在 grid `auto` 行中占据大量空间
3. **面板缺少 `height: 100%`**：`.panel` 使用 `flex: 0 0 auto`，虽然 workspace 的 `align-items: stretch` 理论上应拉伸面板高度，但缺少显式 `height: 100%` 导致 grid 容器的高度不确定，使 `1fr` 行无法正确计算剩余空间
4. **editor-surface 无保底高度**：`min-height: 0` 允许编辑器被压缩到零

#### 修复方案（三管齐下）

| 改动点 | 文件 | 说明 |
|--------|------|------|
| 诊断面板默认折叠 | `index.html` | `<section class="diagnostics-panel is-collapsed">`，`aria-expanded="false"` |
| 面板 `height: 100%` | `styles.css` | `.panel--editor` 和 `.panel--preview` 都加 `height: 100%`，确保 grid 容器高度确定 |
| 编辑器保底高度 | `styles.css` | `.editor-surface { min-height: 120px }` 防止被压缩到 0 |
| 诊断面板最大高度限制 | `styles.css` | `.diagnostics-panel { max-height: 260px }` 防止展开时抢占过多空间 |

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `index.html` | 诊断面板默认折叠 |
| `src/styles.css` | 面板 height + editor-surface min-height + diagnostics max-height |

#### 状态：✅ 已完成

---

### 问题四（彻底修复）：打印效果不好，未匹配预览

#### 现象

打印输出内容左对齐、尺寸不适配、视觉效果与预览区有明显差距。

#### 根因深入分析

1. 之前仅用 CSS `max-width` + `margin` 居中，但 `.at-surface` 内部 SVG 使用绝对定位，简单的 CSS 居中无法正确处理
2. 未考虑乐谱宽度可能超过 A4 纸张可打印区域的情况
3. 打印样式过于简陋，没有复刻预览区的视觉品质

#### 修复方案（完全重写打印函数）

| 改动点 | 说明 |
|--------|------|
| A4 纸张适配 | `@page { size: A4; margin: 12mm }` 计算可打印宽度 718px，自动计算缩放比例 |
| `transform: scale()` 缩放 | 用 CSS transform 缩放替代 max-width 裁剪，保持 SVG 绝对定位的正确性 |
| wrapper 居中 | `.print-surface-wrapper` 设置 `margin: 0 auto` + `transform-origin: top center` |
| 复刻预览视觉 | 暖色背景 `#f5f0e6`、白色乐谱卡片、圆角、阴影、Noto Serif 标题字体 |
| 标题区域美化 | 居中标题 + 副标题 + 分隔线 |
| 打印模式优化 | `@media print` 中移除装饰效果（阴影、圆角），保持内容缩放和居中 |
| 锁定原始宽高 | 同时锁定克隆体的 width 和 height，避免打印窗口重排 |

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `src/toolbar.ts` | `printCurrentPreviewSnapshot()` 完全重写 |

#### 状态：✅ 已完成

---

### 完整实施进展

- [x] ~~打印空白页修复（第一轮）~~
- [x] ~~页面布局重构（第一轮）~~
- [x] ~~编辑区域被覆盖初修（第二轮 - 不够彻底）~~
- [x] ~~打印居中初修（第二轮 - 不够彻底）~~
- [x] 编辑区域显示 — 彻底修复（第三轮）
- [x] 打印效果 — 完全重写匹配预览（第三轮）
- [x] 更新文档

---

## 第四轮布局修复（2026-04-03 12:50）— 编辑区高度与仅预览铺满

### 新问题复盘

#### 现象 A：编辑页面中诊断区域把编辑区域挤得很不友好

运行态排查显示，这个问题**不只是诊断区高度过大**，而是编辑面板的主内容区高度分配已经失真：

- `#editorPane` 总高度正常
- `.editor-surface` 在运行态只剩约 120px 高度
- 即使临时隐藏 `.diagnostics-panel`，`.editor-surface` 也不会恢复

#### 现象 B：切换到“仅预览”后，预览没有铺满可用宽度

运行态排查显示，`#workspace` 已进入 `data-view="preview"`，但 `#previewPane` 仍然保留了 split 状态下的缩窄宽度，没有接管整个工作区。

### 根因分析

1. **编辑面板布局契约失真**
   - `panel--editor` 仍依赖固定 grid 行模板；
   - 但运行时会动态插入 `.editor-action-bar`，再叠加可选的示例横幅，导致 grid 行分配与真实 DOM 结构不再稳定匹配；
   - 最终 `1fr` 没有稳定落到 `.editor-surface` 上，编辑区被压缩为最小保底高度。

2. **单视图模式仍受 split 宽度约束**
   - `setViewMode('preview')` / `setViewMode('editor')` 依旧沿用 split 的宽度体系；
   - CSS 只隐藏了另一侧面板，但没有让存活面板接管剩余空间；
   - 因此“仅预览 / 仅编辑”仍会保留 split 时的缩窄宽度。

3. **预览重排时机依赖容器先铺满**
   - alphaTab 的重排本身没有坏；
   - 真正的问题是预览容器没有先扩展到正确宽度，导致后续 reflow/render 拿到的仍是错误布局基线。

### 本轮修复目标

- [ ] 将编辑 / 预览面板改为更稳定的纵向布局容器，确保主内容区稳定吃到剩余空间
- [ ] 让“仅编辑 / 仅预览”模式下的存活面板真正铺满 workspace
- [ ] 保持 split 模式拖拽行为不变
- [ ] 完成类型检查与浏览器复测

### 当前实施进展

- [x] 浏览器运行态复现问题
- [x] 完成根因定位
- [x] 开始代码修复
- [ ] 完成验证并更新文档

---

## 第五轮打印修复（2026-04-03 13:07）— 回退到 alphaTab 原生打印接口

### 背景

在当前工作台版本里，打印入口仍走自定义快照打印函数，逻辑链路较长，包含：

- 手动克隆 `.at-surface`
- 自建 `window.open()` 打印窗口
- 手动拼接打印样式和 DOM 结构
- 等待字体后再触发 `print()`

这条链路虽然可控，但对运行时 DOM、弹窗策略和样式同步更敏感，稳定性不如 alphaTab 自带的打印能力。

### 本轮调整

- [x] 打印按钮改为使用 `state.api.print()`
- [x] 打印前增加 `state.api` 与当前乐谱存在性守卫
- [x] 打印前补充“正在准备打印”的状态提示
- [x] 关闭 `core.useWorkers`，保持打印过程更稳妥
- [x] 删除旧的 `printCurrentPreviewSnapshot()` 自定义快照打印函数

### 验证结果

- [x] `npm run typecheck --workspace=packages/realtime-editor`
- [x] `npm run build --workspace=packages/realtime-editor`
- [ ] 浏览器中点击打印按钮做人工确认

### 遗留说明

- 当前打印实现已统一收敛到 alphaTab 原生接口，后续若还需定制打印样式，应基于单一路径扩展，避免再次维护两套打印逻辑。
