import * as alphaTab from '@coderline/alphatab';
import { registerAlphaTexGrammar } from '@coderline/alphatab-monaco/alphatex';
import { basicEditorLspIntegration } from '@coderline/alphatab-monaco/lsp';
import { addTextMateGrammarSupport } from '@coderline/alphatab-monaco/textmate';
import * as monaco from 'monaco-editor';
// @ts-expect-error Monaco worker is provided by Vite
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import Split from 'split.js';
import './styles.css';

type ViewMode = 'split' | 'editor' | 'preview';
type StatusTone = 'ready' | 'rendering' | 'error' | 'warning' | 'muted';
type ExampleId = 'overture' | 'fingerstyle' | 'swing';
type SplitInstance = ReturnType<typeof Split>;

type ExampleDefinition = {
    fileName: string;
    subtitle: string;
    tex: string;
};

const STORAGE_KEYS = {
    document: 'alphatab.realtime-editor.document',
    view: 'alphatab.realtime-editor.view',
    example: 'alphatab.realtime-editor.example'
} as const;

const EXAMPLES: Record<ExampleId, ExampleDefinition> = {
    overture: {
        fileName: 'overture-theme.alphatex',
        subtitle: '分层主旋律与和声示例',
        tex: String.raw`\title "Overture Theme"
\subtitle "Realtime Editor"
\artist "alphaTab"
\tempo 92
\track "Lead"
.
:4 5.3 7.3 8.3 10.3 | 12.2 10.2 8.2 7.2 |
5.3 7.3 8.3 10.3 | 12.2 14.2 12.2 10.2 |
\track "Harmony"
.
:4 (3.4 5.4) (5.4 7.4) (6.4 8.4) (8.4 10.4) |
(10.3 12.3) (8.3 10.3) (6.3 8.3) (5.3 7.3) |`
    },
    fingerstyle: {
        fileName: 'fingerstyle-sketch.alphatex',
        subtitle: '适合试听播放与缩放观察',
        tex: String.raw`\title "Fingerstyle Sketch"
\subtitle "Parchment Preview"
\artist "Workbench Sample"
\tempo 76
\tuning (E4 B3 G3 D3 A2 E2)
.
:8 (0.6 2.4 2.3) (0.6 2.4 2.3) (0.6 2.4 4.3) (0.6 2.4 4.3) |
(0.6 2.4 5.2) (0.6 2.4 5.2) (0.6 2.4 3.2) (0.6 2.4 3.2) |
(3.5 2.4 0.3) (3.5 2.4 0.3) (2.5 2.4 0.3) (2.5 2.4 0.3) |
(0.6 2.4 2.3) (0.6 2.4 2.3) (0.6 2.4 4.3) (0.6 2.4 5.3) |`
    },
    swing: {
        fileName: 'swing-study.alphatex',
        subtitle: '多小节 Swing 节奏练习',
        tex: String.raw`\title "Late Night Swing"
\subtitle "Editor Diagnostics"
\artist "alphaTab Lab"
\tempo 128
.
\tf triplet8th :8 3.4 5.4 6.4 5.4 3.4 2.4 3.4 5.4 |
6.4 8.4 9.4 8.4 6.4 5.4 3.4 2.4 |
3.4{sl} 5.4 6.4{sl} 8.4 9.4 8.4 6.4 5.4 |
3.4 2.4 0.4 2.4 3.4 5.4 6.4 8.4 |`
    }
};

const workspace = document.querySelector<HTMLElement>('#workspace')!;
const shell = document.querySelector<HTMLElement>('#appShell')!;
const statusPill = document.querySelector<HTMLElement>('#statusPill')!;
const scoreTitle = document.querySelector<HTMLElement>('#scoreTitle')!;
const scoreSubtitle = document.querySelector<HTMLElement>('#scoreSubtitle')!;
const previewSummary = document.querySelector<HTMLElement>('#previewSummary')!;
const diagnosticCount = document.querySelector<HTMLElement>('#diagnosticCount')!;
const diagnosticsList = document.querySelector<HTMLUListElement>('#diagnosticsList')!;
const trackList = document.querySelector<HTMLElement>('#trackList')!;
const trackCount = document.querySelector<HTMLElement>('#trackCount')!;
const exampleSelect = document.querySelector<HTMLSelectElement>('#exampleSelect')!;
const newDocumentButton = document.querySelector<HTMLButtonElement>('#newDocumentButton')!;
const openFileButton = document.querySelector<HTMLButtonElement>('#openFileButton')!;
const downloadAlphaTexButton = document.querySelector<HTMLButtonElement>('#downloadAlphaTexButton')!;
const printButton = document.querySelector<HTMLButtonElement>('#printButton')!;
const fileInput = document.querySelector<HTMLInputElement>('#fileInput')!;
const previewViewport = document.querySelector<HTMLElement>('#previewViewport')!;
const alphaTabRoot = document.querySelector<HTMLElement>('#alphaTab')!;
const playPauseButton = document.querySelector<HTMLButtonElement>('#playPauseButton')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stopButton')!;
const timeLabel = document.querySelector<HTMLElement>('#timeLabel')!;
const timeline = document.querySelector<HTMLElement>('#timeline')!;
const timelineValue = document.querySelector<HTMLElement>('#timelineValue')!;
const speedSelect = document.querySelector<HTMLSelectElement>('#speedSelect')!;
const zoomSelect = document.querySelector<HTMLSelectElement>('#zoomSelect')!;
const layoutSelect = document.querySelector<HTMLSelectElement>('#layoutSelect')!;
const scrollSelect = document.querySelector<HTMLSelectElement>('#scrollSelect')!;
const editorElement = document.querySelector<HTMLElement>('#editor')!;
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));

const state = {
    api: null as alphaTab.AlphaTabApi | null,
    editor: null as monaco.editor.IStandaloneCodeEditor | null,
    split: null as SplitInstance | null,
    currentScore: null as alphaTab.model.Score | null,
    activeTrackIndexes: [] as number[],
    currentView: 'split' as ViewMode,
    renderTimer: 0,
    currentTimeInfo: null as alphaTab.synth.PositionChangedEventArgs | null,
    lastFileName: EXAMPLES.overture.fileName,
    shouldSyncEditorFromExternalLoad: false,
    lastSuccessfulCode: ''
};

const layoutModes = {
    page: alphaTab.LayoutMode.Page,
    parchment: alphaTab.LayoutMode.Parchment,
    horizontal: alphaTab.LayoutMode.Horizontal
} as const;

const scrollModes = {
    off: alphaTab.ScrollMode.Off,
    continuous: alphaTab.ScrollMode.Continuous,
    offscreen: alphaTab.ScrollMode.OffScreen,
    smooth: alphaTab.ScrollMode.Smooth
} as const;

void initialize();

async function initialize() {
    try {
        exampleSelect.value = readStorage(STORAGE_KEYS.example) ?? 'overture';
        setStatus('muted', '正在初始化', '加载编辑器与预览能力');
        setupSplit();
        setupPreview();
        await setupEditor();
        setupToolbar();
        setupTransport();
        setViewMode((readStorage(STORAGE_KEYS.view) as ViewMode | null) ?? 'split');
        loadInitialDocument();
    } catch (error) {
        setStatus('error', '初始化失败', getErrorMessage(error));
        diagnosticsList.innerHTML = `<li data-severity="error">${escapeHtml(getErrorMessage(error))}</li>`;
    }
}

function setupSplit() {
    state.split = Split(['#editorPane', '#previewPane'], {
        sizes: [46, 54],
        minSize: [0, 0],
        gutterSize: 10,
        snapOffset: 16,
        onDragEnd: () => {
            queuePreviewReflow();
            state.editor?.layout();
        }
    });
}

function setupPreview() {
    const api = new alphaTab.AlphaTabApi(alphaTabRoot, {
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
            scrollElement: previewViewport,
            enableCursor: true,
            enableUserInteraction: true,
            scrollMode: alphaTab.ScrollMode.Off
        }
    } satisfies alphaTab.json.SettingsJson);

    api.settings.exporter.comments = true;
    api.settings.exporter.indent = 2;

    api.renderStarted.on(() => {
        shell.classList.add('is-rendering');
        setStatus('rendering', '正在渲染预览', '新的乐谱布局正在生成');
    });

    api.renderFinished.on(() => {
        shell.classList.remove('is-rendering');
        if (state.currentScore) {
            const summary = `${state.currentScore.tracks.length} 个轨道 · ${state.currentScore.masterBars.length} 小节`;
            setStatus('ready', '预览已同步', summary);
            previewSummary.textContent = `保持上次成功结果，当前可视内容：${summary}`;
        } else {
            setStatus('ready', '预览已就绪', '可以开始编辑 AlphaTex');
        }
    });

    api.error.on(error => {
        shell.classList.remove('is-rendering');
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
            persistDocument(tex);
            state.editor.getModel()?.setValue(tex);
            state.editor.focus();
            setStatus('ready', '已导入外部文件', '已自动转换为 AlphaTex，可继续实时编辑');
        }
    });

    api.playerReady.on(() => {
        playPauseButton.disabled = false;
        stopButton.disabled = false;
    });

    api.playerStateChanged.on(args => {
        const isPlaying = args.state === alphaTab.synth.PlayerState.Playing;
        playPauseButton.textContent = isPlaying ? '⏸ 暂停' : '▶ 播放';
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

async function setupEditor() {
    await setupMonaco();
    defineMonacoTheme();

    const editor = monaco.editor.create(editorElement, {
        value: '',
        language: 'alphatex',
        theme: 'alphatex-workbench',
        automaticLayout: true,
        minimap: { enabled: false },
        smoothScrolling: true,
        fontSize: 15,
        lineHeight: 22,
        padding: { top: 18, bottom: 18 },
        scrollBeyondLastLine: false,
        roundedSelection: true,
        wordWrap: 'on',
        guides: {
            indentation: true
        }
    });

    editor.onDidChangeModelContent(() => {
        persistDocument(editor.getValue());
        scheduleRender();
    });

    monaco.editor.onDidChangeMarkers(() => {
        refreshDiagnostics();
    });

    await setupLspAlphaTexLanguageSupport(editor);
    state.editor = editor;
    refreshDiagnostics();
}

function setupToolbar() {
    newDocumentButton.addEventListener('click', () => {
        const currentExample = exampleSelect.value as ExampleId;
        loadExample(currentExample);
    });

    exampleSelect.addEventListener('change', () => {
        persistValue(STORAGE_KEYS.example, exampleSelect.value);
        loadExample(exampleSelect.value as ExampleId);
    });

    openFileButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
        const [file] = Array.from(fileInput.files ?? []);
        if (!file) {
            return;
        }

        state.lastFileName = file.name;
        const lowerFileName = file.name.toLowerCase();

        if (/(\.alphatex|\.atx|\.txt)$/.test(lowerFileName)) {
            const text = await file.text();
            state.editor?.getModel()?.setValue(text);
            setStatus('ready', '已加载文本文件', file.name);
        } else {
            const buffer = await file.arrayBuffer();
            state.shouldSyncEditorFromExternalLoad = true;
            state.api?.load(buffer);
            setStatus('rendering', '正在导入文件', file.name);
        }

        fileInput.value = '';
    });

    downloadAlphaTexButton.addEventListener('click', () => {
        const content = state.editor?.getValue() ?? '';
        const fallbackName = safeFileName(scoreTitle.textContent || 'untitled');
        const fileName = state.lastFileName.endsWith('.alphatex') ? state.lastFileName : `${fallbackName}.alphatex`;
        downloadBlob(fileName, new Blob([content], { type: 'text/plain;charset=utf-8' }));
    });

    printButton.addEventListener('click', () => {
        state.api?.print();
    });

    for (const button of viewButtons) {
        button.addEventListener('click', () => {
            setViewMode(button.dataset.view as ViewMode);
        });
    }
}

function setupTransport() {
    playPauseButton.addEventListener('click', () => {
        state.api?.playPause();
    });

    stopButton.addEventListener('click', () => {
        state.api?.stop();
    });

    speedSelect.addEventListener('change', () => {
        if (state.api) {
            state.api.playbackSpeed = Number.parseFloat(speedSelect.value);
        }
    });

    zoomSelect.addEventListener('change', () => {
        if (!state.api) {
            return;
        }

        state.api.settings.display.scale = Number.parseInt(zoomSelect.value, 10) / 100;
        state.api.updateSettings();
        state.api.render();
    });

    layoutSelect.addEventListener('change', () => {
        if (!state.api) {
            return;
        }

        state.api.settings.display.layoutMode = layoutModes[layoutSelect.value as keyof typeof layoutModes];
        state.api.updateSettings();
        state.api.render();
    });

    scrollSelect.addEventListener('change', () => {
        if (!state.api) {
            return;
        }

        state.api.settings.player.scrollMode = scrollModes[scrollSelect.value as keyof typeof scrollModes];
        state.api.updateSettings();
        state.api.render();
    });

    timeline.addEventListener('click', event => {
        if (!state.currentTimeInfo || !state.api) {
            return;
        }

        const rect = timeline.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        state.api.timePosition = Math.floor(state.currentTimeInfo.endTime * percent);
    });

    timeline.addEventListener('keydown', event => {
        if (!state.currentTimeInfo || !state.api) {
            return;
        }

        const step = Math.max(1_000, Math.floor(state.currentTimeInfo.endTime * 0.02));
        switch (event.key) {
            case 'ArrowLeft':
                event.preventDefault();
                state.api.timePosition = Math.max(0, state.api.timePosition - step);
                break;
            case 'ArrowRight':
                event.preventDefault();
                state.api.timePosition = Math.min(state.currentTimeInfo.endTime, state.api.timePosition + step);
                break;
        }
    });
}

function loadInitialDocument() {
    const storedDocument = readStorage(STORAGE_KEYS.document);
    if (storedDocument && state.editor) {
        state.editor.getModel()?.setValue(storedDocument);
        setStatus('ready', '已恢复上次文档', '继续上次编辑进度');
        return;
    }

    loadExample(exampleSelect.value as ExampleId);
}

function loadExample(exampleId: ExampleId) {
    const example = EXAMPLES[exampleId];
    state.lastFileName = example.fileName;
    scoreTitle.textContent = example.fileName;
    scoreSubtitle.textContent = example.subtitle;

    // Reset track selection so the new example starts fresh
    state.activeTrackIndexes = [];

    state.editor?.getModel()?.setValue(example.tex);
    state.editor?.focus();

    // Cancel any pending debounced render and trigger immediately.
    // setValue() fires onDidChangeModelContent which schedules a 220ms
    // debounced render — that causes the preview to lag behind the editor
    // when switching examples. We clear that timer and render right away.
    window.clearTimeout(state.renderTimer);
    setStatus('rendering', '正在加载示例', example.subtitle);
    void renderFromEditor();
}

function scheduleRender(delay = 220) {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(() => {
        void renderFromEditor();
    }, delay);
}

async function renderFromEditor() {
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

        // Only reuse the viewport for incremental edits (same content evolving).
        // When the content changes drastically (e.g. switching examples),
        // render from scratch so the preview fully reflects the new score.
        const isIncrementalEdit = state.lastSuccessfulCode.length > 0
            && tex.substring(0, 40) === state.lastSuccessfulCode.substring(0, 40);
        state.api.renderScore(score, state.activeTrackIndexes, {
            reuseViewport: isIncrementalEdit
        });
    } catch (error) {
        setStatus('error', '脚本暂时无法渲染', getErrorMessage(error));
    }
}

function renderTrackList(score: alphaTab.model.Score) {
    trackList.innerHTML = '';
    trackCount.textContent = String(score.tracks.length);

    if (score.tracks.length === 0) {
        trackList.innerHTML = '<p class="track-dock__empty">当前乐谱没有可用轨道。</p>';
        return;
    }

    for (const track of score.tracks) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'track-chip';
        if (state.activeTrackIndexes.includes(track.index)) {
            button.classList.add('is-active');
        }

        const trackKind = track.staves.some(staff => staff.isPercussion) ? 'Percussion' : 'Instrument';
        button.innerHTML = `<strong>${escapeHtml(track.name || `Track ${track.index + 1}`)}</strong><span>${trackKind} · #${track.index + 1}</span>`;
        button.addEventListener('click', () => {
            if (!state.currentScore || !state.api) {
                return;
            }

            if (state.activeTrackIndexes.includes(track.index)) {
                if (state.activeTrackIndexes.length === 1) {
                    return;
                }
                state.activeTrackIndexes = state.activeTrackIndexes.filter(index => index !== track.index);
            } else {
                state.activeTrackIndexes = [...state.activeTrackIndexes, track.index].sort((a, b) => a - b);
            }

            renderTrackList(state.currentScore);
            state.api.renderScore(state.currentScore, state.activeTrackIndexes, { reuseViewport: true });
        });
        trackList.appendChild(button);
    }
}

function updateScoreMeta(score: alphaTab.model.Score, fileName: string) {
    const resolvedTitle = score.title?.trim() || safeFileName(fileName.replace(/\.[^.]+$/, '')) || '未命名乐谱';
    const subtitleParts = [
        score.artist?.trim(),
        `${score.tracks.length} 个轨道`,
        `${score.masterBars.length} 小节`
    ].filter(Boolean);

    scoreTitle.textContent = resolvedTitle;
    scoreSubtitle.textContent = subtitleParts.join(' · ') || '实时编辑预览中';
}

function refreshDiagnostics() {
    const model = state.editor?.getModel();
    if (!model) {
        diagnosticsList.innerHTML = '<li class="diagnostics-list__empty">等待编辑器初始化。</li>';
        diagnosticCount.textContent = '0';
        return;
    }

    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
    diagnosticCount.textContent = String(markers.length);

    if (markers.length === 0) {
        diagnosticsList.innerHTML = '<li class="diagnostics-list__empty">暂无语法或诊断问题。</li>';
        return;
    }

    diagnosticsList.innerHTML = markers
        .slice(0, 6)
        .map(marker => {
            const severity = marker.severity === monaco.MarkerSeverity.Error ? 'error' : 'warning';
            const position = `L${marker.startLineNumber}:C${marker.startColumn}`;
            return `<li data-severity="${severity}"><strong>${position}</strong><br/>${escapeHtml(marker.message)}</li>`;
        })
        .join('');
}

function setViewMode(view: ViewMode) {
    state.currentView = view;
    workspace.dataset.view = view;
    persistValue(STORAGE_KEYS.view, view);

    for (const button of viewButtons) {
        button.classList.toggle('is-active', button.dataset.view === view);
    }

    switch (view) {
        case 'split':
            state.split?.setSizes([46, 54]);
            break;
        case 'editor':
            state.split?.setSizes([100, 0]);
            break;
        case 'preview':
            state.split?.setSizes([0, 100]);
            break;
    }

    state.editor?.layout();
    queuePreviewReflow();
}

function queuePreviewReflow() {
    window.setTimeout(() => {
        state.api?.render();
    }, 90);
}

function updateTimeline(currentTime: number, endTime: number) {
    const safeEnd = Number.isFinite(endTime) && endTime > 0 ? endTime : 0;
    const percent = safeEnd > 0 ? (currentTime / safeEnd) * 100 : 0;
    timelineValue.style.width = `${Math.min(100, Math.max(0, percent)).toFixed(2)}%`;
    timeLabel.textContent = `${formatTime(currentTime)} / ${formatTime(safeEnd)}`;
}

function normalizeTrackSelection(score: alphaTab.model.Score, trackIndexes: number[]) {
    const available = new Set(score.tracks.map(track => track.index));
    const normalized = trackIndexes.filter(index => available.has(index));
    return normalized.length > 0 ? normalized : score.tracks.map(track => track.index);
}

async function setupMonaco() {
    const host = self as typeof self & {
        MonacoEnvironment?: {
            getWorker: () => Worker;
        };
    };

    host.MonacoEnvironment = {
        getWorker() {
            return new editorWorker();
        }
    };

    const onigurumaWasm = await load<ArrayBuffer>(new URL('vscode-oniguruma/release/onig.wasm', import.meta.url), 'arraybuffer');
    const textMateSupport = addTextMateGrammarSupport(onigurumaWasm);
    await registerAlphaTexGrammar(textMateSupport);
}

async function setupLspAlphaTexLanguageSupport(editor: monaco.editor.IStandaloneCodeEditor) {
    await basicEditorLspIntegration(editor, new Worker(new URL('../../monaco/src/worker.ts', import.meta.url), {
        type: 'module'
    }), {
        logger: {
            error(message: string) {
                alphaTab.Logger.error('RealtimeEditor.LanguageServer', message);
            },
            info(message: string) {
                alphaTab.Logger.info('RealtimeEditor.LanguageServer', message);
            },
            log(message: string) {
                alphaTab.Logger.debug('RealtimeEditor.LanguageServer', message);
            },
            warn(message: string) {
                alphaTab.Logger.warning('RealtimeEditor.LanguageServer', message);
            }
        },
        clientInfo: {
            name: 'alphaTab Realtime Editor',
            version: '1.9.0'
        },
        languageId: 'alphatex'
    });
}

function defineMonacoTheme() {
    monaco.editor.defineTheme('alphatex-workbench', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'keyword', foreground: 'f1b75e' },
            { token: 'string', foreground: 'f5e6bf' },
            { token: 'number', foreground: '8dd8ff' }
        ],
        colors: {
            'editor.background': '#0b1020',
            'editor.lineHighlightBackground': '#131b33',
            'editor.foreground': '#f7f2e8',
            'editorCursor.foreground': '#8dd8ff',
            'editor.selectionBackground': '#27436c88',
            'editor.inactiveSelectionBackground': '#27436c44',
            'editorLineNumber.foreground': '#6f7a97',
            'editorLineNumber.activeForeground': '#f1b75e',
            'editorIndentGuide.background1': '#1f2740',
            'editorIndentGuide.activeBackground1': '#4d618d'
        }
    });
}

function setStatus(tone: StatusTone, title: string, subtitle?: string) {
    statusPill.dataset.tone = tone;
    statusPill.textContent = title;
    if (subtitle) {
        previewSummary.textContent = subtitle;
    }
}

function formatTime(milliseconds: number) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function persistDocument(content: string) {
    persistValue(STORAGE_KEYS.document, content);
}

function persistValue(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // ignore storage failures in private mode
    }
}

function readStorage(key: string) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeFileName(value: string) {
    return value.replace(/[^a-z0-9\-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'untitled';
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function escapeHtml(value: string) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function downloadBlob(fileName: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function load<T>(url: URL, type: XMLHttpRequest['responseType']): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.onload = () => {
            resolve(request.response);
        };
        request.onerror = error => {
            reject(error);
        };
        request.open('GET', url);
        request.responseType = type;
        request.send();
    });
}
