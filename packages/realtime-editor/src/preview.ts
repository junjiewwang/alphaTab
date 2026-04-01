import * as alphaTab from '@coderline/alphatab';
import { dom, getActiveDocument, getDocumentById, setStatus, state } from './state';
import type { WorkspaceDocument } from './types';
import { escapeHtml, getErrorMessage, safeFileName } from './utils';
import { persistWorkspace } from './workspace-storage';

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
        const completedDocumentId = state.pendingRenderDocumentId;
        state.pendingRenderDocumentId = null;
        if (completedDocumentId) {
            state.renderedDocumentId = completedDocumentId;
        }

        const activeDocument = getActiveDocument();
        if (!activeDocument) {
            setStatus('ready', '预览已就绪', '可以开始编辑 AlphaTex');
            dom.previewSummary.textContent = '可以开始编辑 AlphaTex';
            return;
        }

        if (state.pendingRenderStatus) {
            const pendingStatus = state.pendingRenderStatus;
            state.pendingRenderStatus = null;
            setStatus(pendingStatus.tone, pendingStatus.title, pendingStatus.subtitle);
            return;
        }

        if (activeDocument.currentScore) {
            const summary = `${activeDocument.currentScore.tracks.length} 个轨道 · ${activeDocument.currentScore.masterBars.length} 小节`;
            setStatus('ready', '预览已同步', summary);
            dom.previewSummary.textContent = `保持上次成功结果，当前可视内容：${summary}`;
        } else {
            setStatus('ready', '预览已就绪', '可以开始编辑 AlphaTex');
            dom.previewSummary.textContent = '可以开始编辑 AlphaTex';
        }
    });

    api.error.on(error => {
        dom.shell.classList.remove('is-rendering');
        state.pendingRenderDocumentId = null;

        if (state.pendingImportRequest) {
            const pendingImport = state.pendingImportRequest;
            const importedDocument = getDocumentById(pendingImport.documentId);
            if (importedDocument) {
                importedDocument.currentScore = null;
                importedDocument.currentTimeInfo = null;
                importedDocument.scoreSubtitle = '导入失败';
                persistWorkspace();
                if (importedDocument.id === state.activeDocumentId) {
                    syncActiveDocumentUi();
                }
            }
            pendingImport.reject(error);
            state.pendingImportRequest = null;
        }

        setStatus('error', '预览错误', getErrorMessage(error));
    });

    api.scoreLoaded.on(score => {
        const pendingImport = state.pendingImportRequest;
        const targetDocument = pendingImport
            ? getDocumentById(pendingImport.documentId)
            : getActiveDocument();

        if (!targetDocument) {
            return;
        }

        targetDocument.currentScore = score;
        targetDocument.activeTrackIndexes = normalizeTrackSelection(
            score,
            targetDocument.activeTrackIndexes.length > 0
                ? targetDocument.activeTrackIndexes
                : score.tracks.map(track => track.index)
        );
        updateDocumentMeta(targetDocument, score, targetDocument.displayName);
        persistWorkspace();

        if (pendingImport) {
            const exporter = new alphaTab.exporter.AlphaTexExporter();
            const tex = exporter.exportToString(score, api.settings);
            targetDocument.savedContent = tex;
            targetDocument.isDirty = false;
            targetDocument.lastSuccessfulCode = tex;
            targetDocument.currentTimeInfo = null;

            state.suspendDocumentChangeHandling = true;
            targetDocument.model.setValue(tex);
            state.suspendDocumentChangeHandling = false;

            if (targetDocument.id === state.activeDocumentId) {
                renderTrackList(score);
                updateTimeline(0, 0);
                requestRenderForDocument(targetDocument, score, { reuseViewport: false });
                state.editor?.focus();
            }

            persistWorkspace();
            pendingImport.resolve();
            state.pendingImportRequest = null;
            setStatus('ready', '已导入外部文件', '已自动转换为 AlphaTex，可继续实时编辑');
            return;
        }

        if (targetDocument.id === state.activeDocumentId) {
            renderTrackList(score);
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
        const activeDocument = getActiveDocument();
        if (!activeDocument) {
            return;
        }
        activeDocument.currentTimeInfo = args as alphaTab.synth.PositionChangedEventArgs;
        updateTimeline(0, args.endTime);
        persistWorkspace();
    });

    api.playerPositionChanged.on(args => {
        const activeDocument = getActiveDocument();
        if (!activeDocument) {
            return;
        }
        activeDocument.currentTimeInfo = args;
        updateTimeline(args.currentTime, args.endTime);
    });

    state.api = api;
}

type AlphaTabCanvasContainer = {
    element?: HTMLElement;
};

function getAlphaTabCanvasElement(): HTMLElement | null {
    const canvasElement = (state.api?.canvasElement as AlphaTabCanvasContainer | undefined)?.element;
    if (canvasElement instanceof HTMLElement) {
        return canvasElement;
    }

    return dom.alphaTabRoot.querySelector<HTMLElement>('.at-surface');
}

function getAlphaTabCursorElement(): HTMLElement | null {
    return dom.alphaTabRoot.querySelector<HTMLElement>('.at-cursors');
}

function ensureAlphaTabDomAttached(): void {
    const canvasElement = getAlphaTabCanvasElement();
    if (canvasElement && canvasElement.parentElement !== dom.alphaTabRoot) {
        dom.alphaTabRoot.appendChild(canvasElement);
    }
}

function hasRenderedPreviewDom(): boolean {
    const canvasElement = getAlphaTabCanvasElement();
    return Boolean(canvasElement && canvasElement.childElementCount > 0);
}

export function clearPreview(message = '等待乐谱加载'): void {
    ensureAlphaTabDomAttached();

    const canvasElement = getAlphaTabCanvasElement();
    if (canvasElement) {
        canvasElement.replaceChildren();
        canvasElement.style.width = '0px';
        canvasElement.style.height = '0px';
    } else {
        dom.alphaTabRoot.replaceChildren();
    }

    const cursorElement = getAlphaTabCursorElement();
    if (cursorElement) {
        cursorElement.style.visibility = 'hidden';
    }

    dom.trackList.innerHTML = `<p class="track-dock__empty">${escapeHtml(message)}</p>`;
    dom.trackCount.textContent = '0';
    updateTimeline(0, 0);
    dom.playPauseButton.textContent = '▶ 播放';
    state.renderedDocumentId = null;
    state.pendingRenderDocumentId = null;
}

function isPreviewOwnedByDocument(documentId: string): boolean {
    return state.renderedDocumentId === documentId && hasRenderedPreviewDom();
}

function canReuseViewportForDocument(targetDocument: WorkspaceDocument, currentCode: string): boolean {
    return (
        isPreviewOwnedByDocument(targetDocument.id) &&
        isLikelyIncrementalEdit(targetDocument.lastSuccessfulCode, currentCode)
    );
}

function requestRenderForDocument(
    targetDocument: WorkspaceDocument,
    score: alphaTab.model.Score,
    options: { reuseViewport: boolean }
): void {
    if (!state.api) {
        return;
    }

    ensureAlphaTabDomAttached();

    const cursorElement = getAlphaTabCursorElement();
    if (cursorElement) {
        cursorElement.style.visibility = 'visible';
    }

    state.pendingRenderDocumentId = targetDocument.id;
    state.api.renderScore(score, targetDocument.activeTrackIndexes, {
        reuseViewport: options.reuseViewport
    });
}

export function syncActiveDocumentUi(): void {
    const activeDocument = getActiveDocument();
    if (!activeDocument) {
        dom.scoreTitle.textContent = '未命名工作区';
        dom.scoreSubtitle.textContent = '准备加载 AlphaTex 示例';
        dom.previewSummary.textContent = '可以开始编辑 AlphaTex';
        clearPreview();
        return;
    }

    dom.scoreTitle.textContent = activeDocument.scoreTitle || activeDocument.displayName;
    dom.scoreSubtitle.textContent = activeDocument.scoreSubtitle || '等待渲染预览';

    if (activeDocument.currentScore) {
        const ownsRenderedPreview = isPreviewOwnedByDocument(activeDocument.id);
        if (!ownsRenderedPreview) {
            clearPreview('正在切换该文档预览');
        }

        renderTrackList(activeDocument.currentScore);
        updateTimeline(
            activeDocument.currentTimeInfo?.currentTime ?? 0,
            activeDocument.currentTimeInfo?.endTime ?? 0
        );
        dom.previewSummary.textContent = ownsRenderedPreview
            ? `保持上次成功结果，当前可视内容：${activeDocument.currentScore.tracks.length} 个轨道 · ${activeDocument.currentScore.masterBars.length} 小节`
            : '正在切换该文档预览';
    } else {
        clearPreview('切换到该文档后将自动生成预览');
        dom.previewSummary.textContent = '切换到该文档后将自动生成预览';
    }
}

export function renderTrackList(score: alphaTab.model.Score): void {
    const activeDocument = getActiveDocument();
    if (!activeDocument) {
        clearPreview();
        return;
    }

    dom.trackList.innerHTML = '';
    dom.trackCount.textContent = String(score.tracks.length);

    if (score.tracks.length === 0) {
        dom.trackList.innerHTML = '<p class="track-dock__empty">当前乐谱没有可用轨道。</p>';
        return;
    }

    for (const track of score.tracks) {
        const button = window.document.createElement('button');
        button.type = 'button';
        button.className = 'track-chip';
        if (activeDocument.activeTrackIndexes.includes(track.index)) {
            button.classList.add('is-active');
        }

        const trackKind = track.staves.some(staff => staff.isPercussion)
            ? 'Percussion'
            : 'Instrument';
        button.innerHTML = `<strong>${escapeHtml(track.name || `Track ${track.index + 1}`)}</strong><span>${trackKind} · #${track.index + 1}</span>`;

        button.addEventListener('click', () => {
            const currentDocument = getActiveDocument();
            if (!currentDocument?.currentScore || !state.api) {
                return;
            }

            if (currentDocument.activeTrackIndexes.includes(track.index)) {
                if (currentDocument.activeTrackIndexes.length === 1) {
                    return;
                }
                currentDocument.activeTrackIndexes = currentDocument.activeTrackIndexes.filter(
                    index => index !== track.index
                );
            } else {
                currentDocument.activeTrackIndexes = [...currentDocument.activeTrackIndexes, track.index].sort(
                    (a, b) => a - b
                );
            }

            persistWorkspace();
            renderTrackList(currentDocument.currentScore);
            requestRenderForDocument(currentDocument, currentDocument.currentScore, {
                reuseViewport: isPreviewOwnedByDocument(currentDocument.id)
            });
        });
        dom.trackList.appendChild(button);
    }
}

export function scheduleRender(delay = 220): void {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(() => {
        void renderActiveDocument();
    }, delay);
}

export async function renderActiveDocument(): Promise<void> {
    const activeDocument = getActiveDocument();
    if (!activeDocument || !state.api) {
        return;
    }

    const tex = activeDocument.model.getValue();
    if (!tex.trim()) {
        activeDocument.currentScore = null;
        activeDocument.currentTimeInfo = null;
        activeDocument.activeTrackIndexes = [];
        activeDocument.lastSuccessfulCode = '';
        activeDocument.scoreTitle = activeDocument.displayName;
        activeDocument.scoreSubtitle = '空白文档';
        persistWorkspace();
        syncActiveDocumentUi();
        setStatus('warning', '编辑器为空', '请输入 AlphaTex 内容后开始预览');
        return;
    }

    try {
        const score = parseScore(tex);
        const reuseViewport = canReuseViewportForDocument(activeDocument, tex);
        activeDocument.currentScore = score;
        activeDocument.currentTimeInfo = null;
        activeDocument.activeTrackIndexes = normalizeTrackSelection(
            score,
            activeDocument.activeTrackIndexes
        );
        updateDocumentMeta(activeDocument, score, activeDocument.displayName);
        activeDocument.lastSuccessfulCode = tex;
        persistWorkspace();
        syncActiveDocumentUi();
        requestRenderForDocument(activeDocument, score, { reuseViewport });
    } catch (error) {
        if (activeDocument.lastSuccessfulCode && activeDocument.lastSuccessfulCode !== tex) {
            try {
                const fallbackScore = parseScore(activeDocument.lastSuccessfulCode);
                activeDocument.currentScore = fallbackScore;
                activeDocument.currentTimeInfo = null;
                activeDocument.activeTrackIndexes = normalizeTrackSelection(
                    fallbackScore,
                    activeDocument.activeTrackIndexes
                );
                updateDocumentMeta(activeDocument, fallbackScore, activeDocument.displayName);
                persistWorkspace();
                syncActiveDocumentUi();
                state.pendingRenderStatus = {
                    tone: 'warning',
                    title: '当前内容存在错误',
                    subtitle: '正在显示该文档上次成功预览'
                };
                requestRenderForDocument(activeDocument, fallbackScore, {
                    reuseViewport: isPreviewOwnedByDocument(activeDocument.id)
                });
                return;
            } catch {
                // ignore fallback failure and continue to clear preview
            }
        }

        activeDocument.currentScore = null;
        activeDocument.currentTimeInfo = null;
        persistWorkspace();
        clearPreview('该文档当前没有可显示的有效预览');
        setStatus('error', '脚本暂时无法渲染', getErrorMessage(error));
    }
}

export function updateTimeline(currentTime: number, endTime: number): void {
    const safeEnd = Number.isFinite(endTime) && endTime > 0 ? endTime : 0;
    const percent = safeEnd > 0 ? (currentTime / safeEnd) * 100 : 0;
    dom.timelineValue.style.width = `${Math.min(100, Math.max(0, percent)).toFixed(2)}%`;
    dom.timeLabel.textContent = `${formatTimeDisplay(currentTime)} / ${formatTimeDisplay(safeEnd)}`;
}

function updateDocumentMeta(
    targetDocument: WorkspaceDocument,
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

    targetDocument.scoreTitle = resolvedTitle;
    targetDocument.scoreSubtitle = subtitleParts.join(' · ') || '实时编辑预览中';

    if (targetDocument.id === state.activeDocumentId) {
        dom.scoreTitle.textContent = targetDocument.scoreTitle;
        dom.scoreSubtitle.textContent = targetDocument.scoreSubtitle;
    }
}

function parseScore(tex: string): alphaTab.model.Score {
    if (!state.api) {
        throw new Error('预览 API 尚未初始化');
    }

    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(tex, state.api.settings);
    importer.logErrors = true;
    return importer.readScore();
}

function isLikelyIncrementalEdit(previousCode: string, currentCode: string): boolean {
    if (!previousCode) {
        return false;
    }

    const prevLen = previousCode.length;
    const curLen = currentCode.length;
    const lengthChangeRatio = Math.abs(curLen - prevLen) / Math.max(prevLen, 1);
    if (lengthChangeRatio > 0.2) {
        return false;
    }

    const longPrefixLen = Math.min(80, prevLen, curLen);
    if (previousCode.substring(0, longPrefixLen) === currentCode.substring(0, longPrefixLen)) {
        return true;
    }

    const shortPrefixLen = Math.min(40, prevLen, curLen);
    if (previousCode.substring(0, shortPrefixLen) === currentCode.substring(0, shortPrefixLen)) {
        return true;
    }

    return false;
}

function normalizeTrackSelection(score: alphaTab.model.Score, trackIndexes: number[]): number[] {
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
