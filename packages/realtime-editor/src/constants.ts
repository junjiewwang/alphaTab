import * as alphaTab from '@coderline/alphatab';
import type { ExampleDefinition, ExampleId } from './types';

export const STORAGE_KEYS = {
    document: 'alphatab.realtime-editor.document',
    view: 'alphatab.realtime-editor.view',
    example: 'alphatab.realtime-editor.example'
} as const;

export const EXAMPLES: Record<ExampleId, ExampleDefinition> = {
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

/**
 * 新建文档时使用的最小可用模板
 * 提供一个可渲染的起点，让预览面板不会报错
 */
export const NEW_DOCUMENT_TEMPLATE = String.raw`\title "New Score"
\tempo 120
.
:4 1.1 1.1 1.1 1.1 |
`;

export const LAYOUT_MODES = {
    page: alphaTab.LayoutMode.Page,
    parchment: alphaTab.LayoutMode.Parchment,
    horizontal: alphaTab.LayoutMode.Horizontal
} as const;

export const SCROLL_MODES = {
    off: alphaTab.ScrollMode.Off,
    continuous: alphaTab.ScrollMode.Continuous,
    offscreen: alphaTab.ScrollMode.OffScreen,
    smooth: alphaTab.ScrollMode.Smooth
} as const;
