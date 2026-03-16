# Transport 布局优化 & 播放指示线

## 需求概述

| # | 需求 | 说明 |
|---|------|------|
| 1 | 播放指示线 | 播放时在乐谱预览上显示金色指示线，实时指示播放位置 |
| 2 | 自动滚动跟随 | 播放时默认跟随指示线自动滚动（Continuous 模式） |
| 3 | 播放器归属预览面板 | Transport 控件移入预览面板内部，不再作为全局 footer |
| 4 | 编辑模式隐藏播放区 | 纯编辑模式下 Transport 随预览面板一起隐藏 |

## 实施记录

### 已完成 ✅

#### 1. HTML 结构变更 (`index.html`)
- **改动**：将 `<footer class="transport">` 从 `#appShell` 的直接子元素移入 `#previewPane` 内部
- **效果**：Transport 成为预览面板的底部组件，编辑模式下随 `#previewPane` 一起隐藏
- **风险**：DOM ID 不变，所有事件绑定不受影响

#### 2. CSS 变更 (`src/styles.css`)
- **app-shell grid**：从 `auto auto 1fr auto`（4行）改为 `auto auto 1fr`（3行），去掉 footer 行
- **transport 样式**：增加 `border-top: 1px solid var(--line)` 顶部边框分隔 + 背景渐变
- **播放光标样式**：
  - `.at-cursor-bar`：小节高亮背景（蓝色半透明）
  - `.at-cursor-beat`：节拍指示线（金色竖线 + 发光阴影）
  - `.at-highlight *`：当前音符高亮（金色填充）
- **响应式**：小屏幕下 transport 右侧控件自动换行

#### 3. 滚动模式默认值 (`src/preview.ts`)
- **改动**：`scrollMode` 从 `ScrollMode.Off` 改为 `ScrollMode.Continuous`
- **HTML 同步**：滚动下拉框 `#scrollSelect` 的 `selected` 项同步改为 `continuous`

### 布局变化

```
改动前：
┌──────────────────────────────────┐
│           Topbar                 │
├──────────┬───────────────────────┤
│  Editor  │  Preview             │
├──────────┴───────────────────────┤
│        Transport (全局 footer)    │
└──────────────────────────────────┘

改动后：
┌──────────────────────────────────┐
│           Topbar                 │
├──────────┬───────────────────────┤
│  Editor  │  Preview Panel       │
│  Panel   │    ├─ Header         │
│          │    ├─ Stage           │
│          │    └─ Transport ◄─── │
├──────────┴───────────────────────┘
```

### 文件变更清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `index.html` | 结构移动 | Transport footer 移入 `#previewPane` 内部 |
| `src/styles.css` | 样式调整 | app-shell grid 3行 + transport 内嵌样式 + 播放光标 CSS |
| `src/preview.ts` | 配置调整 | `scrollMode: Off` → `Continuous` |
| `src/state.ts` | 无改动 | DOM 引用 ID 不变 |
| `src/transport.ts` | 无改动 | 事件绑定逻辑不变 |
| `src/main.ts` | 无改动 | 初始化顺序不变 |

## 验收标准

- [x] 播放时乐谱上出现金色指示线，随播放节拍移动
- [x] 当前小节有半透明蓝色高亮背景
- [x] 播放时默认自动滚动跟随指示线（Continuous）
- [x] 播放控制区域在预览面板底部显示
- [x] 仅编辑模式下播放控制区域不可见
- [x] 拆分模式下播放控制显示正常
- [x] 所有播放功能（播放/暂停/停止/进度拖拽/速度/缩放/布局/滚动切换）正常工作

## 布局高度修复（补充）

### 问题描述

预览面板右侧乐谱区域没有占满可用高度，底部存在明显空白；左侧编辑器面板也存在相同问题。根本原因是 **高度传递链条断裂**——从 `app-shell → workspace → panel → content` 的 flex/grid 高度未完整传递。

### 修复方案

修改 `src/styles.css`，修复 5 个关键节点：

| 选择器 | 改动 | 原因 |
|--------|------|------|
| `.panel` | 添加 `flex: 1` | 让面板在 workspace 的 flex 布局中占满可用高度 |
| `.editor-surface` | 添加 `overflow: hidden` | 确保编辑器区域在 grid 1fr 行内不溢出 |
| `.preview-stage` | 添加 `overflow: hidden` | 防止预览区域内容溢出 grid 1fr 行 |
| `.preview-card` | 添加 `display: flex; flex-direction: column; min-height: 0` | 让 scroller 子元素可以 flex 伸展占满 |
| `.preview-card__scroller` | `height: 100%` → `flex: 1; min-height: 0` | 在 flex 容器中正确占满并启用滚动 |

### 二次修复：app-shell grid 行数不匹配

**问题**：上述 5 处修复后面板仍未铺满高度。根因是 `.app-shell` 的 `grid-template-rows: auto auto 1fr` 定义了 3 行，但 `.app-shell__backdrop` 是 `position: absolute` 脱离了文档流，grid 实际只有 2 个流内子元素（`.topbar` 和 `.workspace`），导致：
- `.topbar` → 第 1 行 auto ✅
- `.workspace` → 第 2 行 auto ❌（高度由内容撑开，不占满）
- 第 3 行 1fr → 空行，白白浪费

**修复**：`grid-template-rows: auto auto 1fr` → `auto 1fr`，让 workspace 正确落在 1fr 行。

### 高度传递链路（最终修复后）

```
app-shell (100vh, grid: auto 1fr)              ← 修正为 2 行
  ├─ .topbar (auto, 第 1 行)
  └─ .workspace (1fr, 第 2 行, flex row, min-height:0)
       ├─ .panel (flex:1, min-height:0, grid: auto 1fr auto)
       │    ├─ .panel__header (auto)
       │    ├─ .editor-surface (1fr, overflow:hidden)
       │    └─ .diagnostics-panel (auto)
       └─ .panel (flex:1, min-height:0, grid: auto 1fr auto)
            ├─ .panel__header (auto)
            ├─ .preview-stage (1fr, overflow:hidden)
            │    ├─ .track-dock (sidebar)
            │    └─ .preview-card (flex column, min-height:0)
            │         └─ .preview-card__scroller (flex:1, min-height:0, overflow:auto)
            └─ .transport (auto)
```

> **注**：`.app-shell__backdrop` 是 `position: absolute`，不参与 grid 流式布局。

### 验收标准

- [ ] 两个面板完全占满 workspace 可用高度
- [ ] 预览乐谱区可滚动，底部无空白
- [ ] Transport 紧贴预览面板底部
- [ ] 编辑器代码区完全撑满
- [ ] 响应式布局不受影响

## 遗留问题

无
