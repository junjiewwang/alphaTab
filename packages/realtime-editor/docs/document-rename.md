# 文档就地重命名

## 需求背景

`realtime-editor` 工作区支持打开多个文档标签。用户希望：

1. 能在标签页上直接重命名文档（无需另存为）
2. 重命名后，下次保存时使用新文件名落盘

## 最终方案（方案 A：悬浮操作按钮 + 就地编辑）

经过两轮"双击触发"方案的实测失败，最终切换为更优雅、可发现性更强的
**悬浮操作按钮 + 弹层菜单** 方案（类 VS Code / Figma 风格），并用
`contenteditable` 替代 `<input>` 做原地编辑，从根本上解决之前的事件/焦点问题。

### 交互流程

```
┌─────────────────────────────────┐
│ [●] sample.alphatex      ⋯  ×  │  hover / 激活 时 ⋯ 按钮淡入
└─────────────────────────────────┘
              ↓ 点击 ⋯
       ┌──────────────┐
       │   重命名      │
       │   关闭标签    │
       └──────────────┘
              ↓ 选"重命名"
┌─────────────────────────────────┐
│ [●] [sample.alphatex|]          │  label 变 contenteditable，选中主干
└─────────────────────────────────┘
         Enter 提交 / Esc 取消 / blur 提交
```

关键交互决策：

- **单击 tab：立即激活**（回归即时响应，无 250ms 延迟感）
- **更多操作按钮 `⋯`**：hover / 激活 / 菜单打开时可见，默认透明不占视线
- **操作菜单**：
  - 用 `position: fixed` + 边界自适应（右溢出则右对齐、下溢出则上翻）
  - 外部 `pointerdown` / Esc / 窗口 resize/scroll 任意一种都会关闭
  - 点击触发按钮 toggle（再点一次关闭）
- **重命名使用 `contenteditable="plaintext-only"`**：
  - 不替换 DOM 节点 → 自然无法触发"DOM 被替换导致事件失效"类 bug
  - 原地编辑，视觉上 label 位置就变成输入区域
  - 粘贴仅接受纯文本，自动去除换行/制表符
- **保留键盘**：Enter 提交 / Esc 取消 / blur 提交
- **自动选中文件名主干**：通过 `Selection.setStart/setEnd` 选中扩展名前部分
- **成功/失败视觉反馈**：
  - 成功 → `tabFlashSuccess` 绿色渐变 600ms
  - 失败（空名/冲突） → `tabFlashError` 红色抖动 420ms，label 恢复原名

### 校验规则

| 场景 | 行为 |
|---|---|
| 空名称 / 仅空白 | 拒绝，状态栏提示"文件名不能为空"，label 闪红并恢复原名 |
| 与原名相同 | 视为成功，无操作 |
| 与其他 tab 冲突 | 拒绝，提示冲突，label 闪红并恢复原名 |
| 合法新名称 | 更新 `displayName` + 同步状态 + 绿色闪动反馈 |

### 文件句柄处理

已关联 `FileSystemFileHandle`（通过 File System Access API 打开）的文档
重命名时，**立即清空 fileHandle**（调用 `removeFileHandle` 从 IndexedDB 清理），
并把文档标记为脏：

- 浏览器 API 不支持原生 rename
- 下次保存走 `saveActiveDocumentAs` → `showSaveFilePicker`，用新
  `displayName` 作为 `suggestedName`，用户可选择目标路径写入新文件
- 保留原文件不动，避免破坏性操作

### `scoreTitle` 联动

如果 `scoreTitle` 此前值 === 旧的 `displayName`（表示标题默认跟随文件名），
重命名时同步更新 `scoreTitle`。否则（用户/乐谱内部自己指定的 title）保持不变。

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/documents.ts` | 重构 tab DOM（新增 `document-tab__menu` ⋯ 按钮）；`setupDocumentTabs` 改为即时单击激活，click handler 新增菜单按钮分发；新增 `openTabActionMenu` / `positionTabActionMenu` / `closeTabActionMenu` 弹层管理；`startInlineRename` 改为 `contenteditable` 原地编辑；新增 `flashTabFeedback` 视觉反馈；`activateDocument` / `closeDocument` 自动关闭残留菜单与重命名 |
| `src/styles.css` | 新增 `.document-tab__menu`（hover 淡入）；新增 `.document-tab.is-renaming` 编辑态样式；新增 `.tab-action-menu` 及其 `--item`（含 `--danger`）弹层样式；新增 `tabFlashSuccess` / `tabFlashError` 动画；窄屏下同步新增 `.document-tab__menu` 尺寸；删除废弃的 `.document-tab__label-input` 样式 |
| `docs/document-rename.md` | 本文档（整体重写） |

## 关键数据结构

```ts
// 全局单例：当前正在进行的就地重命名
let activeInlineRename: {
    documentId: string;
    label: HTMLElement;        // 直接持有 label 节点，不再需要 input
    finish: (commit: boolean) => void;
} | null;

// 全局单例：当前打开的操作菜单
let activeTabActionMenu: {
    element: HTMLElement;
    trigger: HTMLButtonElement;
    close: () => void;
} | null;
```

- 同一时间只允许一个 tab 处于编辑态、一个菜单处于打开态
- 打开新菜单 / 进入新重命名时会自动关闭/提交前一个

## 边界与稳定性

| 场景 | 处理 |
|---|---|
| 同时快速点击多个 ⋯ | 打开新菜单前 `closeTabActionMenu()` 关闭旧菜单 |
| 菜单打开时点击其他区域 | 捕获阶段监听 `pointerdown`，点到菜单/触发按钮外即关闭 |
| 菜单打开时 Esc | 全局 `keydown` 监听关闭菜单 |
| 窗口 resize / 滚动 | 关闭菜单以免位置错位（简单稳妥） |
| 重命名期间 blur + Enter 同时触发 | `finished` 标志保证 `finish` 只执行一次 |
| 重命名期间切换 tab | `activateDocument` 调 `finish(true)` 自动提交 |
| 重命名期间关闭 tab | `closeDocument` 调 `finish(false)` 自动取消 |
| 持久化 | `renameDocument` 调 `persistWorkspace()`，刷新后保留新名 |
| 粘贴含换行的文本 | `paste` 事件拦截并 `execCommand('insertText', sanitized)` |

## 验收标准

1. ✅ 单击非激活 tab → 立即激活，无可感知延迟，焦点仍在编辑器（符合 VS Code 习惯）
2. ✅ 鼠标悬停到 tab → ⋯ 按钮淡入；移开 → 淡出；激活 tab 的 ⋯ 常亮
3. ✅ 点击 ⋯ → 弹出菜单，包含"重命名 / 关闭标签"
4. ✅ 点击菜单外任意区域 / Esc → 菜单关闭，不触发误操作
5. ✅ 再次点击同一个 ⋯ → 菜单关闭（toggle）
6. ✅ 菜单位于视口边缘时自动翻转位置（右对齐 / 上翻）
7. ✅ 选择"重命名" → label 原地变为可编辑，自动选中主干，焦点**不跳到编辑器**
8. ✅ Enter / blur → 提交；Esc → 取消
9. ✅ 名称冲突或空名 → 恢复原名 + 红色抖动 + 状态栏提示
10. ✅ 成功 → 绿色渐变 + 状态栏"已重命名"
11. ✅ 关联 fileHandle 的文档重命名后：fileHandle 被清空、isDirty=true、
    下次保存弹出 `showSaveFilePicker` 使用新名
12. ✅ 关闭按钮 × 仍然即点即关，不经过菜单
13. ✅ 刷新页面后新名称持久化

## 历史方案（已淘汰）

### 方案 × 第一版：双击 label + `<input>` 替换

- 把 `<input>` 插到 `<button>` 里 → 非法嵌套，焦点行为不稳定
- 即使隐藏 button、把 input 放到 `.document-tab` 容器 ——
  仍然存在双击非激活 tab 时 `renderDocumentTabs()` 整体重建导致
  `dblclick` 不派发的问题

### 方案 × 第二版：手动单/双击判定（250ms 延迟）

- 改在 click 里用 `setTimeout` 做单/双击判定，规避 `dblclick` 的事件依赖
- 引入 `updateActiveTabIndicator` 原地更新激活态避免 DOM 被替换
- **副作用**：单击切换 tab 有 250ms 延迟感，且重命名功能**可发现性极低**
  （没有任何 UI 暗示这里可以双击）

**方案 A 的优势相比之下**：单击即时响应 + ⋯ 按钮可发现性高 + 弹层菜单可
扩展（后续可加"复制路径 / 固定标签 / 在新窗口打开"等）。

## 视觉瘦身：× 与 ⋯ 统一显隐 + 菜单去重

方案 A 首轮实施后发现：× 与 ⋯ 同时常驻 / 同时 hover 出现的规则不一致，
且菜单里还有"关闭标签"与 × 功能重复，造成视觉冗余。遂进行瘦身：

### 规则

| 状态 | × 按钮 | ⋯ 按钮 | 说明 |
|---|---|---|---|
| 默认 / 未 hover / 未激活 | 隐藏 | 隐藏 | 极简视觉 |
| hover 所在 tab | **显示** | **显示** | 操作组整体浮现 |
| 激活 tab（`.is-active`） | **显示** | **显示** | 激活即常亮（突出焦点） |
| 菜单打开中（`aria-expanded=true`） | 显示 | 显示 | 保持操作上下文 |
| 键盘焦点（`:focus-visible`） | 显示 | 显示 | 无障碍 |
| 就地重命名（`.is-renaming`） | 隐藏 | 隐藏 | 避免干扰编辑 |
| 触摸设备（`@media (hover: none)`） | 常驻 | 常驻 | 无 hover 状态的可访问兜底 |

### 菜单瘦身

`openTabActionMenu` 的 items 数组移除 `关闭标签` 项，职责边界清晰化：

- **×** = 关闭（高频，直接入口）
- **⋯** = 扩展操作（低频，菜单聚合）

当前菜单仅保留"重命名"；未来扩展位（不影响已有交互）：

- 复制文件名
- 另存为…
- 关闭其他标签 / 关闭右侧所有（VS Code 经典）
- 固定标签 / 在新窗口打开

### 改动

| 文件 | 改动 |
|---|---|
| `src/styles.css` | 合并 `.document-tab__close` 与 `.document-tab__menu` 的显隐规则：默认 `opacity: 0; pointer-events: none`；追加 `:hover / .is-active / aria-expanded=true / :focus-visible` 显示；新增 `@media (hover: none)` 常驻 |
| `src/documents.ts` | `openTabActionMenu` 的 items 数组删除"关闭标签"项，保留 `danger` 字段以备未来危险操作扩展 |

## 遗留问题 / 潜在风险

- **文件名扩展名**：当前不强制 `.alphatex` 扩展名，允许用户任意命名；
  保存时会通过 `saveActiveDocumentAs` 的 `fallbackName` 逻辑自动补齐。
- **contenteditable 的 `plaintext-only`**：Safari 18 及之前版本支持良好，
  但极旧浏览器可能退化为 `true`（允许富文本）。已通过 `paste` 拦截 + Enter 拦截
  保证输入安全。
- **菜单自适应位置**：当前策略是一次性测量；若动画进行中窗口被 resize，
  菜单会直接关闭（简化实现，避免频繁重定位）。
- **扩展位**：`openTabActionMenu` 的 `items` 是一个数组，未来可无缝加入
  "复制路径 / 在资源管理器中显示 / 另存为 / 固定标签" 等操作。

