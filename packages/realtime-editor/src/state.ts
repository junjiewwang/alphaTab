import { DEFAULT_SPLIT_SIZES, NARROW_BREAKPOINT, STORAGE_KEYS } from './constants';
import type { AppState, StatusTone, ViewMode, WorkspaceDocument } from './types';
import { persistValue, readStorage } from './utils';

// ─── DOM 引用 ──────────────────────────────────────────────

export const dom = {
    workspace: document.querySelector<HTMLElement>('#workspace')!,
    shell: document.querySelector<HTMLElement>('#appShell')!,
    statusPill: document.querySelector<HTMLElement>('#statusPill')!,
    scoreTitle: document.querySelector<HTMLElement>('#scoreTitle')!,
    scoreSubtitle: document.querySelector<HTMLElement>('#scoreSubtitle')!,
    previewSummary: document.querySelector<HTMLElement>('#previewSummary')!,
    diagnosticCount: document.querySelector<HTMLElement>('#diagnosticCount')!,
    diagnosticsList: document.querySelector<HTMLUListElement>('#diagnosticsList')!,
    trackList: document.querySelector<HTMLElement>('#trackList')!,
    trackCount: document.querySelector<HTMLElement>('#trackCount')!,
    documentTabs: document.querySelector<HTMLElement>('#documentTabs')!,
    documentTabList: document.querySelector<HTMLElement>('#documentTabList')!,
    newDocumentButton: document.querySelector<HTMLButtonElement>('#newDocumentButton')!,
    openFileButton: document.querySelector<HTMLButtonElement>('#openFileButton')!,
    exampleButton: document.querySelector<HTMLButtonElement>('#exampleButton')!,
    examplePanel: document.querySelector<HTMLElement>('#examplePanel')!,
    examplePreviewBanner: document.querySelector<HTMLElement>('#examplePreviewBanner')!,
    examplePreviewLabel: document.querySelector<HTMLElement>('#examplePreviewLabel')!,
    restoreDocumentButton: document.querySelector<HTMLButtonElement>('#restoreDocumentButton')!,
    adoptExampleButton: document.querySelector<HTMLButtonElement>('#adoptExampleButton')!,
    saveButton: document.querySelector<HTMLButtonElement>('#saveButton')!,
    printButton: document.querySelector<HTMLButtonElement>('#printButton')!,
    fileInput: document.querySelector<HTMLInputElement>('#fileInput')!,
    previewViewport: document.querySelector<HTMLElement>('#previewViewport')!,
    alphaTabRoot: document.querySelector<HTMLElement>('#alphaTab')!,
    playPauseButton: document.querySelector<HTMLButtonElement>('#playPauseButton')!,
    stopButton: document.querySelector<HTMLButtonElement>('#stopButton')!,
    timeLabel: document.querySelector<HTMLElement>('#timeLabel')!,
    timeline: document.querySelector<HTMLElement>('#timeline')!,
    timelineValue: document.querySelector<HTMLElement>('#timelineValue')!,
    speedSelect: document.querySelector<HTMLSelectElement>('#speedSelect')!,
    zoomSelect: document.querySelector<HTMLSelectElement>('#zoomSelect')!,
    layoutSelect: document.querySelector<HTMLSelectElement>('#layoutSelect')!,
    scrollSelect: document.querySelector<HTMLSelectElement>('#scrollSelect')!,
    editorElement: document.querySelector<HTMLElement>('#editor')!,
    viewButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]')),
    diagnosticsToggle: document.querySelector<HTMLButtonElement>('#diagnosticsToggle'),
    diagnosticsPanel: document.querySelector<HTMLElement>('.diagnostics-panel'),
    trackDockToggle: document.querySelector<HTMLButtonElement>('#trackDockToggle'),
    trackDock: document.querySelector<HTMLElement>('#trackDock')
} as const;

// ─── 应用状态 ───────────────────────────────────────────────

export const state: AppState = {
    api: null,
    editor: null,
    split: null,
    documents: new Map(),
    documentOrder: [],
    activeDocumentId: null,
    renderedDocumentId: null,
    currentView: 'split',
    renderTimer: 0,
    pendingImportRequest: null,
    pendingRenderDocumentId: null,
    pendingRenderStatus: null,
    suspendDocumentChangeHandling: false
};

// ─── 状态查询辅助 ────────────────────────────────────────────

export function getDocumentById(documentId: string | null): WorkspaceDocument | null {
    if (!documentId) {
        return null;
    }
    return state.documents.get(documentId) ?? null;
}

export function getActiveDocument(): WorkspaceDocument | null {
    return getDocumentById(state.activeDocumentId);
}

export function getDocumentsInOrder(): WorkspaceDocument[] {
    return state.documentOrder
        .map(documentId => state.documents.get(documentId) ?? null)
        .filter((document): document is WorkspaceDocument => Boolean(document));
}

// ─── 状态变更辅助 ────────────────────────────────────────────

/**
 * 设置状态指示器（状态胶囊 + 预览摘要）
 */
export function setStatus(tone: StatusTone, title: string, subtitle?: string): void {
    dom.statusPill.dataset.tone = tone;
    dom.statusPill.textContent = title;
    if (subtitle) {
        dom.previewSummary.textContent = subtitle;
    }
}

type SplitSizes = [number, number];

function normalizeSplitSizes(sizes: readonly number[]): SplitSizes | null {
    if (sizes.length !== 2) {
        return null;
    }

    const [left, right] = sizes;
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return null;
    }

    const total = left + right;
    if (total <= 0) {
        return null;
    }

    const normalizedLeft = Number(((left / total) * 100).toFixed(2));
    const normalizedRight = Number((100 - normalizedLeft).toFixed(2));
    return [normalizedLeft, normalizedRight];
}

export function getPreferredSplitSizes(): SplitSizes {
    const raw = readStorage(STORAGE_KEYS.splitSizes);
    if (!raw) {
        return [...DEFAULT_SPLIT_SIZES] as SplitSizes;
    }

    try {
        const parsed = JSON.parse(raw) as number[];
        return normalizeSplitSizes(parsed) ?? ([...DEFAULT_SPLIT_SIZES] as SplitSizes);
    } catch {
        return [...DEFAULT_SPLIT_SIZES] as SplitSizes;
    }
}

export function persistSplitSizes(sizes: readonly number[]): void {
    const normalized = normalizeSplitSizes(sizes);
    if (!normalized) {
        return;
    }

    persistValue(STORAGE_KEYS.splitSizes, JSON.stringify(normalized));
}

/**
 * 设置视图模式（更新 state + DOM + split 布局）
 */
export function setViewMode(view: ViewMode): void {
    const isNarrow = window.innerWidth <= NARROW_BREAKPOINT;
    const resolvedView = view === 'split' && isNarrow ? 'editor' : view;

    state.currentView = resolvedView;
    persistValue(STORAGE_KEYS.view, resolvedView);

    for (const button of dom.viewButtons) {
        button.classList.toggle('is-active', button.dataset.view === resolvedView);
    }

    if (isNarrow) {
        clearSplitInlineStyles();
        dom.workspace.dataset.view = resolvedView;
    } else {
        delete dom.workspace.dataset.view;
        dom.workspace.offsetHeight;

        if (resolvedView === 'split') {
            state.split?.setSizes(getPreferredSplitSizes());
        } else {
            clearSplitInlineStyles();
        }

        dom.workspace.dataset.view = resolvedView;
    }

    state.editor?.layout();
    queuePreviewReflow();
}

function clearSplitInlineStyles(): void {
    const editorPane = document.getElementById('editorPane');
    const previewPane = document.getElementById('previewPane');
    editorPane?.style.removeProperty('width');
    previewPane?.style.removeProperty('width');
}

/**
 * 延迟触发预览重排（等 split.js 动画完成）。
 *
 * 守卫：如果当前有正在进行的 `renderScore()`（pendingRenderDocumentId 不为 null），
 * 说明首帧渲染或文档切换渲染正在执行，此时 `api.render()` 会打断它并产生空布局，
 * 因此跳过本次 reflow。渲染完成后由 renderFinished 回调自然处理后续状态。
 */
export function queuePreviewReflow(): void {
    window.setTimeout(() => {
        if (state.pendingRenderDocumentId) {
            return;
        }
        state.api?.render();
    }, 90);
}
