# 智能补全修复 — 非侵入式方案

## 1. 需求背景

编辑器的自动补全（IntelliSense）下拉框存在两个问题：

1. **匹配排序不正确**：输入 `\temp` 时，下拉框展示所有补全项但不按匹配度排序，`\tempo` 被排在第 ~10 位
2. **部分合法命令缺失**：在非第一小节位置输入 `\chord`、`\chordDiagramsInScore` 等命令时，补全列表中完全没有这些选项（显示 "No suggestions"）

### 约束条件

- 本项目基于 `@coderline/alphatab` 开源代码二次开发
- **不允许修改上游包**（`packages/lsp/`、`packages/monaco/`、`packages/alphatex/`）
- 所有修复必须限制在 `packages/realtime-editor/` 内

## 2. 根因分析

### 补全管线

```
LSP Server (completion.ts) → LSP-Monaco Bridge (lsp.ts) → Monaco Mapping → Monaco Editor 展示
```

### Root Cause A: `range` 零宽度

**位置**: `packages/monaco/src/lsp.ts` — `setupCompletion()` 函数

上游 LSP bridge 将补全项的 `range` 设置为光标处的零宽度范围 (`col → col`)：

```typescript
const range = new monaco.Range(
    position.lineNumber,
    position.column,  // ← 起始 = 终止 = 光标位置
    position.lineNumber,
    position.column
);
```

Monaco 利用 `range` 来确定用户已输入的前缀（从 `range.start` 到光标位置的文本），零宽度范围意味着 Monaco 认为用户没有输入任何前缀，因此无法进行前缀过滤。

### Root Cause B: `sortText` 强制排序

**位置**: `packages/lsp/src/server/completion.ts` — `sortCompletions()` 函数

```typescript
function sortCompletions(completions, console) {
    let i = 'a'.charCodeAt(0);
    for (const c of completions) {
        c.sortText = `${String.fromCharCode(i++)}`;
    }
    return completions;
}
```

按 `definitions.ts` 中的声明顺序赋值 `sortText = "a", "b", "c"...`。这个固定排序覆盖了 Monaco 内置的模糊匹配排序算法，导致即使 Monaco 能识别前缀，排序也不会反映匹配度。

### Root Cause C: 缺失 `filterText`

LSP 服务端的 `metaDataDocToCompletion()`、`propertyToCompletion()`、`valueItemToCompletion()` 均未设置 `filterText`。虽然 Monaco 会回退到使用 `label`，但与 Root Cause A 叠加后影响更大。

### Root Cause D: 缺失 `wordPattern`

**位置**: `packages/lsp/src/language-configuration.json`

未定义 `wordPattern`，Monaco 使用默认模式 `[a-zA-Z0-9_]+`，不包含 `\`。因此 `\tempo` 被切分为 `\` + `tempo`，影响 word-based 补全的触发范围。

### Root Cause E: `barIndex > 0` 时遗漏命令

**位置**: `packages/lsp/src/server/completion.ts` — `createMetaDataCompletions()` 函数（第 359-367 行）

```typescript
if (barIndex === 0) {
    completions.push(...topLevelCompletions);        // 第一小节前：所有命令
} else {
    completions.push(
        ...createMetaDataDocCompletions(structuralMetaData),  // 非第一小节：只有结构+小节命令
        ...createMetaDataDocCompletions(barMetaData)
    );
}
```

上游有意在 `barIndex > 0` 时排除 `scoreMetaData` 和 `staffMetaData`，认为这些命令只应在乐谱开头使用。但实际上这些命令在任何位置都合法（如在中间位置定义新和弦 `\chord`）。

**被影响的命令分类**：

| 分类 | 包含的命令（部分） | barIndex=0 | barIndex>0 |
|------|-------------------|:---:|:---:|
| `structuralMetaData` | `\track`, `\staff`, `\voice` | ✅ | ✅ |
| `barMetaData` | `\ts`, `\tempo`, `\clef`, `\ks` 等 ~27 个 | ✅ | ✅ |
| **`scoreMetaData`** | `\title`, `\chordDiagramsInScore`, `\hideEmptyStaves` 等 ~30 个 | ✅ | ❌ |
| **`staffMetaData`** | `\chord`, `\tuning`, `\capo`, `\lyrics` 等 ~8 个 | ✅ | ❌ |

## 3. 方案选型

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| 方案 A | 注册额外的 CompletionItemProvider | 简单 | Monaco 会合并多个 provider 的结果，导致重复项 | ❌ 弃选 |
| 方案 B | 覆写 `wordPattern` via `setLanguageConfiguration` | 解决 word 切分问题 | 不修复零宽 range 和 sortText；可能影响其他 word-based 功能 | ❌ 弃选 |
| **方案 C** | **猴子补丁 `registerCompletionItemProvider`** | 一次拦截解决所有问题；完全非侵入 | 依赖上游注册时序 | ✅ 采用 |

### 方案 C 详细设计

1. 在 `basicEditorLspIntegration()` 调用**之前**，临时替换 `monaco.languages.registerCompletionItemProvider`
2. 当上游代码注册 provider 时，拦截并包装其 `provideCompletionItems` 方法
3. 包装函数在原始结果基础上：
   - **修正 `range`**：向前扫描到 `\` 或空白，构建正确的单词范围
   - **清除 `sortText`**：让 Monaco 的模糊匹配算法决定排序
   - **补充缺失命令**：检测上游结果中是否缺少 `scoreMetaData`/`staffMetaData`，自动补充
4. 注册完成后**立即恢复**原始方法

### 缺失命令的零维护方案

直接从上游 `@coderline/alphatab-alphatex/definitions` 导入 `scoreMetaData` 和 `staffMetaData`，在运行时将 `MetadataTagDefinition` 转换为 Monaco `CompletionItem`。当上游新增命令时，**自动获得**——无需手动同步维护。

## 4. 实施记录

### Sprint 1：修正 range 和 sortText（已完成）

解决 Root Cause A + B，让 Monaco 能正确识别前缀并按模糊匹配排序。

### Sprint 2：补充缺失命令（已完成）

解决 Root Cause E，在 `barIndex > 0` 时自动补充被上游排除的 ~38 个命令。

### 修改文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `packages/realtime-editor/src/editor.ts` | 新增+修改 | 新增 import、转换函数、补全增强逻辑 |

### 新增 Import

```typescript
import { scoreMetaData, staffMetaData } from '@coderline/alphatab-alphatex/definitions';
import type { MetadataTagDefinition } from '@coderline/alphatab-alphatex/types';
```

### 新增函数/常量

| 名称 | 类型 | 职责 |
|------|------|------|
| `metadataToCompletionItem(def)` | 函数 | 将上游 `MetadataTagDefinition` 转换为 Monaco `CompletionItem`（复刻上游 `metaDataDocToCompletion` 逻辑） |
| `supplementalCompletionItems` | 常量 | 缓存 `scoreMetaData` + `staffMetaData` 转换后的 CompletionItem 数组 |
| `supplementalLabels` | 常量 | 缓存补充项的 label Set，用于 O(1) 去重检测 |
| `findWordStartColumn(model, position)` | 函数 | 从光标位置向前扫描到空白或行首，返回包含 `\` 前缀的单词起始列号 |
| `enhanceCompletionResult(result, model, position)` | 函数 | 修正 range、清除 sortText、补充缺失命令 |
| `patchCompletionProvider()` | 函数 | 猴子补丁：拦截上游 provider 注册并包装 `provideCompletionItems` |

### 设计一致性

本方案与已有的 `resyncLspForModel()` 同属非侵入式修复策略（不修改上游代码，通过外部手段修正行为），保持了项目的架构一致性。

## 5. 状态

- [x] 根因分析完成（A/B/C/D/E）
- [x] 方案设计完成
- [x] Sprint 1：修正 range + sortText
- [x] Sprint 2：补充缺失补全项
- [ ] 功能验证 — 场景 1：输入 `\temp` 后 `\tempo` 应排在第一位
- [ ] 功能验证 — 场景 2：在非第一小节位置输入 `\chord` 应出现在补全列表中
- [ ] 功能验证 — 场景 3：在非第一小节位置输入 `\chordDiagramsInScore` 应出现在补全列表中

## 6. 遗留问题

- **`wordPattern` 未覆写**：当前方案通过修正 `range` 解决了前缀匹配问题，但 Monaco 的其他 word-based 功能（如双击选词）仍然使用默认的 `[a-zA-Z0-9_]+` 模式，不会选中 `\` 前缀。如果后续需要优化双击选词行为，可考虑在 `setupMonaco()` 后调用 `monaco.languages.setLanguageConfiguration('alphatex', { wordPattern: /\\?[a-zA-Z0-9_]+/ })` 覆写。
- **上游注册时序依赖**：猴子补丁依赖于 `basicEditorLspIntegration()` 内部同步注册 provider 的行为。如果上游未来改为异步延迟注册，需要相应调整补丁策略。
- **补充项无参数/属性补全**：补充的 `scoreMetaData`/`staffMetaData` 补全项只提供了 tag 级别的 snippet 插入，不包含后续的参数和属性子补全（如 `\chord` 的参数补全）。这是因为参数补全由上游 LSP 根据 AST 上下文动态生成，无法在静态猴子补丁中复刻。实际使用中，用户选择补全项后手动输入参数，LSP 仍能提供参数级别的提示。
