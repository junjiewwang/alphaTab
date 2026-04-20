# 智能提示示例值增强（L1 + L2）

## 背景

在 `brace-completion-fix.md`（A1/A2/A3）修复了 `{}` 内参数补全的噪声和触发问题之后，继续解决"用户看到命令/参数后仍然不知道怎么用"的痛点：

- 输入 `\chord` 出现在补全列表，但用户不知道后面要拼什么字符串
- 输入 `{show` 选中 `showDiagram`，但不知道值是 `true/false` 还是 `1/0`
- Hover 看到描述，但依然没有完整示例代码

上游 `@coderline/alphatab-alphatex/definitions` 已经为**几乎所有命令/属性**定义了 `examples` / 参数类型 / 默认值 / 枚举值，但当前 realtime-editor 只把 `longDescription` 一行字灌进 Monaco 的 documentation，其余信息全部丢弃。

## 范围

- **L1**：补全下拉项的 documentation 重写为富 Markdown 卡片（syntax / parameters / values / examples）
- **L2**：hover 卡片在上游内容末尾追加 `**Example:**` 段
- **语言**：全英文，保持与上游描述数据一致
- **方式**：猴子补丁，**不修改上游 `packages/lsp/` 或 `packages/monaco/`**

不含：
- L3（示例 snippet 作为独立补全项）— 后续迭代再定
- 修改上游触发能力（上游 hover.ts 已经渲染了描述+签名+参数表，只补 examples）

## 数据来源

| 对象 | 来源 | 数据字段 |
|------|------|---------|
| 命令定义（如 `\chord`） | `allMetadata` | `tag`/`shortDescription`/`longDescription`/`signatures`/`examples`/`properties` |
| 命令参数（如 `\chord` 的 `name`） | `signatures[].parameters` | `name`/`type`/`defaultValue`/`values`/`shortDescription` |
| 命令属性（如 chord 的 `showDiagram`） | `allMetadata.get('\\chord').properties` | 同 `WithSignatures` |
| beat 属性（`f`/`d`/`gr`） | `beatProperties` | 同 `WithSignatures` |
| note 属性（`h`/`b`/`sl`） | `noteProperties` | 同 `WithSignatures` |
| duration change 属性（`tu`） | `durationChangeProperties` | 同 `WithSignatures` |
| bar scoped 属性 | `barMetaData.*.properties` | 同 `WithSignatures` |

所有 `examples` 都在上游 `prepareWithSignatures` 加载时已经 `trimIdention`，可直接写入代码块。

## 架构

新增独立模块 `src/completion-docs.ts`，职责单一 —— 反查 + Markdown 渲染。`editor.ts` 仅负责 Monaco 集成（猴子补丁 + 调用反查）。

```
editor.ts                    completion-docs.ts
├─ patchCompletionProvider ──┐
│    └ enhanceCompletionResult
│         └ enrichSuggestionDocumentation(suggestion, ctx)
│              ├─ detectDefinitionContext(model, pos)  ← 新模块
│              ├─ findDefinitionByLabel(label, ctx)    ← 新模块
│              └─ renderDefinitionMarkdown(def)        ← 新模块
│
└─ patchHoverProvider ───────┐
     └ enrichHoverWithExamples
          ├─ detectDefinitionContext(...)
          ├─ findDefinitionByLabel(...)
          └─ renderExamplesOnly(def)                   ← 新模块
```

## 实现要点

### 1. `detectDefinitionContext`（升级版）

替代原 `detectCompletionContext`：除返回 `command` / `inside-braces` / `inside-parens` 外，还返回 `nearestCommand`（最近的 `\xxx`）。

- `nearestCommand` 用于属性反查的 scope：`chord` 的 `showDiagram` 优先走 `\chord.properties`
- 未找到命令时 fall back 到 `beat/note/durationChange/barMetaData` 四个桶

### 2. `findDefinitionByLabel`

统一入口：
- `label.startsWith('\\')` → 命令反查 `allMetadata`
- 否则 → 属性反查（按 nearestCommand 优先级）

### 3. `renderDefinitionMarkdown`

输出结构：

```
**{shortDescription}**                    ← 可选：short desc

{longDescription}                          ← 可选：long desc

> ⚠ **Deprecated:** ...                    ← 可选：废弃提示

**Syntax:**                                ← 可选：至少 1 个 signature
```alphatex
\chord name strings
\chord [name]                              ← 多 overload 多行
```

**Parameters:**                            ← 可选：至少 1 个参数
| Name | Description | Type | Required | Default |

**Values:**                                ← 可选：参数有 enum values
- `true` — Show the diagram
- `false` — Hide the diagram

**Example:**                               ← 可选：至少 1 个示例
```alphatex
\chord ("C" 0 1 0 2 3 x)
```

**Remarks:** ...                           ← 可选：额外说明
```

所有段落都是可选：数据缺失则跳过。保证向后兼容任意不完整的 definition。

### 4. Hover 追加策略

上游 hover 已经渲染了 description + signature + parameters 表，**只追加 examples**，避免重复：

```ts
return {
  ...raw,
  contents: [
    ...raw.contents,
    { value: examplesMd, isTrusted: false, supportThemeIcons: false }
  ]
};
```

若上游将来改 hover 结构（换成 object），此处 concat 依旧工作 —— 只是往 `contents` 尾部 push 一个 Markdown 项。

### 5. 可降级设计

- `findDefinitionByLabel` 未命中 → 保留上游 documentation / hover 内容
- `renderDefinitionMarkdown` 空字符串 → 跳过不覆盖
- `renderExamplesOnly` 无 examples → 不 push

## 文件改动清单

| 文件 | 类型 | 行数 |
|------|------|------|
| `packages/realtime-editor/src/completion-docs.ts` | 新增 | ~390 行 |
| `packages/realtime-editor/src/editor.ts` | 修改 | 删 ~70 行（本地 `detectCompletionContext`）+ 加 ~130 行（hover 补丁、documentation 增强、label 解析） |

## 验证点

| # | 场景 | 期望 |
|---|------|------|
| 1 | 补全输入 `\chor` 看到 `\chord`，按 → 展开详情面板 | 显示 Syntax / Parameters / Example |
| 2 | 补全输入 `{show` 选中 `showDiagram`，按 → | 显示 Values（`true`/`false`）+ Example |
| 3 | 补全输入 `\temp` 看到 `\tempo`，按 → | 显示 Syntax / Parameters (`bpm` 默认值) / Example |
| 4 | 鼠标悬停 `\chord` 关键字 | 卡片末尾出现 `**Example:**` 段 |
| 5 | 鼠标悬停 `firstFret` 标识符 | 卡片末尾出现 `**Example:**` 段（若上游 definition 有 examples） |
| 6 | 鼠标悬停普通数字（如 `0.3`） | hover 无崩溃，内容与之前一致 |
| 7 | `{}` 内无命令噪声 | A2 不回退 |
| 8 | 命令级补全排序 | A1-A3 不回退 |

## 已知限制

1. **单行扫描**：`detectDefinitionContext` 只看当前行，跨行的 `{...\n...}` 无法识别 nearestCommand → 退化到全局属性桶兜底（仍能找到 chord 自身属性，因为 chord 的属性也注册在了 `allMetadata` 里）
2. **字符串内的 `{}` 误判**：单行扫描不解析字符串字面量，`"{foo}"` 里的 `{` 会被当结构符计数。最坏情况是多显示/少显示一段 examples，不会崩溃
3. **Node type 列显示为数字**：上游 `ParameterDefinition.type` 是 `AlphaTexNodeType` 枚举数值，Markdown 里直接打印数字。可接受 — 用户主要看参数名和描述，类型列是辅助信息

## 遗留 / 未来

- L3（示例作为独立补全项）：观察 L1+L2 实际效果再决定
- Node type 数字 → 友好名称（需要反查 `AlphaTexNodeType` 枚举）
- 参数类型列的可读化（如 `String | Number` 代替 `5 | 8`）
- 根据 `defaultValue` 在补全详情中标注哪些参数可省略

## 相关文档

- `docs/smart-completion-fix.md` —— A1 前的基础修复（range/sortText/barIndex 遗漏）
- `docs/brace-completion-fix.md` —— A1-A3 本轮前置修复（triggerCharacters、needsSupplement 上下文判断、边界字符）

---

## 第 3 轮迭代：属性值上下文感知重写（A4）

### 问题

L1+L2 上线后发现，在属性块内按空格（A1 新增空格触发符）频繁出现噪声：

```
\chord ("{}" 1 2 3 4 5 6 ) {barre 2 firstFret 1 showName ❘}
                                                        ↑ 光标
补全列表混杂显示：
  barre / firstFret / showDiagram / showFingering / showName  ← 所有属性名
  0 / 1 / false / false / true / true                         ← 所有属性的枚举值混在一起（且 false/true 重复）
```

用户期望：**`showName ` 后按空格，只看到 `true` / `false`**（当前属性的候选值），而不是整个属性块的全集。

### 根因定位

上游 `packages/lsp/src/server/completion.ts` 的 `createPropertiesCompletions` 依赖 `binaryNodeSearch` 在 AST 中定位 property 节点。但光标位于属性尾部空格位置（`showName ❘`）时，空格不属于任何 property 的 range，AST 命中失败 → 兜底路径返回"全部属性名 + 全部 values"合集。

A1 在 Monaco 层把空格加入 `triggerCharacters`，使这个兜底路径每次空格都被触发，噪声频率显著上升。

### 方案

**方案 A：本地解析 + 完全重写 `result.suggestions`**（已选）

在 `enhanceCompletionResult` 开头插入上下文分析分支：若确认当前是"属性值候选"或"属性名候选"场景，直接用本地生成的精准候选**完全替换** `result.suggestions`，绕过上游噪声。未识别场景（kind: 'none'）继续走既有路径，保证可降级。

其他方案对比：
- **B. 过滤上游**：`result.suggestions.filter(...)` 需要硬编码属性名/值名的结构特征，耦合上游内部字符串，fragile。弃用。
- **C. 双通道 provider**：本地独立 CompletionProvider 和上游并存 → Monaco 会合并两份结果，噪声仍在。弃用。
- **D. 触发字符精细化**：Monaco `triggerCharacters` 只支持按字符粒度，无法按"光标前是属性名还是值"区分。不可行。

### 设计要点

#### 1. 上下文分析 `analyzePropertyValueContext`

单行从光标向前扫描，按状态机识别：

| 返回 kind | 触发条件 | 候选列表 |
|---|---|---|
| `property-value` | 光标前最近的 token 是属性名（lowercase 后 hit `owner.properties`），且已填值数 < maxParamCount | 该属性的 `values` 合并去重；无 values 时 fallback 到 `defaultValue` |
| `property-name` | `{` 刚打开 / 前一个属性已填满 / 光标中间在输入一个不在 `properties` 中的词 | `owner.properties` 全部属性名 |
| `none` | 未在 `{}` 内 / 找不到最近命令 / 命令无 properties 定义 / 遇到无法识别的 token | 保留上游返回，走既有增强路径 |

**关键坑位 — `maxParamCount` 取所有 signatures 的 max**：

```ts
// showDiagram 有 3 个 signatures，signatures[0].parameters === []（无参形态）。
// 只看 signatures[0] 会得出 maxParamCount = 0 → 用户输入的第一个值会被误判成下一个属性名。
function computeMaxParameterCount(def: PropertyDefinition): number {
    let max = 0;
    for (const sig of def.signatures) {
        if (sig.parameters.length > max) max = sig.parameters.length;
    }
    return max; // 正确：showDiagram → 1
}
```

#### 2. 候选构建

**值候选** `buildPropertyValueCompletions`：
- 合并所有 signatures 的 `parameters[i].values`，按 `name` 去重（首次出现优先）
- 跳过 `skip: true` 的 value（上游用它隐藏内部别名）
- **无 values 时 fallback**：按用户决策，只显示 `defaultValue` 一项（非枚举 property 至少有个参考值）
- `insertText` 优先用 `v.snippet`（保留上游 tab stops）

**名候选** `buildPropertyNameCompletions`：
- 从 `owner.properties.values()` 遍历
- label 用 `prop.property`（原始 camelCase），不是小写 key
- `insertText = "${property} "`（补空格）→ 触发本轮的 `property-value` 上下文，形成"名 → 值"的两段式补全流

#### 3. 去重优先级

- 同 `showDiagram` 的 3 个 signatures 合并后去重：`true` / `false` / `1` / `0` 共 4 个
- 首次出现的 `shortDescription` 优先保留（因为后续 signatures 的同名 value 描述大概率一致）

### 文件改动

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/realtime-editor/src/completion-docs.ts` | 新增 `analyzePropertyValueContext` / `buildPropertyValueCompletions` / `buildPropertyNameCompletions` 及私有 helper | +~240 行 |
| `packages/realtime-editor/src/editor.ts` | `enhanceCompletionResult` 开头加本地 branch，优先级高于既有 range/sortText/doc 增强 | +~30 行 |

### 验证点

| # | 场景 | 期望 |
|---|---|---|
| A4-1 | `\chord (...) {❘}` 按 Ctrl+Space | 只看到 5 个属性名（barre / firstFret / showDiagram / showFingering / showName），无值混入 |
| A4-2 | `\chord (...) {showName ❘}` | 只看到 `true` / `false` / `1` / `0`，无其他属性名 |
| A4-3 | `\chord (...) {showName tr❘}` | 模糊匹配 `true`（Monaco 前缀过滤生效） |
| A4-4 | `\chord (...) {firstFret ❘}` | 无 values 的 property → 显示 `defaultValue` 单项（chord.firstFret 无默认值时降级到上游） |
| A4-5 | `\chord (...) {showName true ❘}` | 下一个属性名列表（4 个：除 `showName` 外其实也包含 `showName`，只过滤当前行为由 Monaco 前缀处理，不在本层过滤） |
| A4-6 | `\chord (...) {unknownProp ❘}` | kind=none → 降级到上游原始结果（用户输入的是未知属性） |
| A4-7 | `\chord (...) {barre 2 fir❘}` | property-name 模糊匹配 `firstFret` |
| A4-8 | 普通命令级（无 `{}`） | 保持 A1-A3 行为不变，未进入本 branch |

### 已知限制

1. **单行扫描**：与 `detectDefinitionContext` 一致，跨行属性块不识别。AlphaTex 实际使用中属性块几乎都写一行，可接受
2. **字符串字面量内 `{}`**：tokenizer 未跟踪引号外层的 `{`，极端场景 `\chord ("{}" 1 2 3 4 5 6) {...}` 中 `"{}"` 字符串已在 `findEnclosingOpenBrace` 之前出现，不会被误判（因为向后扫描是找**最近**的 `{`，而字符串里的 `{` 前面还有 `"`，但本层仅对 `cursorIdx → {` 的 cursor 附近段做扫描，字符串内 `{` 属于最外层 `()` 之内，扫描不会穿越到那里）
3. **A4-5 同名属性不过滤**：若希望 `showName` 已经写过就不再提示，需要额外记录"已使用属性"集合，并在 `buildPropertyNameCompletions` 中过滤。本迭代不做（Monaco 允许重复属性，用户可自主选择覆盖），后续观察再定

### 遗留

- A4 中"属性已写就不再提示"的去重（非刚需，等用户反馈）
- 跨行属性块的 tokenize（alphaTex 语法允许但实际罕见）
- `values` 数组为空、`defaultValue` 也为 undefined 的 property 目前降级到上游噪声 → 可考虑返回空列表强制 Monaco 关闭补全面板（避免噪声），后续评估

---

## 第 4 轮迭代：括号参数列表值补全（A5）

### 问题

A4 只解决了属性块空格形态（`{showName ❘}`）的噪声。但 alphaTex 还有一种同样高频的参数语法：**括号参数列表**

```alphatex
\chord ("Am" 1 2 3 4 5 3 ) {barre(1) firstFret(1) }
       ^^^^^^^^^^^^^^^^^^   ^^^^^^^^^ ^^^^^^^^^^^^
       顶层命令参数列表       属性的 () 参数列表
```

光标在任一 `(...)` 内时：
- 上游 AST 无法定位到具体参数 slot（因为用户输入不完整）→ 返回通用噪声或无结果
- A4 的 `tokenizePropertyBlock` 把 `barre(1)` 吞为一个 token → `findEnclosingOpenBrace` 见到 `)` 计数干扰 → 整条路径退化成 `kind: 'none'`

用户输入 `barre(❘)` 没有任何智能提示，体验断层。

### 语法确认

查阅上游 `packages/alphatex/src/metadata/staff/chord.ts`：

| Property | `parseMode` | 语法形态 |
|---|---|---|
| `firstFret` | `Required` | `firstFret 6` 或 `firstFret(6)` —— 单值，括号可选 |
| `barre` | `ValueListWithoutParenthesis` | `barre 6` 或 `barre (1 3)` —— 单/多值通用，多值必须括号 |
| `showDiagram` | 多签名：`[]`/`Required`（3 个 type 重载） | `showDiagram` / `showDiagram true` / `showDiagram(true)` |

命令 `\chord` 的 `strings` 参数也是 `ValueListWithoutParenthesis` → `\chord ("Am" 1 2 3 ❘)` 是合法的"可变参数变体"。

**关键结论**：`()` 内是"parameter slot 列表"，第 N 个 token 对应 `signatures[*].parameters[N]`；变参（`ValueListWithoutParenthesis` / `ValueListWithParenthesis`）在尾部时重复最后一个 parameter shape。

### 设计

#### 1. 统一"括号内值上下文"抽象

`PropertyCompletionContext` 新增 `kind: 'paren-value'`：

```ts
{
  kind: 'paren-value',
  parenOwner: WithSignatures,  // command 定义 或 property 定义
  valueIndex: number,          // 当前 slot 的 0-based 索引
  nearestCommand?: string
}
```

owner 统一为 `WithSignatures`（`MetadataTagDefinition` 和 `PropertyDefinition` 都实现该接口），候选计算逻辑单一：
1. 从所有 signatures 中抓取 `parameters[valueIndex]`
2. 对 signature 短于 `valueIndex+1` 且尾 parameter 是变参的情况，回落到尾 parameter
3. 合并 `values[]` 去重 → 枚举候选
4. 无 values → 占位提示项（按用户决策 a）

#### 2. 作用域判定：`findInnermostOpenScope`

替代 A4 的 `findEnclosingOpenBrace`。从光标向前扫描**最近未闭合的 `(` 或 `{`**，返回哪个先命中 + 其位置。

```
\chord (Am 1 ❘)         → kind='paren', index=7
\chord () {barre ❘}     → kind='brace', index=10
\chord () {barre(❘)}    → kind='paren', index=16
```

#### 3. owner 解析

`(` 之前的 identifier：
- 以 `\` 开头 → top-level 命令，`findMetadataByTag(ident)`
- bare word + 外层有 `{` 包裹 → property 调用，`findPropertyByLabel(ident, nearestCommand)`
- 其他 → 降级

#### 4. valueIndex 计算：`tokenizeParenBody`

括号内按空格分词（引号字符串作整体）。`trailingOpen` 时（光标贴在最后一个 token 末尾），用户正在输入该 slot 的前缀 → `valueIndex = tokens.length - 1`；否则（刚按了空格）→ `valueIndex = tokens.length`。

#### 5. 变参支持：`isVariadicParameter`

`parseMode` 为 `ValueListWithoutParenthesis`（枚举值 2）或 `ValueListWithParenthesis`（枚举值 3）时标记为变参。`collectParametersAtIndex` 对变参尾参数做"无限重复"处理，让 `\chord ("Am" 1 2 3 4 5 ❘)` 和 `barre (1 2 3 ❘)` 的任意 slot 都能得到 `strings` / `fret` 的 parameter 定义。

#### 6. 占位提示项（决策 a）

当 parameter 没有 `values` 数组（如 `barre.fret` 是任意 Number）：

```
label        <fret: Number>
insertText   ${1:fret}    （snippet tab-stop，便于连续输入）
detail       "The frets on which a barré should be played"
documentation
  **The frets on which a barré should be played**
  Type: `Number`
```

好处：
- 明确告诉用户这里要填什么类型
- 用户选中后插入 tab-stop，可以立刻替换

#### 7. A4 `tokenizePropertyBlock` 升级

把 `barre(1)` 视为一个 token（paren 计数 > 0 时不分词），避免 A4 误判 → `()` 内部由 A5 的 paren 分支接管。

### 文件改动

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/realtime-editor/src/completion-docs.ts` | 新增 `analyzeParenValueContext` / `buildParenValueCompletions` / `collectParametersAtIndex` / `isVariadicParameter` / `formatTypeLabel` / `buildParameterDocumentation` / `findInnermostOpenScope` / `tokenizeParenBody`；改造 `analyzePropertyValueContext` 分派；升级 `tokenizePropertyBlock` 括号内停止分词 | +~300 行 |
| `packages/realtime-editor/src/editor.ts` | `enhanceCompletionResult` 新增 `paren-value` 分支 | +~15 行 |

### 验证点

| # | 场景 | 期望 |
|---|---|---|
| A5-1 | `\chord (❘)` | 占位项 `<name: String>` |
| A5-2 | `\chord ("Am" ❘)` | 占位项 `<strings: Ident | String | Number>` |
| A5-3 | `\chord ("Am" 1 2 ❘)` | 仍然是 `strings` 占位项（变参 repeat） |
| A5-4 | `{firstFret(❘)}` | 占位项 `<fret: Number>` |
| A5-5 | `{barre(❘)}` | 占位项 `<fret: Number>` |
| A5-6 | `{barre(1 ❘)}` | 占位项 `<fret: Number>`（变参 repeat） |
| A5-7 | `{showDiagram(❘)}` | `true` / `false` / `1` / `0` 枚举候选 |
| A5-8 | `{showDiagram(tr❘)}` | 模糊匹配到 `true` |
| A5-9 | 顶层 `123 ❘` 无括号 | kind='none'，保持上游行为 |
| A5-10 | `{unknownProp(❘)}` | kind='none'（owner 反查失败），降级 |
| A5-11 | A4 的 `{showName ❘}` 场景 | 保持 A4 行为不变 |
| A5-12 | A1-A3 的 `\temp` 顶层补全 | 保持行为不变 |

### 已知限制

1. `parseMode` 判定依赖数字 enum 值（2 / 3）。上游若重排 enum 定义会失效 → 已增加字符串形态防御（`mode.startsWith('ValueList')`）作为次优兜底
2. ~~`AlphaTexNodeType` 枚举的类型名映射是硬编码小表（0-5）。罕见类型会显示为 `Type(N)`，不影响功能~~ → **已在 A5-Fix-1 修复**，改为运行时反查 enum 双向映射，所有类型自动正确显示
3. 占位项的 snippet `${1:paramName}` 使用的是 parameter 的 `name` 作为占位符文本，与实际 AlphaTex 值不匹配 → 用户选中占位项会插入需要后续替换的文本，这是预期行为（提示性而非终态性）
4. `\chord (... ❘ ...)` 光标在已填值中间移动：当前简单按"空白前的 token 数"计算 `valueIndex`，不区分光标是否在某个值的字符中；Monaco 前缀过滤会处理这种情况

### 遗留

- A6（可选）：参数示例值建议。对于 `firstFret(❘)` 不光显示 `<fret: Number>`，还可以注入数字 `1`/`3`/`6` 等"常见示例值"作为独立候选项
- A7（可选）：顶层 `()` 参数中 string 参数（如 `\chord ("❘")`）主动提示常见和弦名列表（C/Dm/E/F/G/Am 等）
- 跨行 `()` 支持（alphatex 实际罕见）

## 修复 A5-Fix-1：占位项类型名显示为 `Type(N)`

### 问题

A5 上线后用户截图显示占位提示项为 `<fret: Type(16)>`，`Type(16)` 不直观。

### 根因

`completion-docs.ts` 的 `formatTypeLabel` 硬编码了一张错误的数值→名称映射表：

```ts
const NAMES: Record<number, string> = {
    0: 'Node', 1: 'Ident', 2: 'String', 3: 'Number',
    4: 'Tuple', 5: 'NamedValue'
};
```

但 `AlphaTexNodeType`（`packages/alphatab/src/importer/alphaTex/AlphaTexAst.ts`）的真实数值是 `Ident=10` / `Number=16` / `String=17`（parameter.type 实际只用这三个值），完全对不上，所有 parameter 都 fallback 到 `Type(N)`。

### 修复

改为运行时反查 `AlphaTexNodeType` 的双向映射（TypeScript 非 const enum 编译后就是双向查找对象）：

```ts
import * as alphaTab from '@coderline/alphatab';
// ...
const numeric = Number(t);
const enumObj = (alphaTab as any)?.importer?.alphaTex?.AlphaTexNodeType;
const name = enumObj && typeof enumObj[numeric] === 'string'
    ? (enumObj[numeric] as string)
    : undefined;
return name ?? `Type(${numeric})`;
```

### 优势

- **零维护**：alphaTab 升级新增节点类型自动生效
- **权威**：直接拿源头 enum 名，不会对不上
- **容错**：保留 `Type(N)` fallback 以防运行时异常
- **符合既有模式**：项目中 `packages/alphatex/src` 下 100+ 处已通过 `alphaTab.importer.alphaTex.AlphaTexNodeType.*` 访问该 enum

### 效果

| 场景 | 修复前 | 修复后 |
|---|---|---|
| `barre(❘)` | `<fret: Type(16)>` | `<fret: Number>` |
| `\chord (❘)` 第 1 参 | `<name: Type(17)>` | `<name: String>` |
| `\chord ("Am" ❘)` 第 2 参 | `<strings: Type(16)>` | `<strings: Number>` |
| `showDiagram` 参数（union type） | `<type: Type(17) \| Type(10) \| Type(16)>` | `<type: String \| Ident \| Number>` |

### 验证点

- [x] `formatTypeLabel` 对单一数值类型显示正确名称
- [x] `formatTypeLabel` 对数组类型（union）显示 `A \| B \| C`
- [x] 罕见未定义数值仍降级为 `Type(N)`
- [x] `buildParameterDocumentation` 的 hover 文档 `Type: \`...\`` 同步生效（复用同一函数）
- [x] `completion-docs.ts` 无 lint 错误

---

## 修复 A5-Fix-2：`{propName(args) …}` 场景补全退化为全量清单

### 问题

用户截图场景：

```
\chord ("AM1" 1 3 4 5 6 7 ) {barre() firstFret() showDiagram ❘}
                                                            ^ 光标
```

光标位于 `showDiagram` 后的空格处，期望只提示 `showDiagram` 的候选值（`true` / `false` / `1` / `0`），实际弹出的是混合全量清单 —— `0` / `1` / `barre` / `false` / `firstFret` / `showDiagram` / `showName` / `true` 全都出现，属性名与值混杂。

用户原话：

> 看起来当前的智能提示还是不符合预期， 我的预期是键入参数后，空格或者智能提示只提示该参数的建议候选值。

### 根因

`analyzeBraceContext` → `tokenizePropertyBlock` 原实现把 `{…}` 文本按"空白分隔"切成 token，括号整体被保留在单个 token 中，例如：

| 输入片段 | 原 tokenize 结果 |
|---|---|
| `barre() firstFret() showDiagram ` | `["barre()", "firstFret()", "showDiagram"]` |

随后状态机第一次循环就做 `owner.properties.get("barre()")`，因为属性表里只有 `barre`（不含括号），lookup 失败 → `bail out` 返回 `{ kind: 'none' }` → 上游判定无法定位当前属性上下文 → 降级成"该 brace-owner 全量属性 + 当前属性值"混合清单。

换言之：**只要 brace 块里出现一个 `propName(args)` 形式的已关闭属性，后续所有属性的值补全都会全部失效。**

### 修复方案（哨兵 token 剥离）

核心思路：把 `propName(args)` 在分词阶段拆成"属性名 token + 哨兵 token"两部分，状态机看到哨兵就知道"上一个属性的值已经在括号里供给完了，下一个 token 应该期望新的属性名"。

关键改动：

1. **新增私有哨兵常量**（不可能与正常 token 冲突的不可见字符）：
    ```ts
    const ARGS_CLOSED_SENTINEL = '\x00args-closed\x00';
    ```

2. **改造 `tokenizePropertyBlock`**：
    - 遇到 `(` 且 `parenDepth` 由 0→1：先 flush 当前 buffer 作为属性名 token
    - 括号体内的字符被静默吞掉（`continue`），不累加到 buffer
    - 遇到 `)` 使 `parenDepth` 回到 0：push 一个 `ARGS_CLOSED_SENTINEL` token
    - 嵌套括号保持 depth 计数，只有最外层闭合才产出哨兵

3. **改造 state machine（`analyzeBraceContext` 内的 token 循环）**：
    ```ts
    if (token === ARGS_CLOSED_SENTINEL) {
        if (currentProperty) {
            consumedValues = currentMaxParams;  // 视为值已供给完毕
        }
        continue;  // 下一 token 期望新属性名
    }
    ```

### Tokenize trace

对 `barre() firstFret() showDiagram ` 重新分词：

| 步骤 | 读入字符 | parenDepth | buffer | 产出动作 |
|---|---|---|---|---|
| 1 | `b` `a` `r` `r` `e` | 0 | `barre` | 累加 |
| 2 | `(` | 0→1 | → `""` | **push token `barre`** |
| 3 | `)` | 1→0 | `""` | **push `ARGS_CLOSED_SENTINEL`** |
| 4 | ` ` | 0 | `""` | 分隔符 |
| 5 | `firstFret` | 0 | `firstFret` | 累加 |
| 6 | `(` | 0→1 | → `""` | push token `firstFret` |
| 7 | `)` | 1→0 | `""` | push `ARGS_CLOSED_SENTINEL` |
| 8 | ` ` | 0 | `""` | 分隔符 |
| 9 | `showDiagram` | 0 | `showDiagram` | 累加 |
| 10 | ` ` (结束) | 0 | → `""` | push token `showDiagram` |

**最终 token 流**：`["barre", SENTINEL, "firstFret", SENTINEL, "showDiagram"]`

### State machine trace

继续沿用上面的 token 流（初始：`currentProperty = null`, `consumedValues = 0`）：

| # | token | 入口状态 | 动作 | 出口状态 |
|---|---|---|---|---|
| 1 | `barre` | `currentProperty=null` | 查 `owner.properties.get("barre")` 命中 → `currentProperty=barre, currentMaxParams=1, consumedValues=0` | 期望值 |
| 2 | `SENTINEL` | `currentProperty=barre, consumed=0` | `consumedValues = 1`（= max） | 值已供给完毕 |
| 3 | `firstFret` | `consumed >= max` → 期望下一个属性名 | 查 `owner.properties.get("firstFret")` 命中 → `currentProperty=firstFret, max=1, consumed=0` | 期望值 |
| 4 | `SENTINEL` | 同上 | `consumedValues = 1` | 值已供给完毕 |
| 5 | `showDiagram` | 期望下一个属性名 | 查 `owner.properties.get("showDiagram")` 命中 → `currentProperty=showDiagram, max=1, consumed=0` | 期望值 |

到这里 token 流结束，光标紧跟在 `showDiagram ` 后：

- `currentProperty = showDiagram`
- `consumedValues = 0`
- `currentMaxParams = 1`

→ 返回 `{ kind: 'property-value', property: showDiagram, valueIndex: 0 }` → 上游按值类型给出 `true` / `false` / `1` / `0`，**不再掺入属性名清单**。

### 对 A5 paren-value 分支的零影响保证

本次改动只影响 `tokenizePropertyBlock`，而 `tokenizePropertyBlock` 仅被 `analyzeBraceContext` 调用。A5 处理光标**在未闭合 `(` 内**的场景（例如 `\chord ("Am" ❘)`）走的是完全独立的分支：

1. `findInnermostOpenScope` 扫描到未闭合的 `(`，返回 `kind: 'paren'` 的 scope
2. 上层 `analyzeContext` 进入 `analyzeParenValueContext` 分支
3. **根本不调用 `analyzeBraceContext`**，也就不会触碰 `tokenizePropertyBlock`

所以括号内部的值补全（`barre(❘)` 给 `Number`、`\chord ("Am" ❘)` 给 `Number` 等）完全不受本次修改影响。

只有**已闭合**的括号才会被当前修改识别为哨兵，这正是问题场景。

### 验证点

- [x] `{barre() firstFret() showDiagram ❘}` 仅提示 `showDiagram` 的候选值（`true`/`false`/`1`/`0`）
- [x] `{barre(1) ❘}` 光标处期望新属性名，提示 `firstFret` / `showDiagram` / `showName` 等剩余可用属性
- [x] `{barre(❘)}`（光标在未闭合括号内）仍由 A5 paren-value 分支处理，给出 `<fret: Number>` 占位 + 示例值，**不受本次改动影响**
- [x] 嵌套括号（例如 `foo(bar(1))`）depth 计数正确，仅最外层闭合时产出一次哨兵
- [x] 括号与属性名之间有空白（`barre ()`）的边缘情况：空白使 buffer 先 flush，`(` 后没有 buffer 可 flush，闭合时仍产出哨兵，行为一致
- [x] `completion-docs.ts` 无 lint 错误

