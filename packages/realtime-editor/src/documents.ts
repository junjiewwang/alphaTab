import * as monaco from 'monaco-editor';
import { EXAMPLES, NEW_DOCUMENT_TEMPLATE, STORAGE_KEYS } from './constants';
import { refreshDiagnostics } from './editor';
import { clearPreview, renderActiveDocument, syncActiveDocumentUi } from './preview';
import {
    dom,
    getActiveDocument,
    getDocumentById,
    getDocumentsInOrder,
    setStatus,
    state
} from './state';
import type {
    DocumentSourceKind,
    ExampleId,
    WorkspaceDocument,
    WorkspaceSnapshot
} from './types';
import { getErrorMessage, readStorage } from './utils';
import { persistWorkspace, readWorkspaceSnapshot } from './workspace-storage';

let documentIdSequence = 0;

function createDocumentId(): string {
    documentIdSequence += 1;
    return `doc-${Date.now()}-${documentIdSequence}`;
}

function createModel(documentId: string, content: string): monaco.editor.ITextModel {
    return monaco.editor.createModel(
        content,
        'alphatex',
        monaco.Uri.parse(`inmemory://alphatab/${documentId}.alphatex`)
    );
}

function createUniqueDisplayName(baseName: string): string {
    const existingNames = new Set(getDocumentsInOrder().map(documentItem => documentItem.displayName));
    if (!existingNames.has(baseName)) {
        return baseName;
    }

    let index = 2;
    while (existingNames.has(`${baseName} (${index})`)) {
        index += 1;
    }
    return `${baseName} (${index})`;
}

function createDocument(options: {
    displayName: string;
    content: string;
    sourceKind: DocumentSourceKind;
    savedContent?: string;
    scoreTitle?: string;
    scoreSubtitle?: string;
    activeTrackIndexes?: number[];
    lastSuccessfulCode?: string;
    isDirty?: boolean;
}): WorkspaceDocument {
    const id = createDocumentId();
    const workspaceDocument: WorkspaceDocument = {
        id,
        displayName: createUniqueDisplayName(options.displayName),
        sourceKind: options.sourceKind,
        content: options.content,
        savedContent: options.savedContent ?? options.content,
        isDirty: options.isDirty ?? false,
        activeTrackIndexes: [...(options.activeTrackIndexes ?? [])],
        lastSuccessfulCode: options.lastSuccessfulCode ?? '',
        scoreTitle: options.scoreTitle ?? options.displayName,
        scoreSubtitle: options.scoreSubtitle ?? '等待渲染预览',
        model: createModel(id, options.content),
        currentScore: null,
        currentTimeInfo: null
    };

    state.documents.set(workspaceDocument.id, workspaceDocument);
    state.documentOrder.push(workspaceDocument.id);
    return workspaceDocument;
}

function restoreDocument(snapshot: WorkspaceSnapshot['documents'][number]): WorkspaceDocument {
    const workspaceDocument: WorkspaceDocument = {
        ...snapshot,
        activeTrackIndexes: [...snapshot.activeTrackIndexes],
        model: createModel(snapshot.id, snapshot.content),
        currentScore: null,
        currentTimeInfo: null
    };

    state.documents.set(workspaceDocument.id, workspaceDocument);
    state.documentOrder.push(workspaceDocument.id);
    return workspaceDocument;
}

function pickNextDocumentId(closedDocumentId: string): string | null {
    const currentIndex = state.documentOrder.indexOf(closedDocumentId);
    if (currentIndex === -1) {
        return state.documentOrder[0] ?? null;
    }

    return state.documentOrder[currentIndex + 1] ?? state.documentOrder[currentIndex - 1] ?? null;
}

function createLegacyInitialDocument(): WorkspaceDocument {
    const storedDocument = readStorage(STORAGE_KEYS.document);
    if (storedDocument) {
        return createDocument({
            displayName: 'recovered.alphatex',
            content: storedDocument,
            sourceKind: 'restored',
            savedContent: storedDocument,
            scoreTitle: '恢复的文档',
            scoreSubtitle: '已从旧版单文档缓存恢复'
        });
    }

    const storedExample = readStorage(STORAGE_KEYS.example) as ExampleId | null;
    const exampleId = storedExample && EXAMPLES[storedExample] ? storedExample : 'overture';
    const example = EXAMPLES[exampleId];
    return createDocument({
        displayName: example.fileName,
        content: example.tex,
        sourceKind: 'example',
        savedContent: example.tex,
        scoreTitle: example.fileName,
        scoreSubtitle: example.subtitle,
        lastSuccessfulCode: example.tex
    });
}

function renderDocumentTabs(): void {
    dom.documentTabList.innerHTML = '';

    for (const workspaceDocument of getDocumentsInOrder()) {
        const tab = window.document.createElement('div');
        tab.className = 'document-tab';
        if (workspaceDocument.id === state.activeDocumentId) {
            tab.classList.add('is-active');
        }
        tab.dataset.documentId = workspaceDocument.id;

        const selectButton = window.document.createElement('button');
        selectButton.type = 'button';
        selectButton.className = 'document-tab__select';
        selectButton.dataset.documentId = workspaceDocument.id;
        selectButton.setAttribute('role', 'tab');
        selectButton.setAttribute(
            'aria-selected',
            String(workspaceDocument.id === state.activeDocumentId)
        );
        selectButton.title = workspaceDocument.displayName;

        const dirty = window.document.createElement('span');
        dirty.className = 'document-tab__dirty';
        dirty.textContent = workspaceDocument.isDirty ? '●' : '○';
        dirty.setAttribute('aria-hidden', 'true');
        selectButton.appendChild(dirty);

        const label = window.document.createElement('span');
        label.className = 'document-tab__label';
        label.textContent = workspaceDocument.displayName;
        selectButton.appendChild(label);

        const closeButton = window.document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'document-tab__close';
        closeButton.dataset.documentId = workspaceDocument.id;
        closeButton.setAttribute('aria-label', `关闭 ${workspaceDocument.displayName}`);
        closeButton.title = `关闭 ${workspaceDocument.displayName}`;
        closeButton.textContent = '×';

        tab.appendChild(selectButton);
        tab.appendChild(closeButton);
        dom.documentTabList.appendChild(tab);
    }
}

export function setupDocumentTabs(): void {
    dom.documentTabList.setAttribute('role', 'tablist');
    dom.documentTabList.addEventListener('click', event => {
        const target = event.target as HTMLElement;
        const closeButton = target.closest<HTMLButtonElement>('.document-tab__close');
        if (closeButton?.dataset.documentId) {
            closeDocument(closeButton.dataset.documentId);
            return;
        }

        const selectButton = target.closest<HTMLButtonElement>('.document-tab__select');
        if (selectButton?.dataset.documentId) {
            activateDocument(selectButton.dataset.documentId);
        }
    });
}

export function handleActiveDocumentContentChanged(): void {
    const activeDocument = getActiveDocument();
    if (!activeDocument) {
        return;
    }

    activeDocument.content = activeDocument.model.getValue();
    activeDocument.isDirty = activeDocument.content !== activeDocument.savedContent;
    renderDocumentTabs();
    persistWorkspace();
}

export function markActiveDocumentSaved(): void {
    const activeDocument = getActiveDocument();
    if (!activeDocument) {
        return;
    }

    activeDocument.savedContent = activeDocument.model.getValue();
    activeDocument.content = activeDocument.savedContent;
    activeDocument.isDirty = false;
    renderDocumentTabs();
    persistWorkspace();
}

export function activateDocument(
    documentId: string,
    options: { focus?: boolean; render?: boolean; stopPlayback?: boolean } = {}
): void {
    const targetDocument = getDocumentById(documentId);
    if (!targetDocument || !state.editor) {
        return;
    }

    if (options.stopPlayback !== false) {
        state.api?.stop();
    }

    state.activeDocumentId = documentId;
    state.suspendDocumentChangeHandling = true;
    state.editor.setModel(targetDocument.model);
    state.suspendDocumentChangeHandling = false;
    syncActiveDocumentUi();
    refreshDiagnostics();
    renderDocumentTabs();
    persistWorkspace();

    if (options.render !== false) {
        void renderActiveDocument();
    }

    if (options.focus !== false) {
        state.editor.focus();
    }
}

export function createNewDocument(): void {
    const index = getDocumentsInOrder().filter(documentItem => documentItem.sourceKind === 'new').length + 1;
    const displayName = index === 1 ? 'untitled.alphatex' : `untitled-${index}.alphatex`;

    const workspaceDocument = createDocument({
        displayName,
        content: NEW_DOCUMENT_TEMPLATE,
        sourceKind: 'new',
        savedContent: NEW_DOCUMENT_TEMPLATE,
        scoreTitle: '未命名乐谱',
        scoreSubtitle: '新建空白文档',
        lastSuccessfulCode: ''
    });

    activateDocument(workspaceDocument.id);
    setStatus('ready', '新文档', '已创建新的工作区标签页');
}

export function openExampleDocument(exampleId: ExampleId): void {
    const example = EXAMPLES[exampleId];
    const workspaceDocument = createDocument({
        displayName: example.fileName,
        content: example.tex,
        sourceKind: 'example',
        savedContent: example.tex,
        scoreTitle: example.fileName,
        scoreSubtitle: example.subtitle,
        lastSuccessfulCode: example.tex
    });

    activateDocument(workspaceDocument.id);
    setStatus('muted', '已打开示例', `示例「${example.subtitle}」已在新标签页中打开`);
}

async function openTextFile(file: File): Promise<void> {
    const text = await file.text();
    const workspaceDocument = createDocument({
        displayName: file.name,
        content: text,
        sourceKind: 'text-file',
        savedContent: text,
        scoreTitle: file.name,
        scoreSubtitle: '已加载文本文件'
    });

    activateDocument(workspaceDocument.id);
    setStatus('ready', '已加载文本文件', workspaceDocument.displayName);
}

async function openBinaryFile(file: File): Promise<void> {
    const workspaceDocument = createDocument({
        displayName: file.name,
        content: '',
        sourceKind: 'imported-file',
        savedContent: '',
        scoreTitle: file.name,
        scoreSubtitle: '正在导入外部文件'
    });

    activateDocument(workspaceDocument.id, { render: false });
    clearPreview('正在导入外部文件…');
    setStatus('rendering', '正在导入文件', workspaceDocument.displayName);

    const buffer = await file.arrayBuffer();
    if (!state.api) {
        throw new Error('预览尚未初始化，暂时无法导入文件');
    }

    await new Promise<void>((resolve, reject) => {
        state.pendingImportRequest = {
            documentId: workspaceDocument.id,
            fileName: workspaceDocument.displayName,
            resolve,
            reject
        };
        state.api?.load(buffer);
    });
}

export async function openFiles(files: File[]): Promise<void> {
    for (const file of files) {
        const lowerFileName = file.name.toLowerCase();
        try {
            if (/(\.alphatex|\.atx|\.txt)$/.test(lowerFileName)) {
                await openTextFile(file);
            } else {
                await openBinaryFile(file);
            }
        } catch (error) {
            setStatus('error', '文件打开失败', `${file.name}：${getErrorMessage(error)}`);
        }
    }
}

export function closeDocument(documentId: string): void {
    const targetDocument = getDocumentById(documentId);
    if (!targetDocument) {
        return;
    }

    if (targetDocument.isDirty) {
        const confirmed = confirm(
            `文档「${targetDocument.displayName}」有未导出的更改，确定关闭吗？`
        );
        if (!confirmed) {
            return;
        }
    }

    const wasActive = state.activeDocumentId === documentId;
    const nextDocumentId = pickNextDocumentId(documentId);

    state.documentOrder = state.documentOrder.filter(id => id !== documentId);
    state.documents.delete(documentId);
    targetDocument.model.dispose();

    if (state.pendingImportRequest?.documentId === documentId) {
        state.pendingImportRequest.reject(new Error('导入过程已取消'));
        state.pendingImportRequest = null;
    }

    if (state.documentOrder.length === 0) {
        createNewDocument();
        return;
    }

    if (wasActive && nextDocumentId) {
        activateDocument(nextDocumentId);
        return;
    }

    renderDocumentTabs();
    persistWorkspace();
}

export function loadInitialWorkspace(): void {
    const snapshot = readWorkspaceSnapshot();
    if (snapshot?.documents.length) {
        for (const snapshotDocument of snapshot.documents) {
            restoreDocument(snapshotDocument);
        }

        const targetDocumentId =
            snapshot.activeDocumentId && getDocumentById(snapshot.activeDocumentId)
                ? snapshot.activeDocumentId
                : state.documentOrder[0];

        if (targetDocumentId) {
            activateDocument(targetDocumentId);
            setStatus('ready', '已恢复工作区', `恢复 ${state.documentOrder.length} 个标签页`);
            return;
        }
    }

    const initialDocument = createLegacyInitialDocument();
    activateDocument(initialDocument.id);
}
