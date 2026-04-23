/**
 * 运行期 monkey patch，增强 alphaTab 简谱（Numbered）渲染：
 *
 * 1. Ghost 可视化：`Note.isGhost === true` 时，简谱数字两侧加括号（与 tab / 五线谱对齐）。
 * 2. 低音点移到时值线下方：将低音八度点从「数字与时值线之间」移到「时值线下方」，
 *    使时值线紧贴数字、全局统一对齐。高音点保持在数字上方不变。
 *
 * 两个 patch 均通过重写 prototype 方法实现：
 * - 幂等：模块级 flag + 方法是否已 patch 的标记，防止 HMR 重复应用；
 * - 容错：找不到目标类 / 签名不匹配时 `console.warn` 并跳过，不中断主流程；
 * - 可回滚：删除 `applyNumberedPatches()` 调用即可恢复默认行为。
 *
 * 方案详见 `docs/numbered-ghost-and-flag-alignment.md`。
 */

import type { Beat } from '@coderline/alphatab/model/Beat';
import { Duration } from '@coderline/alphatab/model/Duration';
import type { BeatContainerGlyph } from '@coderline/alphatab/rendering/glyphs/BeatContainerGlyph';
import type { NumberedBeatGlyph } from '@coderline/alphatab/rendering/glyphs/NumberedBeatGlyph';
import { NumberedNoteHeadGlyph } from '@coderline/alphatab/rendering/glyphs/NumberedNoteHeadGlyph';
import { NumberedBarRenderer } from '@coderline/alphatab/rendering/NumberedBarRenderer';

const PATCH_FLAG = '__alphatab_realtime_editor_numbered_patches__';
type PatchableGlobal = {
    [PATCH_FLAG]?: boolean;
};

/**
 * 应用所有简谱增强 patch（幂等）。
 * 应在 `AlphaTabApi` 实例创建前调用（如 `setupPreview` 开头）。
 */
export function applyNumberedPatches(): void {
    const g = globalThis as PatchableGlobal;
    if (g[PATCH_FLAG]) {
        return;
    }

    const okGhost = patchNumberedGhostRendering();
    const okDots = patchNumberedLowOctaveDotsBelow();

    if (okGhost || okDots) {
        g[PATCH_FLAG] = true;
    }
}

// ---------------------------------------------------------------------------
// Patch 1: Ghost 可视化
// ---------------------------------------------------------------------------

/**
 * 为 `NumberedNoteHeadGlyph` 的 `doLayout` 添加 Ghost 括号。
 *
 * 策略：
 * - `doLayout`：检测 `beat.notes[0].isGhost` 为真时，
 *   把 `_number` 字符串改写为 `(原数字)`，同时在原逻辑基础上让 `measureText` 返回的宽度
 *   自然覆盖括号；height / octaveDots 布局不变。
 * - `paint`：不需要改 —— 原 paint 调用 `canvas.fillText(this._number, ...)`，
 *   当 `_number` 已是 `(3)` 时会一次性渲染整串。
 */
function patchNumberedGhostRendering(): boolean {
    const proto = NumberedNoteHeadGlyph?.prototype as
        | (NumberedNoteHeadGlyph & { __patched_ghost?: boolean })
        | undefined;
    if (!proto || typeof proto.doLayout !== 'function') {
        console.warn('[realtime-editor] NumberedNoteHeadGlyph prototype missing, skip ghost patch');
        return false;
    }

    if (proto.__patched_ghost) {
        return true;
    }

    type HeadInternals = {
        _beat: Beat;
        _number: string;
        __ghostWrapped?: boolean;
    };

    const originalDoLayout = proto.doLayout;

    proto.doLayout = function patchedDoLayout(this: NumberedNoteHeadGlyph): void {
        const self = this as unknown as HeadInternals;

        // 防止重复包裹（HMR / 多次 doLayout）
        if (!self.__ghostWrapped) {
            const note = self._beat?.notes.length > 0 ? self._beat.notes[0] : undefined;
            const shouldWrap =
                !!note &&
                note.isGhost &&
                !note.isDead &&
                !self._beat.isRest &&
                typeof self._number === 'string' &&
                self._number.length > 0 &&
                self._number !== 'X' &&
                self._number !== '0' &&
                // 已经有括号（来自上游未来变更）就不再包一层
                !(self._number.startsWith('(') && self._number.endsWith(')'));

            if (shouldWrap) {
                self._number = `(${self._number})`;
                self.__ghostWrapped = true;
            }
        }

        originalDoLayout.call(this);
    };

    proto.__patched_ghost = true;
    return true;
}

// ---------------------------------------------------------------------------
// Patch 2: 低音八度点移到时值线下方
// ---------------------------------------------------------------------------

/**
 * 重写 `NumberedNoteHeadGlyph` 的 `doLayout` / `getBoundingBoxBottom`，
 * 将低音点从「数字与时值线之间」移到「时值线下方」。
 *
 * 渲染结构变化（仅低音点 octaveDots < 0 时生效）：
 *
 *   原来：  数字  →  低音点  →  时值线
 *   现在：  数字  →  时值线  →  低音点
 *
 * 实现思路：
 * 1. `doLayout`：低音点的 `_octaveDotsY` 加上时值线高度偏移，使点画在线下方；
 * 2. `getBoundingBoxBottom`：不再包含低音点空间（让时值线的 Y 计算基于"数字底部"）；
 * 3. 新增 `getBoundingBoxBottomWithDots`：供 overflow 计算时使用，包含低音点 + 时值线的完整空间。
 *
 * 由于低音点不再撑大 bounding box bottom，同一小节内所有 beat 的时值线 Y 天然对齐，
 * 不再需要之前的 "Bar 级 baseline 对齐" patch。
 */
function patchNumberedLowOctaveDotsBelow(): boolean {
    const noteHeadProto = NumberedNoteHeadGlyph?.prototype as
        | (NumberedNoteHeadGlyph & {
              __patched_dots_below?: boolean;
          })
        | undefined;
    if (
        !noteHeadProto ||
        typeof noteHeadProto.doLayout !== 'function' ||
        typeof noteHeadProto.getBoundingBoxBottom !== 'function'
    ) {
        console.warn('[realtime-editor] NumberedNoteHeadGlyph prototype missing, skip dots-below patch');
        return false;
    }

    if (noteHeadProto.__patched_dots_below) {
        return true;
    }

    type HeadInternals = {
        _beat: Beat;
        _isGrace: boolean;
        _octaveDots: number;
        _octaveDotsY: number;
        _octaveDotHeight: number;
        // 记录 patch 追加的时值线高度偏移量，供 bounding box 和 overflow 计算使用
        __barHeightOffset: number;
    };

    // --- 1. 重写 doLayout：低音点 Y 加上时值线高度偏移 ---
    const originalDoLayout = noteHeadProto.doLayout;

    noteHeadProto.doLayout = function patchedDoLayout(this: NumberedNoteHeadGlyph): void {
        // 先走原逻辑（计算 width/height、_octaveDotsY、_octaveDotHeight）
        originalDoLayout.call(this);

        const self = this as unknown as HeadInternals;
        self.__barHeightOffset = 0;

        // 只处理低音点（octaveDots < 0）
        if (self._octaveDots >= 0) {
            return;
        }

        // 计算当前 beat 的时值线高度
        const barHeight = calcBarHeightForBeat(this, self._beat);

        if (barHeight > 0) {
            // 将低音点 Y 推到时值线下方：原位置 + 时值线高度
            self._octaveDotsY += barHeight;
            self.__barHeightOffset = barHeight;
        }
    };

    // --- 2. 重写 getBoundingBoxBottom：低音点不参与 bounding box ---
    // 这使时值线基于「数字底部」计算 Y，所有 beat 统一。
    noteHeadProto.getBoundingBoxBottom = function patchedGetBoundingBoxBottom(this: NumberedNoteHeadGlyph): number {
        // 数字底部（不含任何八度点空间）
        // 高音点不影响 bottom；低音点被排除（移到了时值线下方）
        return this.y + this.height / 2;
    };

    // --- 3. 扩展 calculateOverflows：确保低音点所在区域计入 overflow ---
    // 低音点现在在 bounding box 之外（在时值线下方），需要让行高计算知道这些点的存在。
    // 通过重写 NumberedBarRenderer.calculateOverflows 实现。
    patchNumberedBarRendererOverflow();

    noteHeadProto.__patched_dots_below = true;
    return true;
}

/**
 * 扩展 `NumberedBarRenderer.calculateOverflows`：
 * 扫描 bar 内所有 beat 的 noteHead，如果有低音点被移到时值线下方，
 * 将其完整 Y 范围（数字 + 时值线 + 低音点）注册为 overflow bottom。
 */
function patchNumberedBarRendererOverflow(): void {
    type RendererPatchable = {
        calculateOverflows(rendererTop: number, rendererBottom: number): void;
        __patched_overflow?: boolean;
    };
    const proto = NumberedBarRenderer?.prototype as unknown as RendererPatchable | undefined;
    if (!proto || typeof proto.calculateOverflows !== 'function') {
        return;
    }

    if (proto.__patched_overflow) {
        return;
    }

    const original = proto.calculateOverflows;

    type HeadInternals = {
        _octaveDots: number;
        _octaveDotsY: number;
        _octaveDotHeight: number;
        __barHeightOffset: number;
    };

    proto.calculateOverflows = function patchedCalculateOverflows(
        this: NumberedBarRenderer,
        rendererTop: number,
        rendererBottom: number
    ): void {
        // 先调原逻辑
        original.call(this, rendererTop, rendererBottom);

        // 额外检查低音点溢出
        const bar = this.bar;
        if (!bar) {
            return;
        }
        const voice = bar.voices.length > 0 ? bar.voices[0] : undefined;
        if (!voice) {
            return;
        }

        for (const b of voice.beats) {
            const containerBase = this.getBeatContainer(b);
            if (!containerBase) {
                continue;
            }

            // getBeatContainer 返回 BeatContainerGlyphBase，简谱中实际是 NumberedBeatContainerGlyph
            // (extends BeatContainerGlyph)，有 onNotes 属性（类型为 BeatOnNoteGlyphBase）
            const container = containerBase as unknown as BeatContainerGlyph;
            const onNotes = container.onNotes as NumberedBeatGlyph | undefined;
            const noteHead = onNotes?.noteHeads;
            if (!noteHead) {
                continue;
            }

            const headSelf = noteHead as unknown as HeadInternals;
            if (headSelf._octaveDots >= 0 || !headSelf.__barHeightOffset) {
                continue;
            }

            // 计算低音点的真实 bottom Y（相对于 renderer 坐标）
            const dotsBottom =
                noteHead.y + headSelf._octaveDotsY + Math.abs(headSelf._octaveDots) * headSelf._octaveDotHeight * 2;

            if (dotsBottom > rendererBottom) {
                this.registerOverflowBottom(dotsBottom - rendererBottom);
            }
        }
    };

    proto.__patched_overflow = true;
}

/**
 * 为给定的 noteHead glyph 所属 beat 计算时值线高度。
 *
 * 时值线高度 = barSpacing + barCount × (barSpacing + barSize)，
 * 其中 barCount = log2(duration) - 2（八分音符=1条，十六分=2条，等等）。
 * 如果 duration ≤ Quarter（不画线）则返回 0。
 *
 * 使用 noteHead.renderer 获取 smuflMetrics（运行时保证有值）。
 */
function calcBarHeightForBeat(glyph: NumberedNoteHeadGlyph, beat: Beat): number {
    if (beat.duration <= Duration.Quarter) {
        return 0;
    }

    const barCount = getDurationIndex(beat.duration) - 2;
    if (barCount <= 0) {
        return 0;
    }

    const renderer = glyph.renderer as NumberedBarRenderer;
    const smufl = renderer.smuflMetrics;

    return (
        smufl.numberedBarRendererBarSpacing +
        barCount * (smufl.numberedBarRendererBarSpacing + smufl.numberedBarRendererBarSize)
    );
}

/**
 * 等价于 alphaTab `ModelUtils.getIndex`：负值时返回 0，否则 `log2(duration) | 0`。
 */
function getDurationIndex(duration: Duration): number {
    const d = duration as number;
    if (d <= 0) {
        return 0;
    }
    return Math.log2(d) | 0;
}
