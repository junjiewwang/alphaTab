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

/**
 * 用户文档备份：进入示例预览模式前保存的用户编辑快照
 */
export type UserDocumentBackup = {
    /** 编辑器内容 */
    content: string;
    /** 文件名 */
    fileName: string;
    /** 乐谱标题 */
    scoreTitle: string;
    /** 乐谱副标题 */
    scoreSubtitle: string;
    /** 活跃轨道索引 */
    activeTrackIndexes: number[];
    /** 上次成功渲染的代码 */
    lastSuccessfulCode: string;
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
    /** 是否处于示例预览模式 */
    isExamplePreview: boolean;
    /** 当前预览的示例 ID */
    previewingExampleId: ExampleId | null;
    /** 用户文档备份（进入示例预览前保存） */
    userDocumentBackup: UserDocumentBackup | null;
};
