import './styles.css';
import Split from 'split.js';
import {
    MIN_SPLIT_PANEL_WIDTH,
    SPLIT_GUTTER_SIZE,
    STORAGE_KEYS
} from './constants';
import { cursorSync } from './cursor-sync';
import { setupDocumentTabs, handleActiveDocumentContentChanged, loadInitialWorkspace } from './documents';
import { setupEditor } from './editor';
import { setupEnvContext } from './env-context';
import { setupMobileEnhancements } from './mobile';
import { scheduleRender, setupPreview } from './preview';
import {
    dom,
    getPreferredSplitSizes,
    persistSplitSizes,
    setStatus,
    setViewMode,
    state
} from './state';
import { setupToolbar } from './toolbar';
import { setupTransport } from './transport';
import type { ViewMode } from './types';
import { escapeHtml, getErrorMessage, readStorage } from './utils';

void initialize();

async function initialize(): Promise<void> {
    try {
        setStatus('muted', '正在初始化', '加载编辑器与多文档工作区');

        setupSplit();
        setupPreview();
        await setupEditor(() => {
            handleActiveDocumentContentChanged();
            scheduleRender();
        });

        // 初始化光标同步：将编辑器和预览 API 连接起来
        if (state.api && state.editor) {
            cursorSync.init(state.api, state.editor, dom.alphaTabRoot, dom.previewViewport);
        }

        setupDocumentTabs();
        setupToolbar();
        setupEnvContext();
        setupTransport();
        setupDiagnosticsToggle();
        setupTrackDockToggle();

        setViewMode((readStorage(STORAGE_KEYS.view) as ViewMode | null) ?? 'split');
        setupMobileEnhancements();
        loadInitialWorkspace();
        dismissLoading();
    } catch (error) {
        setStatus('error', '初始化失败', getErrorMessage(error));
        dom.diagnosticsList.innerHTML = `<li data-severity="error">${escapeHtml(getErrorMessage(error))}</li>`;
        dismissLoading();
    }
}

function dismissLoading(): void {
    const loading = document.getElementById('appLoading');
    const shell = document.getElementById('appShell');

    shell?.classList.add('is-ready');

    if (loading) {
        loading.style.transition = 'opacity 0.3s ease';
        loading.style.opacity = '0';
        loading.addEventListener('transitionend', () => loading.remove(), { once: true });
        window.setTimeout(() => loading.remove(), 400);
    }
}

function setupSplit(): void {
    let reflowFrame = 0;
    const scheduleSplitReflow = (): void => {
        if (reflowFrame !== 0) {
            return;
        }

        reflowFrame = window.requestAnimationFrame(() => {
            reflowFrame = 0;
            state.editor?.layout();

            if (state.pendingRenderDocumentId) {
                return;
            }

            const api = state.api as ({ triggerResize?: () => void; render?: () => void }) | null;
            if (api?.triggerResize) {
                api.triggerResize();
                return;
            }

            api?.render?.();
        });
    };

    state.split = Split(['#editorPane', '#previewPane'], {
        sizes: getPreferredSplitSizes(),
        minSize: [MIN_SPLIT_PANEL_WIDTH, MIN_SPLIT_PANEL_WIDTH],
        gutterSize: SPLIT_GUTTER_SIZE,
        snapOffset: 24,
        onDrag: () => {
            scheduleSplitReflow();
        },
        onDragEnd: () => {
            persistSplitSizes(state.split?.getSizes() ?? getPreferredSplitSizes());
            scheduleSplitReflow();
        }
    });
}

function setupDiagnosticsToggle(): void {
    const toggle = dom.diagnosticsToggle;
    const panel = dom.diagnosticsPanel;
    if (!toggle || !panel) {
        return;
    }

    toggle.addEventListener('click', () => {
        const isCollapsed = panel.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
    });
}

function setupTrackDockToggle(): void {
    const toggle = dom.trackDockToggle;
    const dock = dom.trackDock;
    if (!toggle || !dock) {
        return;
    }

    toggle.addEventListener('click', () => {
        const isExpanded = dock.classList.toggle('is-expanded');
        toggle.setAttribute('aria-expanded', String(isExpanded));
    });
}
