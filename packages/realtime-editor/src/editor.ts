import * as alphaTab from '@coderline/alphatab';
import { registerAlphaTexGrammar } from '@coderline/alphatab-monaco/alphatex';
import { basicEditorLspIntegration } from '@coderline/alphatab-monaco/lsp';
import { addTextMateGrammarSupport } from '@coderline/alphatab-monaco/textmate';
import * as monaco from 'monaco-editor';
// @ts-expect-error Monaco worker is provided by Vite
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { dom, state } from './state';
import { escapeHtml, load, persistValue } from './utils';
import { STORAGE_KEYS } from './constants';

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

// ─── LSP 集成 ────────────────────────────────────────────────

async function setupLspAlphaTexLanguageSupport(
    editor: monaco.editor.IStandaloneCodeEditor
): Promise<void> {
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

// ─── 文档持久化 ───────────────────────────────────────────────

export function persistDocument(content: string): void {
    persistValue(STORAGE_KEYS.document, content);
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
        persistDocument(editor.getValue());
        onContentChange();
    });

    monaco.editor.onDidChangeMarkers(() => {
        refreshDiagnostics();
    });

    await setupLspAlphaTexLanguageSupport(editor);
    state.editor = editor;
    refreshDiagnostics();
}
