import { EXAMPLES } from './constants';
import type { AppState, StatusTone, ViewMode } from './types';

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
    newDocumentButton: document.querySelector<HTMLButtonElement>('#newDocumentButton')!,
    openFileButton: document.querySelector<HTMLButtonElement>('#openFileButton')!,
    exampleButton: document.querySelector<HTMLButtonElement>('#exampleButton')!,
    examplePanel: document.querySelector<HTMLElement>('#examplePanel')!,
    examplePreviewBanner: document.querySelector<HTMLElement>('#examplePreviewBanner')!,
    examplePreviewLabel: document.querySelector<HTMLElement>('#examplePreviewLabel')!,
    restoreDocumentButton: document.querySelector<HTMLButtonElement>('#restoreDocumentButton')!,
    adoptExampleButton: document.querySelector<HTMLButtonElement>('#adoptExampleButton')!,
    downloadAlphaTexButton: document.querySelector<HTMLButtonElement>('#downloadAlphaTexButton')!,
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
    trackDock: document.querySelector<HTMLElement>('.track-dock')
} as const;

// ─── 应用状态 ───────────────────────────────────────────────

export const state: AppState = {
    api: null,
    editor: null,
    split: null,
    currentScore: null,
    activeTrackIndexes: [],
    currentView: 'split',
    renderTimer: 0,
    currentTimeInfo: null,
    lastFileName: EXAMPLES.overture.fileName,
    shouldSyncEditorFromExternalLoad: false,
    lastSuccessfulCode: '',
    isExamplePreview: false,
    previewingExampleId: null,
    userDocumentBackup: null
};

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

/**
 * 设置视图模式（更新 state + DOM + split 布局）
 */
export function setViewMode(view: ViewMode): void {
    state.currentView = view;
    dom.workspace.dataset.view = view;

    for (const button of dom.viewButtons) {
        button.classList.toggle('is-active', button.dataset.view === view);
    }

    switch (view) {
        case 'split':
            state.split?.setSizes([46, 54]);
            break;
        case 'editor':
            state.split?.setSizes([100, 0]);
            break;
        case 'preview':
            state.split?.setSizes([0, 100]);
            break;
    }

    state.editor?.layout();
    queuePreviewReflow();
}

/**
 * 延迟触发预览重排（等 split.js 动画完成）
 */
export function queuePreviewReflow(): void {
    window.setTimeout(() => {
        state.api?.render();
    }, 90);
}
