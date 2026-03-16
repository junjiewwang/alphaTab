import { EXAMPLES, STORAGE_KEYS } from './constants';
import { dom, setStatus, setViewMode } from './state';
import type { ExampleId, ViewMode } from './types';
import { downloadBlob, persistValue, safeFileName } from './utils';
import { renderFromEditor } from './preview';
import { state } from './state';

// ─── 工具栏初始化 ────────────────────────────────────────────

export function setupToolbar(): void {
    dom.newDocumentButton.addEventListener('click', () => {
        const currentExample = dom.exampleSelect.value as ExampleId;
        loadExample(currentExample);
    });

    dom.exampleSelect.addEventListener('change', () => {
        persistValue(STORAGE_KEYS.example, dom.exampleSelect.value);
        loadExample(dom.exampleSelect.value as ExampleId);
    });

    dom.openFileButton.addEventListener('click', () => {
        dom.fileInput.click();
    });

    dom.fileInput.addEventListener('change', async () => {
        const [file] = Array.from(dom.fileInput.files ?? []);
        if (!file) {
            return;
        }

        state.lastFileName = file.name;
        const lowerFileName = file.name.toLowerCase();

        if (/(\.alphatex|\.atx|\.txt)$/.test(lowerFileName)) {
            const text = await file.text();
            state.editor?.getModel()?.setValue(text);
            setStatus('ready', '已加载文本文件', file.name);
        } else {
            const buffer = await file.arrayBuffer();
            state.shouldSyncEditorFromExternalLoad = true;
            state.api?.load(buffer);
            setStatus('rendering', '正在导入文件', file.name);
        }

        dom.fileInput.value = '';
    });

    dom.downloadAlphaTexButton.addEventListener('click', () => {
        const content = state.editor?.getValue() ?? '';
        const fallbackName = safeFileName(dom.scoreTitle.textContent || 'untitled');
        const fileName = state.lastFileName.endsWith('.alphatex')
            ? state.lastFileName
            : `${fallbackName}.alphatex`;
        downloadBlob(fileName, new Blob([content], { type: 'text/plain;charset=utf-8' }));
    });

    dom.printButton.addEventListener('click', () => {
        state.api?.print();
    });

    for (const button of dom.viewButtons) {
        button.addEventListener('click', () => {
            setViewMode(button.dataset.view as ViewMode);
        });
    }
}

// ─── 文档加载 ────────────────────────────────────────────────

export function loadInitialDocument(): void {
    const storedDocument = localStorage.getItem(STORAGE_KEYS.document);
    if (storedDocument && state.editor) {
        state.editor.getModel()?.setValue(storedDocument);
        setStatus('ready', '已恢复上次文档', '继续上次编辑进度');
        return;
    }

    loadExample(dom.exampleSelect.value as ExampleId);
}

export function loadExample(exampleId: ExampleId): void {
    const example = EXAMPLES[exampleId];
    state.lastFileName = example.fileName;
    dom.scoreTitle.textContent = example.fileName;
    dom.scoreSubtitle.textContent = example.subtitle;

    // Reset track selection so the new example starts fresh
    state.activeTrackIndexes = [];

    state.editor?.getModel()?.setValue(example.tex);
    state.editor?.focus();

    // Cancel any pending debounced render and trigger immediately.
    // setValue() fires onDidChangeModelContent which schedules a 220ms
    // debounced render — that causes the preview to lag behind the editor
    // when switching examples. We clear that timer and render right away.
    window.clearTimeout(state.renderTimer);
    setStatus('rendering', '正在加载示例', example.subtitle);
    void renderFromEditor();
}
