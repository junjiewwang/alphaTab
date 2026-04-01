import type * as alphaTab from '@coderline/alphatab';
import type * as monaco from 'monaco-editor';
import type Split from 'split.js';

export type ViewMode = 'split' | 'editor' | 'preview';
export type StatusTone = 'ready' | 'rendering' | 'error' | 'warning' | 'muted';
export type ExampleId = 'overture' | 'fingerstyle' | 'swing';
export type SplitInstance = ReturnType<typeof Split>;
export type DocumentSourceKind = 'new' | 'text-file' | 'imported-file' | 'example' | 'restored';

export type ExampleDefinition = {
    fileName: string;
    subtitle: string;
    tex: string;
};

export type WorkspaceDocumentSnapshot = {
    id: string;
    displayName: string;
    sourceKind: DocumentSourceKind;
    content: string;
    savedContent: string;
    isDirty: boolean;
    activeTrackIndexes: number[];
    lastSuccessfulCode: string;
    scoreTitle: string;
    scoreSubtitle: string;
};

export type WorkspaceSnapshot = {
    version: 1;
    activeDocumentId: string | null;
    documents: WorkspaceDocumentSnapshot[];
};

export type WorkspaceDocument = WorkspaceDocumentSnapshot & {
    model: monaco.editor.ITextModel;
    currentScore: alphaTab.model.Score | null;
    currentTimeInfo: alphaTab.synth.PositionChangedEventArgs | null;
};

export type PendingImportRequest = {
    documentId: string;
    fileName: string;
    resolve: () => void;
    reject: (error: unknown) => void;
};

export type PendingRenderStatus = {
    tone: StatusTone;
    title: string;
    subtitle?: string;
};

export type AppState = {
    api: alphaTab.AlphaTabApi | null;
    editor: monaco.editor.IStandaloneCodeEditor | null;
    split: SplitInstance | null;
    documents: Map<string, WorkspaceDocument>;
    documentOrder: string[];
    activeDocumentId: string | null;
    renderedDocumentId: string | null;
    currentView: ViewMode;
    renderTimer: number;
    pendingImportRequest: PendingImportRequest | null;
    pendingRenderDocumentId: string | null;
    pendingRenderStatus: PendingRenderStatus | null;
    suspendDocumentChangeHandling: boolean;
};
