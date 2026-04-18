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
        label.dataset.documentId = workspaceDocument.id;
        selectButton.appendChild(label);

        // 更多操作按钮（悬浮/激活时淡入）
        const menuButton = window.document.createElement('button');
        menuButton.type = 'button';
        menuButton.className = 'document-tab__menu';
        menuButton.dataset.documentId = workspaceDocument.id;
        menuButton.setAttribute('aria-label', `${workspaceDocument.displayName} 更多操作`);
        menuButton.setAttribute('aria-haspopup', 'menu');
        menuButton.setAttribute('aria-expanded', 'false');
        menuButton.title = '更多操作';
        menuButton.textContent = '⋯';

        const closeButton = window.document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'document-tab__close';
        closeButton.dataset.documentId = workspaceDocument.id;
        closeButton.setAttribute('aria-label', `关闭 ${workspaceDocument.displayName}`);
        closeButton.title = `关闭 ${workspaceDocument.displayName}`;
        closeButton.textContent = '×';

        tab.appendChild(selectButton);
        tab.appendChild(menuButton);
        tab.appendChild(closeButton);
        dom.documentTabList.appendChild(tab);
    }

    // 将激活标签滚动到可见区域
    scrollActiveTabIntoView();
    // 更新渐变遮罩状态
    updateTabScrollIndicators();
}

/**
 * 仅更新激活标签的视觉状态（class / aria-selected），不重建 DOM。
 *
 * 设计目的：避免因 `renderDocumentTabs()` 整体重渲染导致正在打开的菜单、
 * 正处于 contenteditable 编辑态的 label 等被销毁。激活链路频繁触发，
 * 使用原地更新远比重建 DOM 更稳。
 */
function updateActiveTabIndicator(): void {
    const tabs = dom.documentTabList.querySelectorAll<HTMLElement>('.document-tab');
    for (const tab of tabs) {
        const id = tab.dataset.documentId;
        const isActive = id === state.activeDocumentId;
        tab.classList.toggle('is-active', isActive);
        const select = tab.querySelector<HTMLButtonElement>('.document-tab__select');
        if (select) {
            select.setAttribute('aria-selected', String(isActive));
        }
    }
    scrollActiveTabIntoView();
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

        // 关闭按钮：立即关闭
        const closeButton = target.closest<HTMLButtonElement>('.document-tab__close');
        if (closeButton?.dataset.documentId) {
            closeDocument(closeButton.dataset.documentId);
            return;
        }

        // 更多操作按钮：打开弹层菜单
        const menuButton = target.closest<HTMLButtonElement>('.document-tab__menu');
        if (menuButton?.dataset.documentId) {
            event.stopPropagation();
            openTabActionMenu(menuButton, menuButton.dataset.documentId);
            return;
        }

        // 处于就地重命名输入状态时，点击 input 自身不应触发激活
        if (target.closest('.document-tab__label[contenteditable="true"]')) {
            return;
        }

        // 普通激活
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

// ─── 文档重命名（就地编辑标签） ───────────────────────────────

/**
 * 当前是否有正在进行的就地重命名操作。
 * 用于防止同一 tab 上打开多个输入框，以及切换/关闭文档时自动提交。
 */
let activeInlineRename: {
    documentId: string;
    label: HTMLElement;
    finish: (commit: boolean) => void;
} | null = null;

/**
 * 校验并更新文档的 displayName。
 *
 * 行为：
 * - 新名称为空 / 仅空白 → 拒绝，提示警告
 * - 新名称与当前名称相同 → 视为成功（无操作）
 * - 与其他 tab 冲突 → 拒绝，提示警告
 * - 通过校验后：
 *   - 若 `scoreTitle` 原本跟随 `displayName`，同步更新
 *   - 若文档有 `fileHandle`（已关联磁盘文件）→ 清空句柄，
 *     下次保存会通过"另存为"对话框写入新文件，符合"修改保存的文件名"语义
 *   - 标记为脏（内容未变但要提示用户另存为）
 *
 * @returns 是否重命名成功
 */
export function renameDocument(documentId: string, rawName: string): boolean {
    const target = getDocumentById(documentId);
    if (!target) {
        return false;
    }

    const trimmed = rawName.trim();
    if (!trimmed) {
        setStatus('warning', '重命名失败', '文件名不能为空');
        return false;
    }

    if (trimmed === target.displayName) {
        return true;
    }

    const conflict = getDocumentsInOrder().some(
        other => other.id !== documentId && other.displayName === trimmed
    );
    if (conflict) {
        setStatus('warning', '重命名失败', `名称「${trimmed}」已被其他标签使用`);
        return false;
    }

    const titleFollowedDisplayName = target.scoreTitle === target.displayName;
    const previousName = target.displayName;
    target.displayName = trimmed;
    if (titleFollowedDisplayName) {
        target.scoreTitle = trimmed;
    }

    // 已关联磁盘文件 → 切断句柄，强制下次保存走"另存为"写入新文件名
    let fileHandleCleared = false;
    if (target.fileHandle) {
        target.fileHandle = null;
        target.hasFileHandle = false;
        void removeFileHandle(documentId);
        fileHandleCleared = true;
        // 标记为脏，提示用户该名称尚未落盘
        target.isDirty = true;
    }

    renderDocumentTabs();
    persistWorkspace();

    // 重命名成功后对目标 tab 做一次短暂的视觉反馈
    flashTabFeedback(documentId, 'success');

    if (state.activeDocumentId === documentId) {
        dom.scoreTitle.textContent = target.scoreTitle || trimmed;
    }

    const subtitle = fileHandleCleared
        ? `${previousName} → ${trimmed}（下次保存将另存为新文件）`
        : `${previousName} → ${trimmed}`;
    setStatus('ready', '已重命名', subtitle);
    return true;
}

/**
 * 为指定标签追加一次短暂的视觉反馈（success / error）。
 * 通过切换 CSS 类触发动画，动画结束后自动移除，保持 DOM 干净。
 */
function flashTabFeedback(documentId: string, kind: 'success' | 'error'): void {
    const tab = dom.documentTabList.querySelector<HTMLElement>(
        `.document-tab[data-document-id="${CSS.escape(documentId)}"]`
    );
    if (!tab) {
        return;
    }
    const className = kind === 'success' ? 'is-flash-success' : 'is-flash-error';
    tab.classList.remove(className);
    // 触发重排以保证动画能重新播放
    void tab.offsetWidth;
    tab.classList.add(className);
    window.setTimeout(() => {
        tab.classList.remove(className);
    }, 600);
}

/**
 * 在指定 label 元素上启动就地重命名（contenteditable 方案）。
 *
 * 交互规则：
 * - 打开时自动选中不含扩展名的部分（符合主流 IDE 习惯）
 * - Enter / 失焦 → 提交
 * - Esc → 取消
 * - 切换其他 tab / 开始另一次重命名 → 自动提交当前输入
 *
 * 实现说明：
 * - 直接在 label (`<span>`) 上启用 `contenteditable`，**不替换 DOM**，
 *   避免 `<button>` 内嵌 `<input>` 的非法嵌套以及节点替换引发的事件异常。
 * - 编辑期间：
 *   - 给外层 `.document-tab` 加 `is-renaming` 类，CSS 提供视觉边框
 *   - 给内层 `.document-tab__select` 加 `pointer-events: none`，
 *     防止 click 冒泡触发 activateDocument / focus 编辑器
 */
function startInlineRename(documentId: string, labelElement: HTMLElement): void {
    // 若已有重命名在进行，先提交它
    if (activeInlineRename) {
        activeInlineRename.finish(true);
    }

    const target = getDocumentById(documentId);
    if (!target) {
        return;
    }

    const tabContainer = labelElement.closest<HTMLElement>('.document-tab');
    const selectButton = labelElement.closest<HTMLButtonElement>('.document-tab__select');
    if (!tabContainer || !selectButton) {
        return;
    }

    const originalText = target.displayName;

    // 进入编辑状态（仅切换属性与类名，不替换节点）
    labelElement.setAttribute('contenteditable', 'plaintext-only');
    labelElement.setAttribute('spellcheck', 'false');
    labelElement.setAttribute('role', 'textbox');
    labelElement.setAttribute('aria-label', '重命名当前文档');
    tabContainer.classList.add('is-renaming');

    let finished = false;
    const finish = (commit: boolean) => {
        if (finished) {
            return;
        }
        finished = true;

        const value = (labelElement.textContent ?? '').replace(/\r?\n/g, '').trim();

        labelElement.removeEventListener('keydown', handleKeydown);
        labelElement.removeEventListener('blur', handleBlur);
        labelElement.removeEventListener('mousedown', stopBubble);
        labelElement.removeEventListener('click', stopBubble);
        labelElement.removeEventListener('paste', handlePaste);

        labelElement.removeAttribute('contenteditable');
        labelElement.removeAttribute('spellcheck');
        labelElement.removeAttribute('role');
        labelElement.removeAttribute('aria-label');
        tabContainer.classList.remove('is-renaming');

        if (activeInlineRename?.documentId === documentId) {
            activeInlineRename = null;
        }

        if (!commit) {
            labelElement.textContent = originalText;
            return;
        }

        const ok = renameDocument(documentId, value);
        if (!ok) {
            // 校验失败（空名/冲突），恢复原名并闪红提示
            labelElement.textContent = originalText;
            flashTabFeedback(documentId, 'error');
        }
    };

    const handleKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
        }
    };
    const handleBlur = () => finish(true);
    const stopBubble = (event: Event) => event.stopPropagation();
    // 阻止粘贴富文本（带 HTML/换行），只接受纯文本单行
    const handlePaste = (event: ClipboardEvent) => {
        event.preventDefault();
        const text = event.clipboardData?.getData('text/plain') ?? '';
        const sanitized = text.replace(/[\r\n\t]+/g, ' ').trim();
        window.document.execCommand('insertText', false, sanitized);
    };

    labelElement.addEventListener('keydown', handleKeydown);
    labelElement.addEventListener('blur', handleBlur);
    labelElement.addEventListener('mousedown', stopBubble);
    labelElement.addEventListener('click', stopBubble);
    labelElement.addEventListener('paste', handlePaste);

    activeInlineRename = { documentId, label: labelElement, finish };

    // 选中文件名主干（扩展名前的部分）
    labelElement.focus();
    selectLabelStem(labelElement, originalText);
}

/**
 * 在一个 contenteditable label 内选中不含扩展名的主干部分。
 * 若没有扩展名，则全选。
 */
function selectLabelStem(labelElement: HTMLElement, fullText: string): void {
    const dotIndex = fullText.lastIndexOf('.');
    const selection = window.getSelection();
    if (!selection) {
        return;
    }
    const range = window.document.createRange();
    const textNode = labelElement.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        range.selectNodeContents(labelElement);
    } else if (dotIndex > 0) {
        range.setStart(textNode, 0);
        range.setEnd(textNode, dotIndex);
    } else {
        range.selectNodeContents(labelElement);
    }
    selection.removeAllRanges();
    selection.addRange(range);
}

// ─── Tab 操作菜单（更多操作弹层） ─────────────────────────────

/**
 * 当前打开的 tab 操作菜单引用，用于外部点击/Esc 关闭。
 */
let activeTabActionMenu: {
    element: HTMLElement;
    trigger: HTMLButtonElement;
    close: () => void;
} | null = null;

/**
 * 在指定触发按钮下方打开 tab 操作菜单。
 *
 * 设计要点：
 * - 菜单位置基于触发按钮的视口坐标 `position: fixed` 定位，避免被 tab 容器的
 *   `overflow: hidden / scroll` 裁切
 * - 外部点击 / Esc / 窗口 resize / scroll 都会关闭菜单
 * - 同一时间只允许一个菜单，打开新菜单前先关闭旧菜单
 */
function openTabActionMenu(trigger: HTMLButtonElement, documentId: string): void {
    // 已打开的同触发点菜单 → 视为 toggle，关闭
    if (activeTabActionMenu?.trigger === trigger) {
        activeTabActionMenu.close();
        return;
    }
    closeTabActionMenu();

    const target = getDocumentById(documentId);
    if (!target) {
        return;
    }

    const menu = window.document.createElement('div');
    menu.className = 'tab-action-menu';
    menu.setAttribute('role', 'menu');

    const items: Array<{ label: string; danger?: boolean; action: () => void }> = [
        {
            label: '重命名',
            action: () => {
                const label = dom.documentTabList.querySelector<HTMLElement>(
                    `.document-tab[data-document-id="${CSS.escape(documentId)}"] .document-tab__label`
                );
                if (label) {
                    startInlineRename(documentId, label);
                }
            }
        }
        // 关闭操作由 tab 自带的 × 按钮承担，菜单专注扩展低频操作，不重复入口。
        // 未来可在此追加：复制文件名 / 另存为 / 关闭其他标签 等。
    ];

    for (const item of items) {
        const button = window.document.createElement('button');
        button.type = 'button';
        button.className = 'tab-action-menu__item';
        if (item.danger) {
            button.classList.add('tab-action-menu__item--danger');
        }
        button.setAttribute('role', 'menuitem');
        button.textContent = item.label;
        button.addEventListener('click', event => {
            event.stopPropagation();
            closeTabActionMenu();
            // 下一帧执行，确保菜单已从 DOM 移除，避免 action 内的 focus 流被打断
            window.requestAnimationFrame(() => item.action());
        });
        menu.appendChild(button);
    }

    window.document.body.appendChild(menu);
    positionTabActionMenu(menu, trigger);

    trigger.setAttribute('aria-expanded', 'true');

    const handleDocumentPointerDown = (event: Event) => {
        if (!(event.target instanceof Node)) {
            return;
        }
        if (menu.contains(event.target) || trigger.contains(event.target)) {
            return;
        }
        closeTabActionMenu();
    };
    const handleKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            closeTabActionMenu();
        }
    };
    const handleRelayout = () => closeTabActionMenu();

    // 捕获阶段监听 pointerdown，优先于内部 click；避免误把点击当 tab 激活
    window.document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', handleRelayout);
    window.addEventListener('scroll', handleRelayout, true);

    activeTabActionMenu = {
        element: menu,
        trigger,
        close: () => {
            window.document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
            window.removeEventListener('keydown', handleKeydown);
            window.removeEventListener('resize', handleRelayout);
            window.removeEventListener('scroll', handleRelayout, true);
            menu.remove();
            trigger.setAttribute('aria-expanded', 'false');
            if (activeTabActionMenu?.element === menu) {
                activeTabActionMenu = null;
            }
        }
    };
}

/**
 * 根据触发按钮定位菜单。默认在按钮下方 4px，超出视口右侧时改为右对齐，
 * 超出视口底部时改为按钮上方显示。
 */
function positionTabActionMenu(menu: HTMLElement, trigger: HTMLElement): void {
    const triggerRect = trigger.getBoundingClientRect();
    // 先给一个不可见位置用于测量尺寸
    menu.style.visibility = 'hidden';
    menu.style.left = '0px';
    menu.style.top = '0px';
    const menuRect = menu.getBoundingClientRect();
    const gap = 4;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let left = triggerRect.left;
    if (left + menuRect.width + gap > viewportW) {
        left = Math.max(8, triggerRect.right - menuRect.width);
    }

    let top = triggerRect.bottom + gap;
    if (top + menuRect.height + gap > viewportH) {
        top = Math.max(8, triggerRect.top - menuRect.height - gap);
    }

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.visibility = '';
}

function closeTabActionMenu(): void {
    activeTabActionMenu?.close();
}

export function activateDocument(
    documentId: string,
    options: { focus?: boolean; render?: boolean; stopPlayback?: boolean } = {}
): void {
    const targetDocument = getDocumentById(documentId);
    if (!targetDocument || !state.editor) {
        return;
    }

    // 若正在进行就地重命名，先提交以保证 UI 状态一致
    if (activeInlineRename) {
        activeInlineRename.finish(true);
    }
    // 切换文档时关闭可能残留的操作菜单
    closeTabActionMenu();

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
    // 仅更新激活态，保留 DOM 节点，避免重建时销毁菜单 / contenteditable 编辑态
    updateActiveTabIndicator();
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
        // 降级：使用 downloadBlob（非安全上下文或不支持的浏览器）
        const { downloadBlob } = await import('./utils');
        downloadBlob(fallbackName, new Blob([content], { type: 'text/plain;charset=utf-8' }));
        markActiveDocumentSaved();
        setStatus('ready', '已导出下载', `${fallbackName}（浏览器不支持直接保存，请在下载目录中查找）`);
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

    // 若正在对该文档重命名，先取消
    if (activeInlineRename?.documentId === documentId) {
        activeInlineRename.finish(false);
    }
    // 关闭可能残留的操作菜单
    closeTabActionMenu();

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
