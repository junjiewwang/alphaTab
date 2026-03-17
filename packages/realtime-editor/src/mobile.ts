/**
 * alphaTab Realtime Editor — 移动端增强模块
 *
 * 该模块集中处理所有移动端适配逻辑：
 * - 触摸设备检测
 * - 编辑器快捷工具栏（Action Bar）
 * - 时间轴 touch 事件支持
 * - 编辑器字号适配
 *
 * 设计原则：
 * - 所有移动端增强通过检测条件隔离，桌面端零影响
 * - 不修改现有模块的核心逻辑，仅在外部添加增强层
 */

import { NARROW_BREAKPOINT } from './constants';
import { dom, setViewMode, state } from './state';

// ─── 设备检测 ────────────────────────────────────────────────

/**
 * 检测当前设备是否支持触摸交互
 * 综合判断 `pointer: coarse`（粗精度指针，即手指）和 `ontouchstart` 支持
 */
export function isTouchDevice(): boolean {
    return (
        window.matchMedia('(pointer: coarse)').matches ||
        'ontouchstart' in window
    );
}

// ─── 编辑器快捷工具栏 (Action Bar) ──────────────────────────

/**
 * 在编辑器上方注入移动端快捷工具栏
 *
 * 按钮通过 Monaco 的 `editor.trigger()` API 触发操作，
 * 不修改 Monaco 内部行为，仅在外部添加辅助入口。
 *
 * 工具栏只在触摸设备上可见（CSS `@media (pointer: coarse)` 控制）
 */
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
        { label: '取消缩进', icon: '←', command: 'editor.action.outdentLines' },
    ];

    for (const item of actions) {
        if (item.type === 'separator') {
            const sep = document.createElement('span');
            sep.className = 'editor-action-bar__separator';
            sep.setAttribute('aria-hidden', 'true');
            bar.appendChild(sep);
            continue;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-action-bar__button';
        button.textContent = item.icon;
        button.title = item.label;
        button.setAttribute('aria-label', item.label);

        button.addEventListener('click', (event) => {
            event.preventDefault();
            triggerEditorAction(item.command);
        });

        bar.appendChild(button);
    }

    return bar;
}

/**
 * 通过 Monaco API 触发编辑器操作
 */
function triggerEditorAction(command: string): void {
    const editor = state.editor;
    if (!editor) {
        return;
    }

    editor.focus();
    editor.trigger('actionbar', command, {});
}

// ─── 时间轴 touch 事件 ──────────────────────────────────────

/**
 * 为时间轴添加 touch 事件支持
 *
 * 将 click 事件中的 `clientX → percent → timePosition` 计算逻辑
 * 抽取为 `seekToPosition()` 公共函数，touch 和 click 都调用它。
 */
export function setupTimelineTouch(): void {
    let isSeeking = false;

    dom.timeline.addEventListener('touchstart', (event) => {
        event.preventDefault(); // 阻止浏览器默认滚动
        isSeeking = true;
        seekToClientX(event.touches[0].clientX);
    }, { passive: false });

    dom.timeline.addEventListener('touchmove', (event) => {
        if (!isSeeking) {
            return;
        }
        event.preventDefault();
        seekToClientX(event.touches[0].clientX);
    }, { passive: false });

    dom.timeline.addEventListener('touchend', () => {
        isSeeking = false;
    });

    dom.timeline.addEventListener('touchcancel', () => {
        isSeeking = false;
    });
}

/**
 * 根据 clientX 坐标计算并跳转播放位置
 * 公共逻辑，供 click 和 touch 事件共同调用
 */
export function seekToClientX(clientX: number): void {
    if (!state.currentTimeInfo || !state.api) {
        return;
    }

    const rect = dom.timeline.getBoundingClientRect();
    const percent = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width)
    );
    state.api.timePosition = Math.floor(state.currentTimeInfo.endTime * percent);
}

// ─── 手机端检测 ───────────────────────────────────────────────

/** 手机端宽度断点（与 CSS @media (max-width: 640px) 保持一致） */
const MOBILE_BREAKPOINT = 640;

/**
 * 检测当前是否为手机端（小屏幕触摸设备）
 * 综合判断屏幕宽度和触摸能力
 */
export function isMobileDevice(): boolean {
    return (
        window.innerWidth <= MOBILE_BREAKPOINT &&
        isTouchDevice()
    );
}

// ─── 响应式视图约束 ──────────────────────────────────────────

/**
 * 判断当前视口是否为窄屏（宽度 ≤ NARROW_BREAKPOINT）
 *
 * 窄屏模式下 split 视图不可用（CSS 已隐藏 split 按钮 + gutter），
 * 此函数供 `state.ts` 中 `setViewMode()` 做运行时守卫。
 */
export function isNarrowViewport(): boolean {
    return window.innerWidth <= NARROW_BREAKPOINT;
}

/**
 * 监听视口宽度变化，跨越 NARROW_BREAKPOINT 时自动调整视图模式
 *
 * - 进入窄屏（宽度 ≤ 980px）：如果当前是 split → 切到 editor
 * - 回到宽屏（宽度 > 980px）：不自动切回 split（尊重用户手动选择），
 *   但需要重新触发 setViewMode 刷新 Split.js 和 Monaco editor 布局，
 *   以修复设备模拟器切换（如 iPhone → iPad Pro）后编辑器区域空白的问题
 *
 * 初次调用时也会检测一次当前状态（matchMedia 回调仅在变化时触发）
 */
export function setupResponsiveViewConstraint(): void {
    const mediaQuery = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT}px)`);

    const handleChange = (event: MediaQueryListEvent | MediaQueryList): void => {
        if (event.matches && state.currentView === 'split') {
            // 进入窄屏：split 不可用，降级为 editor
            setViewMode('editor');
        } else if (!event.matches && 'type' in event) {
            // 回到宽屏（仅在 MediaQueryListEvent 变化时触发，排除初始检测）：
            // 重新应用当前视图模式，刷新 Split.js 尺寸和 Monaco editor 布局
            setViewMode(state.currentView);
        }
    };

    // 初始检测
    handleChange(mediaQuery);

    // 监听后续变化
    mediaQuery.addEventListener('change', handleChange);
}

// ─── 手机端诊断面板自动折叠 ──────────────────────────────────

/**
 * 手机端自动折叠诊断面板，节省垂直空间
 */
export function collapseDiagnosticsOnMobile(): void {
    if (!isMobileDevice()) {
        return;
    }

    const panel = dom.diagnosticsPanel;
    const toggle = dom.diagnosticsToggle;
    if (!panel || !toggle) {
        return;
    }

    // 如果尚未折叠，则自动折叠
    if (!panel.classList.contains('is-collapsed')) {
        panel.classList.add('is-collapsed');
        toggle.setAttribute('aria-expanded', 'false');
    }
}

// ─── 手机端预览布局适配 ──────────────────────────────────────

/** 手机端 alphaTab 缩放比例：降低缩放使乐谱在小屏幕上更宽松 */
const MOBILE_PREVIEW_SCALE = 0.8;

/**
 * 根据屏幕宽度计算合适的每行小节数
 *
 * Parchment 布局的每行小节数默认为 3，在手机端（390px 左右）显得过于拥挤。
 * 通过屏幕宽度动态计算合理的每行小节数，让乐谱在不同宽度的设备上都有良好的可读性。
 *
 * 计算逻辑：
 * - 以 250px 为一个小节的参考宽度（考虑面板内边距、预览区 padding 等开销）
 * - 最小值为 1（极端窄屏），最大值不限（宽屏自然放得下更多小节）
 */
function calculateBarsPerRow(viewportWidth: number): number {
    // 面板开销：预览区 padding + 面板 border + workspace padding
    const layoutOverhead = 40;
    const availableWidth = viewportWidth - layoutOverhead;

    // 每个小节的参考宽度（包含五线谱 + TAB 谱 + 各种标记的舒适显示宽度）
    const barReferenceWidth = 250;

    return Math.max(1, Math.floor(availableWidth / barReferenceWidth));
}

/**
 * 在手机端自动优化 alphaTab 预览布局
 *
 * 两方面优化：
 * 1. 降低缩放比例（scale=0.8），等效于在更宽的画布上渲染
 * 2. 通过 scoreLoaded 事件钩子，根据屏幕宽度动态调整 score.defaultSystemsLayout
 *    和每个 track.defaultSystemsLayout，控制每行显示多少个小节
 *
 * Parchment 布局通过 ModelUtils.getSystemLayout() 读取数据模型中的
 * defaultSystemsLayout 来决定每行小节数，因此我们需要在每次 score 加载后
 * 动态修改这些值。
 *
 * 通过 matchMedia 监听断点变化，实现响应式切换。
 */
export function setupMobilePreviewLayout(): void {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);

    /** 当前是否处于手机端模式 */
    let isMobile = false;

    /**
     * scoreLoaded 回调：在每次乐谱加载后根据当前是否手机端调整每行小节数
     */
    const adjustBarsPerRow = (): void => {
        if (!state.api || !state.currentScore) {
            return;
        }

        const score = state.currentScore;

        if (isMobile) {
            const barsPerRow = calculateBarsPerRow(window.innerWidth);

            // 设置 score 级别（多轨道时使用）
            score.defaultSystemsLayout = barsPerRow;

            // 设置每个 track 级别（单轨道时使用）
            for (const track of score.tracks) {
                track.defaultSystemsLayout = barsPerRow;
            }
        }
        // 非手机端不修改，保持 alphaTab 解析出的原始值（默认 3）
    };

    const handleChange = (event: MediaQueryListEvent | MediaQueryList): void => {
        if (!state.api) {
            return;
        }

        const wasMobile = isMobile;
        isMobile = event.matches;

        if (isMobile) {
            // 进入手机端：降低缩放 + 调整每行小节数
            state.api.settings.display.scale = MOBILE_PREVIEW_SCALE;
            adjustBarsPerRow();
        } else {
            // 离开手机端：恢复默认缩放
            state.api.settings.display.scale = 1;

            // 恢复默认每行小节数（仅在从手机端切回时需要）
            if (wasMobile && state.currentScore) {
                const defaultBars = 3;
                state.currentScore.defaultSystemsLayout = defaultBars;
                for (const track of state.currentScore.tracks) {
                    track.defaultSystemsLayout = defaultBars;
                }
            }
        }

        // 应用设置变更后需要触发重新渲染
        state.api.updateSettings();
        state.api.render();
    };

    // 注册 scoreLoaded 钩子：每次乐谱加载后调整布局
    if (state.api) {
        state.api.scoreLoaded.on(() => {
            adjustBarsPerRow();
        });
    }

    // 初始检测
    handleChange(mediaQuery);

    // 监听后续变化
    mediaQuery.addEventListener('change', handleChange);
}

// ─── 编辑器移动端字号适配 ────────────────────────────────────

/**
 * 在移动端将编辑器字号设为 16px
 *
 * iOS Safari 在 `<input>`/`<textarea>` 字号 < 16px 时会自动缩放页面。
 * Monaco 用 `<textarea>` 做输入代理，设置 ≥16px 可阻止此行为。
 */
export function applyMobileFontSize(): void {
    if (!isTouchDevice() || !state.editor) {
        return;
    }

    state.editor.updateOptions({ fontSize: 16 });
}

// ─── 移动端增强入口 ──────────────────────────────────────────

/**
 * 统一初始化所有移动端增强功能
 * 在 main.ts 的 `initialize()` 中调用
 */
export function setupMobileEnhancements(): void {
    // 注入编辑器快捷工具栏（CSS 控制仅触摸设备可见）
    setupEditorActionBar();

    // 时间轴 touch 事件
    setupTimelineTouch();

    // 移动端字号适配
    applyMobileFontSize();

    // 响应式视图约束：窄屏自动从 split 切到 editor
    setupResponsiveViewConstraint();

    // 手机端诊断面板自动折叠
    collapseDiagnosticsOnMobile();

    // 手机端预览布局适配：降低缩放 + 根据宽度动态调整每行小节数
    setupMobilePreviewLayout();
}

// ─── 类型定义 ────────────────────────────────────────────────

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
