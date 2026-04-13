import * as monaco from 'monaco-editor';
import { EXAMPLES, NEW_DOCUMENT_TEMPLATE, STORAGE_KEYS } from './constants';
import { refreshDiagnostics, resyncLspForModel } from './editor';
import { getFileHandle, removeFileHandle, saveFileHandle, verifyPermission } from './file-handle-store';
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
import { getErrorMessage, readStorage, supportsFileSystemAccess } from './utils';
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
    fileHandle?: FileSystemFileHandle | null;
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
        currentTimeInfo: null,
        fileHandle: options.fileHandle ?? null,
        hasFileHandle: Boolean(options.fileHandle)
    };

    state.documents.set(workspaceDocument.id, workspaceDocument);
    state.documentOrder.push(workspaceDocument.id);

    // 如果有文件句柄，异步持久化到 IndexedDB（fire & forget）
    if (workspaceDocument.fileHandle) {
        void saveFileHandle(workspaceDocument.id, workspaceDocument.fileHandle);
    }

    return workspaceDocument;
}

function restoreDocument(snapshot: WorkspaceSnapshot['documents'][number]): WorkspaceDocument {
    const workspaceDocument: WorkspaceDocument = {
        ...snapshot,
        activeTrackIndexes: [...snapshot.activeTrackIndexes],
        model: createModel(snapshot.id, snapshot.content),
        currentScore: null,
        currentTimeInfo: null,
        fileHandle: null
    };

    state.documents.set(workspaceDocument.id, workspaceDocument);
    state.documentOrder.push(workspaceDocument.id);

    // 如果快照标记了有文件句柄，异步从 IndexedDB 恢复
    if (snapshot.hasFileHandle) {
        void restoreFileHandle(workspaceDocument);
    }

    return workspaceDocument;
}

/**
 * 从 IndexedDB 异步恢复文件句柄。
 * 恢复成功后更新文档的 fileHandle 和 hasFileHandle 字段。
 * 如果句柄不存在或获取失败，静默处理（降级为普通文档）。
 */
async function restoreFileHandle(workspaceDocument: WorkspaceDocument): Promise<void> {
    try {
        const handle = await getFileHandle(workspaceDocument.id);
        if (handle) {
            workspaceDocument.fileHandle = handle;
            workspaceDocument.hasFileHandle = true;
        } else {
            workspaceDocument.hasFileHandle = false;
        }
    } catch {
        // IndexedDB 读取失败时静默降级
        workspaceDocument.hasFileHandle = false;
    }
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

    // 将激活标签滚动到可见区域
    scrollActiveTabIntoView();
    // 更新渐变遮罩状态
    updateTabScrollIndicators();
}

/**
 * 将当前激活的标签滚动到可见区域。
 * 使用 requestAnimationFrame 确保 DOM 已更新。
 */
function scrollActiveTabIntoView(): void {
    requestAnimationFrame(() => {
        const activeTab = dom.documentTabList.querySelector<HTMLElement>('.document-tab.is-active');
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
    });
}

/**
 * 根据标签列表的滚动位置，更新容器上的遮罩类名。
 * - has-scroll-left: 左侧有隐藏内容
 * - has-scroll-right: 右侧有隐藏内容
 */
function updateTabScrollIndicators(): void {
    const container = dom.documentTabList;
    const tabs = dom.documentTabs;
    // 允许 1px 的浮点误差
    const threshold = 1;
    const hasScrollLeft = container.scrollLeft > threshold;
    const hasScrollRight = container.scrollLeft < container.scrollWidth - container.clientWidth - threshold;

    tabs.classList.toggle('has-scroll-left', hasScrollLeft);
    tabs.classList.toggle('has-scroll-right', hasScrollRight);
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

    // 滚动时更新渐变遮罩状态
    dom.documentTabList.addEventListener('scroll', updateTabScrollIndicators, { passive: true });

    // 鼠标滚轮垂直滚动映射为标签栏水平滚动
    dom.documentTabList.addEventListener('wheel', event => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.preventDefault();
            dom.documentTabList.scrollLeft += event.deltaY;
        }
    }, { passive: false });

    // 窗口尺寸变化时重新检测遮罩状态
    window.addEventListener('resize', updateTabScrollIndicators, { passive: true });
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

    // 强制 LSP 客户端与新 model 内容重同步：
    // 清除旧诊断标记 + 触发全文增量通知，使 LSP 服务端重新解析
    resyncLspForModel(targetDocument.model);
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

async function openTextFile(file: File, fileHandle?: FileSystemFileHandle): Promise<void> {
    const text = await file.text();
    const workspaceDocument = createDocument({
        displayName: file.name,
        content: text,
        sourceKind: 'text-file',
        savedContent: text,
        scoreTitle: file.name,
        scoreSubtitle: fileHandle ? '已从文件系统打开' : '已加载文本文件',
        fileHandle: fileHandle ?? null
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

// ─── File System Access API 集成 ─────────────────────────────

/**
 * AlphaTex 文件类型描述，用于 showOpenFilePicker / showSaveFilePicker
 */
const ALPHATEX_FILE_TYPES: FilePickerAcceptType[] = [
    {
        description: 'AlphaTex 文件',
        accept: {
            'text/plain': ['.alphatex', '.atx', '.txt']
        }
    }
];

/**
 * 使用 File System Access API 的文件选择器打开文件。
 *
 * 与传统 <input type="file"> 的区别：
 * - 获取 FileSystemFileHandle，可以直接保存回原文件
 * - 句柄可持久化到 IndexedDB，刷新页面后恢复
 *
 * 仅在支持 File System Access API 的浏览器中调用。
 */
export async function openFilesWithPicker(): Promise<void> {
    if (!supportsFileSystemAccess()) {
        // 降级到传统文件输入
        dom.fileInput.click();
        return;
    }

    try {
        const handles = await window.showOpenFilePicker({
            multiple: true,
            types: ALPHATEX_FILE_TYPES
        });

        for (const handle of handles) {
            try {
                const file = await handle.getFile();
                const lowerFileName = file.name.toLowerCase();
                if (/(\.alphatex|\.atx|\.txt)$/.test(lowerFileName)) {
                    await openTextFile(file, handle);
                } else {
                    await openBinaryFile(file);
                }
            } catch (error) {
                setStatus('error', '文件打开失败', `${handle.name}：${getErrorMessage(error)}`);
            }
        }
    } catch (error) {
        // 用户取消文件选择器时会抛出 AbortError，静默处理
        if (error instanceof DOMException && error.name === 'AbortError') {
            return;
        }
        setStatus('error', '文件打开失败', getErrorMessage(error));
    }
}

/**
 * 保存当前活动文档。
 *
 * 行为逻辑：
 * - 如果文档有关联的 FileSystemFileHandle → 直接写入原文件
 * - 如果没有 → 调用 saveActiveDocumentAs() 弹出另存为对话框
 *
 * @returns 是否保存成功
 */
export async function saveActiveDocument(): Promise<boolean> {
    const activeDocument = getActiveDocument();
    if (!activeDocument) {
        setStatus('warning', '保存不可用', '当前没有活动文档');
        return false;
    }

    const content = activeDocument.model.getValue();
    if (!content.trim()) {
        setStatus('warning', '保存不可用', '当前文档内容为空');
        return false;
    }

    // 有文件句柄 → 直接保存
    if (activeDocument.fileHandle) {
        try {
            const hasPermission = await verifyPermission(activeDocument.fileHandle);
            if (!hasPermission) {
                setStatus('warning', '权限不足', '未获得文件写入权限，请重试');
                return false;
            }

            const writable = await activeDocument.fileHandle.createWritable();
            await writable.write(content);
            await writable.close();

            markActiveDocumentSaved();
            setStatus('ready', '已保存', activeDocument.displayName);
            return true;
        } catch (error) {
            setStatus('error', '保存失败', getErrorMessage(error));
            return false;
        }
    }

    // 无文件句柄 → 另存为
    return saveActiveDocumentAs();
}

/**
 * 将当前活动文档另存为新文件。
 *
 * 行为逻辑：
 * - 支持 File System Access API → 使用 showSaveFilePicker 弹出对话框
 * - 不支持 → 降级为 downloadBlob 触发浏览器下载
 *
 * @returns 是否保存成功
 */
async function saveActiveDocumentAs(): Promise<boolean> {
    const activeDocument = getActiveDocument();
    if (!activeDocument) {
        setStatus('warning', '保存不可用', '当前没有活动文档');
        return false;
    }

    const content = activeDocument.model.getValue();
    if (!content.trim()) {
        setStatus('warning', '保存不可用', '当前文档内容为空');
        return false;
    }

    const fallbackName = activeDocument.displayName.toLowerCase().endsWith('.alphatex')
        ? activeDocument.displayName
        : `${activeDocument.displayName}.alphatex`;

    if (!supportsFileSystemAccess()) {
        // 降级：使用 downloadBlob
        const { downloadBlob } = await import('./utils');
        downloadBlob(fallbackName, new Blob([content], { type: 'text/plain;charset=utf-8' }));
        markActiveDocumentSaved();
        setStatus('ready', '已导出 AlphaTex', fallbackName);
        return true;
    }

    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: fallbackName,
            types: ALPHATEX_FILE_TYPES
        });

        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();

        // 更新文档的文件句柄（未来保存将直接写入此文件）
        activeDocument.fileHandle = handle;
        activeDocument.hasFileHandle = true;
        activeDocument.displayName = handle.name;
        void saveFileHandle(activeDocument.id, handle);

        markActiveDocumentSaved();
        setStatus('ready', '已保存', handle.name);
        return true;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return false;
        }
        setStatus('error', '保存失败', getErrorMessage(error));
        return false;
    }
}

export function closeDocument(documentId: string): void {
    const targetDocument = getDocumentById(documentId);
    if (!targetDocument) {
        return;
    }

    if (targetDocument.isDirty) {
        const confirmed = confirm(
            `文档「${targetDocument.displayName}」有未保存的更改，确定关闭吗？`
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

    // 清理 IndexedDB 中持久化的文件句柄
    if (targetDocument.fileHandle) {
        void removeFileHandle(documentId);
    }

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
