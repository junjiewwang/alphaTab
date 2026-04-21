import * as alphaTab from '@coderline/alphatab';
import { scoreMetaData, staffMetaData } from '@coderline/alphatab-alphatex/definitions';
import type { MetadataTagDefinition, PropertyDefinition } from '@coderline/alphatab-alphatex/types';
import { registerAlphaTexGrammar } from '@coderline/alphatab-monaco/alphatex';
import { basicEditorLspIntegration } from '@coderline/alphatab-monaco/lsp';
import { addTextMateGrammarSupport } from '@coderline/alphatab-monaco/textmate';
import * as monaco from 'monaco-editor';
// @ts-expect-error Monaco worker is provided by Vite
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { collectChordIds } from './chord-registry';
import {
    analyzePropertyValueContext,
    buildParenValueCompletions,
    buildPropertyNameCompletions,
    buildPropertyValueCompletions,
    detectDefinitionContext,
    findDefinitionByLabel,
    renderDefinitionMarkdown,
    renderExamplesOnly
} from './completion-docs';
import { dom, state } from './state';
import { escapeHtml, load } from './utils';

// ─── Monaco 环境 ────────────────────────────────────────────

async function setupMonaco(): Promise<void> {
    const host = self as typeof self & {
        MonacoEnvironment?: {
            getWorker: () => Worker;
        };
    };

    host.MonacoEnvironment = {
        getWorker() {
            return new editorWorker();
        }
    };

    const onigurumaWasm = await load<ArrayBuffer>(
        new URL('vscode-oniguruma/release/onig.wasm', import.meta.url),
        'arraybuffer'
    );
    const textMateSupport = addTextMateGrammarSupport(onigurumaWasm);
    await registerAlphaTexGrammar(textMateSupport);
}

// ─── 主题定义 ────────────────────────────────────────────────

/**
 * 自定义 Monaco 主题 — 针对 AlphaTex TextMate Grammar 的 Token 规则
 *
 * TextMate Grammar (alphatex.tmLanguage.json) 定义的 scope 与此处 token 规则的映射：
 *
 * | TextMate Scope                         | Token 匹配                    | 颜色     | 含义           |
 * |----------------------------------------|-------------------------------|----------|----------------|
 * | keyword.metadata.alphatex              | keyword                       | #f1b75e  | \title 等元数据 |
 * | string.quoted.single/double.alphatex   | string                        | #f5e6bf  | 字符串字面量    |
 * | constant.numeric.decimal.alphatex      | number / constant.numeric     | #8dd8ff  | 品位号/弦号    |
 * | comment.block/line.alphatex            | comment                       | #6f7a97  | 注释（斜体）   |
 * | variable.identifier.alphatex           | variable                      | #c8d3e6  | 标识符/属性名   |
 * | punctuation.bar.alphatex               | punctuation.bar               | #f1b75e88| 小节线 |        |
 * | punctuation.dot.alphatex               | punctuation.dot               | #6f7a97  | 品位分隔符 .   |
 * | constant.character.escape.alphatex     | constant.character.escape     | #8dd8ff  | \uXXXX 转义   |
 *
 * Monaco 的 token 匹配策略：会尝试从最具体的 scope 开始匹配（如 `punctuation.bar`），
 * 逐步回退到更泛化的 scope（如 `punctuation`）。因此可以为特定 scope 定义精确颜色。
 */
function defineMonacoTheme(): void {
    monaco.editor.defineTheme('alphatex-workbench', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            // ── 核心语法元素 ──
            { token: 'keyword', foreground: 'f1b75e' },                // 元数据关键字：\title \tempo \track 等
            { token: 'string', foreground: 'f5e6bf' },                 // 字符串字面量："Hello" 'World'
            { token: 'number', foreground: '8dd8ff' },                 // 数字：品位号、弦号、时值
            { token: 'constant.numeric', foreground: '8dd8ff' },       // 显式匹配 constant.numeric.decimal scope

            // ── 注释 ──
            { token: 'comment', foreground: '6f7a97', fontStyle: 'italic' },  // 注释：// 和 /* */

            // ── 标识符 ──
            { token: 'variable', foreground: 'c8d3e6' },              // 标识符/属性名：属性块 {} 中的属性

            // ── 标点符号（AlphaTex 特有） ──
            { token: 'punctuation.bar', foreground: 'f1b75e88' },     // 小节线 |（半透明金色，视觉降级）
            { token: 'punctuation.dot', foreground: '6f7a97' },       // 品位分隔符 .（与行号同色，低调）
            { token: 'punctuation.asterisk', foreground: '6f7a97' },  // 重复标记 *

            // ── 转义字符 ──
            { token: 'constant.character.escape', foreground: '8dd8ff' }  // \uXXXX 等转义序列
        ],
        colors: {
            'editor.background': '#0b1020',
            'editor.lineHighlightBackground': '#131b33',
            'editor.foreground': '#f7f2e8',
            'editorCursor.foreground': '#8dd8ff',
            'editor.selectionBackground': '#27436c88',
            'editor.inactiveSelectionBackground': '#27436c44',
            'editorLineNumber.foreground': '#6f7a97',
            'editorLineNumber.activeForeground': '#f1b75e',
            'editorIndentGuide.background1': '#1f2740',
            'editorIndentGuide.activeBackground1': '#4d618d',
            'editorBracketMatch.background': '#27436c44',             // 匹配括号的背景高亮
            'editorBracketMatch.border': '#8dd8ff44'                  // 匹配括号的边框
        }
    });
}

// ─── LSP 补全增强（非侵入式） ─────────────────────────────────

/**
 * 将上游 `MetadataTagDefinition` 转换为 Monaco `CompletionItem`。
 *
 * 复刻自上游 `completion.ts` 的 `metaDataDocToCompletion()` 逻辑，
 * 但使用 Monaco 原生类型而非 LSP 类型（避免引入 LSP 依赖）。
 *
 * @param def - 上游元数据定义（来自 `@coderline/alphatab-alphatex/definitions`）
 * @returns Monaco CompletionItem
 */
function metadataToCompletionItem(
    def: MetadataTagDefinition
): monaco.languages.CompletionItem {
    return {
        label: def.tag,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: def.snippet,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: def.shortDescription ?? undefined,
        documentation: def.longDescription
            ? { value: def.longDescription }
            : undefined,
        range: undefined!  // 将在 enhanceCompletionResult 中统一设置
    };
}

/**
 * 上游 LSP 在 `barIndex > 0` 时遗漏的补全项缓存。
 *
 * 上游 `completion.ts` 的 `createMetaDataCompletions()` 在光标位于
 * 第一小节之后时，只返回 `structuralMetaData` + `barMetaData`，
 * 排除了 `scoreMetaData`（\title、\chordDiagramsInScore 等 ~30 个）
 * 和 `staffMetaData`（\chord、\tuning、\capo 等 ~8 个）。
 *
 * 这些数据直接从上游 `@coderline/alphatab-alphatex/definitions` 导入，
 * **零维护成本** —— 上游新增命令时自动获得。
 */
const supplementalCompletionItems: monaco.languages.CompletionItem[] = [
    ...Array.from(scoreMetaData.values()).map(metadataToCompletionItem),
    ...Array.from(staffMetaData.values()).map(metadataToCompletionItem)
];

/**
 * 缓存 supplementalCompletionItems 中的 label 集合，
 * 用于在 O(1) 时间内判断上游结果是否已包含某个补全项。
 */
const supplementalLabels = new Set(
    supplementalCompletionItems.map(item => item.label as string)
);

/**
 * AlphaTex 中能充当"单词边界"的结构性分隔符。
 *
 * 除空白外，AlphaTex 还用 `()`、`{}`、`|`、`.`、`,` 等字符区分命令、参数、
 * 属性、音符等结构。`findWordStartColumn` 需要在遇到这些字符时立刻停止
 * 回溯，否则会把 `{`、`)` 等结构符错误地吞进补全的 replace range 里，
 * 导致插入补全项时把 `{` 替换掉。
 *
 * 引号 `"` / `'` 也必须是边界字符：在 `{ch "❘"}` 这种 chord 联动场景
 * 下，光标位于两个引号之间，若不把 `"` 视作边界，向左扫描会把左引号
 * 也纳入 replace 范围，接受候选后文本变成 `{ch Am"}`，把引号给吞了。
 *
 * 反斜杠 `\` 不在此集合中 —— 它是 AlphaTex 命令前缀（`\tempo`），必须被
 * 纳入正在输入的单词范围，Monaco 才能按前缀做模糊匹配。
 */
const WORD_BOUNDARY_CHARS = new Set([' ', '\t', '(', ')', '{', '}', '|', ',', '.', '"', "'"]);

/**
 * 从光标位置向前扫描，找到当前正在输入的"单词"的起始列号。
 *
 * AlphaTex 语法中，命令以 `\` 开头（如 `\tempo`），但 Monaco 默认的
 * `wordPattern` 不包含 `\`，会将 `\tempo` 切分为 `\` + `tempo`。
 * 此函数向前扫描直到遇到 {@link WORD_BOUNDARY_CHARS} 中的分隔符或行首，
 * 确保 `\` 被纳入单词范围而结构符（`{`、`}`、`(`、`)` 等）不被吞入。
 *
 * @param model  - 当前 Monaco 文本模型
 * @param position - 光标位置
 * @returns 单词起始的列号（1-based，Monaco 列号约定）
 */
function findWordStartColumn(
    model: monaco.editor.ITextModel,
    position: monaco.Position
): number {
    const lineContent = model.getLineContent(position.lineNumber);
    // Monaco 列号是 1-based，转为 0-based 索引进行扫描
    let idx = position.column - 2; // column-1 是光标前一字符的 0-based index
    while (idx >= 0 && !WORD_BOUNDARY_CHARS.has(lineContent[idx])) {
        idx--;
    }
    // idx 现在停在分隔符或 -1（行首），所以起始列 = idx + 2（转回 1-based）
    return idx + 2;
}

/**
 * 增强补全项列表：修正 range、清除强制排序，按上下文补充遗漏的命令，
 * 并把每个补全项的 documentation 重写为包含 syntax / parameters /
 * values / examples 的富 Markdown 卡片（L1 增强）。
 *
 * 解决上游 LSP bridge 的三个问题：
 *   1. **range 零宽度**：被设置为光标处 (col → col)，Monaco 无法识别已输入前缀
 *   2. **sortText 强制排序**：按声明顺序赋值 "a","b","c"...，覆盖模糊匹配排序
 *   3. **barIndex > 0 时遗漏命令**：scoreMetaData/staffMetaData 被排除
 *
 * 注入命令（问题 3 的修复）**仅在命令级上下文**生效 —— 若光标位于 `{}`
 * 或 `()` 内，上游返回的是属性/参数级补全，此时注入 `\xxx` 命令会污染列表。
 *
 * Documentation 增强是可选的：若 {@link findDefinitionByLabel} 未命中
 * （如上游新增的命令本地还未引入），则保留上游原始 documentation。
 *
 * @param result    - 上游 provider 返回的原始补全结果
 * @param model     - 当前 Monaco 文本模型
 * @param position  - 触发补全时的光标位置
 * @returns 增强后的补全结果
 */
function enhanceCompletionResult(
    result: monaco.languages.CompletionList,
    model: monaco.editor.ITextModel,
    position: monaco.Position
): monaco.languages.CompletionList {
    // Math.max(1, ...) 防御：Monaco 列号 1-based，findWordStartColumn 在
    // 极端边界（例如行首直接触发补全）理论上不会返回 <1，但显式夹取可避免
    // 任何未来改动意外越界到 0 或负数，触发 Monaco 的范围回退默认逻辑。
    const wordStartCol = Math.max(1, findWordStartColumn(model, position));

    // 构建 IInsertReplaceRange：显式告诉 Monaco `insert` 与 `replace`
    // 两段 range，避免 Monaco 在只拿到单一 Range 时走默认 wordPattern
    // 扩展逻辑 —— 该逻辑可能把 `{`、`\` 等 AlphaTex 结构符纳入 replace
    // 区间，造成应用补全后向左覆盖一个字符的 bug（如 `{ch❘` 选中 `ch`
    // 候选后 `{` 被替换为 `c`）。
    //
    // Monaco `CompletionItem` 类（suggest.js）对 IInsertReplaceRange 做了
    // 严格校验：
    //   this.isInvalid = … || completion.range.insert.startColumn
    //                      !== completion.range.replace.startColumn;
    // 即 `insert.startColumn` 必须与 `replace.startColumn` **完全一致**，
    // 否则整个候选被标记为 invalid，控制台打印
    //   "[suggest] IGNORE invalid completion item from undefined"
    // 然后在 UI 中被默默过滤掉 —— 正是用户截图里"控制台有候选、编辑区
    // 没有候选"的症状。
    //
    // 因此两段 range 必须共享同一个 `startColumn = wordStartCol`：
    //   - replace: [wordStart, col)  覆盖用户已输入的前缀（如 `ch`）
    //   - insert:  [wordStart, col)  与 replace 同形；我们没有"右侧 word
    //                 残留"需要区分的场景，所以 end 也到光标即可
    //
    // 关于 insert/replace 的语义差异（VSCode/Monaco）：
    //   - Insert mode：用户在右侧有残留（`ch❘aracter`）时，仅替换 insert
    //     范围，保留光标右侧的 `aracter`
    //   - Replace mode：将 replace 范围整体替换（通常会吃掉光标右侧 word）
    //   AlphaTex 补全场景中用户几乎不会在 word 中间触发补全，两种模式
    //   效果等价，因此 insert = replace 最稳妥。
    const correctedRange: monaco.languages.CompletionItemRanges = {
        insert: new monaco.Range(
            position.lineNumber,
            wordStartCol,
            position.lineNumber,
            position.column
        ),
        replace: new monaco.Range(
            position.lineNumber,
            wordStartCol,
            position.lineNumber,
            position.column
        )
    };

    // ── 属性块 / 括号参数列表内：接管补全列表 ──
    // 上游 LSP 的 createPropertiesCompletions 依赖 AST binaryNodeSearch 定位
    // property 节点；当光标位于属性尾部空格处（如 `{showName ❘}`）或位于
    // `()` 参数列表内（如 `\chord (❘)` / `{barre(❘)}`）时，AST 命中失败，
    // 兜底返回混合噪声或完全无结果。
    //
    // 这里先做一次上下文分析：
    //   - property-name / property-value → 本地候选（上一轮 A4 实现）
    //   - paren-value → 本地候选（A5，覆盖 \chord(...) 和 {barre(...)} 两种）
    // 命中时**完全替换** result.suggestions；未命中（kind: 'none'）继续走
    // 下方既有路径，保证可降级。
    const propContext = analyzePropertyValueContext(model, position);
    if (propContext.kind === 'property-value' && propContext.currentProperty) {
        // ── ch + insideQuote 特例：联动文档中已声明的 `\chord` 名称 ──
        //
        // 语法背景：`ch` 是 beat 级 property，形如 `{ch "Am"}` — 其引号
        // 值是 **property-value**（不是 paren-value）。`analyzeBraceContext`
        // 在命中到引号内光标时会把 `insideQuote` 透传过来，这里据此完全
        // 接管候选列表（Q2.1 = 引号内触发 / Q2.3 = 全文 / Q2.4 = 正则）。
        //
        // 对非 `ch` 属性或引号外场景返回 null，逻辑透明地继续走通用的
        // `buildPropertyValueCompletions`，不影响其他 property 的值补全。
        const chordItems = buildChCompletionsIfApplicable(
            propContext.currentProperty,
            propContext.insideQuote === true,
            model,
            correctedRange
        );
        if (chordItems) {
            result.suggestions = chordItems;
            return result;
        }

        const items = buildPropertyValueCompletions(
            propContext.currentProperty,
            correctedRange,
            monaco
        );
        if (items.length > 0) {
            result.suggestions = items;
            return result;
        }
        // items 为空（既无 values 也无 defaultValue）→ 降级到上游逻辑
    } else if (propContext.kind === 'property-name' && propContext.propertiesScope) {
        // 使用 propertiesScope（统一来源）而非原先的 nearestCommand 字符串：
        //   - 命令块（`\chord {...}`）的 scope 是 owner.properties
        //   - beat-property 块（`(0.1 2.3){...}`）的 scope 是全局 beatProperties
        // 两者在 analyzeBraceContext 已通过 resolveBracePropertyScope 归一化，
        // 这里直接传 scope map，避免在 editor 层重复查表。
        const items = buildPropertyNameCompletions(
            propContext.propertiesScope,
            correctedRange,
            monaco
        );
        if (items.length > 0) {
            result.suggestions = items;
            return result;
        }
    } else if (
        propContext.kind === 'paren-value' &&
        propContext.parenOwner &&
        propContext.valueIndex !== undefined
    ) {
        // 注意：`ch` 属性的值在 AlphaTex 语法上永远是 property-value
        // （brace 块内部的 `{ch "…"}`），不会进入 paren-value 分支。
        // 因此此处无需再调用 buildChCompletionsIfApplicable —— 之前的
        // chord 联动放在这里是无效死代码，已迁至 property-value 分支。
        const items = buildParenValueCompletions(
            propContext.parenOwner,
            propContext.valueIndex,
            correctedRange,
            monaco
        );
        if (items.length > 0) {
            result.suggestions = items;
            return result;
        }
    }

    // 预先解析上下文，后续 documentation 反查和命令补充都会复用
    const defContext = detectDefinitionContext(model, position);

    for (const suggestion of result.suggestions) {
        // 修正 range：让 Monaco 知道用户已经输入了 `\temp` 这样的前缀
        suggestion.range = correctedRange;
        // 清除 sortText：让 Monaco 基于用户输入的前缀进行模糊匹配排序
        suggestion.sortText = undefined;

        // 重写 documentation 为富卡片（L1）：加入 syntax / parameters / values / examples
        enrichSuggestionDocumentation(suggestion, defContext);
    }

    // 仅在"命令级"上下文才补充被上游排除的 scoreMetaData/staffMetaData 命令。
    // 在 `{}` / `()` 内，上游返回的是属性/参数/音符级补全，注入命令会造成噪声。
    if (defContext.kind !== 'command') {
        return result;
    }

    // 收集上游已返回的 label，用 O(1) 判定补充项是否已存在
    const existingLabels = new Set(
        result.suggestions.map(s => s.label as string)
    );
    const needsSupplement = [...supplementalLabels].some(
        label => !existingLabels.has(label)
    );

    if (needsSupplement) {
        for (const item of supplementalCompletionItems) {
            if (existingLabels.has(item.label as string)) {
                continue;
            }
            // 补充项也走一次 documentation 增强，保持卡片风格一致
            const enriched: monaco.languages.CompletionItem = {
                ...item,
                range: correctedRange
            };
            enrichSuggestionDocumentation(enriched, defContext);
            result.suggestions.push(enriched);
        }
    }

    return result;
}

/**
 * 从 suggestion 提取规范化 label（去除 `labelDetails` 干扰）。
 * Monaco `label` 可以是 string 或 `{label: string; ...}`；
 * 此处统一取字符串形态。
 */
function resolveSuggestionLabel(
    suggestion: monaco.languages.CompletionItem
): string {
    const raw = suggestion.label;
    return typeof raw === 'string' ? raw : raw.label;
}

// ─── Chord completion (ch property → \chord name linkage) ────────────

/**
 * 判断 property 定义是否是 beat-level `ch`。
 *
 * `ch` 是 beat-property 块内的字符串型 property（`{ch "Am"}`），上游
 * 定义只声明 name 是一个 String，没有枚举 `values`。默认走
 * {@link buildPropertyValueCompletions} 只会得到一个 defaultValue
 * 占位或完全空 —— 这里识别 `ch` 后接管候选生成，注入文档中已声明的
 * `\chord` 名称。
 *
 * 注：从 `property-value` 分支调用 —— AlphaTex 语法上 `ch` 的值永远
 * 是 property-value（`{ch "…"}`），不会出现在 paren-value 分支。
 */
function isBeatChProperty(def: PropertyDefinition): boolean {
    return def.property === 'ch';
}

/**
 * 构造 `ch "❘"` 光标位置的候选列表 —— 当且仅当命中 `ch` 属性且光标位于
 * 引号内时返回非 null，其它情况返回 null 交回通用逻辑。
 *
 * 候选构造规则：
 *   - 正常情况：返回文档中 `\chord ("name" …)` 声明的 name 列表（按声明
 *     顺序，已去重）。
 *   - 空列表兜底（Q2.2 = b）：返回单条 `CompletionItemKind.Issue` 提示
 *     项，告知用户先声明 `\chord`，`insertText` 为空、`sortText: '\uFFFF'`
 *     排在最末，不抢占默认占位符。
 *
 * @returns 候选列表或 null（表示不适用）
 */
function buildChCompletionsIfApplicable(
    def: PropertyDefinition,
    insideQuote: boolean,
    model: monaco.editor.ITextModel,
    range: monaco.languages.CompletionItemRanges
): monaco.languages.CompletionItem[] | null {
    if (!insideQuote || !isBeatChProperty(def)) {
        return null;
    }

    const chordIds = collectChordIds(model);
    if (chordIds.length === 0) {
        // 空列表兜底：展示 Issue 图标引导用户先声明 \chord（Q-C = b）。
        return [
            {
                label: '（未定义 \\chord，先用 \\chord ("name" …) 声明）',
                kind: monaco.languages.CompletionItemKind.Issue,
                insertText: '',
                detail: '文档中尚未声明和弦',
                documentation: {
                    value:
                        '使用 `\\chord ("Am" firstFret(1) …)` 声明和弦后，'
                        + '此处会自动联动可选的和弦名称列表。',
                    isTrusted: false,
                    supportThemeIcons: false
                },
                // 排在最后，不抢占输入流
                sortText: '\uFFFF',
                // filterText 置空：避免 Monaco 尝试模糊匹配把整条隐掉
                filterText: '',
                range
            }
        ];
    }

    return chordIds.map<monaco.languages.CompletionItem>((name, idx) => ({
        label: name,
        kind: monaco.languages.CompletionItemKind.EnumMember,
        insertText: name,
        detail: 'Declared chord',
        // sortText 按声明顺序，保证用户体验稳定：首次声明的 chord 排第一。
        // 使用 6 位零填充避免 >999 时的字典序错位。
        sortText: idx.toString().padStart(6, '0'),
        range
    }));
}

/**
 * 若能在 `@coderline/alphatab-alphatex/definitions` 中反查到对应定义，
 * 把 suggestion 的 documentation 替换为富 Markdown 卡片。未命中时保留
 * 上游原始 documentation，确保可降级。
 */
function enrichSuggestionDocumentation(
    suggestion: monaco.languages.CompletionItem,
    context: ReturnType<typeof detectDefinitionContext>
): void {
    const label = resolveSuggestionLabel(suggestion);
    const def = findDefinitionByLabel(label, context);
    if (!def) {
        return;
    }

    const markdown = renderDefinitionMarkdown(def);
    if (!markdown) {
        return;
    }

    suggestion.documentation = {
        value: markdown,
        // Markdown 中嵌入的是上游定义里的描述文本，来源可信，允许渲染
        isTrusted: false,
        supportThemeIcons: false
    };
}

/**
 * 希望让 Monaco 在哪些字符被键入时自动触发补全。
 *
 * 上游 `packages/lsp/src/server/index.ts` 的 `completionProvider` 未声明
 * `triggerCharacters`，导致在 `{`、空格等关键位置需要手动 Ctrl+Space 才能
 * 看到属性/参数补全 —— 尤其是 `\chord (...) {` 后按上游能力完全看不到
 * `firstFret`、`showDiagram` 等属性提示。
 *
 * 此处在 Monaco 层补齐触发字符：
 *   - `\` : 命令级（输入反斜杠即期望看到命令列表）
 *   - `{` : 属性块入口（chord/duration-change 等的属性补全）
 *   - ` ` : 属性值 / 参数分隔（`firstFret ` 后的值列表 / enum）
 *   - `(` : 参数列表入口（上游已为 signatureHelp 声明了 `(`，顺带用于补全）
 *
 * 与上游若未来自行声明 triggerCharacters，需在合并时去重，不会有正确性问题。
 */
const LOCAL_TRIGGER_CHARACTERS = ['\\', '{', ' ', '('];

/**
 * 合并上游 provider 已声明的触发字符与本地期望字符，返回去重后的数组。
 */
function mergeTriggerCharacters(upstream: readonly string[] | undefined): string[] {
    const merged = new Set<string>(upstream ?? []);
    for (const ch of LOCAL_TRIGGER_CHARACTERS) {
        merged.add(ch);
    }
    return [...merged];
}

/**
 * 猴子补丁：拦截上游 LSP bridge 的 CompletionItemProvider 注册，
 * 包装其 `provideCompletionItems` 方法以增强补全行为。
 *
 * **工作原理**：
 *   1. 临时替换 `monaco.languages.registerCompletionItemProvider`
 *   2. 当上游 `basicEditorLspIntegration()` 调用该方法注册 provider 时，
 *      我们拦截到 provider 对象并包装其 `provideCompletionItems`
 *   3. 包装函数调用原始实现后，对结果执行 {@link enhanceCompletionResult}
 *   4. 同时补齐上游遗漏的 `triggerCharacters`（见 {@link LOCAL_TRIGGER_CHARACTERS}）
 *   5. 注册完成后恢复原始方法，不影响后续其他 provider 注册
 *
 * **为什么不直接修改上游代码**：
 *   本项目基于 `@coderline/alphatab` 开源代码二次开发，
 *   修改 `packages/lsp/` 或 `packages/monaco/` 会增加合并上游更新的冲突成本。
 *   此猴子补丁方案与现有的 {@link resyncLspForModel} 同属非侵入式修复策略。
 *
 * @returns 恢复函数 — 调用后将 `registerCompletionItemProvider` 还原为原始实现
 */
function patchCompletionProvider(): () => void {
    const original = monaco.languages.registerCompletionItemProvider;

    monaco.languages.registerCompletionItemProvider = function (
        languageSelector: monaco.languages.LanguageSelector,
        provider: monaco.languages.CompletionItemProvider
    ) {
        const originalProvide = provider.provideCompletionItems.bind(provider);

        provider.provideCompletionItems = function (
            model: monaco.editor.ITextModel,
            position: monaco.Position,
            context: monaco.languages.CompletionContext,
            token: monaco.CancellationToken
        ) {
            const rawResult = originalProvide(model, position, context, token);

            // provideCompletionItems 可能返回 Promise 或同步结果
            if (rawResult && typeof (rawResult as Promise<monaco.languages.CompletionList>).then === 'function') {
                return (rawResult as Promise<monaco.languages.CompletionList>).then(
                    result => result ? enhanceCompletionResult(result, model, position) : result
                );
            }
            return rawResult
                ? enhanceCompletionResult(rawResult as monaco.languages.CompletionList, model, position)
                : rawResult;
        };

        // 合并上游已声明的 triggerCharacters（来自 provider 对象）与本地期望字符
        provider.triggerCharacters = mergeTriggerCharacters(provider.triggerCharacters);

        // Monaco 的 `registerCompletionItemProvider` 在某些类型声明版本下
        // 是 `(selector, provider)` 签名（不再接收 rest 参数），TS 的严格
        // 模式会把 `...triggerCharacters` 扩张视为 arity 不匹配。
        // 运行时我们不实际使用 rest 参数（trigger 字符已经通过
        // `provider.triggerCharacters` 生效），因此直接 2 参调用即可。
        return original.call(monaco.languages, languageSelector, provider);
    };

    return () => {
        monaco.languages.registerCompletionItemProvider = original;
    };
}

// ─── LSP Hover 增强（L2） ─────────────────────────────────────

/**
 * 猴子补丁：拦截上游 LSP bridge 的 HoverProvider 注册，包装其
 * `provideHover` 方法，在上游返回内容末尾追加 `**Example:**` 段。
 *
 * **最小侵入策略**：
 *   - 不接管上游的 description / syntax / parameters —— 上游
 *     `packages/lsp/src/server/hover.ts` 已经渲染得不错
 *   - **只追加 examples**，保证行为可降级：上游若改 hover 格式，
 *     此追加逻辑不会碎（基于 `contents` 数组 concat）
 *   - 反查失败（label 不是已知命令/属性）时直接透传原结果
 *
 * **为什么不独立注册 HoverProvider**：
 *   Monaco 会把多个 HoverProvider 的结果**合并显示为多张卡片**，
 *   视觉上会出现上下两张卡，割裂感强。追加到上游 hover 内容里能
 *   保证"一张卡片展示所有信息"。
 *
 * @returns 恢复函数 — 调用后将 `registerHoverProvider` 还原为原始实现
 */
function patchHoverProvider(): () => void {
    const original = monaco.languages.registerHoverProvider;

    monaco.languages.registerHoverProvider = function (
        languageSelector: monaco.languages.LanguageSelector,
        provider: monaco.languages.HoverProvider
    ) {
        const originalProvide = provider.provideHover?.bind(provider);
        if (!originalProvide) {
            return original.call(monaco.languages, languageSelector, provider);
        }

        provider.provideHover = function (
            model: monaco.editor.ITextModel,
            position: monaco.Position,
            token: monaco.CancellationToken,
            hoverContext?: monaco.languages.HoverContext<monaco.languages.Hover>
        ) {
            const rawResult = originalProvide(model, position, token, hoverContext!);

            if (rawResult && typeof (rawResult as Promise<monaco.languages.Hover>).then === 'function') {
                return (rawResult as Promise<monaco.languages.Hover | null | undefined>).then(
                    result => enrichHoverWithExamples(result, model, position)
                );
            }
            return enrichHoverWithExamples(
                rawResult as monaco.languages.Hover | null | undefined,
                model,
                position
            );
        };

        return original.call(monaco.languages, languageSelector, provider);
    };

    return () => {
        monaco.languages.registerHoverProvider = original;
    };
}

/**
 * 在上游 hover 结果末尾追加 examples 段（若反查到定义且定义包含 examples）。
 *
 * 反查流程：
 *   1. 读取光标位置的 word（Monaco `getWordAtPosition`）
 *   2. 若 word 前一字符是 `\`，拼成 `\word` 作为命令 label；否则作为属性 label
 *   3. 调用 {@link detectDefinitionContext} 确定上下文（用于属性反查的 scope）
 *   4. 调用 {@link findDefinitionByLabel} 反查定义
 *   5. 调用 {@link renderExamplesOnly} 生成 examples Markdown
 *   6. 以新的 `IMarkdownString` 项 push 到 `contents` 末尾
 *
 * 反查任一步失败都原样返回上游结果（幂等、无副作用）。
 */
function enrichHoverWithExamples(
    raw: monaco.languages.Hover | null | undefined,
    model: monaco.editor.ITextModel,
    position: monaco.Position
): monaco.languages.Hover | null | undefined {
    if (!raw) {
        return raw;
    }

    const word = model.getWordAtPosition(position);
    if (!word) {
        return raw;
    }

    // 判断这个 word 是命令（前缀 `\`）还是属性（裸标识符）
    const lineContent = model.getLineContent(position.lineNumber);
    const charBefore = word.startColumn >= 2 ? lineContent[word.startColumn - 2] : '';
    const label = charBefore === '\\' ? `\\${word.word}` : word.word;

    const context = detectDefinitionContext(model, position);
    const def = findDefinitionByLabel(label, context);
    if (!def) {
        return raw;
    }

    const examplesMd = renderExamplesOnly(def);
    if (!examplesMd) {
        return raw;
    }

    return {
        ...raw,
        contents: [
            ...raw.contents,
            { value: examplesMd, isTrusted: false, supportThemeIcons: false }
        ]
    };
}

// ─── LSP 集成 ────────────────────────────────────────────────

async function setupLspAlphaTexLanguageSupport(
    editor: monaco.editor.IStandaloneCodeEditor
): Promise<void> {
    // 在上游注册 CompletionItemProvider / HoverProvider 之前安装猴子补丁
    const restoreCompletionProvider = patchCompletionProvider();
    const restoreHoverProvider = patchHoverProvider();

    await basicEditorLspIntegration(
        editor,
        new Worker(new URL('../../monaco/src/worker.ts', import.meta.url), {
            type: 'module'
        }),
        {
            logger: {
                error(message: string) {
                    alphaTab.Logger.error('RealtimeEditor.LanguageServer', message);
                },
                info(message: string) {
                    alphaTab.Logger.info('RealtimeEditor.LanguageServer', message);
                },
                log(message: string) {
                    alphaTab.Logger.debug('RealtimeEditor.LanguageServer', message);
                },
                warn(message: string) {
                    alphaTab.Logger.warning('RealtimeEditor.LanguageServer', message);
                }
            },
            clientInfo: {
                name: 'alphaTab Realtime Editor',
                version: '1.9.0'
            },
            languageId: 'alphatex'
        }
    );

    // 注册完成后恢复原始方法，不影响后续其他 provider 注册
    restoreCompletionProvider();
    restoreHoverProvider();
}

// ─── LSP 重同步 ──────────────────────────────────────────────

/**
 * 在切换文档标签页后，强制 LSP 客户端与当前 model 内容重新同步。
 *
 * 背景：`@coderline/alphatab-monaco/lsp` 的 LSP 客户端使用固定的
 * `documentUri` 并绑定 `editor.onDidChangeModelContent` 发送增量更新。
 * 当通过 `editor.setModel()` 切换 model 后，LSP 内部缓存的文档内容
 * 仍然是上一个 model 的内容，导致：
 *   1. 旧 model 上的诊断标记（红色下划线）不会被清除
 *   2. 新 model 的内容未被 LSP 重新诊断
 *
 * 修复策略（非侵入式，不修改上游 lsp.ts）：
 *   1. 清除当前 model 上所有 LSP 标记
 *   2. 通过 `model.applyEdits()` 执行一次等值全文替换，
 *      触发 `onDidChangeModelContent` 事件，使 LSP 客户端重新接收全文
 *
 * @param model - 需要重同步的 Monaco ITextModel（通常是刚激活的文档 model）
 */
export function resyncLspForModel(model: monaco.editor.ITextModel): void {
    // Step 1: 清除该 model 上所有来源为 'lsp' 的诊断标记
    monaco.editor.setModelMarkers(model, 'lsp', []);

    // Step 2: 执行等值全文替换，触发 onDidChangeModelContent
    // 这会导致 lsp.ts 中的 DidChangeTextDocumentNotification 被发送，
    // LSP 服务端重新解析完整文档内容
    const fullRange = model.getFullModelRange();
    const fullContent = model.getValue();
    model.applyEdits([{
        range: fullRange,
        text: fullContent
    }]);
}

// ─── 诊断面板 ────────────────────────────────────────────────

export function refreshDiagnostics(): void {
    const model = state.editor?.getModel();
    if (!model) {
        dom.diagnosticsList.innerHTML = '<li class="diagnostics-list__empty">等待编辑器初始化。</li>';
        dom.diagnosticCount.textContent = '0';
        return;
    }

    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
    dom.diagnosticCount.textContent = String(markers.length);

    // 更新折叠按钮上的 badge
    if (dom.diagnosticsToggle) {
        dom.diagnosticsToggle.dataset.count = String(markers.length);
    }

    if (markers.length === 0) {
        dom.diagnosticsList.innerHTML =
            '<li class="diagnostics-list__empty">暂无语法或诊断问题。</li>';
        return;
    }

    dom.diagnosticsList.innerHTML = markers
        .slice(0, 6)
        .map(marker => {
            const severity =
                marker.severity === monaco.MarkerSeverity.Error ? 'error' : 'warning';
            const position = `L${marker.startLineNumber}:C${marker.startColumn}`;
            return `<li data-severity="${severity}"><strong>${position}</strong><br/>${escapeHtml(marker.message)}</li>`;
        })
        .join('');
}

// ─── 编辑器初始化（对外导出） ─────────────────────────────────

export async function setupEditor(
    onContentChange: () => void
): Promise<void> {
    await setupMonaco();
    defineMonacoTheme();

    const editor = monaco.editor.create(dom.editorElement, {
        value: '',
        language: 'alphatex',
        theme: 'alphatex-workbench',
        automaticLayout: true,
        minimap: { enabled: false },
        smoothScrolling: true,
        fontSize: 15,
        lineHeight: 22,
        padding: { top: 18, bottom: 18 },
        scrollBeyondLastLine: false,
        roundedSelection: true,
        wordWrap: 'on',
        guides: {
            indentation: true,
            bracketPairs: true              // 缩进区域显示括号配对线
        },
        // ── 括号与匹配 ──
        bracketPairColorization: {
            enabled: true,                  // 括号 (){}[] 彩色配对，提升嵌套可读性
            independentColorPoolPerBracketType: true
        },
        matchBrackets: 'always',            // 始终高亮匹配的括号对

        // ── 代码折叠（对大型乐谱有用）──
        folding: true,
        foldingStrategy: 'indentation',     // 基于缩进的折叠策略

        // ── 光标与交互 ──
        cursorBlinking: 'smooth',           // 柔和的光标闪烁动画
        cursorSmoothCaretAnimation: 'on',   // 光标移动时平滑过渡

        // ── 智能提示 ──
        suggestOnTriggerCharacters: true,   // 输入触发字符时自动弹出建议
        quickSuggestions: {
            other: true,                    // 普通代码区域启用快速建议
            comments: false,                // 注释中不触发
            strings: false                  // 字符串中不触发
        }
    });

    // 绑定 Alt+/ 触发智能提示（与 IntelliJ/Eclipse 习惯一致）
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Slash, () => {
        editor.trigger('keyboard', 'editor.action.triggerSuggest', {});
    });

    editor.onDidChangeModelContent(() => {
        if (state.suspendDocumentChangeHandling) {
            return;
        }
        onContentChange();
    });

    monaco.editor.onDidChangeMarkers(() => {
        refreshDiagnostics();
    });

    await setupLspAlphaTexLanguageSupport(editor);
    state.editor = editor;
    refreshDiagnostics();
}
