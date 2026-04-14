import { dom, setStatus } from './state';
import { supportsFileSystemAccess } from './utils';

/**
 * File System Access API 不可用的原因。
 *
 * - 'insecure-context'：非安全上下文（HTTP + 非 localhost），切换 HTTPS 可解决
 * - 'unsupported-browser'：浏览器不支持（Firefox / Safari），需使用 Chrome / Edge
 * - null：API 可用，无需降级
 */
type FallbackReason = 'insecure-context' | 'unsupported-browser' | null;

function detectFallbackReason(): FallbackReason {
    if (supportsFileSystemAccess()) {
        return null;
    }

    if (!window.isSecureContext) {
        return 'insecure-context';
    }

    return 'unsupported-browser';
}

const TOOLTIP_MESSAGES: Record<Exclude<FallbackReason, null>, string> = {
    'insecure-context':
        '导出下载 (Ctrl+S)\n当前为 HTTP 非安全上下文，无法直接保存回原文件\n建议通过 HTTPS 访问以启用完整功能',
    'unsupported-browser':
        '导出下载 (Ctrl+S)\n当前浏览器不支持直接保存回原文件\n建议使用 Chrome 或 Edge 获得完整体验'
};

const STATUS_MESSAGES: Record<Exclude<FallbackReason, null>, string> = {
    'insecure-context':
        'HTTP 环境下文件保存将以下载方式进行，HTTPS 可启用完整功能',
    'unsupported-browser':
        '当前浏览器不支持直接保存，文件将以下载方式导出'
};

/**
 * 初始化环境检测：如果 File System Access API 不可用，
 * 通过保存按钮 tooltip 和状态栏一次性提示告知用户。
 *
 * 策略：轻量非侵入 — 不添加任何 DOM 元素，不影响布局。
 * - 保存按钮 tooltip：持久显示降级原因
 * - 状态栏：初始化时一次性提示（会被后续操作自然覆盖）
 * - 保存按钮样式：添加视觉标记（虚线边框）
 */
export function setupEnvContext(): void {
    const reason = detectFallbackReason();
    if (!reason) {
        return;
    }

    // 1. 保存按钮 tooltip — 详细说明降级原因
    dom.saveButton.title = TOOLTIP_MESSAGES[reason];

    // 2. 保存按钮视觉标记 — 虚线边框暗示功能受限
    dom.saveButton.classList.add('is-fallback');

    // 3. 状态栏一次性提示 — 会被用户后续操作自然覆盖
    setStatus('warning', '保存受限', STATUS_MESSAGES[reason]);
}
