import { NARROW_BREAKPOINT } from './constants';
import { dom, getActiveDocument, setViewMode, state } from './state';

export function isTouchDevice(): boolean {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

export function setupEditorActionBar(): void {
    const editorPane = document.getElementById('editorPane');
    const editorSurface = editorPane?.querySelector('.editor-surface');
    if (!editorSurface) {
        return;
    }

    const actionBar = createActionBar();
    editorSurface.insertAdjacentElement('beforebegin', actionBar);
}

function createActionBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'editor-action-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', '编辑器快捷操作');

    const actions: ActionBarItem[] = [
        { label: '撤销', icon: '↩', command: 'undo' },
        { label: '重做', icon: '↪', command: 'redo' },
        { type: 'separator' },
        { label: 'Tab', icon: '⇥', command: 'tab' },
        { label: '智能提示', icon: '💡', command: 'editor.action.triggerSuggest' },
        { type: 'separator' },
        { label: '缩进', icon: '→', command: 'editor.action.indentLines' },
        { label: '取消缩进', icon: '←', command: 'editor.action.outdentLines' }
    ];

    for (const item of actions) {
        if (item.type === 'separator') {
            const separator = document.createElement('span');
            separator.className = 'editor-action-bar__separator';
            separator.setAttribute('aria-hidden', 'true');
            bar.appendChild(separator);
            continue;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-action-bar__button';
        button.textContent = item.icon;
        button.title = item.label;
        button.setAttribute('aria-label', item.label);
        button.addEventListener('click', event => {
            event.preventDefault();
            triggerEditorAction(item.command);
        });
        bar.appendChild(button);
    }

    return bar;
}

function triggerEditorAction(command: string): void {
    const editor = state.editor;
    if (!editor) {
        return;
    }

    editor.focus();
    editor.trigger('actionbar', command, {});
}

export function setupTimelineTouch(): void {
    let isSeeking = false;

    dom.timeline.addEventListener(
        'touchstart',
        event => {
            event.preventDefault();
            isSeeking = true;
            seekToClientX(event.touches[0].clientX);
        },
        { passive: false }
    );

    dom.timeline.addEventListener(
        'touchmove',
        event => {
            if (!isSeeking) {
                return;
            }
            event.preventDefault();
            seekToClientX(event.touches[0].clientX);
        },
        { passive: false }
    );

    dom.timeline.addEventListener('touchend', () => {
        isSeeking = false;
    });

    dom.timeline.addEventListener('touchcancel', () => {
        isSeeking = false;
    });
}

export function seekToClientX(clientX: number): void {
    const timeInfo = getActiveDocument()?.currentTimeInfo;
    if (!timeInfo || !state.api) {
        return;
    }

    const rect = dom.timeline.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    state.api.timePosition = Math.floor(timeInfo.endTime * percent);
}

const MOBILE_BREAKPOINT = 640;
const MOBILE_PREVIEW_SCALE = 0.8;

export function isMobileDevice(): boolean {
    return window.innerWidth <= MOBILE_BREAKPOINT && isTouchDevice();
}

export function isNarrowViewport(): boolean {
    return window.innerWidth <= NARROW_BREAKPOINT;
}

export function setupResponsiveViewConstraint(): void {
    const mediaQuery = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT}px)`);

    const handleChange = (event: MediaQueryListEvent | MediaQueryList): void => {
        if (event.matches && state.currentView === 'split') {
            setViewMode('editor');
        } else if (!event.matches && 'type' in event) {
            setViewMode(state.currentView);
        }
    };

    handleChange(mediaQuery);
    mediaQuery.addEventListener('change', handleChange);
}

export function collapseDiagnosticsOnMobile(): void {
    if (!isMobileDevice()) {
        return;
    }

    const panel = dom.diagnosticsPanel;
    const toggle = dom.diagnosticsToggle;
    if (!panel || !toggle) {
        return;
    }

    if (!panel.classList.contains('is-collapsed')) {
        panel.classList.add('is-collapsed');
        toggle.setAttribute('aria-expanded', 'false');
    }
}

function calculateBarsPerRow(viewportWidth: number): number {
    const layoutOverhead = 40;
    const availableWidth = viewportWidth - layoutOverhead;
    const barReferenceWidth = 250;
    return Math.max(1, Math.floor(availableWidth / barReferenceWidth));
}

export function setupMobilePreviewLayout(): void {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    let isMobile = false;

    const adjustBarsPerRow = (): void => {
        const score = getActiveDocument()?.currentScore;
        if (!score) {
            return;
        }

        if (isMobile) {
            const barsPerRow = calculateBarsPerRow(window.innerWidth);
            score.defaultSystemsLayout = barsPerRow;
            for (const track of score.tracks) {
                track.defaultSystemsLayout = barsPerRow;
            }
        }
    };

    const handleChange = (event: MediaQueryListEvent | MediaQueryList): void => {
        if (!state.api) {
            return;
        }

        const wasMobile = isMobile;
        isMobile = event.matches;

        if (isMobile) {
            state.api.settings.display.scale = MOBILE_PREVIEW_SCALE;
            adjustBarsPerRow();
        } else {
            state.api.settings.display.scale = 1;

            const score = getActiveDocument()?.currentScore;
            if (wasMobile && score) {
                const defaultBars = 3;
                score.defaultSystemsLayout = defaultBars;
                for (const track of score.tracks) {
                    track.defaultSystemsLayout = defaultBars;
                }
            }
        }

        state.api.updateSettings();
        state.api.render();
    };

    state.api?.scoreLoaded.on(() => {
        adjustBarsPerRow();
    });

    handleChange(mediaQuery);
    mediaQuery.addEventListener('change', handleChange);
}

export function applyMobileFontSize(): void {
    if (!isTouchDevice() || !state.editor) {
        return;
    }

    state.editor.updateOptions({ fontSize: 16 });
}

export function setupMobileEnhancements(): void {
    setupEditorActionBar();
    setupTimelineTouch();
    applyMobileFontSize();
    setupResponsiveViewConstraint();
    collapseDiagnosticsOnMobile();
    setupMobilePreviewLayout();
}

type ActionBarButton = {
    type?: undefined;
    label: string;
    icon: string;
    command: string;
};

type ActionBarSeparator = {
    type: 'separator';
};

type ActionBarItem = ActionBarButton | ActionBarSeparator;
