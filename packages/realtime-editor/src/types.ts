import type * as alphaTab from '@coderline/alphatab';
import type * as monaco from 'monaco-editor';
import type Split from 'split.js';

export type ViewMode = 'split' | 'editor' | 'preview';
export type StatusTone = 'ready' | 'rendering' | 'error' | 'warning' | 'muted';
export type ExampleId = 'overture' | 'fingerstyle' | 'swing';
export type SplitInstance = ReturnType<typeof Split>;

export type ExampleDefinition = {
    fileName: string;
    subtitle: string;
    tex: string;
};

export type AppState = {
    api: alphaTab.AlphaTabApi | null;
    editor: monaco.editor.IStandaloneCodeEditor | null;
    split: SplitInstance | null;
    currentScore: alphaTab.model.Score | null;
    activeTrackIndexes: number[];
    currentView: ViewMode;
    renderTimer: number;
    currentTimeInfo: alphaTab.synth.PositionChangedEventArgs | null;
    lastFileName: string;
    shouldSyncEditorFromExternalLoad: boolean;
    lastSuccessfulCode: string;
};
