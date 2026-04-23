# 简谱 Ghost 可视化 & 低音点移到时值线下方

> 本文档记录两个相关改动的设计与实施，两者共享一套"启动期运行时 patch"基础设施，放同一文档便于维护。
>
> - **需求 1**：在简谱中用 Ghost Note（括号形式）来标识过渡音 / 经过音，与 tab、五线谱视觉语义对齐
> - **需求 2**：修复简谱带低音点的 beat 时值横线与其它 beat 对不齐的问题（低音点移至时值线下方）

## 1. 需求背景

### 1.1 需求 1：旋律音 vs 过渡音

| 视图 | 现状 | 目标 |
|---|---|---|
| Tab | `isGhost` 显示为 `(5)` 括号 | ✅ 无需改 |
| 五线谱（Score） | `isGhost` 显示符头加括号 | ✅ 无需改 |
| **简谱（Numbered）** | **`isGhost` 无任何视觉区分** | **❌ → 显示为 `(3)` 括号** |

结论：**复用 alphaTab 现有 `Note.isGhost` 语义**表达"过渡音 / 经过音"，
alphaTex 语法已支持（音符级别的 `g` 修饰），只需在简谱渲染器把 Ghost 可视化补齐。

### 1.2 需求 2：时值横线对不齐

简谱中时值 < 四分音符时，数字下方画时值横线（八分 1 条，十六分 2 条，等等）。

当前渲染逻辑（`NumberedBarRenderer.getFlagBottomY`）：

```
bar_start_y = container.getBoundingBoxBottom() + barHeight
```

而 `container.getBoundingBoxBottom()` 会把 **低音点（octaveDots < 0）** 所占高度算进去。
结果：**同一小节里有低音点的 beat 容器更高，时值横线起点更低**，
与相邻没低音点的 beat 的横线**纵向错位**，视觉参差不齐。

**只在同一 beam 组内** alphaTab 会通过 `calculateBeamYWithDirection` 取 max 对齐，
**跨 beam 组 / 独立 flag beat** 则各画各的，这就是问题现象的根源。

## 2. 方案

### 2.1 整体策略

**运行期 monkey patch**（参考 `lyrics-below-numbered-staff` 同款手法），
先在 realtime-editor 内验证效果，稳定后再考虑推回 alphaTab 核心。

- 优点：零侵入上游；回滚只要移除 patch 调用
- 缺点：依赖 alphaTab `@internal` 类名/方法名；通过 `staffId` 等稳定锚点定位降低耦合
- 约束：realtime-editor 通过 vite alias 直接 import `packages/alphatab/src`，
  所以 `@internal` 标记**不会**被 d.ts 裁剪

### 2.2 需求 1 方案：NumberedNoteHeadGlyph 的渲染增强

目标行为：

| Note 状态 | 原渲染 | 新渲染 |
|---|---|---|
| 常规 | `3` | `3` |
| `isGhost === true` | `3` | `(3)` |
| 休止符（isRest） | `0` | `0`（不加括号） |
| Dead note | `X` | `X`（不加括号） |

#### Patch 点选择对比

| 方案 | 说明 | 评价 |
|---|---|---|
| **A：替换 `NumberedNoteHeadGlyph.prototype.paint` + `doLayout`** | 猴子补丁重写 paint，在数字两侧画括号字形；doLayout 里把宽度加上括号宽度 | ⭐⭐⭐⭐⭐ 改动内聚、坐标精确、符合 alphaTab glyph 架构 |
| B：替换 `NumberedBeatGlyph.doLayout`，改 `numberWithinOctave` 字符串为 `(3)` | 用字符串拼接"伪"括号 | ❌ 括号粗细/字形与 tab 不一致；度量误差大；数字居中算错 |
| C：在 `NumberedBeatPreNotesGlyph` 前加 `GhostParenthesisGlyph`，PostNotes 后加一个 | 语义上最"正"，复用现有 Ghost 括号 Glyph | ⚠️ alphaTab 现有 Ghost 括号偏大（按符头高度），简谱数字偏小，视觉不协调；且需要同时 patch pre + post 两个位置 |

**采用方案 A**，重写 `NumberedNoteHeadGlyph` 的 `doLayout` 和 `paint`：

- `doLayout`：如果 `_beat.notes[0].isGhost`，把宽度加上两侧括号的文本测量宽度
- `paint`：在数字两侧 `fillText('(', ...)` / `fillText(')', ...)`，字号复用 `numberedNotationFont` / `numberedNotationGraceFont`
- 括号颜色复用 `NoteSubElement.NumberedNumber` 当前的 style（继承数字颜色）

#### 关键代码位置（patch 目标）

- `packages/alphatab/src/rendering/glyphs/NumberedNoteHeadGlyph.ts`
  - `doLayout()` 第 77-104 行：宽度计算
  - `paint()` 第 47-75 行：绘制逻辑

### 2.3 需求 2 方案：低音点移到时值线下方

目标：将低音八度点从「数字与时值线之间」移到「时值线下方」，使时值线紧贴数字、全局统一对齐。高音点保持在数字上方不变。

#### 方案演进

| 迭代 | 方案 | 说明 | 结果 |
|---|---|---|---|
| v1 | Bar 级统一 baseline | 重写 `getFlagBottomY`，取 bar 内所有 beat 容器 bottom 最大值作为统一基准 | ❌ 用户反馈：希望时值线紧贴数字而非对齐到最低 beat |
| **v2** | **低音点下移到时值线下方** | 重写 `doLayout` / `getBoundingBoxBottom` / `calculateOverflows`，改变渲染顺序 | ✅ 采用 |

#### 最终方案 (v2) 细节

渲染结构变化（仅低音点 `octaveDots < 0` 时生效）：

```text
原来：  数字  →  低音点  →  时值线
现在：  数字  →  时值线  →  低音点
```

实现三个 Patch 点：

1. **`NumberedNoteHeadGlyph.prototype.doLayout`**：低音点的 `_octaveDotsY` 加上时值线高度偏移，使点画在线下方
2. **`NumberedNoteHeadGlyph.prototype.getBoundingBoxBottom`**：返回「数字底部」（不含低音点空间），让时值线的 Y 基于数字底部计算，所有 beat 天然对齐
3. **`NumberedBarRenderer.prototype.calculateOverflows`**：扫描被移位的低音点，将其真实 Y 注册为 overflow bottom，确保行高容纳低音点

#### 时值线高度计算

```text
barHeight = barSpacing + barCount × (barSpacing + barSize)
barCount = log2(duration) - 2   （八分=1条，十六分=2条，...）
duration ≤ Quarter → barHeight = 0（不画线）
```

#### 边界情况

| 场景 | 行为 |
|---|---|
| bar 内没有 duration < Quarter 的 beat | 低音点不偏移（barHeight = 0），行为不变 |
| bar 内没有低音点 | 所有 patch 分支跳过（`_octaveDots >= 0`），行为不变 |
| 有装饰音（grace）混入 | grace beat 有独立布局，patch 中 `calcBarHeightForBeat` 基于 beat 自身 duration 计算 |
| 多 voice | 简谱只渲染 voice 0，overflow 扫描也只处理 voice 0 |
| 高音点 + 低音点混排 | 高音点不受影响（`_octaveDots >= 0` 跳过）；低音点被移到时值线下方 |

## 3. 文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `packages/realtime-editor/src/numbered-patches.ts` | 新增 | 封装两个 patch：Ghost 可视化（`patchNumberedGhostRendering`）+ 低音点下移（`patchNumberedLowOctaveDotsBelow`），统一入口 `applyNumberedPatches()` |
| `packages/realtime-editor/src/preview.ts` | 修改 | `setupPreview()` 开头调用 `applyNumberedPatches()`（幂等，在 AlphaTabApi 创建前执行） |
| `packages/realtime-editor/docs/alphatex-guitar-syntax-suite.alphatex` | 修改 | 新增 Track 4 "Numbered Showcase"：Ghost 音 `.g` + 低音八度点混排示例，便于验收 |
| `packages/realtime-editor/docs/numbered-ghost-and-flag-alignment.md` | 新增 | 本文件 |

不改动 `packages/alphatab/**` 任何源文件。

## 4. 实施计划（Sprint 拆分）

### Sprint 1：基础设施 + Ghost 可视化

1. 新建 `numbered-patches.ts`：
   - 模块级 `patched` 防重入 flag
   - 导出 `applyNumberedPatches()` 作为总入口
   - 内部实现 `patchNumberedGhostRendering()`
2. `preview.ts` 的 `setupPreview()` 入口调用一次
3. 更新示例文档添加 ghost 案例

**验收**：`\note.g` 音符在简谱中显示为 `(数字)`，tab 谱仍为 `(fret)`，两者都有括号

### Sprint 2：低音点移到时值线下方

1. 在 `numbered-patches.ts` 中追加 `patchNumberedLowOctaveDotsBelow()`
2. 实现三个子 patch：`doLayout`（偏移低音点 Y）、`getBoundingBoxBottom`（排除低音点）、`calculateOverflows`（注册低音点溢出）
3. 示例文档补充"高低音点混合"片段

**验收**：同一小节内，低音 + 高音 + 常规音混排时，所有时值横线紧贴数字底部统一对齐，低音点显示在时值线下方

### Sprint 3（按需，未纳入本次）

- 如果 Ghost 括号的字形与 tab 视觉差异大，切换到 `GhostParenthesisGlyph` 方案（方案 C）
- 如果低音点下移后间距不理想，微调 `barSpacing` 参数
- 推回 alphaTab 核心（layout 阶段预计算会更高效）

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| alphaTab 重构 `NumberedNoteHeadGlyph` 方法签名 | patch 内做存在性检查（`if (proto.doLayout && proto.getBoundingBoxBottom)`），不满足时 `console.warn` 并跳过 |
| 高/低音点的 bounding box 计算被上游改动 | patch 不依赖 dot 的具体实现，只依赖 `getBoundingBoxBottom()` 返回值和 `_octaveDotsY` 字段 |
| overflow 计算遗漏导致低音点被裁切 | `calculateOverflows` patch 扫描所有带 `__barHeightOffset` 的 noteHead，注册溢出区域 |
| HMR / 多次初始化 | 模块级 patched flag + 方法级 `__patched_*` 标记，确保幂等 |

**回滚**：删除 `preview.ts` 里的 `applyNumberedPatches()` 调用即可完全还原 alphaTab 默认行为。

## 6. 验收标准

### Ghost 可视化

1. alphaTex 中写 `3.4.g` 或 `C4.4.g`：
   - Tab：显示 `(5)` 括号
   - 五线谱：符头加括号
   - **简谱：显示 `(3)` 括号** ← 新行为
2. 常规音符：简谱维持裸数字，不引入意外括号
3. 休止符 `r`、dead note `x`：不加括号

### 低音点下移

1. 示例：一小节 `C3 D4.8 E5.8 C3.8 | ...`（低音 + 高音点 + 混合 eighth）
   - **改前**：时值横线高低不齐（有低音点的 beat 横线被低音点顶下去）
   - **改后**：全部时值横线紧贴数字底部统一对齐，低音点显示在时值线下方
2. 回归：纯无低音点小节渲染与旧版完全一致（低音点 patch 跳过）
3. 回归：光标同步 / bounding box / 播放光标不受影响
4. 回归：高音点位置不变（仍在数字上方）

## 7. 实施状态

- [x] 需求分析与方案设计
- [x] 需求文档
- [x] Sprint 1：Ghost 可视化 patch
- [x] Sprint 1：preview.ts 接入
- [x] Sprint 1：示例补充
- [x] Sprint 2：低音点下移 patch（v2：doLayout + getBoundingBoxBottom + calculateOverflows）
- [x] Sprint 2：示例补充
- [x] Lint / 类型检查（`biome check` pass，`tsc --noEmit` pass）
- [ ] 手工验收（需要用户在浏览器中确认）

## 8. 遗留问题

- **全局副作用**：`NumberedNoteHeadGlyph.prototype`、`NumberedBarRenderer.prototype` 是跨实例共享的，patch 后全页面生效。realtime-editor 单宿主下无冲突
- **Ghost 视觉样式细节**：当前设计只加圆括号、复用数字字体字号，未改颜色；若需要"淡化"效果需额外引入 `NoteSubElement.NumberedNumber` 的样式细分或新子元素（放 Sprint 3）
- **低音点间距**：低音点与时值线之间的间距由 `barSpacing` 决定，可能需要根据视觉反馈微调
- **上游同步**：如果效果稳定，建议后续提 PR 把两个 patch 的逻辑内建到 alphaTab 核心（在 layout 阶段预计算偏移会更高效，避免运行时方法替换）
- **AST Printer 暂不需要改**：alphaTex 语法已支持 `.g`，输出端已兼容
