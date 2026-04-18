# 光标同步 · 多谱样式点击定位

## 需求背景

`realtime-editor` 的预览面板支持多种谱样式（五线谱 / 吉他 tab 6 线谱 / 简谱）。
当一条 `\track` 同时开启多个 staff 时（例如既展示 tab 又展示简谱），用户期望：

- 点击 **tab 6 线谱** 的音符 → 编辑器光标定位到对应 `\staff { tuning ... }` 段的源码
- 点击 **简谱** 的音符 → 编辑器光标定位到对应 `\staff { tuning numbered }` 段的源码

改动前的实际行为：
- 无论点击哪种谱样式，光标都跳到**第一个 staff**（tab 段）的源码位置。

## 根因分析

alphaTab 的鼠标事件管线：

```
canvas.mouseDown
  → boundsLookup.getBeatAtPos(relX, relY) → Beat
  → beatMouseDown.trigger(Beat)
```

`beatMouseDown` 事件只携带 `Beat` 对象，不携带"点击位置所属的 BarRenderer/Staff"。
而在 Score 数据模型中，**同一个小节的多种渲染（tab/简谱/五线）共享同一组 `Beat`
实例，这些 `Beat` 始终绑定到第一个 staff**（`beat.voice.bar.staff.index === 0`）。

因此 `mapScoreBeatToAstOffset` 中通过 `beat.voice.bar.staff.index` 得到的 staff
索引永远是 0，AST 反向查找到的自然是第一个 `\staff` 段的源码偏移。

## 方案

**方案选择**：在鼠标事件 capture 阶段捕获点击坐标，用 `BoundsLookup` 的
`StaffSystemBounds → MasterBarBounds → BarBounds` 层级结构反查命中的 `Staff.index`，
在 `_syncPreviewToEditor` 中作为 `staffIndexOverride` 传给 `mapScoreBeatToAstOffset`。

**为什么不改 alphaTab 源码扩充 `beatMouseDown` 事件数据**？
- 侵入上游接口（破坏兼容性），后续升级困难
- realtime-editor 侧改动可控（仅本包内），完全通过公开 API 即可实现

### 数据流

```
mousedown (capture 阶段)
  → canvasHost.getBoundingClientRect() 计算 relX/relY
  → findStaffIndexAtPos(api, relX, relY)
       遍历 lookup.staffSystems
         → system.findBarAtPos(relX) 定位 MasterBar
         → masterBar.bars 中按 Y 匹配 BarBounds
         → 返回 barBounds.bar.staff.index
  → 暂存到 _lastClickedStaffIndex

beatMouseDown.trigger(beat)
  → _syncPreviewToEditor(beat)
       → 读取并立即清空 _lastClickedStaffIndex
       → mapScoreBeatToAstOffset(beat, ast, staffIndexOverride)
         以 staffIndexOverride 覆盖 beat.voice.bar.staff.index
       → editor.setPosition(position)
```

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/cursor-sync.ts` | 新增 `findStaffIndexAtPos` 函数；`mapScoreBeatToAstOffset` 新增 `staffIndexOverride` 形参；`CursorSyncManager` 新增 `_lastClickedStaffIndex` + `_rootMouseDownHandler` 字段；`init()` 注册 alphaTabRoot 的 mousedown capture 监听；`_syncPreviewToEditor` 使用暂存的 staff 索引；`dispose()` 清理监听器 |
| `docs/cursor-sync-multi-staff.md` | 本文档 |

## 实现要点

### 1. `findStaffIndexAtPos` 的 Y 容错

- 精确匹配：Y 落在某个 `barBounds.visualBounds` 的 `[y, y+h]` 区间内 → 直接返回
- 容错匹配：Y 落在 effect band 或谱间空隙（任一 BarBounds 都不包含）→ 取 Y 距离最近的 staff

### 2. 点击状态的生命周期

- 在 `mousedown` 的 capture 阶段（`useCapture = true`）写入 `_lastClickedStaffIndex`
- 在 `_syncPreviewToEditor` 的入口**立即清空**，即使后续 `mapScoreBeatToAstOffset` 返回 null 也不残留
- 每次点击都是独立一次生命周期，不会出现"上次点击的 staff 影响下次同步"

### 3. 双向同步锁的兼容性

既有的 `_suppressEditorSync` 机制不受影响：
- 预览→编辑器路径（mousedown）不触发 `onDidChangeCursorPosition` 之前的逻辑
- 编辑器→预览路径（键盘光标移动）不会设置 `_lastClickedStaffIndex`

### 4. 回退策略

以下场景 `findStaffIndexAtPos` 返回 `null`，调用方退回到 `beat.voice.bar.staff.index`（原行为）：
- `api.boundsLookup` 未就绪（渲染前点击）
- `canvasElement` 不可用（DOM 异常）
- 坐标不在任一 `staffSystem` 范围内（canvas 外侧）

## 验收标准

1. ✅ 光标能精确定位到 tab staff 对应源码（点击 tab 音符时）
2. ✅ 光标能精确定位到 numbered staff 对应源码（点击简谱音符时）
3. ✅ 五线谱 + tab 混合渲染时，点击五线谱音符定位到五线 staff
4. ✅ 单 staff 场景（例如纯 tab）保持原行为，无任何退化
5. ✅ 播放期间（`_pausedByPlayback = true`）不触发光标同步，也不残留 staff 索引
6. ✅ `dispose()` 能完整清理 mousedown 监听器

## 遗留问题 / 潜在风险

- **跨平台触控事件**：当前仅监听 `mousedown`。若未来支持移动端手势（touchstart），
  需要补充 touch 事件的坐标捕获逻辑。
- **Shadow DOM 场景**：如果 alphaTab 被嵌入 Shadow DOM 内部，
  `alphaTabRoot.addEventListener` 仍在 host 上监听可能收不到 composed 事件 —— 现有
  realtime-editor 并未使用 Shadow DOM，暂不处理。
- **boundsLookup 异步更新**：在重渲染的极短窗口内点击可能出现 `findStaffIndexAtPos`
  返回 null（boundsLookup 尚未 finish）。此时会回退到 `beat.voice.bar.staff.index = 0`，
  属于可接受的降级。
