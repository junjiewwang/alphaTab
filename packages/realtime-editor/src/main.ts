/**
 * alphaTab Realtime Editor — 入口编排器
 *
 * 该文件只负责：
 * 1. 导入各功能模块
 * 2. 按依赖顺序调度初始化
 * 3. 处理顶层异常
 *
 * 具体功能实现分别在：
 * - state.ts    — 应用状态 + DOM 引用 + 状态变更辅助
 * - editor.ts   — Monaco 编辑器初始化 / 主题 / LSP / 诊断
 * - preview.ts  — alphaTab 预览渲染 / 轨道管理 / 渲染调度
 * - toolbar.ts  — 顶部工具栏事件 / 文件操作 / 示例加载
 * - transport.ts — 播放控制 / 速度 / 缩放 / 布局 / 滚动 / 时间轴
 * - utils.ts    — 通用工具函数
 * - constants.ts — 常量 / 示例 / 配置映射
 * - types.ts    — 公共类型定义
 */

import './styles.css';
import Split from 'split.js';
import { STORAGE_KEYS } from './constants';
import { setupEditor } from './editor';
import { setupPreview, scheduleRender } from './preview';
import { dom, setStatus, setViewMode, state } from './state';
import { loadInitialDocument, setupToolbar } from './toolbar';
import { setupTransport } from './transport';
import type { ViewMode } from './types';
import { escapeHtml, getErrorMessage, readStorage } from './utils';

void initialize();

async function initialize(): Promise<void> {
    try {
        setStatus('muted', '正在初始化', '加载编辑器与预览能力');

        setupSplit();
        setupPreview();
        await setupEditor(() => scheduleRender());
        setupToolbar();
        setupTransport();
        setupDiagnosticsToggle();
        setupTrackDockToggle();

        setViewMode((readStorage(STORAGE_KEYS.view) as ViewMode | null) ?? 'split');
        loadInitialDocument();
    } catch (error) {
        setStatus('error', '初始化失败', getErrorMessage(error));
        dom.diagnosticsList.innerHTML = `<li data-severity="error">${escapeHtml(getErrorMessage(error))}</li>`;
    }
}

function setupSplit(): void {
    state.split = Split(['#editorPane', '#previewPane'], {
        sizes: [46, 54],
        minSize: [0, 0],
        gutterSize: 10,
        snapOffset: 16,
        onDragEnd: () => {
            state.api?.render();
            state.editor?.layout();
        }
    });
}

// ─── 诊断面板折叠 ────────────────────────────────────────────

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

// ─── 轨道面板折叠 ────────────────────────────────────────────

function setupTrackDockToggle(): void {
    const toggle = dom.trackDockToggle;
    const dock = dom.trackDock;
    if (!toggle || !dock) {
        return;
    }

    toggle.addEventListener('click', () => {
        const isCollapsed = dock.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
    });
}
