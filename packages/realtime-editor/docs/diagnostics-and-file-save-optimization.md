# LSP 诊断修复 & 文件保存优化

## 需求背景

### Bug：LSP 诊断标记不清除
编辑 AlphaTex 代码后，语法错误红色下划线（Monaco markers）在修正语法后仍然残留，只能通过刷新页面来恢复。

**根因分析**：`@coderline/alphatab-monaco/lsp` 的 LSP 客户端使用固定 `documentUri` 并绑定 `editor.onDidChangeModelContent`。当通过 `editor.setModel()` 切换文档 model 后，LSP 内部缓存的文档内容仍是上一个 model 的内容，导致旧 model 上的诊断标记不会被清除，新 model 也未被重新诊断。

### 优化：文件打开与保存工作流
- 打开文件后应记住原始文件位置，保存时直接写回原文件
- 新建文档保存时应提供选择目录的功能
- 页面刷新后仍能恢复文件句柄（需用户点击一次授权）

## 约束条件

- **不侵入上游源码**：不能修改 `packages/monaco/src/lsp.ts` 或其他上游包，只在 `packages/realtime-editor/` 内改动
- **浏览器兼容性**：File System Access API 仅 Chrome 86+ / Edge 86+ 支持，Safari/Firefox 需降级处理

---

## 实施清单

### Sprint 1: LSP 诊断标记修复 ✅

| 文件 | 变更 |
|------|------|
| `src/editor.ts` | 新增 `resyncLspForModel()` 函数：清除 LSP markers + 全文 applyEdits 触发重同步 |
| `src/documents.ts` | `activateDocument()` 中 setModel 后调用 `resyncLspForModel()` |

**修复策略**：
1. `monaco.editor.setModelMarkers(model, 'lsp', [])` — 清除旧标记
2. `model.applyEdits([{ range: fullRange, text: fullContent }])` — 触发等值全文替换，使 LSP 客户端的 `onDidChangeModelContent` 重新发送 `DidChangeTextDocumentNotification`

**验收标准**：
- [ ] 切换标签页后，旧标签页的红色下划线不残留
- [ ] 新标签页内容被 LSP 重新诊断
- [ ] 编辑修正语法错误后，红色下划线及时消失

### Sprint 2: File System Access API 集成 ✅

| 文件 | 变更 |
|------|------|
| `src/file-handle-store.ts` | **新建** — IndexedDB 文件句柄持久化（save/get/remove/verifyPermission） |
| `src/types.ts` | `WorkspaceDocumentSnapshot` 添加 `hasFileHandle?`；`WorkspaceDocument` 添加 `fileHandle` |
| `src/utils.ts` | 新增 `supportsFileSystemAccess()` 检测函数 |
| `src/documents.ts` | 新增 `openFilesWithPicker()`、`saveActiveDocument()`、`saveActiveDocumentAs()`；`createDocument` 支持 fileHandle；`restoreDocument` 异步恢复句柄；`closeDocument` 清理句柄 |
| `src/workspace-storage.ts` | `toSnapshot()` 序列化 `hasFileHandle` 字段 |

**保存逻辑**：
- 有 `FileSystemFileHandle` → 验证权限后直接 `createWritable()` 写入
- 无句柄 + 支持 API → `showSaveFilePicker()` 另存为，保存后绑定句柄
- 无句柄 + 不支持 API → 降级为 `downloadBlob()` 浏览器下载

**句柄恢复**：
- 保存时持久化到 IndexedDB
- 恢复时通过 `snapshot.hasFileHandle` 标记异步从 IndexedDB 获取
- 刷新后需用户点击一次授权（浏览器安全限制）

**验收标准**：
- [ ] Chrome/Edge 中使用 showOpenFilePicker 打开文件
- [ ] 保存直接写回打开的原文件
- [ ] 另存为弹出系统对话框选择目录
- [ ] 新建文档保存时弹出另存为对话框
- [ ] 页面刷新后恢复的文档仍可保存到原文件（点击授权后）
- [ ] Safari/Firefox 降级为传统 input/download 方式

### Sprint 3: UI 适配 ✅

| 文件 | 变更 |
|------|------|
| `index.html` | 新增保存按钮 `#saveButton` 和另存为按钮 `#saveAsButton` |
| `src/state.ts` | DOM 引用添加 `saveButton`、`saveAsButton` |
| `src/toolbar.ts` | 绑定保存/另存为事件；全局 Ctrl+S/Cmd+S 快捷键；打开文件优先使用 File Picker |
| `src/styles.css` | `.toolbar-button--save` 高亮样式；移动端隐藏次要按钮 |

**验收标准**：
- [ ] 保存按钮（软件盘图标）带渐变高亮，视觉突出
- [ ] 另存为按钮（软件盘+加号图标）使用 ghost 样式
- [ ] Ctrl+S / Cmd+S 触发保存
- [ ] 移动端（≤640px）隐藏导出和另存为按钮，仅保留保存按钮

---

## 变更文件总览

| 文件 | 状态 | Sprint |
|------|------|--------|
| `src/editor.ts` | 修改 | 1 |
| `src/documents.ts` | 修改 | 1, 2 |
| `src/file-handle-store.ts` | 新建 | 2 |
| `src/types.ts` | 修改 | 2 |
| `src/utils.ts` | 修改 | 2 |
| `src/workspace-storage.ts` | 修改 | 2 |
| `index.html` | 修改 | 3 |
| `src/state.ts` | 修改 | 3 |
| `src/toolbar.ts` | 修改 | 3 |
| `src/styles.css` | 修改 | 3 |
| `src/file-system-access.d.ts` | 新建 | 3 |

## 风险与降级策略

| 风险 | 影响 | 降级方案 |
|------|------|----------|
| File System Access API 不支持 | Safari/Firefox 无法直接保存 | 自动检测，降级为 `<input type="file">` + `<a download>` |
| IndexedDB 不可用 | 刷新后无法恢复句柄 | 静默降级为普通文档，保存时走另存为流程 |
| 句柄权限过期 | 刷新后需重新授权 | `verifyPermission()` 弹出一次性授权对话框 |

## 遗留问题

- [ ] 二进制文件（.gp/.gpx 等）的打开暂未接入 File System Access API（仅文本文件受益）
- [ ] 尚未实现拖拽打开文件时获取 FileSystemFileHandle 的能力
- [ ] 关闭标签页时的 "未保存" 提示文案仍使用 "未导出"，可考虑统一为 "未保存"
