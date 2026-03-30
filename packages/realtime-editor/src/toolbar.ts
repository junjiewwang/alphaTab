import { EXAMPLES, NEW_DOCUMENT_TEMPLATE, STORAGE_KEYS } from './constants';
import { dom, setStatus, setViewMode, state } from './state';
import type { ExampleId, ViewMode } from './types';
import { downloadBlob, persistValue, safeFileName } from './utils';
import { renderFromEditor } from './preview';

// ─── 工具栏初始化 ────────────────────────────────────────────

export function setupToolbar(): void {
    // ── 新建按钮 ──
    dom.newDocumentButton.addEventListener('click', () => {
        createNewDocument();
    });

    // ── 示例面板：打开/关闭 ──
    dom.exampleButton.addEventListener('click', () => {
        toggleExamplePanel();
    });

    // ── 示例面板：点击示例项 ──
    for (const item of dom.examplePanel.querySelectorAll<HTMLButtonElement>('[data-example]')) {
        item.addEventListener('click', () => {
            const exampleId = item.dataset.example as ExampleId;
            enterExamplePreview(exampleId);
            closeExamplePanel();
        });
    }

    // ── 点击面板外部关闭 ──
    document.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (!target.closest('.example-trigger')) {
            closeExamplePanel();
        }
    });

    // ── 示例预览横幅按钮 ──
    dom.restoreDocumentButton.addEventListener('click', () => {
        restoreUserDocument();
    });

    dom.adoptExampleButton.addEventListener('click', () => {
        adoptExample();
    });

    // ── 打开文件 ──
    dom.openFileButton.addEventListener('click', () => {
        dom.fileInput.click();
    });

    dom.fileInput.addEventListener('change', async () => {
        const [file] = Array.from(dom.fileInput.files ?? []);
        if (!file) {
            return;
        }

        // 打开文件时退出示例预览模式（丢弃备份）
        exitExamplePreviewSilently();

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

    // ── 导出 ──
    dom.downloadAlphaTexButton.addEventListener('click', () => {
        const content = state.editor?.getValue() ?? '';
        const fallbackName = safeFileName(dom.scoreTitle.textContent || 'untitled');
        const fileName = state.lastFileName.endsWith('.alphatex')
            ? state.lastFileName
            : `${fallbackName}.alphatex`;
        downloadBlob(fileName, new Blob([content], { type: 'text/plain;charset=utf-8' }));
    });

    // ── 打印 ──
    dom.printButton.addEventListener('click', () => {
        if (!state.api || !state.currentScore) {
            setStatus('warning', '打印不可用', '当前没有可打印的乐谱内容');
            return;
        }

        setStatus('muted', '正在准备打印', '正在生成打印预览，请稍候');
        state.api?.print(undefined, {  
            core: {
                useWorkers: false
            }});
    });

    // ── 视图模式 ──
    for (const button of dom.viewButtons) {
        button.addEventListener('click', () => {
            setViewMode(button.dataset.view as ViewMode);
        });
    }
}

// ─── 新建文档 ────────────────────────────────────────────────

function createNewDocument(): void {
    const currentContent = state.editor?.getValue() ?? '';
    const isBlank = !currentContent.trim() || currentContent.trim() === NEW_DOCUMENT_TEMPLATE.trim();

    // 如果有实质内容，弹出确认
    if (!isBlank && !state.isExamplePreview) {
        const confirmed = confirm('当前文档有未保存的更改，确定新建空白文档？未保存的内容将丢失。');
        if (!confirmed) {
            return;
        }
    }

    // 退出示例预览模式（丢弃备份）
    exitExamplePreviewSilently();

    // 重置编辑器内容
    state.editor?.getModel()?.setValue(NEW_DOCUMENT_TEMPLATE);

    // 清除 localStorage 缓存
    localStorage.removeItem(STORAGE_KEYS.document);
    localStorage.removeItem(STORAGE_KEYS.example);

    // 重置应用状态
    state.lastFileName = 'untitled.alphatex';
    state.activeTrackIndexes = [];
    state.lastSuccessfulCode = '';
    state.currentScore = null;

    // 重置 Score Meta
    dom.scoreTitle.textContent = '未命名乐谱';
    dom.scoreSubtitle.textContent = '新建空白文档';

    // 触发渲染 + 聚焦
    window.clearTimeout(state.renderTimer);
    setStatus('ready', '新文档', '已创建空白文档，开始编辑吧');
    void renderFromEditor();
    state.editor?.focus();
}

// ─── 示例面板开关 ─────────────────────────────────────────────

function toggleExamplePanel(): void {
    const isOpen = !dom.examplePanel.hidden;
    if (isOpen) {
        closeExamplePanel();
    } else {
        openExamplePanel();
    }
}

function openExamplePanel(): void {
    dom.examplePanel.hidden = false;
    dom.exampleButton.setAttribute('aria-expanded', 'true');
}

function closeExamplePanel(): void {
    dom.examplePanel.hidden = true;
    dom.exampleButton.setAttribute('aria-expanded', 'false');
}

// ─── 示例预览模式 ─────────────────────────────────────────────

/**
 * 进入示例预览模式：备份用户文档 → 加载示例 → 显示预览横幅
 */
function enterExamplePreview(exampleId: ExampleId): void {
    const example = EXAMPLES[exampleId];

    // 如果当前不在示例预览模式，先备份用户文档
    if (!state.isExamplePreview) {
        const currentContent = state.editor?.getValue() ?? '';
        const isBlank = !currentContent.trim() || currentContent.trim() === NEW_DOCUMENT_TEMPLATE.trim();

        // 如果编辑器有有意义的内容才备份
        if (!isBlank) {
            state.userDocumentBackup = {
                content: currentContent,
                fileName: state.lastFileName,
                scoreTitle: dom.scoreTitle.textContent || '未命名乐谱',
                scoreSubtitle: dom.scoreSubtitle.textContent || '',
                activeTrackIndexes: [...state.activeTrackIndexes],
                lastSuccessfulCode: state.lastSuccessfulCode
            };
        }
    }
    // 如果已在示例预览模式，切换示例时不覆盖备份（保留原始用户文档）

    // 标记为示例预览模式
    state.isExamplePreview = true;
    state.previewingExampleId = exampleId;

    // 加载示例到编辑器
    state.lastFileName = example.fileName;
    dom.scoreTitle.textContent = example.fileName;
    dom.scoreSubtitle.textContent = example.subtitle;
    state.activeTrackIndexes = [];

    state.editor?.getModel()?.setValue(example.tex);
    state.editor?.focus();

    // 显示示例预览横幅
    showExamplePreviewBanner(exampleId);

    // 触发渲染
    window.clearTimeout(state.renderTimer);
    setStatus('muted', '示例预览', `正在预览「${example.subtitle}」`);
    void renderFromEditor();
}

/**
 * 还原到用户文档：从备份恢复编辑器内容
 */
function restoreUserDocument(): void {
    const backup = state.userDocumentBackup;

    if (backup) {
        // 恢复编辑器内容
        state.editor?.getModel()?.setValue(backup.content);

        // 恢复元信息
        state.lastFileName = backup.fileName;
        dom.scoreTitle.textContent = backup.scoreTitle;
        dom.scoreSubtitle.textContent = backup.scoreSubtitle;
        state.activeTrackIndexes = [...backup.activeTrackIndexes];
        state.lastSuccessfulCode = backup.lastSuccessfulCode;

        // 触发渲染
        window.clearTimeout(state.renderTimer);
        setStatus('ready', '已还原', '已恢复到您之前的编辑内容');
        void renderFromEditor();
    } else {
        // 没有备份（编辑器之前是空白的），回到空白文档
        state.editor?.getModel()?.setValue(NEW_DOCUMENT_TEMPLATE);
        state.lastFileName = 'untitled.alphatex';
        dom.scoreTitle.textContent = '未命名乐谱';
        dom.scoreSubtitle.textContent = '新建空白文档';
        state.activeTrackIndexes = [];
        state.lastSuccessfulCode = '';

        window.clearTimeout(state.renderTimer);
        setStatus('ready', '已还原', '已恢复到空白文档');
        void renderFromEditor();
    }

    // 退出示例预览模式
    state.isExamplePreview = false;
    state.previewingExampleId = null;
    state.userDocumentBackup = null;
    hideExamplePreviewBanner();

    state.editor?.focus();
}

/**
 * 采用此示例：将当前编辑器内容确认为正式内容
 */
function adoptExample(): void {
    // 清除备份
    state.userDocumentBackup = null;

    // 退出示例预览模式
    state.isExamplePreview = false;
    state.previewingExampleId = null;
    hideExamplePreviewBanner();

    // 持久化当前内容
    const content = state.editor?.getValue() ?? '';
    persistValue(STORAGE_KEYS.document, content);

    setStatus('ready', '已采用示例', '示例已作为当前文档，继续编辑吧');
    state.editor?.focus();
}

/**
 * 静默退出示例预览模式（丢弃备份，不恢复内容）
 * 用于"新建"、"打开文件"等覆盖操作
 */
function exitExamplePreviewSilently(): void {
    if (!state.isExamplePreview) {
        return;
    }
    state.isExamplePreview = false;
    state.previewingExampleId = null;
    state.userDocumentBackup = null;
    hideExamplePreviewBanner();
}

// ─── 示例预览横幅 UI ──────────────────────────────────────────

function showExamplePreviewBanner(exampleId: ExampleId): void {
    const example = EXAMPLES[exampleId];
    dom.examplePreviewLabel.textContent = `正在预览示例「${example.subtitle}」`;
    dom.examplePreviewBanner.hidden = false;

    // 始终显示"还原/退出"按钮，根据有无备份显示不同文案
    dom.restoreDocumentButton.style.display = '';
    dom.restoreDocumentButton.textContent = state.userDocumentBackup ? '还原到我的文档' : '退出预览';
}

function hideExamplePreviewBanner(): void {
    dom.examplePreviewBanner.hidden = true;
}

// ─── 文档加载 ────────────────────────────────────────────────

export function loadInitialDocument(): void {
    const storedDocument = localStorage.getItem(STORAGE_KEYS.document);
    if (storedDocument && state.editor) {
        state.editor.getModel()?.setValue(storedDocument);
        setStatus('ready', '已恢复上次文档', '继续上次编辑进度');
        return;
    }

    // 没有缓存，加载默认示例
    const storedExample = localStorage.getItem(STORAGE_KEYS.example) as ExampleId | null;
    const exampleId = storedExample && EXAMPLES[storedExample] ? storedExample : 'overture';
    loadExampleDirectly(exampleId);
}

/**
 * 直接加载示例（非预览模式）— 仅用于初始化时无缓存文档的情况
 */
function loadExampleDirectly(exampleId: ExampleId): void {
    const example = EXAMPLES[exampleId];
    state.lastFileName = example.fileName;
    dom.scoreTitle.textContent = example.fileName;
    dom.scoreSubtitle.textContent = example.subtitle;
    state.activeTrackIndexes = [];

    state.editor?.getModel()?.setValue(example.tex);
    state.editor?.focus();

    window.clearTimeout(state.renderTimer);
    setStatus('rendering', '正在加载示例', example.subtitle);
    void renderFromEditor();
}
