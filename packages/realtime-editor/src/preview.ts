import * as alphaTab from '@coderline/alphatab';
import { dom, setStatus, state } from './state';
import { escapeHtml, getErrorMessage, persistValue, safeFileName } from './utils';
import { STORAGE_KEYS } from './constants';

// ─── 预览初始化 ──────────────────────────────────────────────

export function setupPreview(): void {
    const api = new alphaTab.AlphaTabApi(dom.alphaTabRoot, {
        core: {
            file: undefined,
            fontDirectory: '/font/bravura/',
            enableLazyLoading: false,
            useWorkers: false
        },
        display: {
            layoutMode: alphaTab.LayoutMode.Parchment,
            scale: 1
        },
        player: {
            playerMode: alphaTab.PlayerMode.EnabledAutomatic,
            soundFont: '/font/sonivox/sonivox.sf2',
            scrollElement: dom.previewViewport,
            enableCursor: true,
            enableUserInteraction: true,
            scrollMode: alphaTab.ScrollMode.Continuous
        }
    } satisfies alphaTab.json.SettingsJson);

    api.settings.exporter.comments = true;
    api.settings.exporter.indent = 2;

    api.renderStarted.on(() => {
        dom.shell.classList.add('is-rendering');
        setStatus('rendering', '正在渲染预览', '新的乐谱布局正在生成');
    });

    api.renderFinished.on(() => {
        dom.shell.classList.remove('is-rendering');
        if (state.currentScore) {
            const summary = `${state.currentScore.tracks.length} 个轨道 · ${state.currentScore.masterBars.length} 小节`;
            setStatus('ready', '预览已同步', summary);
            dom.previewSummary.textContent = `保持上次成功结果，当前可视内容：${summary}`;
        } else {
            setStatus('ready', '预览已就绪', '可以开始编辑 AlphaTex');
        }
    });

    api.error.on(error => {
        dom.shell.classList.remove('is-rendering');
        setStatus('error', '预览错误', getErrorMessage(error));
    });

    api.scoreLoaded.on(score => {
        state.currentScore = score;
        state.activeTrackIndexes = score.tracks.map(track => track.index);
        updateScoreMeta(score, state.lastFileName);
        renderTrackList(score);
        api.renderScore(score, state.activeTrackIndexes, { reuseViewport: true });

        if (state.shouldSyncEditorFromExternalLoad && state.editor) {
            const exporter = new alphaTab.exporter.AlphaTexExporter();
            const tex = exporter.exportToString(score, api.settings);
            state.shouldSyncEditorFromExternalLoad = false;
            state.lastSuccessfulCode = tex;
            persistValue(STORAGE_KEYS.document, tex);
            state.editor.getModel()?.setValue(tex);
            state.editor.focus();
            setStatus('ready', '已导入外部文件', '已自动转换为 AlphaTex，可继续实时编辑');
        }
    });

    api.playerReady.on(() => {
        dom.playPauseButton.disabled = false;
        dom.stopButton.disabled = false;
    });

    api.playerStateChanged.on(args => {
        const isPlaying = args.state === alphaTab.synth.PlayerState.Playing;
        dom.playPauseButton.textContent = isPlaying ? '⏸ 暂停' : '▶ 播放';
    });

    api.midiLoaded.on(args => {
        state.currentTimeInfo = args as alphaTab.synth.PositionChangedEventArgs;
        updateTimeline(0, args.endTime);
    });

    api.playerPositionChanged.on(args => {
        state.currentTimeInfo = args;
        updateTimeline(args.currentTime, args.endTime);
    });

    state.api = api;
}

// ─── 轨道列表渲染 ────────────────────────────────────────────

export function renderTrackList(score: alphaTab.model.Score): void {
    dom.trackList.innerHTML = '';
    dom.trackCount.textContent = String(score.tracks.length);

    if (score.tracks.length === 0) {
        dom.trackList.innerHTML =
            '<p class="track-dock__empty">当前乐谱没有可用轨道。</p>';
        return;
    }

    for (const track of score.tracks) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'track-chip';
        if (state.activeTrackIndexes.includes(track.index)) {
            button.classList.add('is-active');
        }

        const trackKind = track.staves.some(staff => staff.isPercussion)
            ? 'Percussion'
            : 'Instrument';
        button.innerHTML = `<strong>${escapeHtml(track.name || `Track ${track.index + 1}`)}</strong><span>${trackKind} · #${track.index + 1}</span>`;

        button.addEventListener('click', () => {
            if (!state.currentScore || !state.api) {
                return;
            }

            if (state.activeTrackIndexes.includes(track.index)) {
                if (state.activeTrackIndexes.length === 1) {
                    return;
                }
                state.activeTrackIndexes = state.activeTrackIndexes.filter(
                    index => index !== track.index
                );
            } else {
                state.activeTrackIndexes = [...state.activeTrackIndexes, track.index].sort(
                    (a, b) => a - b
                );
            }

            renderTrackList(state.currentScore);
            state.api.renderScore(state.currentScore, state.activeTrackIndexes, {
                reuseViewport: true
            });
        });
        dom.trackList.appendChild(button);
    }
}

// ─── 乐谱元信息 ─────────────────────────────────────────────

export function updateScoreMeta(
    score: alphaTab.model.Score,
    fileName: string
): void {
    const resolvedTitle =
        score.title?.trim() ||
        safeFileName(fileName.replace(/\.[^.]+$/, '')) ||
        '未命名乐谱';
    const subtitleParts = [
        score.artist?.trim(),
        `${score.tracks.length} 个轨道`,
        `${score.masterBars.length} 小节`
    ].filter(Boolean);

    dom.scoreTitle.textContent = resolvedTitle;
    dom.scoreSubtitle.textContent = subtitleParts.join(' · ') || '实时编辑预览中';
}

// ─── 渲染逻辑 ────────────────────────────────────────────────

export function scheduleRender(delay = 220): void {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(() => {
        void renderFromEditor();
    }, delay);
}

export async function renderFromEditor(): Promise<void> {
    if (!state.api || !state.editor) {
        return;
    }

    const tex = state.editor.getValue();
    if (!tex.trim()) {
        setStatus('warning', '编辑器为空', '请输入 AlphaTex 内容后开始预览');
        return;
    }

    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(tex, state.api.settings);
    importer.logErrors = true;

    try {
        const score = importer.readScore();
        state.currentScore = score;
        state.lastSuccessfulCode = tex;

        if (state.activeTrackIndexes.length === 0) {
            state.activeTrackIndexes = score.tracks.map(track => track.index);
        }

        state.activeTrackIndexes = normalizeTrackSelection(score, state.activeTrackIndexes);
        renderTrackList(score);
        updateScoreMeta(score, state.lastFileName);

        const isIncrementalEdit =
            state.lastSuccessfulCode.length > 0 &&
            tex.substring(0, 40) === state.lastSuccessfulCode.substring(0, 40);
        state.api.renderScore(score, state.activeTrackIndexes, {
            reuseViewport: isIncrementalEdit
        });
    } catch (error) {
        setStatus('error', '脚本暂时无法渲染', getErrorMessage(error));
    }
}

// ─── 时间轴更新 ──────────────────────────────────────────────

export function updateTimeline(currentTime: number, endTime: number): void {
    const safeEnd = Number.isFinite(endTime) && endTime > 0 ? endTime : 0;
    const percent = safeEnd > 0 ? (currentTime / safeEnd) * 100 : 0;
    dom.timelineValue.style.width = `${Math.min(100, Math.max(0, percent)).toFixed(2)}%`;
    dom.timeLabel.textContent = `${formatTimeDisplay(currentTime)} / ${formatTimeDisplay(safeEnd)}`;
}

// ─── 内部辅助 ────────────────────────────────────────────────

function normalizeTrackSelection(
    score: alphaTab.model.Score,
    trackIndexes: number[]
): number[] {
    const available = new Set(score.tracks.map(track => track.index));
    const normalized = trackIndexes.filter(index => available.has(index));
    return normalized.length > 0 ? normalized : score.tracks.map(track => track.index);
}

function formatTimeDisplay(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
