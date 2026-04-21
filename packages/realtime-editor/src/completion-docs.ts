/**
 * Completion & hover documentation enhancer.
 *
 * Responsibility: given a symbol label (either a command like `\chord`
 * or a property like `showDiagram`), look up its definition from the
 * upstream `@coderline/alphatab-alphatex/definitions` data and render
 * an enriched Markdown card that includes:
 *
 *   1. Short + long description (from `WithDescription`)
 *   2. Syntax overloads (from `signatures[].parameters`)
 *   3. Parameters table with type / required / default / enum values
 *   4. Code examples (from `examples`) wrapped in alphatex code fences
 *
 * Upstream `packages/lsp/src/server/hover.ts` only emits description +
 * syntax + parameters table in hover, and upstream completion emits
 * only `longDescription`. Examples are never surfaced. This module
 * fills that gap without touching upstream code — it is consumed by the
 * monkey-patched completion / hover providers in `editor.ts`.
 *
 * Design notes:
 *   - Pure data-driven: no hard-coded text about specific commands.
 *   - Fault-tolerant: `findDefinitionByLabel` returns `undefined` when
 *     the label is unknown so callers can preserve upstream behaviour.
 *   - English output: intentionally matches upstream description
 *     language for consistency.
 */

import * as alphaTab from '@coderline/alphatab';
import {
    allMetadata,
    barMetaData,
    beatProperties,
    durationChangeProperties,
    noteProperties
} from '@coderline/alphatab-alphatex/definitions';
import type {
    AlphaTexExample,
    MetadataTagDefinition,
    ParameterDefinition,
    ParameterValueDefinition,
    PropertyDefinition,
    SignatureDefinition,
    WithSignatures
} from '@coderline/alphatab-alphatex/types';
import type * as monaco from 'monaco-editor';

// ─── Types ───────────────────────────────────────────────────────────

/**
 * The structural context detected at a cursor position.
 *
 * - `command`: top-level position where `\xxx` metadata tags apply.
 * - `inside-braces`: cursor is inside a `{}` property block (e.g. `\chord (...) {|}`).
 * - `inside-parens`: cursor is inside a `()` argument list (e.g. note block).
 */
export type DefinitionContextKind = 'command' | 'inside-braces' | 'inside-parens';

/**
 * Result of {@link detectDefinitionContext}. Carries both the context
 * kind and the nearest owning command (for property resolution).
 */
export interface DefinitionContext {
    kind: DefinitionContextKind;
    /**
     * The nearest enclosing command tag (e.g. `\chord`) when
     * `kind === 'inside-braces'`. Used to resolve property definitions
     * scoped to a particular command via `metadata.properties`.
     */
    nearestCommand?: string;
}

// ─── Context detection ──────────────────────────────────────────────

/**
 * Detect structural context at the given cursor position within the
 * current line, and — when inside `{}` — identify the owning command.
 *
 * Limitations (by design):
 *   - Single-line scan. AlphaTex property blocks are almost always on
 *     the same line as their owning command, so this covers >95% of
 *     real usage. Multi-line cases gracefully degrade to `command`.
 *   - Does not account for string literals (`"..."`) — a `{` inside a
 *     quoted string would be miscounted. Acceptable trade-off for
 *     simplicity; the worst case is a missed documentation enrichment,
 *     not a crash.
 */
export function detectDefinitionContext(
    model: monaco.editor.ITextModel,
    position: monaco.Position
): DefinitionContext {
    const lineContent = model.getLineContent(position.lineNumber);

    let braceDepth = 0;
    let parenDepth = 0;

    for (let i = position.column - 2; i >= 0; i--) {
        const ch = lineContent[i];
        if (ch === '}') {
            braceDepth++;
        } else if (ch === '{') {
            if (braceDepth === 0) {
                // Found the opening brace — now scan further back to find
                // the nearest command tag (e.g. `\chord`) that owns this `{}`.
                const nearestCommand = findNearestCommand(lineContent, i - 1);
                return { kind: 'inside-braces', nearestCommand };
            }
            braceDepth--;
        } else if (ch === ')') {
            parenDepth++;
        } else if (ch === '(') {
            if (parenDepth === 0) {
                const nearestCommand = findNearestCommand(lineContent, i - 1);
                return { kind: 'inside-parens', nearestCommand };
            }
            parenDepth--;
        }
    }

    return { kind: 'command' };
}

/**
 * Scan backwards from `startIdx` to find the nearest `\xxx` command tag.
 * Used to associate a property context with its owning command.
 */
function findNearestCommand(lineContent: string, startIdx: number): string | undefined {
    // Walk back until we find a `\` preceded by whitespace or start-of-line.
    for (let i = startIdx; i >= 0; i--) {
        if (lineContent[i] === '\\') {
            // Read the command identifier (letters only)
            let end = i + 1;
            while (end < lineContent.length && /[A-Za-z]/.test(lineContent[end])) {
                end++;
            }
            if (end > i + 1) {
                return lineContent.substring(i, end);
            }
        }
    }
    return undefined;
}

// ─── Definition lookup ──────────────────────────────────────────────

/**
 * Look up a metadata tag definition (command) by its label (e.g. `\chord`).
 * Label is case-insensitive on the identifier portion.
 */
function findMetadataByTag(tag: string): MetadataTagDefinition | undefined {
    const normalized = tag.startsWith('\\') ? tag : `\\${tag}`;
    // `allMetadata` keys are stored with the leading backslash; see definitions.ts.
    // Keys may be lowercase; upstream `metadata()` uses the tag as-is. Try both.
    return allMetadata.get(normalized) ?? allMetadata.get(normalized.toLowerCase());
}

/**
 * Look up a property definition by label, scoped to the nearest owning command.
 *
 * Resolution order:
 *   1. `metadata.properties` of the nearest command (e.g. `\chord`'s properties)
 *   2. `beatProperties` (beat-level properties like `f`, `d`, `gr`)
 *   3. `noteProperties` (note-level properties like `h`, `b`, `sl`)
 *   4. `durationChangeProperties` (tuplet properties like `tu`)
 *   5. `barMetaData.*.properties` (bar-level metadata properties)
 *
 * Lowercasing is applied since property maps are keyed by lowercase ids.
 */
function findPropertyByLabel(
    label: string,
    nearestCommand: string | undefined
): PropertyDefinition | undefined {
    const key = label.toLowerCase();

    // 1. Command-scoped properties (e.g. `\chord` → firstFret/showDiagram/...)
    if (nearestCommand) {
        const owner = findMetadataByTag(nearestCommand);
        const scoped = owner?.properties?.get(key);
        if (scoped) {
            return scoped;
        }
    }

    // 2-4. Fall back to the global property buckets.
    return (
        beatProperties.get(key) ??
        noteProperties.get(key) ??
        durationChangeProperties.get(key) ??
        findBarScopedProperty(key)
    );
}

/**
 * Walk `barMetaData` looking for a property matching the given lowercase key.
 * Some bar-level metadata (e.g. `\ks`) expose sub-properties via
 * `metadata.properties`, and completions for those are only discoverable
 * through their owning tag. This fallback covers cases where the nearest
 * command wasn't detected (e.g. multi-line property block).
 */
function findBarScopedProperty(key: string): PropertyDefinition | undefined {
    for (const metadata of barMetaData.values()) {
        const prop = metadata.properties?.get(key);
        if (prop) {
            return prop;
        }
    }
    return undefined;
}

/**
 * Resolve a completion / hover label to its upstream definition.
 * Returns `undefined` when the label is unknown (caller should leave
 * upstream documentation untouched).
 */
export function findDefinitionByLabel(
    label: string,
    context: DefinitionContext
): WithSignatures | undefined {
    if (!label) {
        return undefined;
    }

    // Commands start with `\` — resolve via allMetadata.
    if (label.startsWith('\\')) {
        return findMetadataByTag(label);
    }

    // Bare identifiers are treated as properties. Use context to narrow scope.
    return findPropertyByLabel(label, context.nearestCommand);
}

// ─── Markdown rendering ─────────────────────────────────────────────

/**
 * Render a full Markdown help card for a definition.
 *
 * Sections (all optional, skipped when data is missing):
 *   - Description (short + long)
 *   - Syntax overloads (one code block per signature)
 *   - Parameters table (with type / required / default / enum hint)
 *   - Values list (only for properties with enumerated values)
 *   - Examples (one alphatex code block per example)
 *   - Deprecated / remarks callout
 */
export function renderDefinitionMarkdown(def: WithSignatures): string {
    const displayName = getDisplayName(def);
    const sections: string[] = [];

    // Header: short description as H4 for Monaco's compact doc panel.
    if (def.shortDescription) {
        sections.push(`**${escapeMarkdown(def.shortDescription)}**`);
    }

    // Long description (rendered as plain paragraphs).
    if (def.longDescription && def.longDescription !== def.shortDescription) {
        sections.push(def.longDescription.trim());
    }

    // Deprecated callout.
    if (def.deprecated) {
        sections.push(`> ⚠ **Deprecated:** ${def.deprecated}`);
    }

    const syntaxBlock = renderSyntaxBlock(displayName, def.signatures);
    if (syntaxBlock) {
        sections.push(syntaxBlock);
    }

    const parametersBlock = renderParametersBlock(def.signatures);
    if (parametersBlock) {
        sections.push(parametersBlock);
    }

    const valuesBlock = renderValuesBlock(def.signatures);
    if (valuesBlock) {
        sections.push(valuesBlock);
    }

    const examplesBlock = renderExamplesBlock(def.examples);
    if (examplesBlock) {
        sections.push(examplesBlock);
    }

    if (def.remarks) {
        sections.push(`**Remarks:** ${def.remarks.trim()}`);
    }

    return sections.join('\n\n');
}

/**
 * Render just the examples section (used by the hover enricher, which
 * wants to append examples to upstream hover content without duplicating
 * the description / syntax / parameters that upstream already renders).
 */
export function renderExamplesOnly(def: WithSignatures): string | undefined {
    return renderExamplesBlock(def.examples);
}

/**
 * Type alias for the range field of a Monaco completion item.
 *
 * Monaco accepts either a single `IRange` or an `IInsertReplaceRange`
 * (`CompletionItemRanges`) with separate insert/replace sub-ranges.
 * We expose the union so callers can pass whichever they built —
 * `editor.ts` now uses `CompletionItemRanges` to prevent the default
 * wordPattern-based replace-range derivation from swallowing the
 * leading `{` / `\` character in AlphaTex.
 */
export type CompletionRange = monaco.IRange | monaco.languages.CompletionItemRanges;

// ─── Property-value context analysis ────────────────────────────────

/**
 * Context detected inside a `{}` property block or a `()` argument list,
 * used to **fully rewrite** the completion list when upstream LSP would
 * otherwise return noise (all property names + all values mashed
 * together, or no relevant suggestions at all).
 *
 * - `property-value`: cursor is positioned where a value for the current
 *   property is expected in whitespace form (e.g. `{showName ❘}` or
 *   `{showName tr❘ue}`). Completions should list only the candidate
 *   values of `currentProperty`.
 * - `property-name`: cursor is positioned where a new property name is
 *   expected (e.g. `{❘}` at the start, or `{showName true ❘}` after the
 *   previous property has consumed all its parameters). Completions
 *   should list only the property names of `nearestCommand`.
 * - `paren-value`: cursor is inside a `()` argument list — either at
 *   the top level (`\chord (❘)`, `\chord ("Am" 1 ❘)`) or nested inside
 *   a property block (`{barre (1 ❘)}`, `{showDiagram(❘)}`). Completions
 *   should list candidates for the specific parameter slot the cursor
 *   is about to fill, derived from `owner.signatures[*].parameters[valueIndex]`.
 * - `none`: cursor is not inside a recognized property-block position;
 *   caller should fall back to upstream behaviour.
 */
export interface PropertyCompletionContext {
    kind: 'property-value' | 'property-name' | 'paren-value' | 'none';
    /**
     * The nearest owning command tag (e.g. `\chord`). Present for `{}`
     * contexts that are attached to a metadata command. **Absent** for
     * beat-property blocks like `(0.1 2.3){ch "Am"}` which have no
     * leading `\xxx` command — those blocks resolve their property
     * scope from {@link propertiesScope} instead.
     */
    nearestCommand?: string;
    /**
     * The property map that governs which identifiers may appear as
     * property names inside this brace block. Callers use this map both
     * during state-machine tokenization (to resolve `propName`) and
     * when building completion items (the {@link buildPropertyNameCompletions}
     * now reads this scope directly rather than re-deriving it from
     * `nearestCommand`, so beat-property blocks work uniformly).
     *
     * Populated for `property-name` and `property-value` contexts.
     */
    propertiesScope?: Map<string, PropertyDefinition>;
    /**
     * When `kind === 'property-value'`, the property definition whose values
     * should be suggested. Lowercase property-key lookup already done.
     */
    currentProperty?: PropertyDefinition;
    /**
     * When `kind === 'property-value'` or `kind === 'paren-value'`, the
     * 0-based index of the value slot that the cursor is about to fill.
     * For `paren-value` this drives the per-slot parameter lookup.
     */
    valueIndex?: number;
    /**
     * When `kind === 'paren-value'`, the owner definition whose parameters
     * govern the candidate list. Either a `MetadataTagDefinition` (top-level
     * command) or a `PropertyDefinition` (nested inside `{}`).
     */
    parenOwner?: WithSignatures;
    /**
     * When `kind === 'property-value'` or `kind === 'paren-value'`,
     * indicates whether the cursor is positioned **inside an unclosed
     * quoted string** (e.g. `{ch "❘"}` or `\chord ("A❘m" …)`). Caller
     * needs this to decide whether to inject string-valued candidates
     * (like the list of declared chord names) that must *not* include
     * surrounding quotes — the quotes are already typed by the user.
     *
     * Set to `true` when the containing scope's scan encounters an
     * opening quote (`"` or `'`) that remains unclosed before the cursor.
     */
    insideQuote?: boolean;
}

/**
 * Analyze the cursor position to decide whether we should take over the
 * completion list with local property-name / property-value / paren-value
 * candidates.
 *
 * Strategy (single-line scan for simplicity, matching existing
 * {@link detectDefinitionContext}):
 *
 *   1. Find the cursor's innermost enclosing scope opener — either `(`
 *      or `{`, whichever is nearer without crossing a matching closer.
 *   2. If `(` is innermost → resolve as `paren-value` context:
 *        - Look up the identifier immediately before `(`. When prefixed
 *          with `\` it's a command (`\chord`), otherwise it's a property
 *          name that must live in the outer `{...}` owner's properties.
 *        - Tokenize what's already inside the parens to compute
 *          `valueIndex`.
 *   3. If `{` is innermost → fall back to the existing property-block
 *      analysis (unchanged behaviour).
 *   4. Neither → `kind: 'none'`.
 */
export function analyzePropertyValueContext(
    model: monaco.editor.ITextModel,
    position: monaco.Position
): PropertyCompletionContext {
    const lineContent = model.getLineContent(position.lineNumber);
    const cursorIdx = position.column - 1; // 0-based index of the cursor

    // --- Step 1: locate the innermost enclosing scope. ---
    const scope = findInnermostOpenScope(lineContent, cursorIdx);
    if (!scope) {
        return { kind: 'none' };
    }

    if (scope.kind === 'paren') {
        return analyzeParenValueContext(lineContent, cursorIdx, scope.index);
    }

    return analyzeBraceContext(lineContent, cursorIdx, scope.index);
}

/**
 * Resolve the paren-value completion context when cursor is inside `()`.
 *
 * Owner resolution rules:
 *   - Identifier before `(` starts with `\` → top-level command call
 *     (e.g. `\chord (❘)`). Owner is `allMetadata.get(tag)`.
 *   - Identifier before `(` is a bare word AND we're inside a surrounding
 *     `{}` → nested property call (e.g. `{barre(❘)}`). Owner resolves
 *     through the enclosing command's `properties` map.
 *   - Anything else → `kind: 'none'` (degrade to upstream).
 */
function analyzeParenValueContext(
    lineContent: string,
    cursorIdx: number,
    openParenIdx: number
): PropertyCompletionContext {
    // Read the identifier directly preceding `(` (may have trailing whitespace).
    let end = openParenIdx;
    while (end > 0 && /\s/.test(lineContent[end - 1])) {
        end--;
    }
    let start = end;
    while (start > 0 && /[\\A-Za-z]/.test(lineContent[start - 1])) {
        start--;
    }
    const ident = lineContent.substring(start, end);
    if (!ident) {
        return { kind: 'none' };
    }

    // Resolve owner: command vs. property-within-braces.
    let owner: WithSignatures | undefined;
    let nearestCommand: string | undefined;

    if (ident.startsWith('\\')) {
        owner = findMetadataByTag(ident);
        nearestCommand = ident;
    } else {
        // Must be inside a `{...}` whose owning command has this property.
        const braceIdx = findEnclosingOpenBrace(lineContent, openParenIdx);
        if (braceIdx < 0) {
            return { kind: 'none' };
        }
        nearestCommand = findNearestCommand(lineContent, braceIdx - 1);
        owner = findPropertyByLabel(ident, nearestCommand);
    }

    if (!owner) {
        return { kind: 'none' };
    }

    // Count value slots already filled inside the parens to derive valueIndex.
    const inner = lineContent.substring(openParenIdx + 1, cursorIdx);
    const { tokens, trailingOpen, insideQuote } = tokenizeParenBody(inner);
    // `trailingOpen` means cursor is glued to the last token — that
    // token *is* what the user is currently typing, so the effective
    // slot is still `tokens.length - 1`.
    const valueIndex = trailingOpen ? Math.max(0, tokens.length - 1) : tokens.length;

    return {
        kind: 'paren-value',
        nearestCommand,
        parenOwner: owner,
        valueIndex,
        insideQuote
    };
}

/**
 * Resolve the property scope for a `{}` block.
 *
 * The scope decides which identifiers are valid **property names** inside
 * the braces. Two shapes are supported:
 *
 * 1. **Command-scoped block** — `\chord (…) {firstFret(3) showDiagram}`
 *    The braces are preceded by a metadata tag; properties come from
 *    `owner.properties`.
 *
 * 2. **Beat-property block** — `(0.1 1.2){ch "Am" dy ppp}`
 *    The braces hang off a beat (no `\xxx` prefix); properties come
 *    from the global `beatProperties` map.
 *
 * Rationale for the fallback (Q = b, 宽松策略): any `{}` without a
 * detectable enclosing command is overwhelmingly a beat-property block
 * in real scores, and surfacing beat-property candidates there is
 * strictly more useful than returning `none` (which degrades to an empty
 * "No suggestions" popup). Edge cases like stray `{}` tokens gracefully
 * show the beat-property list — harmless noise, not a correctness bug.
 */
function resolveBracePropertyScope(
    nearestCommand: string | undefined
): Map<string, PropertyDefinition> | undefined {
    if (nearestCommand) {
        const owner = findMetadataByTag(nearestCommand);
        if (owner?.properties && owner.properties.size > 0) {
            return owner.properties;
        }
        // Command exists but declares no properties — do not fall back
        // silently, that would mask a genuine "no candidates" state.
        return undefined;
    }
    // No enclosing command → this is a beat-property block.
    return beatProperties;
}

/**
 * Existing property-block analysis, now generalized to handle both
 * command-scoped (`\chord (…) {…}`) and beat-property (`(…){…}`) blocks
 * through {@link resolveBracePropertyScope}.
 */
function analyzeBraceContext(
    lineContent: string,
    cursorIdx: number,
    openBraceIdx: number
): PropertyCompletionContext {
    // --- Step 2: resolve the property scope (command-based or beat-based). ---
    const nearestCommand = findNearestCommand(lineContent, openBraceIdx - 1);
    const propertiesScope = resolveBracePropertyScope(nearestCommand);
    if (!propertiesScope) {
        return { kind: 'none' };
    }

    // --- Step 3: tokenize from `{` (exclusive) up to the cursor. ---
    const inner = lineContent.substring(openBraceIdx + 1, cursorIdx);
    const { tokens, trailingOpen, insideQuote } = tokenizePropertyBlock(inner);

    // --- Step 4: state-machine walk. ---
    //
    // 关键：最后一个 token 是否与光标"粘连"（即 `trailingOpen=true` 且
    // 该 token 就是 tokens[tokens.length-1]）决定了我们对它的容错态度：
    //
    //   - 已闭合 token（中间的、由 whitespace/`)` flush 掉的）必须是
    //     合法 property 名或 value，否则文本确实无效，bail `none`
    //     避免把错误上下文误导成补全候选。
    //   - **尾部 open token**（trailing）是用户正在键入的前缀，形如
    //     `{barre(1) firstFret(2) s❘}` 的 `s`、`{sh❘}` 的 `sh`。这类
    //     token 故意**不要求**命中已定义 property —— 它只是前缀，应当
    //     让 Monaco 拿到完整 property-name 列表后用自带的模糊匹配
    //     过滤（`s` → `showDiagram/showFingering/showName`）。
    //
    // 先前实现在上面这种"合法前缀"场景下 bail `none` → UI 显示
    // "No suggestions"，表现为"有空格触发正常、紧接字符触发失败"。
    const trailingTokenIdx =
        trailingOpen && tokens.length > 0 ? tokens.length - 1 : -1;

    let currentProperty: PropertyDefinition | undefined;
    let currentMaxParams = 0;
    let consumedValues = 0;

    for (let idx = 0; idx < tokens.length; idx++) {
        const token = tokens[idx];
        if (token === ARGS_CLOSED_SENTINEL) {
            // `propName(args)` was already tokenized as [propName, sentinel].
            // The preceding iteration resolved `currentProperty`; now mark
            // all of its value slots as supplied so the walk expects the
            // next property name.
            if (currentProperty) {
                consumedValues = currentMaxParams;
            }
            // A stray sentinel without a preceding property is a parse
            // artifact (e.g. `{() foo}`) — just skip it.
            continue;
        }
        const isTrailingToken = idx === trailingTokenIdx;
        if (!currentProperty || consumedValues >= currentMaxParams) {
            // Expecting a property name.
            const def = propertiesScope.get(token.toLowerCase());
            if (!def) {
                if (isTrailingToken) {
                    // 尾部前缀不匹配任何已知 property —— 这是合法的
                    // "正在键入 property 名"状态。直接短路返回
                    // property-name 上下文（让 Monaco 拿完整列表 +
                    // 前缀模糊过滤处理）。
                    //
                    // 关键：不能落到 Step 5 来推导 —— 此时
                    // `currentProperty` 可能是上一个刚闭合的 property
                    // （consumedValues=max），Step 5 会把它误判成
                    // property-value 分支。
                    return { kind: 'property-name', nearestCommand, propertiesScope };
                }
                // 已闭合 token 仍然要求合法 —— 否则上下文真的不可知。
                return { kind: 'none' };
            }
            currentProperty = def;
            currentMaxParams = computeMaxParameterCount(def);
            consumedValues = 0;
        } else {
            // Consume a value token.
            consumedValues++;
        }
    }

    // --- Step 5: decide the current cursor state. ---
    if (trailingOpen) {
        if (tokens.length === 0) {
            return { kind: 'property-name', nearestCommand, propertiesScope };
        }
        if (currentProperty && consumedValues === 0) {
            return { kind: 'property-name', nearestCommand, propertiesScope };
        }
        if (currentProperty) {
            return {
                kind: 'property-value',
                nearestCommand,
                propertiesScope,
                currentProperty,
                valueIndex: consumedValues - 1,
                insideQuote
            };
        }
        return { kind: 'property-name', nearestCommand, propertiesScope };
    }

    // Cursor is after whitespace (or right after `{`).
    if (currentProperty && consumedValues < currentMaxParams) {
        return {
            kind: 'property-value',
            nearestCommand,
            propertiesScope,
            currentProperty,
            valueIndex: consumedValues,
            insideQuote
        };
    }
    return { kind: 'property-name', nearestCommand, propertiesScope };
}

/**
 * Build completion items for the candidate *values* of a property.
 *
 * Merges `values` across all signatures, de-duplicating by `name`.
 * Skips entries flagged with `skip: true` (upstream uses this to hide
 * internal markers from completion while keeping them parse-able).
 *
 * When the property has no enumerated `values` across any signature,
 * falls back to a **single** entry built from the first non-undefined
 * `defaultValue` (per user decision). If no default exists either, the
 * returned array is empty — caller should then degrade to upstream.
 */
export function buildPropertyValueCompletions(
    def: PropertyDefinition,
    range: CompletionRange,
    monacoApi: typeof monaco
): monaco.languages.CompletionItem[] {
    const items: monaco.languages.CompletionItem[] = [];
    const seen = new Set<string>();

    // Walk every signature / parameter / value, preserving first-seen order.
    for (const sig of def.signatures) {
        for (const param of sig.parameters) {
            if (!param.values) {
                continue;
            }
            for (const v of param.values) {
                if (v.skip) {
                    continue;
                }
                if (seen.has(v.name)) {
                    continue;
                }
                seen.add(v.name);
                items.push(valueToCompletion(v, range, monacoApi));
            }
        }
    }

    if (items.length > 0) {
        return items;
    }

    // Fallback: surface defaultValue as a single candidate so the user
    // at least sees *something* instead of upstream noise.
    for (const sig of def.signatures) {
        for (const param of sig.parameters) {
            if (param.defaultValue === undefined) {
                continue;
            }
            const rendered = formatValueLiteral(param.defaultValue);
            items.push({
                label: rendered,
                kind: monacoApi.languages.CompletionItemKind.Value,
                insertText: rendered,
                detail: 'Default value',
                range
            });
            return items; // Only the first default — per user decision.
        }
    }

    return items;
}

/**
 * Build completion items for the property *names* available in a given scope.
 *
 * `scope` is keyed by lowercase id; the user-facing label comes
 * from `prop.property` (preserves original camelCase like `showDiagram`).
 *
 * The snippet is `${property} ` so Monaco auto-inserts a space after
 * accepting, placing the cursor exactly where the property-value
 * completion should re-trigger.
 *
 * Callers pass either a command's `owner.properties` (for `\chord {…}`
 * style blocks) or the global `beatProperties` map (for `(…){…}` blocks).
 */
export function buildPropertyNameCompletions(
    scope: Map<string, PropertyDefinition>,
    range: CompletionRange,
    monacoApi: typeof monaco
): monaco.languages.CompletionItem[] {
    const items: monaco.languages.CompletionItem[] = [];
    for (const prop of scope.values()) {
        items.push({
            label: prop.property,
            kind: monacoApi.languages.CompletionItemKind.Property,
            insertText: `${prop.property} `,
            detail: prop.shortDescription ?? undefined,
            documentation: {
                value: renderDefinitionMarkdown(prop),
                isTrusted: false,
                supportThemeIcons: false
            },
            range
        });
    }
    return items;
}

/**
 * Build completion items for the candidate *parameter values* of a
 * `()` argument slot. Works for both top-level commands (`\chord`) and
 * nested property calls (`{barre(...)}`), since both are `WithSignatures`.
 *
 * Strategy:
 *   1. Walk every signature and pick `parameters[valueIndex]`. For
 *      signatures shorter than `valueIndex + 1` AND where the *last*
 *      parameter is variadic-style (`ValueListWithoutParenthesis`),
 *      fall back to that last parameter — it represents a repeating
 *      value slot (e.g. `\chord strings`, `barre fret`).
 *   2. For each reachable parameter, collect `values[]` (de-duped by
 *      `name`, skipping `skip: true`). These become enum-style candidates.
 *   3. If no enum values were produced, emit a single **placeholder
 *      hint item** derived from the parameter name + type, so the user
 *      at least sees *what kind of value* is expected.
 *
 * The returned list may be empty only when no parameter shape matches
 * the requested `valueIndex` (owner has fewer params than requested and
 * none variadic). Callers should then degrade to upstream behaviour.
 */
export function buildParenValueCompletions(
    owner: WithSignatures,
    valueIndex: number,
    range: CompletionRange,
    monacoApi: typeof monaco
): monaco.languages.CompletionItem[] {
    const reachableParams = collectParametersAtIndex(owner, valueIndex);
    if (reachableParams.length === 0) {
        return [];
    }

    // 1) Collect enumerated values from all reachable parameter shapes.
    const items: monaco.languages.CompletionItem[] = [];
    const seen = new Set<string>();
    for (const param of reachableParams) {
        if (!param.values) {
            continue;
        }
        for (const v of param.values) {
            if (v.skip || seen.has(v.name)) {
                continue;
            }
            seen.add(v.name);
            items.push(valueToCompletion(v, range, monacoApi));
        }
    }

    if (items.length > 0) {
        return items;
    }

    // 2) No enum values → emit a single placeholder hint so users at
    //    least know the expected kind of input. The placeholder inserts
    //    a snippet tab-stop so the user can immediately type over it.
    const first = reachableParams[0];
    const typeLabel = formatTypeLabel(first);
    const placeholderLabel = typeLabel
        ? `<${first.name}: ${typeLabel}>`
        : `<${first.name}>`;

    return [
        {
            label: placeholderLabel,
            kind: monacoApi.languages.CompletionItemKind.Value,
            insertText: `\${1:${first.name}}`,
            insertTextRules: monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: first.shortDescription ?? undefined,
            // Documentation surfaces the default value and full parameter
            // description so users can make sense of the placeholder.
            documentation: buildParameterDocumentation(first),
            // Use a non-matching filterText so Monaco keeps the item
            // visible regardless of what the user types next — it's a
            // hint, not a value to be searched for.
            filterText: first.name,
            range
        }
    ];
}

/**
 * Walk `owner.signatures` and collect every parameter shape that could
 * fill slot `valueIndex`. When a signature has fewer params and its
 * tail param is `ValueListWithoutParenthesis`, the tail is repeated.
 *
 * De-duplication is by identity — the same `ParameterDefinition` object
 * shared across signatures is only collected once.
 */
function collectParametersAtIndex(
    owner: WithSignatures,
    valueIndex: number
): ParameterDefinition[] {
    const collected = new Set<ParameterDefinition>();
    for (const sig of owner.signatures) {
        if (sig.parameters.length === 0) {
            continue;
        }
        if (valueIndex < sig.parameters.length) {
            collected.add(sig.parameters[valueIndex]);
            continue;
        }
        // Beyond the defined parameter count — check if the tail is variadic.
        const tail = sig.parameters[sig.parameters.length - 1];
        if (isVariadicParameter(tail)) {
            collected.add(tail);
        }
    }
    return [...collected];
}

/**
 * A parameter is variadic-style when its `parseMode` says the value list
 * can contain an unbounded number of items (`ValueListWithoutParenthesis`
 * / `ValueListWithParenthesis`). `parseMode` is an enum from the upstream
 * alphaTab package; we match by numeric value to avoid a runtime import.
 */
function isVariadicParameter(param: ParameterDefinition): boolean {
    const mode = param.parseMode as unknown as string | number | undefined;
    if (typeof mode === 'string') {
        return mode.startsWith('ValueList'); // defensive; upstream may change
    }
    if (typeof mode !== 'number') {
        return false;
    }
    // Upstream `ArgumentListParseTypesMode` enum values:
    //   0 = Required, 1 = Optional, 2 = ValueListWithoutParenthesis,
    //   3 = ValueListWithParenthesis
    return mode === 2 || mode === 3;
}

/**
 * Render a human-readable type label for a parameter (e.g. `Number`,
 * `String | Ident`). Used in the placeholder hint.
 */
function formatTypeLabel(param: ParameterDefinition): string {
    const raw = param.type;
    if (raw === undefined || raw === null) {
        return '';
    }
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr
        .map(t => {
            if (typeof t === 'string') return t;
            // Resolve the numeric value against the runtime two-way map
            // of the `AlphaTexNodeType` enum (non-const enums compile to
            // a reverse-lookup object). This keeps the label in sync
            // with upstream automatically — no manual mapping table.
            const numeric = Number(t);
            const enumObj = (alphaTab as any)?.importer?.alphaTex?.AlphaTexNodeType;
            const name =
                enumObj && typeof enumObj[numeric] === 'string'
                    ? (enumObj[numeric] as string)
                    : undefined;
            return name ?? `Type(${numeric})`;
        })
        .join(' | ');
}

/**
 * Build a Markdown documentation card for a parameter — used as the
 * hover documentation of the placeholder hint item.
 */
function buildParameterDocumentation(
    param: ParameterDefinition
): monaco.IMarkdownString | undefined {
    const lines: string[] = [];
    if (param.shortDescription) {
        lines.push(`**${param.shortDescription}**`);
    }
    const typeLabel = formatTypeLabel(param);
    if (typeLabel) {
        lines.push(`Type: \`${typeLabel}\``);
    }
    if (param.defaultValue !== undefined) {
        lines.push(`Default: \`${formatValueLiteral(param.defaultValue)}\``);
    }
    if (lines.length === 0) {
        return undefined;
    }
    return { value: lines.join('\n\n'), isTrusted: false, supportThemeIcons: false };
}

// ─── Private analysis helpers ───────────────────────────────────────

/**
 * Find the cursor's innermost open scope (unclosed `(` or `{`) by
 * walking backwards. Returns which kind was found and its 0-based index.
 * Returns `undefined` when cursor is at top level.
 *
 * Matching closers on the way back (`)` / `}`) are tracked so we don't
 * mistakenly surface an opener that is already balanced.
 */
function findInnermostOpenScope(
    lineContent: string,
    cursorIdx: number
): { kind: 'paren' | 'brace'; index: number } | undefined {
    let parenDepth = 0;
    let braceDepth = 0;
    for (let i = cursorIdx - 1; i >= 0; i--) {
        const ch = lineContent[i];
        if (ch === ')') {
            parenDepth++;
        } else if (ch === '(') {
            if (parenDepth === 0) {
                return { kind: 'paren', index: i };
            }
            parenDepth--;
        } else if (ch === '}') {
            braceDepth++;
        } else if (ch === '{') {
            if (braceDepth === 0) {
                return { kind: 'brace', index: i };
            }
            braceDepth--;
        }
    }
    return undefined;
}

/**
 * Find the enclosing `{` index for a given position, respecting nested
 * braces. Returns -1 when not inside a brace block.
 */
function findEnclosingOpenBrace(lineContent: string, cursorIdx: number): number {
    let depth = 0;
    for (let i = cursorIdx - 1; i >= 0; i--) {
        const ch = lineContent[i];
        if (ch === '}') {
            depth++;
        } else if (ch === '{') {
            if (depth === 0) {
                return i;
            }
            depth--;
        }
    }
    return -1;
}

/**
 * Tokenize the content of a property block into whitespace-separated
 * tokens. Quoted strings (`"..."` / `'...'`) are treated as a single
 * token so identifiers like `"My Chord"` don't fragment the walk.
 *
 * `propName(args)` is emitted as **two** tokens: the property name
 * (`propName`) followed by the {@link ARGS_CLOSED_SENTINEL} placeholder
 * which signals to the state machine that this property's values were
 * supplied inside the parens (regardless of whether the parens were
 * empty or held values). This avoids treating `barre()` as a single
 * property-name lookup key (which would fail) and lets the walk
 * advance cleanly to the next property.
 *
 * Note: cursor-inside-parens scenarios (`{barre(❘)}`) are handled by
 * the paren-value branch (see {@link analyzeParenValueContext}) and
 * never reach this function with an *open* paren, so we only need to
 * handle balanced `(...)` here. An unbalanced trailing `(` is treated
 * defensively as ordinary buffer content.
 *
 * `trailingOpen` indicates whether the last token is "open" (cursor
 * glued to the end of it without a trailing whitespace).
 */
const ARGS_CLOSED_SENTINEL = '\x00args-closed\x00';

function tokenizePropertyBlock(inner: string): {
    tokens: string[];
    trailingOpen: boolean;
    insideQuote: boolean;
} {
    const tokens: string[] = [];
    let buffer = '';
    let inQuote: '"' | "'" | null = null;
    let parenDepth = 0;

    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (inQuote) {
            buffer += ch;
            if (ch === inQuote && inner[i - 1] !== '\\') {
                inQuote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            inQuote = ch;
            buffer += ch;
            continue;
        }
        if (ch === '(') {
            if (parenDepth === 0) {
                // Opening the args of a property: flush the property name
                // first, then consume the paren body without accumulating
                // it into the name token.
                if (buffer.length > 0) {
                    tokens.push(buffer);
                    buffer = '';
                }
            }
            parenDepth++;
            continue;
        }
        if (ch === ')') {
            if (parenDepth > 0) {
                parenDepth--;
                if (parenDepth === 0) {
                    // Just closed the outermost args — emit a sentinel
                    // that the state machine reads as "values supplied".
                    tokens.push(ARGS_CLOSED_SENTINEL);
                }
                continue;
            }
            // Stray ')' outside any paren: fall through as regular char
            // so we do not silently drop user input during mid-edit states.
            buffer += ch;
            continue;
        }
        if (parenDepth > 0) {
            // Inside a paren body: swallow the content (it is not a
            // property-level token). The dedicated paren-value analysis
            // handles cursor-inside-parens completion separately.
            continue;
        }
        if (ch === ' ' || ch === '\t') {
            if (buffer.length > 0) {
                tokens.push(buffer);
                buffer = '';
            }
            continue;
        }
        buffer += ch;
    }

    const trailingOpen = buffer.length > 0;
    if (trailingOpen) {
        tokens.push(buffer);
    }
    return { tokens, trailingOpen, insideQuote: inQuote !== null };
}

/**
 * Tokenize the body of a `()` argument list. Like {@link tokenizePropertyBlock}
 * but without paren-awareness (we're already inside parens and don't expect
 * further nesting in practice).
 *
 * `insideQuote` reflects whether the scan ended while still inside an
 * unclosed `"` / `'` string. Callers use this to distinguish
 * `ch "❘"` (cursor inside quoted value → string candidate list) from
 * `ch ❘` (cursor at a whitespace value slot → enum candidates).
 */
function tokenizeParenBody(inner: string): {
    tokens: string[];
    trailingOpen: boolean;
    insideQuote: boolean;
} {
    const tokens: string[] = [];
    let buffer = '';
    let inQuote: '"' | "'" | null = null;

    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (inQuote) {
            buffer += ch;
            if (ch === inQuote && inner[i - 1] !== '\\') {
                inQuote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            inQuote = ch;
            buffer += ch;
            continue;
        }
        if (ch === ' ' || ch === '\t') {
            if (buffer.length > 0) {
                tokens.push(buffer);
                buffer = '';
            }
            continue;
        }
        buffer += ch;
    }

    const trailingOpen = buffer.length > 0;
    if (trailingOpen) {
        tokens.push(buffer);
    }
    return { tokens, trailingOpen, insideQuote: inQuote !== null };
}

/**
 * Compute the maximum parameter count across all signatures of a property.
 *
 * `signatures[0].parameters` may be `[]` (e.g. `showDiagram` has a no-arg
 * overload that uses `defaultValue` as the effective state), so relying
 * on `signatures[0]` alone would mistakenly cap `consumedValues` at 0
 * and classify any typed value as a new property name. Taking the max
 * correctly respects signatures like `showDiagram true`.
 */
function computeMaxParameterCount(def: PropertyDefinition): number {
    let max = 0;
    for (const sig of def.signatures) {
        if (sig.parameters.length > max) {
            max = sig.parameters.length;
        }
    }
    return max;
}

/**
 * Convert an upstream `ParameterValueDefinition` into a Monaco
 * CompletionItem. `snippet` takes precedence over `name` for the insert
 * text so upstream-defined tab stops / placeholders are preserved.
 */
function valueToCompletion(
    v: ParameterValueDefinition,
    range: CompletionRange,
    monacoApi: typeof monaco
): monaco.languages.CompletionItem {
    const insertText = v.snippet ?? v.name;
    const isSnippet = insertText !== v.name || /\$\{/.test(insertText);

    return {
        label: v.name,
        kind: monacoApi.languages.CompletionItemKind.EnumMember,
        insertText,
        insertTextRules: isSnippet
            ? monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
        detail: v.shortDescription ?? undefined,
        documentation: v.shortDescription
            ? { value: v.shortDescription }
            : undefined,
        range
    };
}

/**
 * Format an unknown `defaultValue` into a literal string suitable as the
 * actual text to insert into the document (no surrounding quotes unless
 * the value is already a string).
 */
function formatValueLiteral(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

// ─── Private rendering helpers ──────────────────────────────────────

/**
 * Heuristic: get the best display name for headers / syntax lines.
 * - For `MetadataTagDefinition` we have `.tag` (e.g. `\chord`).
 * - For `PropertyDefinition` we have `.property` (e.g. `firstFret`).
 * Falls back to empty string to avoid `undefined` in output.
 */
function getDisplayName(def: WithSignatures): string {
    const asMeta = def as Partial<MetadataTagDefinition>;
    if (asMeta.tag) {
        return asMeta.tag;
    }
    const asProp = def as Partial<PropertyDefinition>;
    if (asProp.property) {
        return asProp.property;
    }
    return '';
}

/**
 * Render the Syntax section. One code block per overload, so users can
 * spot parameter count / type differences at a glance.
 */
function renderSyntaxBlock(
    displayName: string,
    signatures: SignatureDefinition[]
): string | undefined {
    if (!signatures || signatures.length === 0) {
        return undefined;
    }

    const lines: string[] = ['**Syntax:**'];
    const uniqueSyntaxes = new Set<string>();

    for (const sig of signatures) {
        const syntax = buildSyntaxLine(displayName, sig);
        if (uniqueSyntaxes.has(syntax)) {
            // Skip duplicates (same shape, different only in type coercion).
            continue;
        }
        uniqueSyntaxes.add(syntax);
    }

    lines.push('```alphatex');
    lines.push(...uniqueSyntaxes);
    lines.push('```');
    return lines.join('\n');
}

/**
 * Build a single syntax line like `\chord ("name" strings)` or
 * `showDiagram true|false`. Parameters are wrapped in `[]` when optional
 * (i.e. have a `defaultValue`), following common CLI help conventions.
 */
function buildSyntaxLine(displayName: string, sig: SignatureDefinition): string {
    const parts: string[] = [displayName];

    for (const param of sig.parameters) {
        const isOptional = param.defaultValue !== undefined;
        const token = isOptional ? `[${param.name}]` : param.name;
        parts.push(token);
    }

    // When strict mode and there are 2+ params, upstream uses parentheses.
    // We only surface the parameter tokens — Monaco users generally know
    // alphatex uses `()` for multi-parameter signatures.
    return parts.join(' ');
}

/**
 * Render the Parameters section as a Markdown table.
 *
 * Columns: Name | Description | Type | Required | Default
 *
 * When multiple overloads have overlapping parameter names, we collapse
 * rows by name and annotate the `Type` cell with alternative types
 * separated by `|`. This keeps the doc card compact and readable.
 */
function renderParametersBlock(signatures: SignatureDefinition[]): string | undefined {
    if (!signatures || signatures.length === 0) {
        return undefined;
    }

    // Collect unique parameters across all signatures.
    const paramsByName = new Map<string, ParameterDefinition[]>();
    for (const sig of signatures) {
        for (const param of sig.parameters) {
            const bucket = paramsByName.get(param.name) ?? [];
            bucket.push(param);
            paramsByName.set(param.name, bucket);
        }
    }

    if (paramsByName.size === 0) {
        return undefined;
    }

    const lines: string[] = [
        '**Parameters:**',
        '| Name | Description | Type | Required | Default |',
        '|------|-------------|------|----------|---------|'
    ];

    for (const [name, params] of paramsByName) {
        const first = params[0];
        const description = first.shortDescription ?? '';
        const typeText = formatParameterType(params);
        // A parameter is considered optional when ANY overload marks it so.
        const optional = params.some(p => p.defaultValue !== undefined);
        const required = optional ? 'no' : 'yes';
        const defaultValue = formatDefaultValue(params);

        lines.push(
            `| \`${name}\` | ${escapeTableCell(description)} | ${typeText} | ${required} | ${defaultValue} |`
        );
    }

    return lines.join('\n');
}

/**
 * Format the `type` column for a parameter, merging types across overloads.
 * Upstream `param.type` may be a single `AlphaTexNodeType` or an array.
 * Node types are numeric enums — we emit them as-is but wrap in backticks
 * so Markdown renders them monospace.
 */
function formatParameterType(params: ParameterDefinition[]): string {
    const typeNames = new Set<string>();
    for (const p of params) {
        const arr = Array.isArray(p.type) ? p.type : [p.type];
        for (const t of arr) {
            typeNames.add(String(t));
        }
    }
    return [...typeNames].map(t => `\`${t}\``).join(' \\| ');
}

/**
 * Format the default value column. We show the first non-undefined default.
 */
function formatDefaultValue(params: ParameterDefinition[]): string {
    for (const p of params) {
        if (p.defaultValue !== undefined) {
            return `\`${formatValue(p.defaultValue)}\``;
        }
    }
    return '—';
}

/**
 * Render an enumerated values list for parameters that have a `values` array
 * (e.g. `showDiagram true|false`). Skips parameters flagged with `skip: true`.
 */
function renderValuesBlock(signatures: SignatureDefinition[]): string | undefined {
    const collected = new Map<string, ParameterValueDefinition>();

    for (const sig of signatures) {
        for (const param of sig.parameters) {
            if (!param.values) {
                continue;
            }
            for (const v of param.values) {
                if (v.skip) {
                    continue;
                }
                if (!collected.has(v.name)) {
                    collected.set(v.name, v);
                }
            }
        }
    }

    if (collected.size === 0) {
        return undefined;
    }

    const lines: string[] = ['**Values:**'];
    for (const v of collected.values()) {
        const desc = v.shortDescription ? ` — ${escapeMarkdown(v.shortDescription)}` : '';
        lines.push(`- \`${v.name}\`${desc}`);
    }
    return lines.join('\n');
}

/**
 * Render one or more examples as fenced alphatex code blocks. Each block
 * gets a numbered heading only when there are 2+ examples, to keep the
 * common single-example case clean.
 */
function renderExamplesBlock(
    examples: AlphaTexExample | AlphaTexExample[] | undefined
): string | undefined {
    if (examples === undefined) {
        return undefined;
    }

    const list = Array.isArray(examples) ? examples : [examples];
    const normalized = list
        .map(ex => (typeof ex === 'string' ? ex : ex.tex))
        .filter((tex): tex is string => typeof tex === 'string' && tex.trim().length > 0);

    if (normalized.length === 0) {
        return undefined;
    }

    const lines: string[] = [normalized.length === 1 ? '**Example:**' : '**Examples:**'];
    for (let i = 0; i < normalized.length; i++) {
        if (normalized.length > 1) {
            lines.push(`*Example ${i + 1}:*`);
        }
        lines.push('```alphatex');
        lines.push(normalized[i].trim());
        lines.push('```');
    }
    return lines.join('\n');
}

// ─── Primitive helpers ──────────────────────────────────────────────

/**
 * Render an unknown primitive value safely for Markdown output.
 */
function formatValue(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * Escape characters that would break Markdown table cells (pipes, newlines).
 */
function escapeTableCell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Light-weight Markdown escape for inline text. We deliberately keep this
 * minimal to preserve naturally-flowing descriptions; only characters that
 * would mis-render in our specific contexts are escaped.
 */
function escapeMarkdown(text: string): string {
    return text.replace(/\|/g, '\\|');
}
