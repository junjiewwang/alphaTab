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

function defineMonacoTheme(): void {
    monaco.editor.defineTheme('alphatex-workbench', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'keyword', foreground: 'f1b75e' },
            { token: 'string', foreground: 'f5e6bf' },
            { token: 'number', foreground: '8dd8ff' }
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
            'editorIndentGuide.activeBackground1': '#4d618d'
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
            indentation: true
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
