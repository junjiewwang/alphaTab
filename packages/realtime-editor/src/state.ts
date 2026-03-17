import { EXAMPLES, NARROW_BREAKPOINT } from './constants';
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
 *
 * 窄屏守卫：当视口宽度 ≤ NARROW_BREAKPOINT 时，split 视图不可用（CSS 已隐藏
 * split 按钮和 gutter），此处做运行时兜底，将 split 请求降级为 editor。
 *
 * 宽屏模式 — 操作顺序至关重要：
 * 1. 先临时移除 data-view 属性，确保两个面板都可见（非 display:none）
 * 2. 让 Split.js 在两个面板都可见时计算和设置尺寸
 * 3. 最后设置 data-view 触发 CSS display:none 隐藏对应面板
 *
 * 窄屏模式（≤ NARROW_BREAKPOINT）— 跳过 Split.js：
 * CSS 已将 workspace 设为 flex-direction: column（纵向堆叠），gutter 隐藏。
 * Split.js 的水平 width 操作在纵向布局下无效且有害（会干扰 flex 宽度分配，
 * 在 Safari WebKit 中可能导致面板宽度异常）。因此窄屏下直接清除面板的内联
 * width 样式，只依赖 CSS data-view + display:none 来控制视图切换。
 */
export function setViewMode(view: ViewMode): void {
    // 窄屏守卫：拦截 split 请求，降级为 editor
    const isNarrow = window.innerWidth <= NARROW_BREAKPOINT;
    const resolvedView = (view === 'split' && isNarrow)
        ? 'editor'
        : view;

    state.currentView = resolvedView;

    // 更新工具栏按钮高亮状态
    for (const button of dom.viewButtons) {
        button.classList.toggle('is-active', button.dataset.view === resolvedView);
    }

    if (isNarrow) {
        // ── 窄屏路径：跳过 Split.js，纯 CSS 驱动视图切换 ──
        // 清除 Split.js 可能遗留的内联 width，让 CSS flex 布局接管
        clearSplitInlineStyles();

        // 直接设置 data-view 触发 CSS display:none 隐藏对应面板
        dom.workspace.dataset.view = resolvedView;
    } else {
        // ── 宽屏路径：通过 Split.js 精确控制面板尺寸 ──

        // Step 1：临时移除 data-view，确保两个面板都可见
        delete dom.workspace.dataset.view;

        // Step 1.5：强制浏览器 reflow
        // 当面板从 display:none 恢复为可见时，浏览器可能尚未完成 layout，
        // Split.js 读取到的元素尺寸仍为 0。读取 offsetHeight 迫使浏览器
        // 同步完成挂起的样式计算和布局。
        dom.workspace.offsetHeight;

        // Step 2：在面板都可见时让 Split.js 设置正确的尺寸
        switch (resolvedView) {
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

        // Step 3：设置 data-view 触发 CSS 隐藏对应面板
        dom.workspace.dataset.view = resolvedView;
    }

    // ── 刷新编辑器和预览布局 ──
    state.editor?.layout();
    queuePreviewReflow();
}

/**
 * 清除 Split.js 在面板上设置的内联 width 样式
 *
 * 在窄屏模式下（flex-direction: column），Split.js 的水平 width 值
 * 会干扰 flex 布局的自动宽度分配。清除后让 CSS flex 规则完全接管。
 */
function clearSplitInlineStyles(): void {
    const editorPane = document.getElementById('editorPane');
    const previewPane = document.getElementById('previewPane');
    editorPane?.style.removeProperty('width');
    previewPane?.style.removeProperty('width');
}

/**
 * 延迟触发预览重排（等 split.js 动画完成）
 */
export function queuePreviewReflow(): void {
    window.setTimeout(() => {
        state.api?.render();
    }, 90);
}
