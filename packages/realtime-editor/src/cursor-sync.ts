/**
 * 编辑器光标 ↔ 预览乐谱联动模块
 *
 * 将 Monaco 编辑器中的光标位置映射到 alphaTab 预览面板中渲染的音符/节拍，
 * 并在预览面板中高亮显示对应元素。同时支持反向操作：点击预览面板定位编辑器光标。
 *
 * 映射链路（编辑器 → 预览）：
 *   Monaco 光标 → 文本偏移 → AST 节点（二分查找）→ Score Beat → 自定义 DOM 高亮
 *
 * 映射链路（预览 → 编辑器）：
 *   beatMouseDown → Score Beat → AST 反向查找 → 文本偏移 → Monaco 光标定位
 */
import * as alphaTab from '@coderline/alphatab';
import type * as monaco from 'monaco-editor';

// ─── AST 节点二分查找（从 LSP 包移植） ──────────────────────

/**
 * 在 AST 节点数组中通过二分查找定位给定文本偏移所在的节点。
 *
 * 复刻自 `packages/lsp/src/server/utils.ts` 的 `binaryNodeSearch`。
 * 独立复制而非直接导入，避免 realtime-editor 引入 LSP 包的 vscode-languageserver 等
 * 重量级依赖。该函数为纯算法工具，零外部依赖。
 *
 * @param items - 按 start.offset 升序排列的 AST 节点数组
 * @param offset - 目标文本偏移（0-based）
 * @param trailingEnd - 最后一个节点的尾部边界（默认取最后节点的 end.offset）
 * @returns 命中的 AST 节点，或 undefined
 */
function binaryNodeSearch<T extends alphaTab.importer.alphaTex.AlphaTexAstNode>(
    items: T[],
    offset: number,
    trailingEnd: number = items.length > 0 ? items[items.length - 1].end!.offset : 0
): T | undefined {
    if (items.length === 0) {
        return undefined;
    }

    const rangeStart = items[0].start!.offset;
    if (offset < rangeStart || offset > trailingEnd) {
        return undefined;
    }

    return binaryNodeSearchInner(items, offset, 0, items.length, trailingEnd);
}

function binaryNodeSearchInner<T extends alphaTab.importer.alphaTex.AlphaTexAstNode>(
    items: T[],
    offset: number,
    left: number,
    right: number,
    trailingEnd: number
): T | undefined {
    if (left > right) {
        return undefined;
    }

    const center = Math.trunc((left + right) / 2);
    const centerItem = items[center];
    const isLast = center === items.length - 1;

    // 区间策略：
    // - 非末尾节点：[start, nextStart) — 左闭右开，边界点归属下一个节点
    // - 末尾节点：[start, trailingEnd] — 左闭右闭，无下一个节点可归属
    const end = isLast ? trailingEnd : items[center + 1].start!.offset;
    const inRange = isLast
        ? (centerItem.start!.offset <= offset && offset <= end)
        : (centerItem.start!.offset <= offset && offset < end);

    if (inRange) {
        return centerItem;
    }

    if (offset < centerItem.start!.offset) {
        return binaryNodeSearchInner(items, offset, left, center, trailingEnd);
    }

    return binaryNodeSearchInner(items, offset, center, right, trailingEnd);
}

// ─── AST 节点 → Score Beat 结构索引映射 ─────────────────────

/**
 * AST 定位结果：描述光标在 AST 中命中的位置层级。
 */
type AstLookupResult = {
    barIndex: number;
    bar: alphaTab.importer.alphaTex.AlphaTexBarNode;
    beatIndex: number | null;
    beat: alphaTab.importer.alphaTex.AlphaTexBeatNode | null;
    noteIndex: number | null;
    note: alphaTab.importer.alphaTex.AlphaTexNoteNode | null;
};

/**
 * 从 AST 中根据文本偏移查找对应的 bar/beat/note 节点及其索引。
 *
 * @param ast - AlphaTex AST 根节点
 * @param offset - 0-based 文本偏移
 * @returns AST 定位结果，或 null（偏移不在任何 bar 范围内）
 */
function lookupAstAtOffset(
    ast: alphaTab.importer.alphaTex.AlphaTexScoreNode,
    offset: number
): AstLookupResult | null {
    const bar = binaryNodeSearch(ast.bars, offset);
    if (!bar) {
        return null;
    }

    const barIndex = ast.bars.indexOf(bar);

    // 尝试精确到 beat 级别
    const beat = binaryNodeSearch(bar.beats, offset);
    if (!beat) {
        return { barIndex, bar, beatIndex: null, beat: null, noteIndex: null, note: null };
    }

    const beatIndex = bar.beats.indexOf(beat);

    // 尝试精确到 note 级别
    if (beat.notes?.notes && beat.notes.notes.length > 0) {
        const note = binaryNodeSearch(beat.notes.notes, offset);
        if (note) {
            const noteIndex = beat.notes.notes.indexOf(note);
            return { barIndex, bar, beatIndex, beat, noteIndex, note };
        }
    }

    return { barIndex, bar, beatIndex, beat, noteIndex: null, note: null };
}

/**
 * Score 结构索引：标识一个 beat 在 Score 模型中的位置坐标。
 */
type ScoreBarPosition = {
    masterBarIndex: number;
    trackIndex: number;
    staffIndex: number;
    voiceIndex: number;
};

/**
 * 计算 AST bars 中给定 barIndex 之前有多少个"新 track/staff/voice"切换点，
 * 从而推算出该 bar 在 Score 模型中对应的实际 masterBar 索引。
 *
 * AlphaTex 语法中，`\track`、`\staff`、`\voice` 等指令会在 AST 的 bar 节点的
 * metaData 中出现，导致 AST bars 列表中的索引与 Score masterBars 索引不一致。
 * 本函数通过检测这些结构性 metaData 来校正索引偏移。
 *
 * 重要：alphaTab 解析器对 **每个层级的第一个** 结构标签采用"忽略初始"语义
 * （`ignoredInitialTrack/Staff/Voice`），即第一个 `\track` 不创建新 track，
 * 而是复用已有的 track 0。后续的 `\track` 才创建新 track（track 1, 2, ...）。
 * `\staff` 和 `\voice` 同理。本函数需要对齐此行为。
 *
 * @param bars - AST 的 bars 列表
 * @param targetBarIndex - 目标 bar 在 AST 中的索引
 * @returns 该 bar 在当前 track/staff/voice 上下文中的 Score bar 索引
 */
function computeScoreBarIndex(
    bars: alphaTab.importer.alphaTex.AlphaTexBarNode[],
    targetBarIndex: number
): ScoreBarPosition {
    let masterBarIndex = 0;
    let trackIndex = 0;
    let staffIndex = 0;
    let voiceIndex = 0;

    // 对齐 alphaTab 解析器的 "ignored initial" 语义：
    // 每个层级的第一个结构标签不递增索引（复用初始对象）
    let seenFirstTrack = false;
    let seenFirstStaff = false;
    let seenFirstVoice = false;

    const structuralTags = new Set(['track', 'staff', 'voice']);

    for (let i = 0; i <= targetBarIndex; i++) {
        const bar = bars[i];

        for (const meta of bar.metaData) {
            const tagName = meta.tag?.tag?.text?.toLowerCase();
            if (!tagName || !structuralTags.has(tagName)) {
                continue;
            }

            if (tagName === 'track') {
                if (seenFirstTrack) {
                    // 后续 \track：创建新 track，索引递增
                    trackIndex++;
                } else {
                    // 第一个 \track：复用 track 0，不递增
                    seenFirstTrack = true;
                }
                // 无论是否递增，新 track 的 staff/voice/masterBar 都从 0 开始
                seenFirstStaff = false;
                seenFirstVoice = false;
                staffIndex = 0;
                voiceIndex = 0;
                masterBarIndex = 0;
            } else if (tagName === 'staff') {
                if (seenFirstStaff) {
                    staffIndex++;
                } else {
                    seenFirstStaff = true;
                }
                seenFirstVoice = false;
                voiceIndex = 0;
                masterBarIndex = 0;
            } else if (tagName === 'voice') {
                if (seenFirstVoice) {
                    voiceIndex++;
                } else {
                    seenFirstVoice = true;
                }
                masterBarIndex = 0;
            }
        }

        // 递增 masterBarIndex：当前 bar 有 beats 内容，且不是目标 bar 本身
        // 注意：即使有结构标签（如 \track/\staff），只要该 bar 包含 beats，
        // 它就占据了一个 masterBar 槽位，离开时需要递增。
        if (i < targetBarIndex && bar.beats.length > 0) {
            masterBarIndex++;
        }
    }

    return { masterBarIndex, trackIndex, staffIndex, voiceIndex };
}

/**
 * 将 AST 定位结果映射到 Score 模型中的 Beat 对象。
 *
 * 通过结构索引匹配：AST bar/beat 索引 → Score track/staff/bar/voice/beat 索引。
 * 这是整个光标同步链路的核心桥接逻辑。
 *
 * @param astResult - AST 查找结果
 * @param ast - AST 根节点
 * @param score - Score 模型对象
 * @returns 对应的 Score Beat，或 null
 */
function mapAstToScoreBeat(
    astResult: AstLookupResult,
    ast: alphaTab.importer.alphaTex.AlphaTexScoreNode,
    score: alphaTab.model.Score
): alphaTab.model.Beat | null {
    if (astResult.beatIndex === null || score.tracks.length === 0) {
        return null;
    }

    const { masterBarIndex, trackIndex, staffIndex, voiceIndex } =
        computeScoreBarIndex(ast.bars, astResult.barIndex);

    // 获取目标 track（首个 \track 出现前的内容归属 track 0）
    const resolvedTrackIndex = Math.min(trackIndex, score.tracks.length - 1);
    const track = score.tracks[resolvedTrackIndex];
    if (!track) {
        return null;
    }

    // 获取 staff
    const resolvedStaffIndex = Math.min(staffIndex, track.staves.length - 1);
    const staff = track.staves[resolvedStaffIndex];
    if (!staff) {
        return null;
    }

    // 获取 bar
    if (masterBarIndex >= staff.bars.length) {
        return null;
    }
    const bar = staff.bars[masterBarIndex];
    if (!bar) {
        return null;
    }

    // 获取 voice
    const resolvedVoiceIndex = Math.min(voiceIndex, bar.voices.length - 1);
    const voice = bar.voices[resolvedVoiceIndex];
    if (!voice) {
        return null;
    }

    // 获取 beat
    if (astResult.beatIndex >= voice.beats.length) {
        // 可能是 beat 索引越界（AST 有解析错误的残留节点），取最后一个 beat
        return voice.beats.length > 0 ? voice.beats[voice.beats.length - 1] : null;
    }

    return voice.beats[astResult.beatIndex] ?? null;
}

// ─── Score Beat → AST 反向映射（双向同步核心） ───────────────

/**
 * 根据鼠标坐标反查命中的 staff 索引。
 *
 * **问题背景**：同一个 `Bar` 可以被多个 `BarRenderer` 渲染（五线/tab/简谱），
 * 它们共享同一组 `Beat` 对象。alphaTab 的 `beatMouseDown` 事件只传递 `Beat`，
 * 不传递"点击了哪一种渲染"。因此点击不同样式的音符时，事件层面无法区分。
 *
 * **解决思路**：在鼠标按下时（捕获阶段），根据 `(x, y)` 坐标在 `BoundsLookup`
 * 的层级结构中定位：`StaffSystemBounds → MasterBarBounds → BarBounds`，每个
 * `BarBounds` 绑定唯一的 `Bar`，其 `bar.staff.index` 即为命中的 staff 索引。
 *
 * 该函数的容错策略：
 * - boundsLookup 未就绪 → 返回 null（调用方回退到 beat 自带 staff）
 * - 坐标不在任何 staff system 内 → 返回 null
 * - 多个 BarBounds Y 范围重叠（罕见）→ 返回最先匹配的
 *
 * @param api - alphaTab API 实例
 * @param relX - 相对 canvas 的 X 坐标
 * @param relY - 相对 canvas 的 Y 坐标
 * @returns 命中的 staff 索引，或 null
 */
function findStaffIndexAtPos(
    api: alphaTab.AlphaTabApi,
    relX: number,
    relY: number
): number | null {
    const lookup = api.boundsLookup;
    if (!lookup) {
        return null;
    }

    for (const system of lookup.staffSystems) {
        const sysTop = system.realBounds.y;
        const sysBottom = sysTop + system.realBounds.h;
        if (relY < sysTop || relY > sysBottom) {
            continue;
        }

        const masterBar = system.findBarAtPos(relX);
        if (!masterBar) {
            continue;
        }

        // 在 MasterBar 的 bars 列表中按 Y 坐标精确匹配 staff
        for (const barBounds of masterBar.bars) {
            const top = barBounds.visualBounds.y;
            const bottom = top + barBounds.visualBounds.h;
            if (relY >= top && relY <= bottom) {
                return barBounds.bar.staff.index;
            }
        }

        // Y 未精确命中任一 BarBounds 时，取距离 Y 最近的那个 staff
        // （处理 effect band / 谱间空隙点击）
        let nearestIndex: number | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const barBounds of masterBar.bars) {
            const top = barBounds.visualBounds.y;
            const bottom = top + barBounds.visualBounds.h;
            const distance =
                relY < top ? top - relY : relY > bottom ? relY - bottom : 0;
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = barBounds.bar.staff.index;
            }
        }
        return nearestIndex;
    }

    return null;
}

/**
 * 将 Score Beat 反向映射到 AST 中的源码偏移位置。
 *
 * 通过 Beat 的 Score 模型导航链（beat.voice.bar.staff.track）获取结构索引，
 * 然后遍历 AST bars 查找匹配的 bar 和 beat 节点，返回其源码偏移。
 *
 * **多谱样式支持**：同一个 Beat 在 Score 模型中只绑定到首个 staff
 * （alphaTab 的 `beatMouseDown` 事件仅携带 Beat，不携带点击位置所在
 * 的 staff 信息）。当用户在预览面板点击 tab 谱或简谱的音符时，需要
 * 通过 `staffIndexOverride` 参数覆盖默认的 staff 索引，以精准定位到
 * AST 中对应 `\staff` 段的源码位置。
 *
 * @param beat - Score 模型中的 Beat 对象
 * @param ast - AST 根节点
 * @param staffIndexOverride - 可选，强制使用的 staff 索引（点击位置所在 staff）
 * @returns AST 节点的起始偏移，或 null
 */
function mapScoreBeatToAstOffset(
    beat: alphaTab.model.Beat,
    ast: alphaTab.importer.alphaTex.AlphaTexScoreNode,
    staffIndexOverride: number | null = null
): number | null {
    if (!ast.bars || ast.bars.length === 0) {
        return null;
    }

    // 从 Score Beat 提取目标结构索引
    const targetTrackIndex = beat.voice.bar.staff.track.index;
    // staff 索引：优先使用点击位置实际命中的 staff，否则退回到 Beat 所属 staff
    const targetStaffIndex = staffIndexOverride ?? beat.voice.bar.staff.index;
    const targetVoiceIndex = beat.voice.index;
    const targetMasterBarIndex = beat.voice.bar.index;
    const targetBeatIndex = beat.index;

    // 遍历 AST bars，用 computeScoreBarIndex 逻辑找到匹配的 bar
    for (let i = 0; i < ast.bars.length; i++) {
        const pos = computeScoreBarIndex(ast.bars, i);

        if (
            pos.trackIndex === targetTrackIndex &&
            pos.staffIndex === targetStaffIndex &&
            pos.voiceIndex === targetVoiceIndex &&
            pos.masterBarIndex === targetMasterBarIndex
        ) {
            // 找到匹配的 AST bar，尝试精确到 beat
            const astBar = ast.bars[i];
            if (targetBeatIndex < astBar.beats.length) {
                const astBeat = astBar.beats[targetBeatIndex];
                if (astBeat.start) {
                    return astBeat.start.offset;
                }
            }
            // 回退到 bar 级别
            if (astBar.start) {
                return astBar.start.offset;
            }
        }
    }

    return null;
}

// ─── 自定义高亮渲染（替代 highlightPlaybackRange） ──────────

/**
 * 自定义高亮元素的 CSS 类名。
 *
 * 使用独立 CSS 类区分播放高亮（.at-cursor-bar / .at-selection）
 * 与编辑器光标同步高亮，避免视觉冲突。
 */
const CURSOR_SYNC_HIGHLIGHT_CLASS = 'at-cursor-sync-highlight';

/** 高亮覆盖层容器（绝对定位在 alphaTab 根元素内） */
let highlightOverlay: HTMLDivElement | null = null;

/**
 * 确保高亮覆盖层容器存在。
 *
 * 覆盖层作为绝对定位的 div 插入 alphaTab 根元素，与 .at-cursors 层级并列。
 * pointer-events: none 确保不拦截鼠标事件。
 */
function ensureHighlightOverlay(alphaTabRoot: HTMLElement): HTMLDivElement {
    if (highlightOverlay && highlightOverlay.parentElement === alphaTabRoot) {
        return highlightOverlay;
    }

    highlightOverlay = document.createElement('div');
    highlightOverlay.className = 'at-cursor-sync-overlay';
    highlightOverlay.style.position = 'absolute';
    highlightOverlay.style.inset = '0';
    highlightOverlay.style.pointerEvents = 'none';
    highlightOverlay.style.zIndex = '999'; // 在 .at-cursors (1000) 之下
    alphaTabRoot.appendChild(highlightOverlay);

    return highlightOverlay;
}

/**
 * 清除所有自定义同步高亮元素。
 */
function clearSyncHighlights(): void {
    if (highlightOverlay) {
        highlightOverlay.replaceChildren();
    }
}

/**
 * 在预览面板中为指定 Beat 渲染自定义高亮覆盖层。
 *
 * 使用 BoundsLookup 获取 Beat 在渲染输出中的精确位置，
 * 创建绝对定位的 div 元素覆盖该区域。
 *
 * @param beat - 要高亮的 Score Beat
 * @param api - alphaTab API 实例
 * @param alphaTabRoot - alphaTab 根 DOM 元素
 * @returns 高亮的 BeatBounds（用于后续滚动计算），或 null
 */
function renderSyncHighlight(
    beat: alphaTab.model.Beat,
    api: alphaTab.AlphaTabApi,
    alphaTabRoot: HTMLElement
): alphaTab.rendering.BeatBounds | null {
    clearSyncHighlights();

    const boundsLookup = api.boundsLookup;
    if (!boundsLookup) {
        return null;
    }

    const beatBounds = boundsLookup.findBeat(beat);
    if (!beatBounds) {
        return null;
    }

    const overlay = ensureHighlightOverlay(alphaTabRoot);

    // 使用 masterBarBounds.visualBounds 的 y/h（与 _cursorSelectRange 一致）
    const masterBarBounds = beatBounds.barBounds.masterBarBounds;
    const y = masterBarBounds.visualBounds.y;
    const h = masterBarBounds.visualBounds.h;

    // X 范围：使用 beat 的 realBounds，与第一个/最后一个 beat 的扩展逻辑一致
    let x = beatBounds.realBounds.x;
    let w = beatBounds.realBounds.w;

    // 第一个 beat：扩展到 bar 开头
    if (beat.index === 0) {
        const barStartX = masterBarBounds.realBounds.x;
        w += x - barStartX;
        x = barStartX;
    }

    // 最后一个 beat：扩展到 bar 末尾
    if (beat.index === beat.voice.beats.length - 1) {
        const barEndX = masterBarBounds.realBounds.x + masterBarBounds.realBounds.w;
        w = barEndX - x;
    }

    const el = document.createElement('div');
    el.className = CURSOR_SYNC_HIGHLIGHT_CLASS;
    el.style.position = 'absolute';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    overlay.appendChild(el);

    return beatBounds;
}

// ─── 自动滚动到视口 ─────────────────────────────────────────

/** 滚动边距：距离视口边缘的最小像素距离 */
const SCROLL_MARGIN_PX = 40;

/**
 * 确保高亮的 beat 在预览滚动容器的可见区域内。
 *
 * 如果 beat 的边界不在当前视口范围内，平滑滚动到使其可见的位置。
 *
 * @param beatBounds - 已高亮 beat 的边界信息
 * @param scrollContainer - 预览区域的滚动容器
 */
function scrollBeatIntoView(
    beatBounds: alphaTab.rendering.BeatBounds,
    scrollContainer: HTMLElement
): void {
    const masterBarBounds = beatBounds.barBounds.masterBarBounds;
    const beatY = masterBarBounds.visualBounds.y;
    const beatH = masterBarBounds.visualBounds.h;
    const beatBottom = beatY + beatH;

    const viewTop = scrollContainer.scrollTop;
    const viewBottom = viewTop + scrollContainer.clientHeight;

    // 已在可见区域内（含边距），无需滚动
    if (beatY >= viewTop + SCROLL_MARGIN_PX && beatBottom <= viewBottom - SCROLL_MARGIN_PX) {
        return;
    }

    // 目标：将 beat 居中显示在视口中
    const targetScrollTop = beatY - scrollContainer.clientHeight / 2 + beatH / 2;
    const clampedScrollTop = Math.max(
        0,
        Math.min(targetScrollTop, scrollContainer.scrollHeight - scrollContainer.clientHeight)
    );

    scrollContainer.scrollTo({
        top: clampedScrollTop,
        behavior: 'smooth'
    });
}

// ─── 增量 AST 缓存 ──────────────────────────────────────────

/**
 * AST 偏移索引缓存。
 *
 * 为 AST bars 构建 (astBarIndex → ScoreBarPosition) 的预计算映射表，
 * 避免每次光标同步时重复遍历计算 computeScoreBarIndex。
 *
 * 当 AST 更新时（文本变更），通过比较新旧 AST 的 bar 数量和内容哈希
 * 判断是否可以增量更新缓存。
 */
type AstBarIndexEntry = {
    position: ScoreBarPosition;
    barStartOffset: number;
    barEndOffset: number;
};

class AstIndexCache {
    private _entries: AstBarIndexEntry[] = [];
    private _ast: alphaTab.importer.alphaTex.AlphaTexScoreNode | null = null;
    private _barCount = 0;

    /**
     * 更新缓存。如果 AST 结构未变化（bar 数量相同），尝试复用已有缓存。
     */
    update(ast: alphaTab.importer.alphaTex.AlphaTexScoreNode | null): void {
        if (!ast || ast.bars.length === 0) {
            this._entries = [];
            this._ast = null;
            this._barCount = 0;
            return;
        }

        // 增量判断：bar 数量不变且是同一 AST 对象引用时跳过重建
        if (ast === this._ast && ast.bars.length === this._barCount) {
            return;
        }

        this._ast = ast;
        this._barCount = ast.bars.length;
        this._entries = new Array(ast.bars.length);

        for (let i = 0; i < ast.bars.length; i++) {
            const bar = ast.bars[i];
            this._entries[i] = {
                position: computeScoreBarIndex(ast.bars, i),
                barStartOffset: bar.start?.offset ?? 0,
                barEndOffset: bar.end?.offset ?? 0
            };
        }
    }

    /**
     * 通过文本偏移快速查找对应的 AST bar 索引。
     * 使用预计算的偏移范围进行二分查找。
     */
    findBarIndexAtOffset(offset: number): number {
        if (this._entries.length === 0) {
            return -1;
        }

        // 二分查找：bars 按 startOffset 升序
        let lo = 0;
        let hi = this._entries.length - 1;

        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const entry = this._entries[mid];
            const nextStart = mid < this._entries.length - 1
                ? this._entries[mid + 1].barStartOffset
                : entry.barEndOffset;

            if (offset < entry.barStartOffset) {
                hi = mid - 1;
            } else if (offset > nextStart) {
                lo = mid + 1;
            } else {
                return mid;
            }
        }

        return -1;
    }

    /**
     * 获取指定 AST bar 索引的 Score 结构位置。
     */
    getPosition(barIndex: number): ScoreBarPosition | null {
        return this._entries[barIndex]?.position ?? null;
    }

    clear(): void {
        this._entries = [];
        this._ast = null;
        this._barCount = 0;
    }
}

// ─── CursorSyncManager（对外暴露的主类）─────────────────────

// ─── 渲染期间滚动位置保存/恢复 ─────────────────────────────

/**
 * 渲染期间需要保存的视口快照。
 *
 * 当编辑触发重新渲染时，alphaTab 会重建 DOM 导致滚动容器的
 * scrollTop 被浏览器 clamp 到 0。通过在渲染前保存、渲染后恢复
 * 来维持用户的阅读位置。
 */
type ViewportSnapshot = {
    /** 保存时的 scrollTop */
    scrollTop: number;
    /** 保存时最后高亮的 beat ID（用于渲染后重建高亮） */
    lastBeatId: number | null;
    /** 保存时光标在编辑器中的偏移（用于重新映射 beat） */
    cursorOffset: number | null;
};

/** 防抖定时器 ID */
let cursorDebounceTimer = 0;

/** 光标同步防抖延迟（ms）*/
const CURSOR_SYNC_DEBOUNCE_MS = 80;

/**
 * 光标同步管理器。
 *
 * 职责：
 * - 持有最新的 AST 和 Score 引用（每次文本变更后由 preview 模块更新）
 * - 监听 Monaco 编辑器的 `onDidChangeCursorPosition` 事件（编辑器→预览）
 * - 监听 alphaTab 的 `beatMouseDown` 事件（预览→编辑器）
 * - 使用自定义 DOM 覆盖层高亮预览中的 Beat（替代 highlightPlaybackRange）
 * - 播放期间自动暂停光标同步（监听 playerStateChanged）
 * - 高亮的 beat 不在视口时自动滚动
 * - 通过 AST 索引缓存优化性能
 * - 渲染完成前和数据不可用时自动降级（不报错）
 */
export class CursorSyncManager {
    private _ast: alphaTab.importer.alphaTex.AlphaTexScoreNode | null = null;
    private _score: alphaTab.model.Score | null = null;
    private _api: alphaTab.AlphaTabApi | null = null;
    private _editor: monaco.editor.IStandaloneCodeEditor | null = null;
    private _alphaTabRoot: HTMLElement | null = null;
    private _scrollContainer: HTMLElement | null = null;
    private _renderReady = false;
    private _cursorDisposable: monaco.IDisposable | null = null;
    private _postRenderHandler: (() => void) | null = null;
    private _playerStateHandler: ((args: alphaTab.synth.PlayerStateChangedEventArgs) => void) | null = null;
    private _beatMouseDownHandler: ((beat: alphaTab.model.Beat) => void) | null = null;
    private _enabled = true;
    /** 播放期间自动暂停标志（区别于用户手动 setEnabled） */
    private _pausedByPlayback = false;
    /** 双向同步锁：防止 A→B 同步触发 B→A 反向同步 */
    private _suppressEditorSync = false;
    private _lastHighlightedBeatId: number | null = null;
    private _indexCache = new AstIndexCache();
    /** 渲染期间的视口快照（updateData 时保存，postRenderFinished 时恢复） */
    private _viewportSnapshot: ViewportSnapshot | null = null;
    /**
     * 最近一次鼠标按下时，命中的 staff 索引。
     *
     * 在 alphaTabRoot 的 capture 阶段捕获，先于 alphaTab 内部的
     * `beatMouseDown` 触发。beatMouseDown 回调中读取后立即清空，
     * 确保每次点击独立生效（过期值不会污染后续事件）。
     */
    private _lastClickedStaffIndex: number | null = null;
    /** alphaTabRoot 上注册的 mousedown capture 监听器（用于 dispose 清理） */
    private _rootMouseDownHandler: ((event: MouseEvent) => void) | null = null;

    /**
     * 初始化光标同步管理器。
     *
     * @param api - alphaTab API 实例
     * @param editor - Monaco 编辑器实例
     * @param alphaTabRoot - alphaTab 根 DOM 元素
     * @param scrollContainer - 预览区域滚动容器
     */
    init(
        api: alphaTab.AlphaTabApi,
        editor: monaco.editor.IStandaloneCodeEditor,
        alphaTabRoot: HTMLElement,
        scrollContainer: HTMLElement
    ): void {
        this._api = api;
        this._editor = editor;
        this._alphaTabRoot = alphaTabRoot;
        this._scrollContainer = scrollContainer;

        // ── 监听渲染完成事件 — boundsLookup 在 postRenderFinished 后才可用
        this._postRenderHandler = () => {
            this._renderReady = true;
            this._restoreViewportAfterRender();
        };
        api.postRenderFinished.on(this._postRenderHandler);

        // ── 监听光标位置变化（编辑器 → 预览）
        this._cursorDisposable = editor.onDidChangeCursorPosition(event => {
            if (!this._enabled || this._pausedByPlayback || this._suppressEditorSync) {
                return;
            }
            this._scheduleSyncFromCursor(editor, event.position);
        });

        // ── 监听 beat 点击事件（预览 → 编辑器）
        this._beatMouseDownHandler = (beat: alphaTab.model.Beat) => {
            if (!this._enabled || this._pausedByPlayback) {
                return;
            }
            this._syncPreviewToEditor(beat);
        };
        api.beatMouseDown.on(this._beatMouseDownHandler);

        // ── 监听鼠标按下坐标（capture 阶段，先于 alphaTab 内部处理），
        //    用于识别点击落在哪个 staff（tab / 简谱 / 五线谱）
        this._rootMouseDownHandler = (event: MouseEvent) => {
            if (!this._enabled || this._pausedByPlayback || !this._api) {
                this._lastClickedStaffIndex = null;
                return;
            }

            const canvasHost =
                (this._api.canvasElement as { element?: HTMLElement } | undefined)?.element ??
                this._alphaTabRoot?.querySelector<HTMLElement>('.at-surface') ??
                null;
            if (!canvasHost) {
                this._lastClickedStaffIndex = null;
                return;
            }

            const rect = canvasHost.getBoundingClientRect();
            const relX = event.clientX - rect.left;
            const relY = event.clientY - rect.top;
            this._lastClickedStaffIndex = findStaffIndexAtPos(this._api, relX, relY);
        };
        alphaTabRoot.addEventListener('mousedown', this._rootMouseDownHandler, true);

        // ── 监听播放状态变化（播放时自动暂停）
        this._playerStateHandler = (args: alphaTab.synth.PlayerStateChangedEventArgs) => {
            const isPlaying = args.state === alphaTab.synth.PlayerState.Playing;

            if (isPlaying) {
                // 播放开始：自动暂停光标同步，清除高亮
                this._pausedByPlayback = true;
                this.clearHighlight();
            } else {
                // 播放停止/暂停：恢复光标同步
                this._pausedByPlayback = false;
            }
        };
        api.playerStateChanged.on(this._playerStateHandler);
    }

    /**
     * 更新 AST 和 Score 数据。
     *
     * 每次文本变更导致重新解析后调用，通常在 `renderActiveDocument()` 中的
     * 解析成功路径里触发。同时重置 renderReady 标志——新的渲染尚未完成。
     *
     * 在重置之前保存当前视口状态快照，渲染完成后用于恢复滚动位置和高亮。
     */
    updateData(
        ast: alphaTab.importer.alphaTex.AlphaTexScoreNode | null,
        score: alphaTab.model.Score | null
    ): void {
        // ── 渲染前保存视口快照 ──
        this._saveViewportBeforeRender();

        this._ast = ast;
        this._score = score;
        this._renderReady = false;
        this._lastHighlightedBeatId = null;

        // 增量更新 AST 索引缓存
        this._indexCache.update(ast);
    }

    /**
     * 清除预览面板中的光标同步高亮。
     */
    clearHighlight(): void {
        this._lastHighlightedBeatId = null;
        clearSyncHighlights();
    }

    /**
     * 启用或禁用光标同步。
     * 禁用时清除已有高亮。
     */
    setEnabled(enabled: boolean): void {
        this._enabled = enabled;
        if (!enabled) {
            this.clearHighlight();
        }
    }

    get enabled(): boolean {
        return this._enabled;
    }

    /**
     * 当前是否因播放而暂停。
     */
    get isPausedByPlayback(): boolean {
        return this._pausedByPlayback;
    }

    /**
     * 销毁管理器，释放所有事件监听。
     */
    dispose(): void {
        this.clearHighlight();

        this._cursorDisposable?.dispose();
        this._cursorDisposable = null;

        if (this._postRenderHandler && this._api) {
            this._api.postRenderFinished.off(this._postRenderHandler);
        }
        this._postRenderHandler = null;

        if (this._beatMouseDownHandler && this._api) {
            this._api.beatMouseDown.off(this._beatMouseDownHandler);
        }
        this._beatMouseDownHandler = null;

        if (this._rootMouseDownHandler && this._alphaTabRoot) {
            this._alphaTabRoot.removeEventListener('mousedown', this._rootMouseDownHandler, true);
        }
        this._rootMouseDownHandler = null;
        this._lastClickedStaffIndex = null;

        if (this._playerStateHandler && this._api) {
            this._api.playerStateChanged.off(this._playerStateHandler);
        }
        this._playerStateHandler = null;

        // 清理覆盖层
        if (highlightOverlay) {
            highlightOverlay.remove();
            highlightOverlay = null;
        }

        this._indexCache.clear();
        this._viewportSnapshot = null;
        this._api = null;
        this._editor = null;
        this._alphaTabRoot = null;
        this._scrollContainer = null;
        this._ast = null;
        this._score = null;
    }

    // ─── 内部方法 ──────────────────────────────────────────

    /**
     * 在渲染开始前保存视口快照。
     *
     * 当编辑触发重新渲染时，alphaTab 的 _onPostRenderFinished 会通过
     * beginInvoke 异步调用 _internalCursorUpdateBeat → ScrollHandler →
     * scrollToY，将预览滚动到 _previousTick 对应的 beat（用户从未播放时
     * 默认是第一个 beat）。
     *
     * 本方法保存当前滚动位置和高亮信息，供渲染完成后通过延迟恢复覆盖
     * alphaTab 内部的异步滚动。
     */
    private _saveViewportBeforeRender(): void {
        if (!this._enabled || this._pausedByPlayback || !this._scrollContainer) {
            this._viewportSnapshot = null;
            return;
        }

        const scrollTop = this._scrollContainer.scrollTop;

        // 仅当有实际滚动位置时才需要保存（scrollTop === 0 无需恢复）
        if (scrollTop <= 0 && !this._lastHighlightedBeatId) {
            this._viewportSnapshot = null;
            return;
        }

        // 获取当前编辑器光标偏移，用于渲染后重新映射 beat
        let cursorOffset: number | null = null;
        if (this._editor) {
            const position = this._editor.getPosition();
            const model = this._editor.getModel();
            if (position && model) {
                cursorOffset = model.getOffsetAt(position);
            }
        }

        this._viewportSnapshot = {
            scrollTop,
            lastBeatId: this._lastHighlightedBeatId,
            cursorOffset
        };
    }

    /**
     * 渲染完成后通过延迟恢复视口状态。
     *
     * 策略（纯延迟恢复，无 scroll 守卫）：
     *
     * alphaTab 的 _onPostRenderFinished 先调用 _cursorUpdateTick（其中
     * _cursorUpdateBeat 通过 uiFacade.beginInvoke 异步排队），然后才
     * trigger postRenderFinished 事件（我们的回调在此时执行）。
     * 异步排队的 _internalCursorUpdateBeat → scrollToY 会在下一个
     * 微任务/帧中执行。
     *
     * 我们通过 2 帧 rAF 延迟执行恢复，确保在 alphaTab 异步滚动 **之后**
     * 运行，从而覆盖它。
     *
     * 相比 scroll 事件守卫：
     * - ✅ 不阻断正常的光标同步滚动（用户后续键入触发的 scrollBeatIntoView）
     * - ⚠️ 可能有极短暂的视觉闪烁（alphaTab 异步滚动 → 我们延迟恢复）
     */
    private _restoreViewportAfterRender(): void {
        const snapshot = this._viewportSnapshot;
        this._viewportSnapshot = null;

        if (!snapshot || !this._scrollContainer) {
            return;
        }

        // 捕获引用，避免闭包中 this 引用变化问题
        const sc = this._scrollContainer;
        const ast = this._ast;
        const score = this._score;
        const api = this._api;
        const root = this._alphaTabRoot;
        const cursorOffset = snapshot.cursorOffset;
        const savedScrollTop = snapshot.scrollTop;

        // 延迟 2 帧 rAF：确保 alphaTab 异步排队的 scrollToY 已执行完毕
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                // ① 恢复 scrollTop
                sc.scrollTop = savedScrollTop;

                // ② 尝试重建高亮
                if (cursorOffset !== null && ast && score && api && root) {
                    const astResult = lookupAstAtOffset(ast, cursorOffset);
                    if (astResult) {
                        const beat = mapAstToScoreBeat(astResult, ast, score);
                        if (beat) {
                            this._lastHighlightedBeatId = beat.id;
                            renderSyncHighlight(beat, api, root);
                        }
                    }
                }
            });
        });
    }

    /**
     * 防抖调度：对光标移动事件做 debounce，减少频繁映射计算。
     */
    private _scheduleSyncFromCursor(
        editor: monaco.editor.IStandaloneCodeEditor,
        position: monaco.Position
    ): void {
        window.clearTimeout(cursorDebounceTimer);
        cursorDebounceTimer = window.setTimeout(() => {
            this._syncCursorToPreview(editor, position);
        }, CURSOR_SYNC_DEBOUNCE_MS);
    }

    /**
     * 核心同步逻辑：Monaco 光标位置 → AST 查找 → Score 映射 → 自定义高亮 → 自动滚动。
     */
    private _syncCursorToPreview(
        editor: monaco.editor.IStandaloneCodeEditor,
        position: monaco.Position
    ): void {
        // 前置检查
        if (!this._ast || !this._score || !this._api || !this._renderReady || !this._alphaTabRoot) {
            return;
        }

        const model = editor.getModel();
        if (!model) {
            return;
        }

        // 环节 ①：Monaco 光标位置 → 文本偏移
        const offset = model.getOffsetAt(position);

        // 环节 ②：文本偏移 → AST 节点
        const astResult = lookupAstAtOffset(this._ast, offset);
        if (!astResult) {
            this.clearHighlight();
            return;
        }

        // 环节 ③：AST 节点 → Score Beat
        const beat = mapAstToScoreBeat(astResult, this._ast, this._score);

        if (!beat) {
            this.clearHighlight();
            return;
        }

        // 去重：如果与上次高亮的 beat 相同，跳过
        if (beat.id === this._lastHighlightedBeatId) {
            return;
        }
        this._lastHighlightedBeatId = beat.id;

        // 环节 ④：自定义 DOM 高亮
        const beatBounds = renderSyncHighlight(beat, this._api, this._alphaTabRoot);

        // 环节 ⑤：自动滚动到视口
        if (beatBounds && this._scrollContainer) {
            scrollBeatIntoView(beatBounds, this._scrollContainer);
        }
    }

    /**
     * 反向同步：预览面板 Beat 点击 → 定位编辑器光标。
     *
     * 使用 `_lastClickedStaffIndex`（由 mousedown capture 阶段捕获）来精确
     * 定位点击落在哪个 staff（tab/简谱/五线谱），避免多谱样式场景下始终
     * 跳到第一个 staff 的源码位置。
     */
    private _syncPreviewToEditor(beat: alphaTab.model.Beat): void {
        if (!this._ast || !this._editor || !this._api || !this._renderReady || !this._alphaTabRoot) {
            return;
        }

        const model = this._editor.getModel();
        if (!model) {
            return;
        }

        // 取出并立即清空点击点所在的 staff 索引，避免过期值污染后续事件
        const clickedStaffIndex = this._lastClickedStaffIndex;
        this._lastClickedStaffIndex = null;

        // 将 Score Beat 反向映射到 AST 偏移（传入实际点击的 staff 索引）
        const offset = mapScoreBeatToAstOffset(beat, this._ast, clickedStaffIndex);
        if (offset === null) {
            return;
        }

        // 设置同步锁，防止 editor.setPosition 触发的 onDidChangeCursorPosition
        // 再反向同步回预览（避免循环）
        this._suppressEditorSync = true;

        try {
            // 定位编辑器光标
            const position = model.getPositionAt(offset);
            this._editor.setPosition(position);
            this._editor.revealPositionInCenter(position);
            this._editor.focus();
        } finally {
            // 延迟释放锁，确保 onDidChangeCursorPosition 的回调已被跳过
            window.setTimeout(() => {
                this._suppressEditorSync = false;
            }, CURSOR_SYNC_DEBOUNCE_MS + 20);
        }

        // 高亮被点击的 beat
        this._lastHighlightedBeatId = beat.id;
        renderSyncHighlight(beat, this._api, this._alphaTabRoot);
    }
}

/** 单例实例 — 由 main.ts 初始化并全局复用 */
export const cursorSync = new CursorSyncManager();
