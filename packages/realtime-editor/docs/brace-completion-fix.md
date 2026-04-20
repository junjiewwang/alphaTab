# `{}` 内参数补全不友好 — 非侵入式修复（A1+A2+A3）

> 本文档是 [`smart-completion-fix.md`](./smart-completion-fix.md) 的续集。前者解决了命令级补全（`\temp` → `\tempo`）的 range/sortText/遗漏命令问题；本次聚焦 **属性块 `{}` 内的补全体验**。

## 1. 需求背景

用户反馈：在 AlphaTex 编辑区输入
```alphatex
\chord ("C" 0 1 0 2 3 x) {showd
```
时，智能提示无法稳定提示 `showDiagram`、`firstFret`、`barre`、`showFingering`、`showName` 等 chord 的属性配置。类似问题普遍存在于所有带 `{}` 属性块的命令（chord、duration change、beat、note 等）。

### 约束条件

- 基于 `@coderline/alphatab` 开源代码二次开发
- **不允许修改上游包**（`packages/lsp/`、`packages/monaco/`、`packages/alphatex/`）
- 所有修复限制在 `packages/realtime-editor/` 内

## 2. 根因分析

### 好消息：上游能力是完备的

`packages/alphatex/src/metadata/staff/chord.ts` 已完整声明 `chord` 的 5 个属性（`firstFret`、`barre`、`showDiagram`、`showFingering`、`showName`）及其 enum 值。

`packages/lsp/src/server/completion.ts` 的 `createPropertiesCompletions` / `createPropertyCompletions` 同样会在识别到 `{}` 内上下文时返回属性级补全。

**问题全部出在本地增强层和触发时机。**

### Root Cause A1：`{` 不是补全触发字符

`packages/lsp/src/server/index.ts` L39-41：

```ts
completionProvider: {
    resolveProvider: true        // ❗ 没有 triggerCharacters
}
```

Monaco 的 `CompletionItemProvider.triggerCharacters` 来自此处，自然为 `undefined`。

**后果**：输入到 `\chord (...) {` 后光标落入 `{}` 不会自动弹出列表，必须手动 Ctrl+Space / Alt+/。

### Root Cause A2：`enhanceCompletionResult` 在 `{}` 内错误注入 38 个命令

原先的补充判断：

```ts
const needsSupplement = [...supplementalLabels].some(
    label => !existingLabels.has(label)
);
if (needsSupplement) { /* 注入 scoreMetaData + staffMetaData 的 38 个 \xxx */ }
```

只要上游结果不包含 `\title` 等任一命令就触发补充。
**在 `{}` 内上游返回的是 property 级补全（不含任何 `\xxx`）**，导致：

- 38 个 `\title`、`\tempo`… 全部塞进列表
- 属性补全被淹没在命令噪声中

### Root Cause A3：`findWordStartColumn` 回溯跨越结构符

原实现仅以空白为边界：

```ts
while (idx >= 0 && lineContent[idx] !== ' ' && lineContent[idx] !== '\t') {
    idx--;
}
```

在 `\chord (...) {sh|` 的场景中，回溯会穿越 `}`、`)`、`{`、`(` 等结构字符一直到行首空白，把 Monaco 的 replace range 扩到包含 `{`。最终选中 `showDiagram` 时会把 `{` 甚至更早的内容一并替换，产生诡异编辑结果。

## 3. 实施方案（A1 + A2 + A3）

### A1：本地补齐 `triggerCharacters`

在 `patchCompletionProvider` 的猴子补丁里合并本地期望的触发字符到 provider 对象：

```ts
const LOCAL_TRIGGER_CHARACTERS = ['\\', '{', ' ', '('];

provider.triggerCharacters = mergeTriggerCharacters(provider.triggerCharacters);
```

| 触发字符 | 用途 |
|---------|------|
| `\`     | 命令级（输入反斜杠 → 命令列表） |
| `{`     | 属性块入口（chord/duration-change 等） |
| ` `     | 属性值 / 参数分隔（`firstFret ` 后的值） |
| `(`     | 参数列表入口（与上游 signatureHelp 触发字符重合） |

若上游未来自行声明 `triggerCharacters`，`mergeTriggerCharacters` 使用 `Set` 去重，不会重复。

### A2：按上下文决定是否补充命令

新增 `detectCompletionContext(model, position)`，通过单行回溯统计未配对的 `{`/`(`，返回：

- `command`：命令级位置（允许补充 `scoreMetaData`/`staffMetaData`）
- `inside-braces`：`{}` 内（上游给 property 补全，**禁止注入命令**）
- `inside-parens`：`()` 内（上游给参数/音符补全，**禁止注入命令**）

`enhanceCompletionResult` 先做 range 和 sortText 修正，再用上下文判定决定是否跑原补充逻辑：

```ts
const contextKind = detectCompletionContext(model, position);
if (contextKind !== 'command') {
    return result;   // 不在命令级上下文，只做基础增强
}
// 否则照旧补充缺失命令
```

### A3：扩展 `findWordStartColumn` 边界字符

新增 `WORD_BOUNDARY_CHARS` 集合：

```ts
const WORD_BOUNDARY_CHARS = new Set([' ', '\t', '(', ')', '{', '}', '|', ',', '.']);
```

回溯时遇到任一分隔符即停止。`\` 不在其中（必须被纳入单词，才能让 Monaco 按 `\tempo` 做前缀匹配）。

### 修改文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/realtime-editor/src/editor.ts` | 修改 | 扩展边界、新增上下文检测、合并 triggerCharacters |
| `packages/realtime-editor/docs/brace-completion-fix.md` | 新增 | 本文档 |

### 关键符号

| 名称 | 类型 | 职责 |
|------|------|------|
| `WORD_BOUNDARY_CHARS` | 常量 Set | AlphaTex 结构性单词分隔符集合 |
| `CompletionContextKind` | 类型 | `'command' \| 'inside-braces' \| 'inside-parens'` |
| `detectCompletionContext(model, position)` | 函数 | 单行回溯判断光标所处的结构上下文 |
| `LOCAL_TRIGGER_CHARACTERS` | 常量 | `['\\', '{', ' ', '(']` |
| `mergeTriggerCharacters(upstream)` | 函数 | 合并上游 triggerCharacters 与本地期望字符 |

## 4. 行为对比

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| `\chord (...) {` 后光标停留 | 不自动弹出补全 | 键入 `{` 即自动弹出属性列表 |
| `{showd\|` 位置 Ctrl+Space | 上游属性 + 38 个命令噪声 | 纯属性列表（`showDiagram` 等） |
| `{showd\|` 选中 `showDiagram` | 可能吞掉 `{` | 只替换 `showd` |
| `\temp\|` 命令级补全 | 未受影响 | 仍然正常（`\tempo` 排第一） |
| 非第一小节补全 `\chord` | 仍然补齐（命令级） | 仍然补齐（逻辑未变） |

## 5. 状态

- [x] 根因分析（A1/A2/A3）
- [x] A1：triggerCharacters 注入
- [x] A2：上下文感知的命令补充
- [x] A3：单词边界扩展
- [ ] 功能验证 — 场景 1：`\chord (...) {` 自动弹出属性
- [ ] 功能验证 — 场景 2：`{showd` 补全只显示属性
- [ ] 功能验证 — 场景 3：选中 `showDiagram` 后 `{` 不被吞掉
- [ ] 功能验证 — 场景 4：`\temp` 命令级补全行为不回退

## 6. 遗留问题（A4，暂不实施）

- **未闭合 `{` 场景的兜底补全**：当用户刚输入 `\chord (...) {` 但尚未输入 `}` 时，alphaTex 解析器可能把这段识别为错误节点，`metaData.properties` 为 `undefined`，上游 `createPropertiesCompletions` 直接返回 `[]`。

  - 影响范围：非常窄（用户只需输入 `}` 再回到花括号内就恢复正常；或先成对输入 `{}` 再进去）
  - 解决思路：本地读 `allMetadata` 按命令名 → properties 直接生成补全
  - 决策：先观察 A1-A3 的落地效果，A4 视实际痛点再评估

## 7. 设计一致性

本次修复沿用项目既定的**猴子补丁 / 非侵入式** 策略：

- 不触碰 `packages/lsp/`、`packages/monaco/`、`packages/alphatex/`
- 与 `resyncLspForModel`、原 `patchCompletionProvider` 共用同一设计哲学
- 所有新增逻辑都挂在现有 `patchCompletionProvider` / `enhanceCompletionResult` 的扩展点上，最大化复用
