/**
 * AlphaTex 脚本格式化器。
 *
 * 格式化规则：
 *   1. 缩进使用 2 空格
 *   2. 按小节分组换行：每 4 小节一行，空行作为段落分隔保留
 *   3. 音符间保持单个空格
 *   4. {属性块} 内部空格原样保留
 *
 * 架构：
 *   纯字符串处理（不依赖 AlphaTexImporter AST），
 *   通过正则分行和分类，按缩进层级和小节密度重组输出。
 */

/** 每行容纳的小节数（可配置） */
const BARS_PER_LINE = 4;
/** 每级缩进的空间数 */
const INDENT_SIZE = 2;

// ─── 类型定义 ──────────────────────────────────────────────

/** 行分类 */
const LineKind = {
    Empty: 0,
    Comment: 1,
    Command: 2,
    Content: 3
} as const;
type LineKind = (typeof LineKind)[keyof typeof LineKind];

/** 命令行缩进层级表：startsWith → indent level */
const COMMAND_INDENT_MAP: [string, number][] = [
    ['\\track', 0],
    ['\\staff', 1],
    ['\\tuning', 1],
    ['\\ts', 0],
    ['\\tempo', 0],
    ['\\title', 0],
    ['\\subtitle', 0],
    ['\\artist', 0],
    ['\\album', 0],
    ['\\words', 0],
    ['\\music', 0],
    ['\\copyright', 0],
    ['\\ic', 0],
    ['\\ro', 1],
    ['\\ks', 0],
    ['\\capo', 1],
    ['\\instrument', 1],
    ['\\mix', 0],
    ['\\rp', 0],
    ['\\sp', 0],
    ['\\chord', 0],
    ['\\ac', 0],
    ['\\lyrics', 1],
    ['\\stave', 1]
];

// ─── 公开 API ──────────────────────────────────────────────

/**
 * 格式化 AlphaTex 脚本文本。
 * @param input 原始 AlphaTex 文本
 * @returns 格式化后的文本
 */
export function formatAlphaTex(input: string): string {
    const rawLines = splitLines(input);
    const lines = rawLines.map(raw => ({ raw, trimmed: raw.trim() }));

    const result: string[] = [];
    // 当前段落内暂存的 bar 内容，积累到 BARS_PER_LINE 再写入
    let barBuffer: string[] = [];
    let indentLevel = 0;

    function flushBarBuffer(): void {
        if (barBuffer.length === 0) {
            return;
        }
        const prefix = ' '.repeat(indentLevel * INDENT_SIZE);
        result.push(`${prefix}${barBuffer.join(' |')} |`);
        barBuffer = [];
    }

    for (let i = 0; i < lines.length; i++) {
        const { trimmed } = lines[i];
        const kind = classifyLine(trimmed);

        switch (kind) {
            case LineKind.Empty:
                flushBarBuffer();
                result.push('');
                break;

            case LineKind.Comment:
                flushBarBuffer();
                result.push(' '.repeat(indentLevel * INDENT_SIZE) + trimmed);
                break;

            case LineKind.Command:
                flushBarBuffer();
                indentLevel = computeCommandIndent(trimmed);
                result.push(' '.repeat(indentLevel * INDENT_SIZE) + trimmed);
                break;

            case LineKind.Content: {
                // 解析当前行的 bar 内容
                const bars = extractBars(trimmed);
                for (const bar of bars) {
                    barBuffer.push(` ${bar}`);
                    if (barBuffer.length >= BARS_PER_LINE) {
                        flushBarBuffer();
                    }
                }
                break;
            }
        }
    }

    // 最后一段不足 barsPerLine 的也写入
    flushBarBuffer();

    // 清理末尾多余空行
    while (result.length > 0 && result[result.length - 1] === '') {
        result.pop();
    }

    return `${result.join('\n')}\n`;
}

// ─── 内部辅助函数 ──────────────────────────────────────────

/** 统一换行符为 \n，按行拆分 */
function splitLines(input: string): string[] {
    return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/** 判断一行文本的分类 */
function classifyLine(line: string): LineKind {
    if (line === '') {
        return LineKind.Empty;
    }
    if (line.startsWith('//') || line.startsWith('/*')) {
        return LineKind.Comment;
    }
    if (line.startsWith('\\')) {
        return LineKind.Command;
    }
    return LineKind.Content;
}

/** 根据命令名返回缩进层级 */
function computeCommandIndent(line: string): number {
    const lower = line.toLowerCase();
    for (const [prefix, indent] of COMMAND_INDENT_MAP) {
        if (lower.startsWith(prefix)) {
            return indent;
        }
    }
    // 未知命令默认缩进 0
    return 0;
}

/**
 * 从一行中提取小节内容。
 * 以 `|` 分隔，每段折叠多余空格。
 * 处理注：`|` 可能出现在字符串字面量中（如 {txt "a|b"}），
 * 这里用简单策略兼容：检测 `"` 配对后再按 `|` 分割。
 */
function extractBars(line: string): string[] {
    const bars: string[] = [];
    let current = '';
    let inString = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inString = !inString;
            current += ch;
        } else if (ch === '|' && !inString) {
            const trimmed = current.trim().replace(/\s+/g, ' ');
            if (trimmed.length > 0) {
                bars.push(trimmed);
            }
            current = '';
        } else {
            current += ch;
        }
    }

    // 尾部残余（不含 | 的部分，可能是不完整小节）
    const trimmed = current.trim().replace(/\s+/g, ' ');
    if (trimmed.length > 0) {
        bars.push(trimmed);
    }

    return bars;
}
