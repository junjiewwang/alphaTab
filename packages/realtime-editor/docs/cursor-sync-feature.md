# 编辑器-预览光标同步功能

## 需求概述

在 realtime-editor 的分割视图模式下，实现编辑器与预览面板的光标联动：当用户在 Monaco 编辑器中移动光标到某个音符/节拍位置时，预览面板自动高亮显示对应的渲染音符。反向操作同样支持：点击预览面板中的节拍，编辑器光标自动跳转到对应的 AlphaTex 源码位置。

## 实施状态

### ✅ Phase 1 — 基础光标同步（已完成）

| 任务 | 状态 | 说明 |
|------|------|------|
| 创建 `cursor-sync.ts` 模块 | ✅ | 包含完整的映射链路 |
| 移植 `binaryNodeSearch` | ✅ | 从 LSP 包复制，避免引入重依赖 |
| 实现 AST→Score 结构索引映射 | ✅ | 支持 `\track`/`\staff`/`\voice` 指令 |
| 切换 Full 解析模式 | ✅ | `preview.ts` 中使用 `AlphaTexParseMode.Full` |
| 集成到初始化流程 | ✅ | `main.ts` 中在 editor+preview 初始化后连接 |
| TypeScript 编译通过 | ✅ | 零新增编译错误 |

### ✅ Phase 2 — 增强功能（已完成）

| 任务 | 状态 | 说明 |
|------|------|------|
| 自定义高亮样式 | ✅ | 使用独立 DOM 覆盖层 + CSS 类，区分播放高亮（蓝色）和光标同步高亮（琥珀色） |
| 双向同步 | ✅ | 点击预览面板 Beat → 反向映射 AST 偏移 → 定位编辑器光标 |
| 自动滚动到视口 | ✅ | 高亮 Beat 不在可视区域时自动平滑滚动至居中位置 |
| 播放期间自动暂停 | ✅ | 监听 `playerStateChanged`，播放时自动暂停光标同步，停止后恢复 |
| 增量 AST 索引缓存 | ✅ | `AstIndexCache` 预计算 bar→ScoreBarPosition 映射表，避免重复遍历 |
| TypeScript 编译通过 | ✅ | 零新增编译错误 |

### 🔲 Phase 3 — 后续优化（未实施）

| 任务 | 说明 |
|------|------|
| 多轨道完善 | 复杂多轨道场景下的索引映射验证 |
| 增量 AST 差分解析 | 仅重新解析变更区域的 AST，而非每次全量 Full 解析 |
| 批量 beat 高亮 | 支持编辑器选区范围对应多 beat 高亮 |
| 高亮动画增强 | 添加淡入淡出过渡动画 |

## 架构设计

### 映射链路（编辑器 → 预览）

```
Monaco Cursor Position
        │ editor.getPosition()
        ▼
  model.getOffsetAt(pos)         ← ① Monaco 原生 API
        │
        ▼
  binaryNodeSearch()             ← ② 从 LSP 包移植的二分查找
        │
        ▼
  AST Node (barIndex, beatIndex, noteIndex)
        │
        ▼
  computeScoreBarIndex()         ← ③ 桥接层（处理 \track/\staff/\voice）
  mapAstToScoreBeat()
        │
        ▼
  Score Beat
        │
        ▼
  renderSyncHighlight()          ← ④ 自定义 DOM 覆盖层高亮
        │
        ▼
  scrollBeatIntoView()           ← ⑤ 自动滚动到视口
```

### 映射链路（预览 → 编辑器）

```
Beat Click (beatMouseDown event)
        │ alphaTab 内部通过 getBeatAtPos() 解析
        ▼
  Score Beat
        │
        ▼
  mapScoreBeatToAstOffset()      ← ① 反向查找：遍历 AST bars 匹配结构索引
        │
        ▼
  AST Source Offset
        │
        ▼
  model.getPositionAt(offset)    ← ② Monaco 原生 API
  editor.setPosition(pos)
  editor.revealPositionInCenter()
```

### 模块职责

| 模块 | 职责 |
|------|------|
| `cursor-sync.ts` | 光标同步核心逻辑：AST 查找、正/反向索引映射、DOM 高亮渲染、滚动、播放暂停、索引缓存、生命周期管理 |
| `preview.ts` | 解析时使用 Full 模式保留 AST，每次解析后更新 cursorSync 数据 |
| `main.ts` | 初始化时将 editor、api、alphaTabRoot、scrollContainer 连接到 cursorSync |
| `styles.css` | 自定义高亮样式（`.at-cursor-sync-highlight`）|

### 关键设计决策

1. **自定义 DOM 覆盖层替代 `highlightPlaybackRange`**：Phase 1 使用的 `api.highlightPlaybackRange(beat, beat)` 对单 beat 高亮无效（`_cursorSelectRange` 中 `startBeat === endBeat` 会触发 early return），且与播放高亮共享 `.at-selection` 容器导致冲突。Phase 2 改用独立的 `.at-cursor-sync-overlay` 容器和 `.at-cursor-sync-highlight` CSS 类
2. **双向同步锁（`_suppressEditorSync`）**：点击预览定位编辑器时，`editor.setPosition()` 会触发 `onDidChangeCursorPosition` 回调，若不加锁会产生无限循环。通过 `_suppressEditorSync` 标志 + 延迟释放（debounce + 20ms）防止循环
3. **播放暂停分离**：`_pausedByPlayback` 标志与用户手动 `setEnabled()` 独立管理，播放结束后自动恢复，不影响用户的启用/禁用选择
4. **AST 索引缓存（`AstIndexCache`）**：预计算全部 AST bars 的 `computeScoreBarIndex` 结果，避免每次光标同步都做 O(n) 遍历。当 AST 对象引用不变时跳过重建
5. **BeatBounds 坐标对齐**：高亮矩形的 Y/H 取自 `masterBarBounds.visualBounds`（与 alphaTab 内置的 `_cursorSelectRange` 保持一致），X/W 取自 `beatBounds.realBounds` 并对首尾 beat 做边界扩展
6. **平滑滚动**：使用 `scrollTo({ behavior: 'smooth' })` 实现平滑过渡，并设置 40px 边距避免 beat 紧贴视口边缘

## 变更文件清单

### Phase 1

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/cursor-sync.ts` | 新增 | 光标同步核心模块 |
| `src/preview.ts` | 修改 | 切换 Full 解析模式、保留 AST、通知 cursorSync |
| `src/main.ts` | 修改 | 初始化时连接 cursorSync |

### Phase 2

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/cursor-sync.ts` | 重写 | 新增：自定义 DOM 高亮、双向同步、播放暂停、自动滚动、AST 索引缓存 |
| `src/styles.css` | 修改 | 新增 `.at-cursor-sync-overlay` 和 `.at-cursor-sync-highlight` 样式 |
| `src/main.ts` | 修改 | `cursorSync.init()` 新增 `alphaTabRoot` 和 `scrollContainer` 参数 |

## Bug Fix 记录

### 🔧 编辑后预览滚动到第一个音符（Phase 2.1）

**问题现象：** 通过光标同步定位到某个 beat 后，在编辑器中修改音符内容，预览面板会滚动到第一小节的第一个音符位置。

**根因分析：**

alphaTab 内部的 `_onPostRenderFinished()`（AlphaTabApiBase.ts line 3599-3611）会：
1. `this._currentBeat = null` — 重置当前 beat
2. `this._cursorUpdateTick(this._previousTick, false, 1, shouldScroll=true, forceUpdate=true)` — 以 shouldScroll=true 调用
3. `_previousTick` 默认为 `0`（用户从未播放时），对应第一个 beat
4. `_cursorUpdateBeat` 通过 `uiFacade.beginInvoke()`（即 setTimeout/rAF）**异步排队** `_internalCursorUpdateBeat`
5. `_internalCursorUpdateBeat` 中非播放状态时 shouldScroll 不被覆盖 → `ScrollHandler.onBeatCursorUpdating()` → `scrollToY(第一个 beat 的 y 坐标)`
6. 异步排队意味着这个滚动发生在 `postRenderFinished.trigger()` **之后**

时序链路：
```
_onPostRenderFinished()
  → _cursorUpdateTick() → _cursorUpdateBeat() → beginInvoke(异步排队 scrollToY)
  → trigger(postRenderFinished) → 我们的 _restoreViewportAfterRender() 执行
  → [下一帧] 异步排队的 scrollToY 执行 → 覆盖我们恢复的 scrollTop！
```

**迭代历程：**

| 迭代 | 方案 | 问题 |
|------|------|------|
| v1 | 单点恢复（postRenderFinished 同步恢复 scrollTop） | alphaTab 异步 scrollToY 在我们之后执行，覆盖恢复值 |
| v2 | scroll 事件守卫（单向，仅防归零） | alphaTab 滚动目标不是 0 而是第一个 beat 的 y 坐标，无法拦截 |
| v3 | scroll 事件守卫（双向锁定 + 2帧rAF延迟释放） | 守卫生命周期与用户交互重叠，阻断了正常的光标同步滚动（键入空格→scrollBeatIntoView 被拦截） |
| **v4（当前）** | **纯延迟恢复（2帧 rAF 延迟，无守卫）** | ✅ 不阻断正常交互，可能有极短暂视觉闪烁 |

**最终修复方案（纯延迟恢复）：**

- `_saveViewportBeforeRender()`：仅保存视口快照（scrollTop、lastBeatId、cursorOffset），**不安装任何 scroll 事件监听**
- `_restoreViewportAfterRender()`：在 `postRenderFinished` 回调中**不立即恢复**，而是通过 2 帧 rAF 延迟执行
- 延迟回调中：恢复 scrollTop + 重新映射并高亮 beat

**关键原理：**
alphaTab 的异步 `scrollToY` 是通过 `beginInvoke(setTimeout/rAF)` 排队的，我们的 2 帧 rAF 延迟确保在它**之后**执行，从而覆盖它。而正常的光标同步滚动（用户后续键入触发的 `scrollBeatIntoView`）不会被阻断，因为我们没有持续监听/拦截 scroll 事件。

**设计决策：**
- 无 scroll 事件守卫 → 不阻断任何正常滚动交互（光标同步、用户手动滚动）
- 2 帧 rAF 延迟 → `beginInvoke` 通常是 setTimeout(0) 或 rAF，2 帧确保足够覆盖
- 闭包捕获引用 → 避免延迟回调执行时 this 引用已变化
- 整个修复完全在 `cursor-sync.ts` 内部闭环，零侵入 alphaTab 核心代码

**变更文件：**
| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/cursor-sync.ts` | 修改 | 移除 `_scrollGuardHandler` 字段和 `_removeScrollGuard()` 方法；简化 `_saveViewportBeforeRender()` 为纯快照保存；重写 `_restoreViewportAfterRender()` 为 2 帧 rAF 延迟恢复 |

## 遗留问题

1. **多轨道映射准确性**：`computeScoreBarIndex` 中对 `\track`/`\staff`/`\voice` 的索引推算基于 AST 的线性遍历，复杂场景（如 `\track` 后接 `\staff` 再接 `\voice`）需要更多测试验证
2. **Full 模式性能影响**：理论上 Full 模式比 ForModelImport 稍慢（需要记录完整位置信息），但在已有 220ms debounce 下影响可忽略
3. **反向映射性能**：`mapScoreBeatToAstOffset` 当前采用线性遍历 AST bars 匹配结构索引，对于大型乐谱可能需要优化为基于缓存的查找
4. **高亮精度**：自定义覆盖层的坐标基于 BoundsLookup 的缓存数据，在渲染过程中可能短暂不同步（已通过 `_renderReady` 守卫缓解）
5. **增量 AST 差分解析未实现**：当前每次文本变更仍然全量重解析 AST，仅在索引缓存层面做了增量优化。真正的增量 AST 解析需要修改 AlphaTexImporter，留待 Phase 3
