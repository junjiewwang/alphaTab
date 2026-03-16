declare module 'split.js' {
    export interface SplitOptions {
        sizes?: number[];
        minSize?: number | number[];
        maxSize?: number | number[];
        expandToMin?: boolean;
        gutterSize?: number;
        snapOffset?: number;
        dragInterval?: number;
        direction?: 'horizontal' | 'vertical';
        cursor?: string;
        onDrag?: (sizes: number[]) => void;
        onDragStart?: (sizes: number[]) => void;
        onDragEnd?: (sizes: number[]) => void;
    }

    export interface SplitInstance {
        setSizes(sizes: number[]): void;
        getSizes(): number[];
        collapse(index: number): void;
        destroy(preserveStyles?: boolean, preserveGutter?: boolean): void;
    }

    export default function Split(elements: Array<string | HTMLElement>, options?: SplitOptions): SplitInstance;
}
