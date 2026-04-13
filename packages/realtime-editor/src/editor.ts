import * as alphaTab from '@coderline/alphatab';
import { scoreMetaData, staffMetaData } from '@coderline/alphatab-alphatex/definitions';
import type { MetadataTagDefinition } from '@coderline/alphatab-alphatex/types';
import { registerAlphaTexGrammar } from '@coderline/alphatab-monaco/alphatex';
import { basicEditorLspIntegration } from '@coderline/alphatab-monaco/lsp';
import { addTextMateGrammarSupport } from '@coderline/alphatab-monaco/textmate';
import * as monaco from 'monaco-editor';
// @ts-expect-error Monaco worker is provided by Vite
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
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
 * 从光标位置向前扫描，找到当前正在输入的"单词"的起始列号。
 *
 * AlphaTex 语法中，命令以 `\` 开头（如 `\tempo`），但 Monaco 默认的
 * `wordPattern` 不包含 `\`，会将 `\tempo` 切分为 `\` + `tempo`。
 * 此函数向前扫描直到遇到空白或行首，确保 `\` 被包含在单词范围内。
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
    while (idx >= 0 && lineContent[idx] !== ' ' && lineContent[idx] !== '\t') {
        idx--;
    }
    // idx 现在停在空白字符或 -1（行首），所以起始列 = idx + 2（转回 1-based）
    return idx + 2;
}

/**
 * 增强补全项列表：修正 range、清除强制排序，并补充缺失的命令。
 *
 * 解决上游 LSP bridge 的三个问题：
 *   1. **range 零宽度**：被设置为光标处 (col → col)，Monaco 无法识别已输入前缀
 *   2. **sortText 强制排序**：按声明顺序赋值 "a","b","c"...，覆盖模糊匹配排序
 *   3. **barIndex > 0 时遗漏命令**：scoreMetaData/staffMetaData 被排除
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
    const wordStartCol = findWordStartColumn(model, position);

    // 构建包含前缀的正确范围
    const correctedRange = new monaco.Range(
        position.lineNumber,
        wordStartCol,
        position.lineNumber,
        position.column
    );

    // 收集上游已返回的 label 集合，用于判断是否需要补充
    const existingLabels = new Set(
        result.suggestions.map(s => s.label as string)
    );

    for (const suggestion of result.suggestions) {
        // 修正 range：让 Monaco 知道用户已经输入了 `\temp` 这样的前缀
        suggestion.range = correctedRange;
        // 清除 sortText：让 Monaco 基于用户输入的前缀进行模糊匹配排序
        suggestion.sortText = undefined;
    }

    // 补充上游在 barIndex > 0 时遗漏的 scoreMetaData / staffMetaData 命令
    // 通过检测 supplementalLabels 中是否有 label 未出现在上游结果中来判断
    const needsSupplement = [...supplementalLabels].some(
        label => !existingLabels.has(label)
    );

    if (needsSupplement) {
        for (const item of supplementalCompletionItems) {
            if (!existingLabels.has(item.label as string)) {
                result.suggestions.push({
                    ...item,
                    range: correctedRange
                });
            }
        }
    }

    return result;
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
 *   4. 注册完成后恢复原始方法，不影响后续其他 provider 注册
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
        provider: monaco.languages.CompletionItemProvider,
        ...triggerCharacters: string[]
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

        return original.call(monaco.languages, languageSelector, provider, ...triggerCharacters);
    };

    return () => {
        monaco.languages.registerCompletionItemProvider = original;
    };
}

// ─── LSP 集成 ────────────────────────────────────────────────

async function setupLspAlphaTexLanguageSupport(
    editor: monaco.editor.IStandaloneCodeEditor
): Promise<void> {
    // 在上游注册 CompletionItemProvider 之前安装猴子补丁
    const restoreCompletionProvider = patchCompletionProvider();

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
