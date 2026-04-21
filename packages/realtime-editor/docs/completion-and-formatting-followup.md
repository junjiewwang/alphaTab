# 智能补全问题修复 + 补全联动 + 格式化能力调研

> 状态：**需求 1 + 优化点 1 已实施（2026-04-21）**；**Fix A/B/C/D 补丁同日上线**，处理 beat 级 `{}` 无提示、chord 联动放错分支、`IInsertReplaceRange` 无效候选、property-name 前缀不完整四个回归；优化点 2（格式化）按用户决策暂不启动
> 建档时间：2026-04-21
> 关联：`completion-docs-enhancement.md`（上一阶段）、`tab-details-view.md`（相邻迭代）

---

## 实施进展（2026-04-21）

| 项 | 状态 | 实施摘要 |
|---|---|---|
| 需求 1（Bug） | ✅ 已完成 | 所有补全项注入 `IInsertReplaceRange { insert, replace }`；`findWordStartColumn` 外包 `Math.max(1, …)` 防御 |
| 优化点 1（chord 联动） | ✅ 已完成 | 新增 `chord-registry.ts`；`tokenizePropertyBlock` / `tokenizeParenBody` 暴露 `insideQuote`；`ch` 属性 + 引号内接管候选列表；空列表走 Issue 图标兜底 |
| Fix A（beat 块无提示回归） | ✅ 已完成 | `analyzeBraceContext` 引入 `resolveBracePropertyScope`，`{}` 没有 `\xxx` 前缀时回退到 `beatProperties`；`PropertyCompletionContext` 新增 `propertiesScope` 字段 |
| Fix B（chord 联动放错分支） | ✅ 已完成 | chord 联动从 paren-value 分支迁至 property-value 分支；`buildPropertyNameCompletions` 签名改为接受 scope map |
| Fix C（IInsertReplaceRange 无效候选） | ✅ 已完成 | Monaco `CompletionItem` 强校验要求 `insert.startColumn === replace.startColumn`，否则静默过滤；改为两段 range 都 `[wordStart, col)`；引号 `"` `'` 纳入 `WORD_BOUNDARY_CHARS` 避免吞引号 |
| Fix D（property-name 前缀不完整 No suggestions） | ✅ 已完成 | `analyzeBraceContext` 状态机对**尾部 open token** 不命中时短路返回 `property-name`，让 Monaco 按前缀过滤完整候选列表；`{barre(1) firstFret(2) s❘}` 补全 `s` → `showDiagram/showFingering/showName` |
| 优化点 2（格式化） | ⏸ 暂缓 | 用户决策「先不做格式化」，方案设计保留在下文备查 |

### 已确认决策汇总

- **Q1.1 修复范围**：全部补全项（统一通过 `correctedRange` 生效）
- **Q1.2 防御层**：`IInsertReplaceRange` + `Math.max(1, …)` 双保险
- **Q2.1 触发场景**：仅「引号内」补全（`ch "❘"`；引号外维持原行为）
- **Q2.2 空列表兜底**：显示 `CompletionItemKind.Issue` 占位提示
- **Q2.3 作用域**：当前 Monaco model 全文
- **Q2.4 扫描方式**：正则 `/\\chord\s*\(\s*(?:"([^"]*)"|'([^']*)')/g`
- **Q-A chord 候选样式**：仅显示和弦名（detail = "Declared chord"）
- **Q-B 缓存策略**：每次触发补全重扫全文（~10k 文档下子毫秒级，无需缓存）
- **Q-C 占位项形态**：`Issue` 图标 + 明确文案 + `sortText='\uFFFF'` + `filterText=''`
- **Fix A 宽松策略（Q=b）**：`{}` 未附着命令时默认走 `beatProperties`，优先让 beat 上下文（`{ch …}`、`{dy …}`）可用，代价是极端边缘态（孤立 `{}`）会展示 beat 属性列表，视为可接受噪声
- **Fix B 死代码处理（Q=a）**：paren-value 分支删除 `buildChCompletionsIfApplicable` 调用；`ch` 的联动只能在 property-value 分支触发（因 AlphaTex 语法 `ch` 值永远位于 brace 内部）

### 变更清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `packages/realtime-editor/src/editor.ts` | 修改 | `enhanceCompletionResult` 改用 `IInsertReplaceRange`；chord 联动迁至 property-value 分支；property-name 分支改用 `propertiesScope`；删除 paren-value 的 chord 联动死代码 |
| `packages/realtime-editor/src/completion-docs.ts` | 修改 | 新增 `CompletionRange` 类型别名；`resolveBracePropertyScope` 统一 command / beat 两种 scope；`tokenizePropertyBlock` / `tokenizeParenBody` 均返回 `insideQuote`；`PropertyCompletionContext` 新增 `propertiesScope` 与 `insideQuote`；`buildPropertyNameCompletions` 改为接受 scope map |
| `packages/realtime-editor/src/chord-registry.ts` | 新建 | 对外导出 `collectChordIds(model)`；单一职责，无缓存 |

### 手动验收路径

| # | 场景 | 预期 |
|---|---|---|
| 1 | `{ch❘` 选 `ch` 候选 | 变为 `{ch "|"}`，`{` 保留（range 修复生效） |
| 2 | 行首 `ch❘` | `wordStartCol=1`，`Math.max` 不越界 |
| 3 | 含 `\chord ("Am" ...)` 时输入 `{ch "❘"}` | 候选显示 `Am`（EnumMember，sortText 按声明顺序） |
| 4 | 无 `\chord` 声明时输入 `{ch "❘"}` | 显示 Issue 占位项（文案：未定义 \\chord） |
| 5 | `{ch ❘}`（引号外） | 走通用 property-value 逻辑，不注入 chord（`isBeatChProperty` 为 true 但 `insideQuote` 为 false → `buildChCompletionsIfApplicable` 返回 null） |
| 6 | `\chord ("❘"...)`（顶层声明） | paren-value 分支已移除 chord 联动，按 `buildParenValueCompletions` 给出参数占位，不误注入 |
| 7 | `{ch❘`（无 `\xxx` 前缀的 beat 块，**Fix A**） | `resolveBracePropertyScope` 回退到 `beatProperties`，返回 property-name 候选（`ch` 自身 + `dy`/`d`/`f`/`gr`/...） |
| 8 | `{dy ❘}`（beat 块 property-value） | 走通用 `buildPropertyValueCompletions`，展示 `dy` 的枚举值（`ppp/pp/mp/...`），chord 联动不介入（`isBeatChProperty(dy)` 为 false） |
| 9 | `\chord () {fi❘}`（command 块 property-name） | 走 owner.properties scope，列出 `firstFret/lastFret/showDiagram/...` |

---

## Fix A：beat 级 `{}` 完全无提示候选（回归）

### 问题现象

用户截图：在 `(0.3 3.5){ch ""}` 或输入 `{ch` 时，Monaco 弹出 "No suggestions"。

### 根因

初版 `analyzeBraceContext` 的 scope 解析路径：

```ts
const nearestCommand = findNearestCommand(...);  // beat 块返回 undefined
const owner = nearestCommand ? findMetadataByTag(nearestCommand) : undefined;
if (!owner?.properties) return { kind: 'none' };   // ← beat 块直接在这里 bail out
```

AlphaTex 的 `{}` 属性块有两种形态：

1. **command-scoped**：`\chord (…) {firstFret(3) showDiagram}`，owner 是 metadata
2. **beat-property**：`(0.1 1.2){ch "Am" dy ppp}`，没有 `\xxx` 前缀，scope 在全局 `beatProperties` 里

初版只处理了形态 1，形态 2 被错误降级为 `kind: 'none'` → 上游 LSP 兜底返回 "No suggestions"。

### 修复策略（Q=b 宽松回退）

抽出独立的 `resolveBracePropertyScope(nearestCommand)`：

```ts
function resolveBracePropertyScope(nearestCommand?: string): Map<string, PropertyDefinition> | undefined {
    if (nearestCommand) {
        const owner = findMetadataByTag(nearestCommand);
        if (owner?.properties && owner.properties.size > 0) {
            return owner.properties;         // Case 1：命令有 properties
        }
        return undefined;                    // 命令存在但无 properties → 不误导
    }
    return beatProperties;                   // Case 2：beat 块，回退到全局
}
```

`analyzeBraceContext` 的返回值全量携带 `propertiesScope`，所有下游判定统一基于 scope map，而不再依赖 `nearestCommand` 字符串做二次查表。

### 设计权衡

| 选项 | 含义 | 采纳 |
|---|---|---|
| a. 严格：无 `nearestCommand` 时保持 `none` | beat 块仍无法触发补全 | ❌ |
| **b. 宽松：默认回退到 `beatProperties`** | beat 块可用；孤立 `{}`（极罕见）会显示 beat 属性列表 | ✅ |

选 b 的原因：真实乐谱里 `{}` 绝大多数是 beat-property；降级噪声只是多显示若干候选，不会误插入错误文本。

---

## Fix B：chord 联动放在了错误分支（代码洁癖）

### 问题现象

Fix A 让 beat 块进入了 context 识别流程，但此时 `{ch "❘"}` 依然走通用 `buildPropertyValueCompletions` 拿到 `ch` 的默认值占位，没有触发 chord 联动。同时原先在 paren-value 分支的 `buildChCompletionsIfApplicable` 被证实为无效代码。

### 根因（语法层面）

AlphaTex 把 `{ch "name"}` 解析为：`ch` 是 brace-block 的 **property name**，`"name"` 是它的 **property value**。`analyzePropertyValueContext` 走 brace 分支而不是 paren 分支 → 初版挂在 paren-value 分支的 chord 联动永远不会触发。

### 修复策略（Q=a 移除死代码）

1. 把 `buildChCompletionsIfApplicable` 调用从 `paren-value` 分支**迁到** `property-value` 分支（放在 `buildPropertyValueCompletions` 之前，`isBeatChProperty` 门卫不命中时透明降级）。
2. 删除 `paren-value` 分支中原先的 chord 联动调用（死代码）。
3. `buildChCompletionsIfApplicable` 的参数类型从 `unknown owner` 收紧为 `PropertyDefinition def`，去掉运行时的 `as Partial<…>` 兜底。
4. `buildPropertyNameCompletions` 的签名从接受 `commandTag: string` 改为接受 `scope: Map<string, PropertyDefinition>`，配合 `propertiesScope` 的归一化，消除了 editor 层对 metadata tag 的二次反查。

### 入口触发条件汇总

| 触发路径 | 条件 | 接管范围 |
|---|---|---|
| `property-value` + `ch` + `insideQuote` | `currentProperty.property === 'ch'` && 光标位于 `"…"` 内部 | 完全接管：返回 chord 名列表或 Issue 占位 |
| `property-value` + `ch` + 引号外 | `buildChCompletionsIfApplicable` 返回 null | 降级到 `buildPropertyValueCompletions`（占位或 defaultValue） |
| `property-value` + 非 `ch` | 同上 | 降级到 `buildPropertyValueCompletions`（枚举 / defaultValue） |
| `paren-value`（`\chord (…)`） | — | 不触发 chord 联动，直接走通用 `buildParenValueCompletions` |

---

## Fix C：IInsertReplaceRange 被 Monaco 静默过滤（回归）

### 问题现象

用户反馈（控制台截图）：补全候选被成功构造并打印到控制台，但编辑区下拉菜单显示 "No suggestions"。Monaco 控制台出现：

```
[suggest] IGNORE invalid completion item from undefined
{label: 'Am', kind: 20, insertText: 'Am', detail: 'Declared chord', …}
```

候选**生成成功**却被 **IGNORE** —— 所有候选静默消失。

### 根因

Monaco 的 `CompletionItem` 构造函数（`monaco-editor/esm/vs/editor/contrib/suggest/browser/suggest.js`）对 `IInsertReplaceRange` 形态的 range 做了严格校验：

```ts
this.isInvalid = this.isInvalid
    || Range.spansMultipleLines(completion.range.insert)
    || Range.spansMultipleLines(completion.range.replace)
    || completion.range.insert.startLineNumber !== position.lineNumber
    || completion.range.replace.startLineNumber !== position.lineNumber
    || completion.range.insert.startColumn !== completion.range.replace.startColumn;
    //                                            ↑ 这条！
```

即 `insert.startColumn` **必须** 等于 `replace.startColumn`，否则整个 `CompletionItem.isInvalid=true` → 被 UI 层静默过滤。

Fix A/B 时的初版实现是：

```ts
insert:  [line, position.column, line, position.column]  // 零宽锚点在光标处
replace: [line, wordStartCol, line, position.column]     // 覆盖用户已键入前缀
```

当 `wordStartCol < position.column`（任何时候用户键入了至少一个字符）`startColumn` 就不相等 → 所有候选被过滤。

### 修复策略

让 `insert` 和 `replace` 的 `startColumn` 对齐到同一个 `wordStartCol`：

```ts
const correctedRange: monaco.languages.CompletionItemRanges = {
    insert:  new monaco.Range(lineNumber, wordStartCol, lineNumber, position.column),
    replace: new monaco.Range(lineNumber, wordStartCol, lineNumber, position.column)
};
```

语义上两者形状相同；在 AlphaTex 补全场景中用户几乎不会在 word 中间触发补全，`insert` / `replace` 模式差异忽略不计。

### 附带修复：引号被吞

为了让 chord 联动在 `{ch "❘"}` 引号内的 `wordStartCol` 不回溯穿过左引号，把 `"` 和 `'` 加入 `WORD_BOUNDARY_CHARS`。否则光标左扫会把左引号吞进 replace 范围，接受 `Am` 补全后文本变成 `{ch Am"}`。

---

## Fix D：property-name 前缀不完整导致 "No suggestions"

### 问题现象

在 `{barre(1) firstFret(2) s❘}` 紧跟 `s` 后按补全快捷键，Monaco 显示 "No suggestions" —— 预期应该列出 `showDiagram/showFingering/showName`（按 `s` 前缀过滤 `\chord` 的 property 列表）。同样场景改为空格（`{barre(1) firstFret(2) ❘}`）按快捷键却能正确显示完整候选。

### 根因

`analyzeBraceContext` 的状态机遍历 tokens 时，对**期望 property name 位置**的 token 调用：

```ts
const def = propertiesScope.get(token.toLowerCase());
if (!def) {
    return { kind: 'none' };       // ← 直接 bail
}
```

这个 `none` 让 `analyzePropertyValueContext` 整体返回无效上下文，editor.ts 降级到上游 LSP，上游对 `{}` 内部也无特殊处理 → 空候选。

问题在于：用户键入的 `s` **只是合法 property 的前缀**（`showDiagram` 的首字母），并非非法内容。状态机不应把"合法前缀"与"非法文本"混为一谈。

### 修复策略

把"尾部 open token"和"已闭合 token"区分对待：

| Token 角色 | 判定条件 | 不命中时的处理 |
|---|---|---|
| **已闭合 token** | 遍历过程中后面还有其他 token（被 whitespace/`)` flush 过） | 必定是完成态，仍然要求命中；不命中 → `none`（上下文真实错误，不误导） |
| **尾部 open token** | `idx === tokens.length - 1` 且 `trailingOpen=true` | 是正在键入的前缀，**短路返回 `property-name`**，让 Monaco 拿完整列表后按前缀过滤 |

核心改动（`completion-docs.ts`）：

```ts
const trailingTokenIdx = trailingOpen && tokens.length > 0 ? tokens.length - 1 : -1;

for (let idx = 0; idx < tokens.length; idx++) {
    // ...
    if (!currentProperty || consumedValues >= currentMaxParams) {
        const def = propertiesScope.get(token.toLowerCase());
        if (!def) {
            if (idx === trailingTokenIdx) {
                // 尾部前缀——短路返回 property-name
                return { kind: 'property-name', nearestCommand, propertiesScope };
            }
            return { kind: 'none' };
        }
        // ...
    }
}
```

### 为什么不能依赖 Step 5 推导

最初尝试过 `break` 而让 Step 5 的 trailingOpen 分支收敛。但 `break` 时 `currentProperty` 可能是**上一个已完成的 property**（如 `firstFret`，consumedValues=max=1），Step 5 的判断链：

```ts
if (currentProperty && consumedValues === 0) → property-name   // 不命中
if (currentProperty) → property-value                          // ← 误命中！
```

会把 `s` 前缀误判为"正在填 firstFret 的值" → 走 property-value 分支 → 错误候选。因此必须在发现尾部不命中时**立即 return**，不让 Step 5 介入。

### 覆盖场景推演

| 场景 | tokens | trailingOpen | 预期 | 实际 |
|---|---|---|---|---|
| `{s❘}` | `['s']` | true | property-name（前缀） | ✅ return 命中（单 token，trailingIdx=0，不命中 → return） |
| `{❘}` | `[]` | false | property-name | ✅ 不进 loop → Step 5 兜底 |
| `{ch❘}` | `['ch']` | true | property-name（ch 自身也是合法 property，列出 beat 全量） | ✅ `ch` 命中 → loop 结束 → Step 5 `consumed===0` → property-name |
| `{barre(1) firstFret(2) s❘}` | `['barre', SENT, 'firstFret', SENT, 's']` | true | property-name（前缀） | ✅ 前 4 token 走通 + 第 5 token 短路 return |
| `{showDiagram tr❘}` | `['showDiagram', 'tr']` | true | property-value（value 前缀） | ✅ `tr` 走 else 分支 consume++ → Step 5 property-value |
| `{barre(1) foo❘}` | `['barre', SENT, 'foo']` | true | property-name（`foo` 不合法但是前缀） | ✅ 前 2 token 走通 + `foo` 不命中且 isTrailing → 短路 return property-name（让 Monaco 过滤为空列表，UI 优雅展示"无匹配"） |
| `{barre(1) foo(2) bar}` | 无 trailingOpen + `foo` 非法 | false | none | ✅ `foo` 是已闭合非法 token → bail none |

---


## 需求 1：补全插入时不应覆盖左侧结构字符（Bug）

### 问题描述

用户反馈现象：在编辑区域触发智能补全，选中补全项后，光标**左侧的一个字符**被替换掉。

典型复现：行内容 `{ch`，光标紧贴在 `h` 后 → 触发补全（例如 `ch` 属性或 `\chord` 命令）→ 应用补全后，发现 `{` 变成了补全项的首字符（视觉上看起来"补全项整体向左偏移了一格"）。

**预期行为**：保留左侧的 `{`（以及 `(`、`)`、`}`、`|` 等结构字符），仅替换用户当前正在键入的词前缀。

### 代码定位

相关代码：`packages/realtime-editor/src/editor.ts`

```ts
const WORD_BOUNDARY_CHARS = new Set([' ', '\t', '(', ')', '{', '}', '|', ',', '.']);

function findWordStartColumn(model, position): number {
    const lineContent = model.getLineContent(position.lineNumber);
    let idx = position.column - 2; // column-1 是光标前一字符的 0-based index
    while (idx >= 0 && !WORD_BOUNDARY_CHARS.has(lineContent[idx])) {
        idx--;
    }
    return idx + 2;
}
```

然后每个 `suggestion.range = correctedRange` 被统一设置为 `[wordStartCol, position.column)`。

### 理论验证 vs 实际现象

用 `{ch|`（光标在 `h` 后，`position.column = 4`）手工推导：

| 步骤 | `idx` | `lineContent[idx]` | 是否边界 | 动作 |
|---|---|---|---|---|
| init | 2 | `h` | 否 | `idx--` |
| | 1 | `c` | 否 | `idx--` |
| | 0 | `{` | **是** | 循环结束 |
| return | | | | `0 + 2 = 2` |

→ `correctedRange = [2, 4)`，替换的是 `c` 和 `h`，保留 `{` ✓（**理论正确**）。

### 实际为什么仍然覆盖？两种潜在根因

#### 根因候选 A：Monaco 在零宽度 range 下回退到默认 word detection

当 `correctedRange` 为零宽度（例如用户刚键入 `{` 立即触发，尚未输入任何前缀，光标紧贴 `{` 后，`[2, 2)`），Monaco 部分版本会**忽略我们给定的 range**，转而使用自身 word detection 逻辑重新计算替换范围。

Monaco 默认 `wordPattern`：
```
/(-?\d*\.\d\w*)|([^\`~!@#%^&*()\-=+\[{\]}\\|;:'",.<>/?\s]+)/g
```

理论上这个正则把 `{` 当作边界字符，不应回溯。但在某些 monaco-editor 版本 + 配合 `insertTextRules: InsertAsSnippet` 模式时，会出现 "overwriteBefore 1 char" 的副作用，特别是当 snippet 以某些"可能是 word 起始"字符（如 `\`）开头时。

#### 根因候选 B：上游 LSP 的 `insertText` 带前导重复字符

`\chord` 的 snippet：
```
\chord ("{$1}" $2)$0
```

以 `\` 开头。若 Monaco 发现光标前字符是 `{`、而 snippet 的逻辑起始是 `\chord`，在某些匹配策略下会把 range 扩展以吸收"前一字符"——这是上游 LSP 在 VSCode 和 Monaco 不同语义下的差异。

#### 根因候选 C：`{` 触发字符 + `quickSuggestions` 时序

用户刚键入 `{`，`{` 作为 trigger character 触发 provider。此时 Monaco 的"当前光标 word"为空 → 它可能将下一次字符插入视为**替换当前 word**。若此时弹出的补全项的 `range` 是我们给的零宽 `[2,2)`，而用户接下来按 `Tab`/`Enter` 接受补全项，Monaco 有可能在接受前按自身 wordPattern 回溯并扩展 range 一格。

### 修复方案

不论具体根因是 A/B/C 哪一个，**稳健的根治方案是显式使用 `IInsertReplaceRange`** 而不是单一 `IRange`：

```ts
// 原
suggestion.range = correctedRange;  // 单 range，Monaco 可能"自主扩展"

// 改
const wordStart = findWordStartColumn(model, position);
suggestion.range = {
    // 插入点：光标当前位置（不影响左侧任何字符）
    insert: new monaco.Range(
        position.lineNumber, wordStart,
        position.lineNumber, position.column
    ),
    // 替换点：显式告诉 Monaco "只替换从 wordStart 到光标的字符，不要自作主张往前扩"
    replace: new monaco.Range(
        position.lineNumber, wordStart,
        position.lineNumber, position.column
    )
};
```

当 Monaco 收到 `{ insert, replace }` 结构时，会严格使用这两个 range，而不再走内部 word detection 回退。

**同时增加兜底防御**：强制 `startColumn` 不小于某个"最近结构字符 +1" 的位置——虽然 `findWordStartColumn` 理论上已经保证这点，但写一层 assertion：

```ts
function findWordStartColumn(model, position): number {
    const lineContent = model.getLineContent(position.lineNumber);
    let idx = position.column - 2;
    while (idx >= 0 && !WORD_BOUNDARY_CHARS.has(lineContent[idx])) {
        idx--;
    }
    // 防御：如果光标前一字符是结构符，直接返回光标列（零宽 insertion point）
    const startCol = idx + 2;
    return Math.max(startCol, 1);
}
```

（目前已经是 `idx + 2`，`idx >= -1` 时 `startCol >= 1`，不会越界；但补上 `Math.max` 可防将来其他调用路径传入异常值。）

### 验证用例

| 输入（`|` 为光标） | 预期 range | 预期补全 `\chord` 后文本 |
|---|---|---|
| `|`（空行） | `[1, 1)` | `\chord ("<name>" <strings>)` |
| `{|` | `[2, 2)` | `{\chord (...)` |
| `{ch|` | `[2, 4)` | `{\chord (...)` |
| `{ c|`（有空格） | `[3, 4)` | `{ \chord (...)` |
| `\ch|` | `[1, 4)` | `\chord (...)` |
| `(0.1){ch|}` | `[7, 9)` | `(0.1){\chord (...)}` |

所有用例都应**保留左侧结构字符**。

### 实施成本

- 小：只改 `enhanceCompletionResult` 中的 `suggestion.range =` 赋值点（2 处），把单 Range 改为 `{ insert, replace }` 对象
- 回归风险：低，`IInsertReplaceRange` 是 Monaco 正式 API，和现有单 Range 行为在非边界场景完全一致

---

## 优化点 1：`ch` 属性的参数值补全联动已定义的 chord 列表

### 现状

在 beat 属性上下文 `... {ch "|"}` 中，参数名是 `chordName`，类型是 `String`。目前 `buildParenValueCompletions` 对它只能生成一个占位提示 `<chordName: String>`，因为 `ch` 的 `values[]` 为空（开放域字符串）。

### 期望

扫描当前文档中所有 `\chord ("NAME" ...)` 定义，把 `NAME` 作为候选值展示。例如用户定义了：

```alphatex
\chord ("Am" 1 2 3 4 5 3)
\chord ("C" 0 1 0 2 3 x)
\chord ("G" 3 2 0 0 0 3)
```

则在 `{ch "|"}` 处触发补全时，应弹出：`Am` / `C` / `G` 三项候选。

### 方案设计

#### 关键技术点

1. **扫描源**：当前活动 model 的完整文本。不能用 cached AST（因为用户可能处于未保存/正在编辑状态），每次触发补全时重算。
2. **识别模式**：`\chord` 后的第一个字符串参数。
3. **触发时机**：`analyzeParenValueContext` 发现 `parenOwner.tag === 'ch'` 且 `valueIndex === 0` 时。

#### 提取算法选择

| 方案 | 实现 | 优点 | 缺点 |
|---|---|---|---|
| **R1 正则** | `/\\chord\s*\(\s*"([^"]+)"/g` | 零依赖、快 | 不处理嵌套引号、字符串转义等边缘 |
| **R2 词法分析** | 复用 `completion-docs.ts` 中已有的 tokenize helper | 健壮 | 需要小改造共享 token 扫描 |
| **R3 AST 遍历** | 调用 `AlphaTexParser` 拿完整 AST | 最权威 | 每次补全都解析全文 → 性能敏感 |

**推荐 R1**（首阶段）。理由：
- `\chord` 的首参数按定义是字符串字面量，AlphaTex 不允许字符串内含未转义 `"`
- 实际代码库内 `\chord ("NAME" ...)` 写法非常规范
- 最坏情况（正则漏识别）只是候选少一个，不会误导
- 可升级到 R2/R3 但以 **R1 + 去重** 作为首版完全够用

#### 数据流

```
触发补全
  └→ analyzeParenValueContext 判定 kind = 'paren-value'
       └→ owner = ch, valueIndex = 0
            └→ buildParenValueCompletions 入口
                 └→ 如果 owner.tag === 'ch' && valueIndex === 0
                      └→ 调用新 helper collectDefinedChordNames(model)
                      └→ 把返回的 chord name 数组转为 CompletionItem[]
                           （kind = EnumMember, insertText = "NAME"，带引号还是不带引号？）
                      └→ 若数组为空，降级走现有占位提示逻辑
```

#### 边界决策

| 问题 | 选项 |
|---|---|
| **a1** 补全插入时是否带引号？（用户光标可能已经在引号内也可能在引号外） | **a**. 智能判断：如果光标前是 `"`，插入纯名字；否则插入 `"NAME"` / **b**. 始终插纯名字（最简单） |
| **a2** 是否对名字去重？同名视为同一候选？ | **a**. 去重 / **b**. 保留重复（罕见） |
| **a3** 扫描范围 | **a**. 当前 model 全文 / **b**. 仅扫描光标所在 staff 内 / **c**. 所有 model |
| **a4** 除 `ch` 外，是否还对其他"引用 chord 名字"的属性也支持？（如果有的话） | **a**. 先仅 `ch` / **b**. 对所有类型为 `String` 且 tag 匹配 chord-reference-like 的属性 |

**推荐默认**：a1=a、a2=a、a3=a、a4=a（先仅 `ch`，观察用户反馈再扩）。

#### 模块放置

新增 helper：`packages/realtime-editor/src/chord-registry.ts`（单一职责：从 model 文本提取 chord 定义）

```ts
export function collectDefinedChordNames(model: monaco.editor.ITextModel): string[];
```

在 `completion-docs.ts` 的 `buildParenValueCompletions` 中按条件调用。

### 遗留问题

- **光标位置判断**：用户光标可能在 `{ch |}`（引号外，属性值 index=0）或 `{ch "|"}`（引号内）。这两种场景的 `insertText` 需不同处理。**需要在 `analyzeParenValueContext` 中新增引号内/外的细分**，或在 insertText 时看"光标前一字符是否为 `"`"做就地判断。
- **重复定义**：用户可能多次 `\chord ("Am" ...)` 覆盖 —— 简单去重策略足够。
- **跨文件**：不考虑（浏览器多 tab 是独立 model，用户引用的 chord 必须在当前 tab 定义）。

### 实施成本

中。新增一个扫描模块（~40 行）+ `buildParenValueCompletions` 分支（~20 行）+ `analyzeParenValueContext` 可能的引号细分（~20 行）+ 文档更新。

---

## 优化点 2：AlphaTex 格式化能力

### 现状排查

| 位置 | 状态 |
|---|---|
| `packages/lsp/src/server/` | **未提供** `DocumentFormatting` 相关能力 |
| `packages/alphatab/src/exporter/AlphaTexExporter.ts` | ✅ 存在「Score → AlphaTex 字符串」导出器，会处理缩进（`AlphaTexWriter` 有 `indent/outdent`） |
| `packages/alphatab/src/importer/alphaTex/AlphaTexParser.ts` | ✅ 存在完整 parser，产出 `AlphaTexScoreNode` 等 AST |
| `AlphaTexAst.ts` | ✅ 含 `AlphaTexComment` 节点类型（说明 AST 能保留注释） |

结论：**alphaTab 本身没有现成的"格式化器"API**，但有两套可用原材料。

### 方案对比

#### M1：基于 `AlphaTexExporter`（Score → Text）

**流程**：
```
currentText → AlphaTexImporter.readScore() → Score 对象
              → AlphaTexExporter.export(score) → 格式化后文本
```

| 维度 | 评价 |
|---|---|
| 实现成本 | **低**。Score import + AlphaTexExporter 两步都是现成 API |
| 缩进一致性 | ✅ Exporter 内置 `AlphaTexWriter` 缩进逻辑 |
| 注释保留 | ❌ **Score 模型丢失注释**，`// comment` 会消失 |
| 空行保留 | ❌ 丢失 |
| 用户自定义排版 | ❌ 完全被 exporter 重新排版 |
| 语义等价 | ✅（round-trip 通过 alphaTab 内部 test 验证过） |
| 错误处理 | 如果源文件有语法错误，import 会失败 → 格式化失败降级 |

**适用场景**：用户接受"格式化 = 完全重排"的行为，用精确但破坏性的格式化换来可读性。

#### M2：基于 AST Printer（Text → AST → Text）

**流程**：
```
currentText → AlphaTexParser.parse() → AlphaTexScoreNode (AST)
              → 自写 astPrinter(ast, options) → 格式化后文本
```

| 维度 | 评价 |
|---|---|
| 实现成本 | **高**。需要为每种 AST 节点（Bar/Beat/Note/MetaData/Properties/...）写 pretty-print 逻辑 |
| 缩进一致性 | ✅ 自控 |
| 注释保留 | ✅（因为 `AlphaTexComment` 在 AST 中） |
| 空行保留 | ⚠️ 取决于 parser 是否记录空行（一般不记录） |
| 用户自定义排版 | 部分保留（注释所在行的相对位置） |
| 语义等价 | ✅ 基于 AST |
| 错误处理 | AST 是 partial 的 → 可对有错的部分原样保留 |

**适用场景**：用户不希望失去注释；愿意为更精细的格式化投入工程成本。

#### M3：Prettier 插件风格

基于 M2，按 prettier 的 Doc IR 思路写 printer（支持 width-aware 换行）。成本 **极高**，且 alphaTab 社区用户基数未必需要这么重的格式化。**暂不考虑**。

#### M4：最小化格式化（Lightweight Reformat）

只做"正则替换级"的小改动：
- 统一 `{` / `(` 前后的空格
- 合并多余空行（连续 >= 3 个换行压到 2 个）
- 对齐 `\chord (...)` 的对齐

| 维度 | 评价 |
|---|---|
| 实现成本 | **极低** |
| 破坏性 | 低（只改可见空白，不动内容） |
| 注释保留 | ✅ |
| 语义等价 | ✅（只改空白） |
| 收益 | 中（重排版美感不如 M1/M2） |

### 推荐决策

两阶段：

1. **阶段 A（首版）**：实现 **M4 Lightweight Reformat**
   - 注册 Monaco 的 `DocumentFormattingEditProvider`
   - 支持 `Shift+Alt+F`（VSCode 默认绑定）
   - 规则集从 3-5 条起步，按用户反馈扩展
   - 永远不破坏用户注释和内容

2. **阶段 B（按需）**：若用户要求"完全重排"，再实现 **M1 基于 Exporter**
   - 作为独立命令 `AlphaTex: Reformat with Exporter (destructive)`，**不**绑定默认快捷键
   - 执行前弹提示"注释和自定义排版将丢失，是否继续"

**M2 AST Printer 暂不投入**，除非 M4 明显不够用。

### 实施成本

- 阶段 A：低，约 100 行（provider 注册 + 4-5 条规则实现 + 单测）
- 阶段 B：中等，约 50-80 行（import + export + confirm dialog）
- 阶段 A 和 B 互不冲突，可并存

### 遗留问题

- **需要确定 M4 的具体规则集**。候选清单：
  - [ ] 连续 `\n` 超过 2 个压到 2 个
  - [ ] `{` / `}` 两侧空格规范化（`{ foo }` vs `{foo}`）
  - [ ] `(` / `)` 两侧空格规范化
  - [ ] 行尾空格去除
  - [ ] Tab → 4 空格（或根据 editor 设置）
  - [ ] `|` 两侧空格规范化（小节分隔符）
- **是否支持 format on save** 需要单独开关（默认关闭，避免意外改动）
- **是否支持 format selection**（`editor.action.formatSelection`）—— provider 只注册 `DocumentFormattingEditProvider` 不支持 range；如果要支持，需加 `DocumentRangeFormattingEditProvider`

---

## 整体实施顺序建议

| 优先级 | 需求 | 实施成本 | 用户价值 |
|---|---|---|---|
| **P0** | 需求 1（补全覆盖字符 bug） | 小 | 高 —— 明显 bug，影响日常使用 |
| **P1** | 优化点 1（chord 补全联动） | 中 | 高 —— 用户有明确期待 |
| **P2** | 优化点 2-阶段 A（轻量格式化） | 低 | 中 —— 美化用，不影响功能 |
| **P3** | 优化点 2-阶段 B（基于 Exporter 的破坏性格式化） | 中 | 低 —— 按需 |

---

## 需要确认的决策清单

### 对需求 1 ✅ 已确认并实施
- ~~Q1.1~~ → 全部补全项
- ~~Q1.2~~ → `IInsertReplaceRange` + `Math.max`

### 对优化点 1 ✅ 已确认并实施
- ~~Q2.1~~ → 引号内触发
- ~~Q2.2~~ → Issue 占位项兜底
- ~~Q2.3~~ → 当前 model 全文
- ~~Q2.4~~ → 正则扫描

### 对优化点 2 ⏸ 暂缓
- Q3.1-Q3.4 均待用户启动格式化需求时再决策

---

## 变更清单预估（供需求评审参考）

### 需求 1
- `packages/realtime-editor/src/editor.ts`：修改 `enhanceCompletionResult` 中的 range 赋值（~20 行）

### 优化点 1
- `packages/realtime-editor/src/chord-registry.ts`：新文件（~40 行）
- `packages/realtime-editor/src/completion-docs.ts`：`buildParenValueCompletions` 新增分支 + `analyzeParenValueContext` 引号细分（~40 行）
- `packages/realtime-editor/docs/completion-docs-enhancement.md`：追加「A6 动态 chord 联动」章节

### 优化点 2-阶段 A
- `packages/realtime-editor/src/formatter.ts`：新文件（~80 行，含规则）
- `packages/realtime-editor/src/editor.ts`：注册 `DocumentFormattingEditProvider`（~15 行）
- `packages/realtime-editor/src/constants.ts`：可能新增格式化规则开关（~5 行）
- 新文档：`packages/realtime-editor/docs/alphatex-formatting.md`
