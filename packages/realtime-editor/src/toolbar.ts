import { createNewDocument, markActiveDocumentSaved, openExampleDocument, openFiles } from './documents';
import { dom, getActiveDocument, setStatus, setViewMode, state } from './state';
import type { ExampleId, ViewMode } from './types';
import { downloadBlob, getErrorMessage, safeFileName } from './utils';

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

    dom.openFileButton.addEventListener('click', () => {
        dom.fileInput.click();
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

    dom.downloadAlphaTexButton.addEventListener('click', () => {
        const activeDocument = getActiveDocument();
        if (!activeDocument) {
            setStatus('warning', '导出不可用', '当前没有活动文档');
            return;
        }

        const content = activeDocument.model.getValue();
        if (!content.trim()) {
            setStatus('warning', '导出不可用', '当前文档内容为空');
            return;
        }

        const fallbackName = safeFileName(
            activeDocument.scoreTitle || activeDocument.displayName || 'untitled'
        );
        const fileName = activeDocument.displayName.toLowerCase().endsWith('.alphatex')
            ? activeDocument.displayName
            : `${fallbackName}.alphatex`;

        downloadBlob(fileName, new Blob([content], { type: 'text/plain;charset=utf-8' }));
        markActiveDocumentSaved();
        setStatus('ready', '已导出 AlphaTex', fileName);
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

