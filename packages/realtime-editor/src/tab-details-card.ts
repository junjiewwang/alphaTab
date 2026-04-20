/**
 * tab-details-card.ts
 *
 * 标签页「查看详情」浮动卡片。
 *
 * 触发：`documents.ts` 中 `openTabActionMenu` 的「查看详情」菜单项调用 `openTabDetailsCard`。
 *
 * 设计要点：
 * - `position: fixed` 视口坐标定位，复用与 `.tab-action-menu` 一致的视觉体系
 * - 外部点击 / Esc / 窗口 resize / scroll 自动关闭
 * - 同一时间只允许一个详情卡片（打开新卡片前先关闭旧卡片）
 * - 卡片是**纯展示组件**，数据源全部来自 `WorkspaceDocument` + 运行时 `model` 查询，
 *   不写任何关于特定命令/文件的硬编码文案
 *
 * 浏览器端硬限制备注：
 * - 无法从 `FileSystemFileHandle` 取得本地绝对路径，只能显示 `handle.name`
 * - Monaco model 的 `inmemory://alphatab/<id>.alphatex` URI 仅作编辑器内部标识使用，
 *   对用户没有定位价值，因此本组件**不展示** URI
 */

import { getDocumentById } from './state';
import type { WorkspaceDocument } from './types';
import { getErrorMessage } from './utils';

// ─── 活动卡片引用（用于外部点击 / Esc 关闭） ───────────────────────

let activeCard: {
    element: HTMLElement;
    close: () => void;
} | null = null;

/**
 * 关闭当前打开的详情卡片（如果有）。
 */
export function closeTabDetailsCard(): void {
    activeCard?.close();
}

/**
 * 在指定锚点元素下方打开详情卡片。
 *
 * @param anchor - 作为定位参考的 HTMLElement（通常是菜单项触发按钮或 tab 节点）
 * @param documentId - 目标文档 id
 */
export function openTabDetailsCard(anchor: HTMLElement, documentId: string): void {
    const doc = getDocumentById(documentId);
    if (!doc) {
        return;
    }

    // 若同一锚点再次触发 → 关闭（toggle 行为）
    if (activeCard && activeCard.element.dataset.documentId === documentId) {
        closeTabDetailsCard();
        return;
    }
    closeTabDetailsCard();

    const card = renderCard(doc);
    window.document.body.appendChild(card);
    positionCard(card, anchor);

    const handleDocumentPointerDown = (event: Event) => {
        if (!(event.target instanceof Node)) {
            return;
        }
        if (card.contains(event.target)) {
            return;
        }
        closeTabDetailsCard();
    };
    const handleKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            closeTabDetailsCard();
        }
    };
    const handleRelayout = () => closeTabDetailsCard();

    window.document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', handleRelayout);
    window.addEventListener('scroll', handleRelayout, true);

    activeCard = {
        element: card,
        close: () => {
            window.document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
            window.removeEventListener('keydown', handleKeydown);
            window.removeEventListener('resize', handleRelayout);
            window.removeEventListener('scroll', handleRelayout, true);
            card.remove();
            if (activeCard?.element === card) {
                activeCard = null;
            }
        }
    };
}

// ─── 渲染 ────────────────────────────────────────────────────

/**
 * 渲染详情卡片 DOM。
 */
function renderCard(doc: WorkspaceDocument): HTMLElement {
    const card = window.document.createElement('div');
    card.className = 'tab-details-card';
    card.dataset.documentId = doc.id;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `${doc.displayName} 详情`);

    card.appendChild(renderHeader(doc));
    const reauthBanner = renderReauthBannerIfNeeded(doc);
    if (reauthBanner) {
        card.appendChild(reauthBanner);
    }
    card.appendChild(renderBody(doc));
    card.appendChild(renderFooter(doc));
    return card;
}

function renderHeader(doc: WorkspaceDocument): HTMLElement {
    const header = window.document.createElement('div');
    header.className = 'tab-details-card__header';

    const title = window.document.createElement('div');
    title.className = 'tab-details-card__title';
    title.textContent = doc.displayName;
    header.appendChild(title);

    const status = window.document.createElement('div');
    status.className = 'tab-details-card__status';
    if (doc.isDirty) {
        status.classList.add('is-dirty');
        status.textContent = '● 未保存';
    } else {
        status.textContent = '○ 已保存';
    }
    header.appendChild(status);

    return header;
}

/**
 * 需要重新授权时展示醒目提醒条。
 *
 * 触发条件：`hasFileHandle === true` 但 `fileHandle === null`
 * → 快照标记了曾关联本地文件，但当前会话句柄尚未恢复/授权
 */
function renderReauthBannerIfNeeded(doc: WorkspaceDocument): HTMLElement | null {
    if (doc.fileHandle || !doc.hasFileHandle) {
        return null;
    }
    const banner = window.document.createElement('div');
    banner.className = 'tab-details-card__banner is-warning';
    banner.innerHTML =
        '<span class="tab-details-card__banner-icon">⚠</span>' +
        '<span class="tab-details-card__banner-text">' +
        '此文档关联了本地文件，但当前会话尚未获得授权。' +
        '下一次保存时浏览器会请求重新授权。' +
        '</span>';
    return banner;
}

function renderBody(doc: WorkspaceDocument): HTMLElement {
    const body = window.document.createElement('div');
    body.className = 'tab-details-card__body';

    body.appendChild(
        renderSection('基本信息', [
            ['来源', `${describeSourceKind(doc.sourceKind)}（${doc.sourceKind}）`],
            ['乐谱标题', doc.scoreTitle || '—'],
            ['副标题', doc.scoreSubtitle || '—']
        ])
    );

    const lineCount = doc.model.getLineCount();
    const charCount = doc.model.getValueLength();
    body.appendChild(
        renderSection('内容', [
            ['大小', `${formatNumber(charCount)} 字符 / ${formatNumber(lineCount)} 行`],
            ['保存状态', doc.isDirty ? '有未保存修改' : '已保存']
        ])
    );

    // 本地文件分区：仅在与本地文件有关系时才显示，避免"未关联本地文件"噪音占行
    const fileDescription = describeFileHandle(doc);
    if (fileDescription) {
        body.appendChild(
            renderSection('本地文件', [
                ['文件名', fileDescription]
            ])
        );
    }

    body.appendChild(
        renderSection('时间', buildTimeRows(doc))
    );

    return body;
}

/**
 * 构造「时间」分区的行数据。
 *
 * - 修改：编辑器内最近一次内容变更时间
 * - 保存：编辑器内最近一次 markActiveDocumentSaved 时间
 * - 磁盘：`file.lastModified`，仅在有值时显示
 */
function buildTimeRows(doc: WorkspaceDocument): Array<[string, string]> {
    const rows: Array<[string, string]> = [
        ['修改', formatTimestamp(doc.lastModifiedAt)],
        ['保存', formatTimestamp(doc.lastSavedAt)]
    ];
    if (doc.diskLastModifiedAt) {
        rows.push(['磁盘修改', formatTimestamp(doc.diskLastModifiedAt)]);
    }
    return rows;
}

function renderSection(title: string, rows: Array<[string, string]>): HTMLElement {
    const section = window.document.createElement('div');
    section.className = 'tab-details-card__section';

    const heading = window.document.createElement('div');
    heading.className = 'tab-details-card__section-title';
    heading.textContent = title;
    section.appendChild(heading);

    const list = window.document.createElement('dl');
    list.className = 'tab-details-card__list';
    for (const [label, value] of rows) {
        const dt = window.document.createElement('dt');
        dt.className = 'tab-details-card__list-key';
        dt.textContent = label;
        list.appendChild(dt);

        const dd = window.document.createElement('dd');
        dd.className = 'tab-details-card__list-value';
        dd.textContent = value;
        dd.title = value;
        list.appendChild(dd);
    }
    section.appendChild(list);

    return section;
}

function renderFooter(doc: WorkspaceDocument): HTMLElement {
    const footer = window.document.createElement('div');
    footer.className = 'tab-details-card__footer';

    footer.appendChild(
        makeCopyButton('复制文件名', doc.displayName)
    );

    return footer;
}

function makeCopyButton(label: string, text: string): HTMLButtonElement {
    const button = window.document.createElement('button');
    button.type = 'button';
    button.className = 'tab-details-card__copy';
    button.textContent = label;
    button.addEventListener('click', event => {
        event.stopPropagation();
        void copyToClipboard(text).then(ok => {
            // 用按钮文案短暂反馈，避免额外 toast 改动
            const originalText = button.textContent;
            button.textContent = ok ? '✓ 已复制' : '✗ 复制失败';
            button.classList.toggle('is-success', ok);
            button.classList.toggle('is-error', !ok);
            window.setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('is-success', 'is-error');
            }, 1200);
        });
    });
    return button;
}

// ─── 工具 ────────────────────────────────────────────────────

function describeSourceKind(kind: WorkspaceDocument['sourceKind']): string {
    switch (kind) {
        case 'new':
            return '新建文档';
        case 'text-file':
            return '本地文本文件';
        case 'imported-file':
            return '导入的二进制乐谱';
        case 'example':
            return '内置示例';
        case 'restored':
            return '旧版缓存恢复';
        default:
            return '未知来源';
    }
}

/**
 * 返回本地文件描述字符串；若文档与本地文件无关联则返回 `null`，
 * 上游据此决定是否展示「本地文件」分区。
 *
 * - 已恢复 / 打开时关联句柄 → 返回 `handle.name`
 * - 快照标记有句柄但尚未恢复 → 返回 `—（待授权恢复）`（具体的警示由 reauth banner 承担）
 * - 无任何关联 → 返回 `null`
 */
function describeFileHandle(doc: WorkspaceDocument): string | null {
    if (doc.fileHandle) {
        return doc.fileHandle.name;
    }
    if (doc.hasFileHandle) {
        return '—（待授权恢复）';
    }
    return null;
}

function formatTimestamp(ms: number | undefined): string {
    if (!ms) {
        return '—';
    }
    const date = new Date(ms);
    // 形如 2026-04-20 11:35:12
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
}

async function copyToClipboard(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (error) {
        // 某些浏览器在非安全上下文会拒绝 → 降级到 execCommand
        console.warn('clipboard.writeText failed:', getErrorMessage(error));
    }

    try {
        const textarea = window.document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        window.document.body.appendChild(textarea);
        textarea.select();
        const ok = window.document.execCommand('copy');
        textarea.remove();
        return ok;
    } catch {
        return false;
    }
}

// ─── 定位 ────────────────────────────────────────────────────

/**
 * 根据锚点定位卡片：
 * - 默认在锚点下方 4px
 * - 超出视口右侧 → 右对齐到锚点
 * - 超出视口底部 → 显示在锚点上方
 *
 * 与 `positionTabActionMenu` 行为一致，之后如果需要可以抽到公共 utils。
 */
function positionCard(card: HTMLElement, anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    card.style.visibility = 'hidden';
    card.style.left = '0px';
    card.style.top = '0px';
    const cardRect = card.getBoundingClientRect();
    const gap = 6;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let left = anchorRect.left;
    if (left + cardRect.width + gap > viewportW) {
        left = Math.max(8, anchorRect.right - cardRect.width);
    }
    if (left < 8) {
        left = 8;
    }

    let top = anchorRect.bottom + gap;
    if (top + cardRect.height + gap > viewportH) {
        top = Math.max(8, anchorRect.top - cardRect.height - gap);
    }

    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
    card.style.visibility = '';
}

// ─── 供其他模块构造 tooltip 多行摘要复用 ─────────────────────────

/**
 * 生成 tab 的 `title` 属性用多行摘要（浏览器原生 tooltip）。
 *
 * 放在这里而不是 `utils.ts`：摘要与详情卡片展示的数据是同一套，
 * 未来要同步扩展时只需改这一个地方。
 *
 * 注意：刻意不展示 Monaco 的 `inmemory://...` URI —— 它对用户没有定位价值。
 */
export function buildTabTitleSummary(doc: WorkspaceDocument): string {
    const lines = [
        doc.displayName,
        `来源：${describeSourceKind(doc.sourceKind)}（${doc.sourceKind}）`,
        `状态：${doc.isDirty ? '有未保存修改' : '已保存'}`
    ];
    if (doc.fileHandle) {
        lines.push(`本地文件：${doc.fileHandle.name}`);
    } else if (doc.hasFileHandle) {
        lines.push('本地文件：待授权恢复');
    }
    if (doc.diskLastModifiedAt) {
        lines.push(`磁盘修改：${formatTimestamp(doc.diskLastModifiedAt)}`);
    }
    return lines.join('\n');
}
