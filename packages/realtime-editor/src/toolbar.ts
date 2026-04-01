import { createNewDocument, markActiveDocumentSaved, openExampleDocument, openFiles } from './documents';
import { dom, getActiveDocument, setStatus, setViewMode } from './state';
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
        const activeDocument = getActiveDocument();
        if (!activeDocument?.currentScore) {
            setStatus('warning', '打印不可用', '当前没有可打印的乐谱内容');
            return;
        }

        printCurrentPreviewSnapshot(activeDocument.scoreTitle || activeDocument.displayName);
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

function printCurrentPreviewSnapshot(title: string): void {
    if (!dom.alphaTabRoot.firstElementChild) {
        setStatus('warning', '打印不可用', '当前预览区域还没有可打印的乐谱内容');
        return;
    }

    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) {
        setStatus('warning', '打印被拦截', '请允许浏览器弹出新窗口后重试');
        return;
    }

    const printableTitle = title || '未命名乐谱';
    const printDocument = printWindow.document;
    const previewMarkup = dom.alphaTabRoot.cloneNode(true) as HTMLElement;

    printDocument.documentElement.lang = 'zh-CN';
    printDocument.title = printableTitle;
    printDocument.head.innerHTML = '';
    printDocument.body.innerHTML = '';

    const meta = printDocument.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    printDocument.head.appendChild(meta);

    for (const node of document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
        'style, link[rel="stylesheet"]'
    )) {
        printDocument.head.appendChild(node.cloneNode(true));
    }

    const style = printDocument.createElement('style');
    style.textContent = `
        html, body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #111111;
        }

        body {
            font-family: 'Noto Sans', sans-serif;
        }

        .print-shell {
            padding: 24px;
        }

        .print-title {
            margin: 0 0 16px;
            font-size: 18px;
            font-weight: 700;
            color: #111111;
        }

        .print-sheet {
            overflow: visible;
            background: #ffffff;
        }

        .print-sheet .at-surface,
        .print-sheet svg {
            max-width: 100%;
        }

        @media print {
            body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .print-shell {
                padding: 0;
            }
        }
    `;
    printDocument.head.appendChild(style);

    const shell = printDocument.createElement('main');
    shell.className = 'print-shell';

    const heading = printDocument.createElement('h1');
    heading.className = 'print-title';
    heading.textContent = printableTitle;
    shell.appendChild(heading);

    const section = printDocument.createElement('section');
    section.className = 'print-sheet';
    section.appendChild(previewMarkup);
    shell.appendChild(section);
    printDocument.body.appendChild(shell);

    printWindow.addEventListener(
        'afterprint',
        () => {
            printWindow.close();
        },
        { once: true }
    );

    window.setTimeout(async () => {
        try {
            await printDocument.fonts?.ready;
        } catch {
            // ignore font readiness issues and continue printing
        }
        printWindow.focus();
        printWindow.print();
    }, 250);

    setStatus('muted', '正在准备打印', '已生成当前文档的预览快照');
}
