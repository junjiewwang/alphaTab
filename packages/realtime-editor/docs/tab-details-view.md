# 标签页「查看详情」能力

## 背景

用户反馈：当前标签页上只能看到文件名 + 脏标记圆点，想"看到打开的文件的具体路径，好定位查看"。

## 浏览器端硬限制（前置说明）

realtime-editor 是**纯浏览器前端**，浏览器安全模型下**无法获取**文件在本地磁盘的真实绝对路径：

- `<input type="file">`：`file.name` 只含文件名，路径是 `C:\fakepath\xxx` 或被剥离
- File System Access API（`showOpenFilePicker`）：返回 `FileSystemFileHandle`，**只暴露 `.name`**，**没有 API 暴露绝对路径**
- 目录句柄可以给出"相对路径"，但需要改造打开流程

所以目标从"展示绝对路径"**调整为**：展示尽可能丰富的可定位/可辨识信息，并提供一键复制手段。

## 能展示的信息清单（数据均已在 `WorkspaceDocument` 中）

| 信息 | 来源 | 备注 |
|---|---|---|
| 文件名 | `displayName` | 含扩展名 |
| 来源类型 | `sourceKind` | new / text-file / imported-file / example / restored |
| 来源描述 | `scoreSubtitle` | 首次创建时设置的人类可读来源 |
| 乐谱标题 / 副标题 | `scoreTitle` / `scoreSubtitle` | |
| 字符数 / 行数 | `model.getValue().length` / `model.getLineCount()` | 运行时计算 |
| 内存 URI | `model.uri.toString()` | 即 `inmemory://alphatab/doc-xxxx.alphatex` |
| 脏状态 | `isDirty` | |
| 文件句柄状态 | `fileHandle`/`hasFileHandle` | 关联的本地文件名（仅 handle.name） |
| 最后修改时间 | **新增 `lastModifiedAt`** | 每次 `handleActiveDocumentContentChanged` 更新 |
| 最后保存时间 | **新增 `lastSavedAt`** | `markActiveDocumentSaved` / 文件句柄写回时更新 |

## 设计决策

| 决策 | 选择 | 原因 |
|---|---|---|
| D1 触发方式 | `⋯` 菜单「查看详情」项 | 避免与重命名双击、hover tooltip 冲突 |
| D2 卡片形态 | 浮动卡片（`position: fixed`） | 复用 `positionTabActionMenu` 定位能力，沿用既有视觉 |
| D3 时间戳 | 记录 `lastModifiedAt` / `lastSavedAt` | 数据侧小改，对后续功能（如脏态提示改进）都有价值 |
| D4 目录打开 | 暂不做 | 工程量中等，等有明确多目录管理需求再考虑 |
| D5 title tooltip | 同步升级为多行摘要 | hover 就能一眼看，不用点菜单 |
| D6 复制按钮 | 2 个：复制 URI / 复制文件名 | 覆盖定位场景，"复制全文"容易误触 |

## 架构

```
documents.ts                    tab-details-card.ts (新)
  openTabActionMenu  ───┐          ├─ openTabDetailsCard(tab, doc)
    [新增] 查看详情 ───→│  调用     │
                        └─→        ├─ buildTabDetailsSections(doc)
                                   ├─ positionCardAnchoredTo(el)
                                   └─ 渲染 + 关闭 + 复制按钮

documents.ts                    types.ts
  handleActiveDocumentContentChanged  →  WorkspaceDocument 新增
  markActiveDocumentSaved             →  lastModifiedAt / lastSavedAt
  createDocument                      →  WorkspaceDocumentSnapshot 同步
  saveActiveDocumentAs / saveActiveDocument → markActiveDocumentSaved 已覆盖
```

## 卡片内容分区

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 gtp-01.alphatex                 ● 未保存
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
基本信息
  来源       已从文件系统打开 (text-file)
  乐谱标题   交响曲第一乐章
  副标题     已从文件系统打开
内容
  大小       12,345 字符 / 245 行
  保存状态   有未保存修改
标识
  URI        inmemory://alphatab/doc-1729...alphatex
  本地文件   gtp-01.alphatex（刷新后可能需重新授权）
时间
  修改       2026-04-20 11:35:12
  保存       2026-04-20 11:32:05
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 [复制 URI]  [复制文件名]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 实施任务清单（已完成 ✅）

- [x] 1. `types.ts`：`WorkspaceDocumentSnapshot` + `WorkspaceDocument` 增加 `lastModifiedAt?: number` / `lastSavedAt?: number`（毫秒时间戳）
- [x] 2. `documents.ts`：
  - `createDocument` 初始化 `lastModifiedAt = lastSavedAt = Date.now()`
  - `handleActiveDocumentContentChanged` 更新 `lastModifiedAt`
  - `markActiveDocumentSaved` 更新 `lastSavedAt`
  - `restoreDocument` 透传快照字段（缺失时 fallback 到 `Date.now()`）
- [x] 3. `workspace-storage.ts`：`toSnapshot` 带上两个时间戳
- [x] 4. 新增 `tab-details-card.ts`：
  - `openTabDetailsCard(anchor, documentId)` / `closeTabDetailsCard()`
  - `buildTabTitleSummary(doc)` 给 `title` tooltip 复用
  - 同一时间只存一个卡片；外部点击 / Esc / resize / scroll 自动关闭
  - `position: fixed` 视口边界自适应定位（右溢右对齐 / 下溢上翻）
  - 剪贴板：优先 `navigator.clipboard`，降级 `execCommand`
- [x] 5. `documents.ts` `openTabActionMenu`：追加「查看详情」菜单项
- [x] 6. `renderDocumentTabs`：`selectButton.title` 升级为 `buildTabTitleSummary(doc)` 多行摘要
- [x] 7. `styles.css`：`.tab-details-card` 及子结构样式（复用 `.tab-action-menu` 视觉体系）
- [x] 8. `activateDocument` / `closeDocument`：同步关闭详情卡（与菜单联动一致）
- [x] 9. lint 校验：无新增错误/警告（既有 `execCommand` HINT 非本轮引入）

## 文件变更清单

| 文件 | 改动 |
|---|---|
| `src/types.ts` | `WorkspaceDocumentSnapshot` 增加 2 个可选字段 |
| `src/documents.ts` | import 新增 / 3 处时间戳维护 / 菜单追加项 / title 改为多行 / 切换关闭联动 |
| `src/workspace-storage.ts` | snapshot 带上时间戳 |
| `src/tab-details-card.ts` | 新文件（~310 行）|
| `src/styles.css` | 新增约 130 行 `.tab-details-card*` 样式 |
| `docs/tab-details-view.md` | 本文档 |

## 验证点（实施后人工验证）

| # | 场景 | 期望 |
|---|---|---|
| V1 | 新建文档 → 打开详情 | 来源 `新建文档（new）`，本地文件「未关联本地文件」 |
| V2 | 从本地 FS 打开文件 → 打开详情 | 来源 `本地文本文件（text-file）`，本地文件显示 `<handle.name>（刷新后可能需重新授权）` |
| V3 | 打开示例 → 打开详情 | 来源 `内置示例（example）`，本地文件「未关联本地文件」 |
| V4 | 编辑内容 | 修改时间戳更新；再次打开详情看到新时间 |
| V5 | 保存（Cmd+S）/「另存为」 | 保存时间戳更新；脏态消失；卡片「已保存」徽章切换 |
| V6 | 重命名后打开详情 | displayName 更新，fileHandle 被清空（符合"另存为语义"）|
| V7 | hover 标签页 | 原生 tooltip 显示多行摘要（文件名 / 来源 / 状态 / URI / 本地文件） |
| V8 | 点击「复制 URI」 | 剪贴板得到 URI 字符串；按钮短暂显示 ✓ 已复制 |
| V9 | 点击「复制文件名」 | 剪贴板得到 displayName |
| V10 | 卡片外部点击 / Esc | 卡片关闭 |
| V11 | 切 tab / resize / scroll | 卡片关闭（与菜单一致） |
| V12 | 刷新页面恢复工作区 | 时间戳从快照恢复 |
| V13 | 多次打开同一 tab 详情 | 第二次点击 = toggle 关闭 |
| V14 | `⋯` 菜单再次打开 | 重命名 + 查看详情 两个菜单项都在 |

## 已知限制

1. **浏览器安全模型硬限制**：无法获得本地磁盘绝对路径。"本地文件"项只能显示 `fileHandle.name`
2. **时间戳精度**：`Date.now()` 毫秒粒度；UI 展示秒级精度
3. **首次编辑后才会有"真实"修改时间**：初次创建时 `lastModifiedAt = lastSavedAt`，一个字符未动时展示相同时间符合直觉
4. **旧快照迁移**：旧快照里没有时间戳字段 → 恢复时 fallback 到 `Date.now()`（当次启动时刻），不会崩
5. **剪贴板**：在非 HTTPS 非 localhost 场景下 `navigator.clipboard` 可能被拒绝，已降级到 `execCommand`，但极个别浏览器环境仍可能失败 → UI 有 ✗ 复制失败 反馈

## 遗留 / 后续可选增强

- 目录选择器 `showDirectoryPicker` 改造 → 能给出"目录相对路径"（工程量中等）
- 卡片内展示最近访问的"姐妹文件"（同 sourceKind 或同目录）
- 加按钮"在新标签页中用只读模式重新打开"便于对比
- 支持将卡片"钉住"（避免失焦自动关闭）
- 实时刷新：卡片打开期间，模型内容变化时自动刷新「大小」「修改」等项
---

## 迭代 2：信息项去噪 + 磁盘时间补强 + 授权状态徽章化

### 背景与问题

迭代 1 上线后用户反馈（截图场景：打开本地 `fingerstyle-sketch1.alphatex`）：

- **URI 误导**：展示 `inmemory://alphatab/doc-1776149133418-2.alphatex`，用户自然会把它当作"文件路径"，但这其实是 Monaco 内部虚拟 URI，与磁盘完全无关
- **本地文件行嚼味**：`fingerstyle-sketch1.alphatex（刷新后可能需重新授权）`，将**当前状态**和**潜在风险**混在一行，信息密度低且容易误读
- **没有磁盘时间**：`File.lastModified` 这个**本就能拿到**的磁盘版本定位信息没被利用

### 浏览器硬限制（继续成立）

- **绝对路径**：`<input type="file">` 和 `FileSystemFileHandle` 一律不暴露 → 网页无法绕过
- **在 Finder / Explorer 中显示**：Web 平台不支持（纯 Electron/Tauri 能力）

本轮迭代在"硬限制边界内"榨取剩余价值，不挑战硬限制。

### 设计决策（Q1-Q4）

| # | 问题 | 决策 | 理由 |
|---|---|---|---|
| Q1 | URI 字段怎么处理 | **a. 直接删除（含复制 URI 按钮）** | 对用户零价值且误导；调试用途极少，需要时可从 devtools 看 |
| Q2 | 补 `file.lastModified`（磁盘修改时间） | **a. 加** | 零成本高价值信息，帮用户区分同名文件版本 |
| Q3 | 授权状态徽章化 | **a. 只在需要重新授权时显示醒目徽章** | 把"风险提示"从括注升级为独立 banner，用户一眼可见 |
| Q4 | 做磁盘 vs 编辑器版本对比 | **b. 先不做** | 需求未明确且容易产生误告警；保留扩展点 |

### 改动范围

#### 1. 数据模型 —— 新增 `diskLastModifiedAt`

```ts
// types.ts: WorkspaceDocumentSnapshot
/**
 * 来自本地文件 `file.lastModified` 的磁盘修改时间（毫秒）。
 * 仅当通过 `<input type="file">` 或 File System Access API 打开文件时可用。
 */
diskLastModifiedAt?: number;
```

同步在 `workspace-storage.ts` 的 `toSnapshot` 映射中透传，刷新后可恢复。

#### 2. 捕获点 —— 三处写入 `diskLastModifiedAt`

| 场景 | 位置 | 写入值 |
|---|---|---|
| 从本地打开文本文件 | `openTextFile` | `file.lastModified \|\| undefined` |
| 导入二进制乐谱 | `openBinaryFile` | `file.lastModified \|\| undefined` |
| FSA 保存 / 另存为成功 | 新抽的 `refreshDiskLastModifiedFromHandle` | `(await handle.getFile()).lastModified` |
| 浏览器下载降级 | `saveActiveDocumentAs` 无 FSA 分支 | 显式置 `undefined`（已与磁盘断开关联，不再绑定时间） |

抽出 `refreshDiskLastModifiedFromHandle(workspaceDocument)` helper 的目的：
- **DRY**：两个写盘点（现有保存 / 另存为）共用同一套"重读磁盘时间 + 重新渲染 tabs + 持久化"逻辑
- **关注点分离**：`markActiveDocumentSaved` 只管编辑器内存态，磁盘时间由写盘方各自负责（因为并非所有保存都真的落盘 —— 下载降级分支就是反例）

#### 3. 视图 —— `tab-details-card.ts`

**A. 删除 URI 行 + 删除 "复制 URI" 按钮**

- `renderBody` 原「标识」分区（URI + 本地文件）整体移除
- 本地文件分区独立成一节（`renderSection('本地文件', ...)`），且**仅在与本地文件相关时才渲染**，未关联时完全不出现，减少噪音
- `renderFooter` 只保留「复制文件名」按钮（`flex: 1 1 auto` 自动占满宽度）

**B. `describeFileHandle` 返回 `string | null`**

返回 null → 上游完全不渲染「本地文件」分区（避免"未关联本地文件"噪音占行）：

| 文档状态 | 原文案 | 新文案 |
|---|---|---|
| 有 handle | `fingerstyle-sketch1.alphatex（刷新后可能需重新授权）` | `fingerstyle-sketch1.alphatex` |
| 仅 hasFileHandle | `待从 IndexedDB 恢复` | `—（待授权恢复）` |
| 无任何关联 | `未关联本地文件` | （整节隐藏） |

**C. 新增 Reauth Banner**

在 header 和 body 之间插入 `tab-details-card__banner.is-warning`：

```
⚠  此文档关联了本地文件，但当前会话尚未获得授权。
    下一次保存时浏览器会请求重新授权。
```

触发条件：`hasFileHandle === true && fileHandle === null`（快照标记有关联但会话尚未恢复）；其它情况不渲染 banner。

**D. 时间分区新增「磁盘修改」行**

`buildTimeRows` 根据 `diskLastModifiedAt` 动态追加：

```
修改          2026-04-20 11:51:11
保存          2026-04-20 11:51:38
磁盘修改      2026-04-20 10:22:03     ← 新增，仅在有值时出现
```

**E. `buildTabTitleSummary` 同步清理**

原生 tab title 摘要**移除 URI 行**，新增「磁盘修改」行（同 body 规则，仅在有值时出现）。

#### 4. 样式 —— `styles.css`

新增 `.tab-details-card__banner` 及 `.is-warning` 变体（琥珀色系），预留 `.is-info` / `.is-error` 扩展点。

### 前后对比

#### 展示项

| 分区 | 迭代 1 | 迭代 2 |
|---|---|---|
| 基本信息 | 来源/乐谱标题/副标题 | 来源/乐谱标题/副标题 |
| 内容 | 大小/保存状态 | 大小/保存状态 |
| 标识 | URI / 本地文件 | **删除**（信息价值过低） |
| 本地文件（新分区） | — | 仅在关联时显示；只显示文件名 |
| 时间 | 修改/保存 | 修改/保存/**磁盘修改**（仅在有值时） |
| Footer | 复制 URI / 复制文件名 | 仅保留复制文件名 |
| Reauth 提醒 | 合入"本地文件"括注 | **独立醒目 banner（仅在需重新授权时）** |

#### 数据流

```
打开本地文件        →  file.lastModified 落入 diskLastModifiedAt
  ↓
内容变更             →  lastModifiedAt = Date.now()
  ↓
Ctrl+S 保存到磁盘   →  markActiveDocumentSaved 更新 lastSavedAt
                        refreshDiskLastModifiedFromHandle 读回新 lastModified
  ↓
另存为新文件        →  同上
  ↓
浏览器下载降级      →  lastSavedAt 更新；diskLastModifiedAt 置 undefined（已脱钩）
  ↓
刷新页面             →  快照往返，所有时间戳保留
```

### 不影响保证

- **其它组件零改动**：Tab 视觉 / 关闭 / 重命名 / 菜单等既有能力全部保留
- **保存流程零侵入**：`refreshDiskLastModifiedFromHandle` 失败静默降级，不影响保存主流程状态提示
- **向后兼容**：`diskLastModifiedAt` 为可选字段；旧快照缺失时视为 undefined，不展示「磁盘修改」行即可

### 验证点

- [x] `types.ts` / `workspace-storage.ts` 新增 `diskLastModifiedAt` 字段并快照往返
- [x] `openTextFile` / `openBinaryFile` 打开本地文件时把 `file.lastModified` 写入
- [x] `saveActiveDocument` / `saveActiveDocumentAs` FSA 分支写盘后自动刷新磁盘时间
- [x] 浏览器下载降级分支显式清空 `diskLastModifiedAt`
- [x] 详情卡已删除 URI 行，「标识」分区整体消失
- [x] 详情卡已删除「复制 URI」按钮，footer 单按钮占满宽度
- [x] 本地文件分区仅在 `describeFileHandle !== null` 时渲染
- [x] Reauth banner 仅在 `hasFileHandle && !fileHandle` 时显示
- [x] 磁盘修改时间仅在 `diskLastModifiedAt` 有值时追加到时间分区
- [x] `buildTabTitleSummary` 移除 URI 行，新增磁盘修改行
- [x] 所有源码 lint 0 errors（既存 `execCommand` 废弃 HINT 非本轮引入）
