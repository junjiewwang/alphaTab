import {
    createNewDocument,
    openExampleDocument,
    openFiles,
    openFilesWithPicker,
    saveActiveDocument
} from './documents';
import { dom, getActiveDocument, setStatus, setViewMode, state } from './state';
import type { ExampleId, ViewMode } from './types';
import { getErrorMessage, supportsFileSystemAccess } from './utils';

export function setupToolbar(): void {
    dom.newDocumentButton.addEventListener('click', () => {
        createNewDocument();
        closeExamplePanel();
    });

    dom.exampleButton.addEventListener('click', () => {
        toggleExamplePanel();
    });

    for (const item of dom.examplePanel.querySelectorAll<HTMLButtonElement>('[data-example]')) {
        item.addEventListener('click', () => {
            const exampleId = item.dataset.example as ExampleId;
            openExampleDocument(exampleId);
            closeExamplePanel();
        });
    }

    document.addEventListener('click', event => {
        const target = event.target as HTMLElement;
        if (!target.closest('.example-trigger')) {
            closeExamplePanel();
        }
    });

    // ── 打开文件 ──
    // 支持 File System Access API 时优先使用 showOpenFilePicker，
    // 可获得 FileSystemFileHandle 实现直接保存回原文件
    dom.openFileButton.addEventListener('click', () => {
        if (supportsFileSystemAccess()) {
            void openFilesWithPicker();
        } else {
            dom.fileInput.click();
        }
    });

    dom.fileInput.addEventListener('change', async () => {
        const files = Array.from(dom.fileInput.files ?? []);
        if (files.length === 0) {
            return;
        }

        closeExamplePanel();
        try {
            await openFiles(files);
        } catch (error) {
            setStatus('error', '文件打开失败', getErrorMessage(error));
        } finally {
            dom.fileInput.value = '';
        }
    });

    // ── 保存（智能判断）──
    // 有 fileHandle → 直接写回原文件
    // 无 fileHandle + 支持 API → showSaveFilePicker 选择路径
    // 无 fileHandle + 不支持 API → 浏览器下载
    dom.saveButton.addEventListener('click', () => {
        void saveActiveDocument();
    });

    // ── 全局 Ctrl+S / Cmd+S 快捷键 ──
    document.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            void saveActiveDocument();
        }
    });

    dom.printButton.addEventListener('click', () => {
        const currentScore = getActiveDocument()?.currentScore;
        if (!state.api || !currentScore) {
            setStatus('warning', '打印不可用', '当前没有可打印的乐谱内容');
            return;
        }

        setStatus('muted', '正在准备打印', '正在生成打印预览，请稍候');
        state.api.print(undefined, {
            core: {
                useWorkers: false
            }
        });
    });

    for (const button of dom.viewButtons) {
        button.addEventListener('click', () => {
            setViewMode(button.dataset.view as ViewMode);
        });
    }
}

function toggleExamplePanel(): void {
    if (dom.examplePanel.hidden) {
        openExamplePanel();
    } else {
        closeExamplePanel();
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

