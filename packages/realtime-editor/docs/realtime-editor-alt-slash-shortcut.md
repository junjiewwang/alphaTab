# AlphaTex 编辑器：Alt+/ 智能提示快捷键绑定

## 需求背景

AlphaTex 实时编辑器基于 Monaco Editor，通过 LSP 集成了代码补全功能。  
Monaco 默认的补全快捷键是 `Ctrl+Space`（macOS 上是 `⌃Space`），但该键位常被系统输入法切换占用。  
用户习惯使用 `Alt+/`（与 IntelliJ/Eclipse 一致）来触发智能提示，因此需要自定义快捷键绑定。

## 改动内容

| 文件 | 改动说明 |
|------|----------|
| `packages/realtime-editor/src/editor.ts` | 在 `setupEditor()` 中，Monaco 编辑器创建后增加 `Alt+/` → `editor.action.triggerSuggest` 的快捷键绑定 |

### 关键代码

```typescript
// 绑定 Alt+/ 触发智能提示（与 IntelliJ/Eclipse 习惯一致）
editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Slash, () => {
    editor.trigger('keyboard', 'editor.action.triggerSuggest', {});
});
```

## 实施状态

- [x] 添加 `Alt+/` 快捷键绑定
- [x] Lint 检查通过

## 验收方式

1. 在 AlphaTex 编辑器中按 `Alt+/`，应弹出智能提示（补全建议列表）
2. 原有的 `Ctrl+Space` 快捷键不受影响，仍可正常使用

## 遗留问题

无
