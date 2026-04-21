/**
 * Chord registry — extracts user-defined `\chord` identifiers from the
 * current Monaco text model.
 *
 * Responsibility (scope-locked by design):
 *   - Given a `ITextModel`, scan the full text with a tolerant regex and
 *     return the ordered, de-duplicated list of chord names that the
 *     author has declared via `\chord ("name" ...)` or `\chord ('name' ...)`.
 *   - Nothing more: no AST walks, no cross-track filtering, no caching.
 *
 * Why a plain regex (and not the upstream AST):
 *   - `\chord` declarations are a fraction of the document and the regex
 *     is unambiguous (`\chord` literal + open paren + quoted string).
 *   - The completion path runs on every keystroke inside `ch "…"`; an
 *     AST pass would pay the price of a full alphaTex reparse just to
 *     list names, which is wasteful.
 *   - The regex copes with quoted strings that contain spaces or
 *     punctuation, which is the only edge case that matters in practice.
 *
 * Known limitations (acceptable for v1 per Q2.4 = regex):
 *   - Escape sequences inside chord names (`"D\""`) are not supported.
 *     AlphaTex does not document string escapes for chord names and the
 *     lexer treats `"..."` as a plain StringLiteral.
 *   - `\chord` appearing inside a comment or a quoted string would be
 *     falsely collected. Comments are rare around chord definitions and
 *     the cost of a false positive is cosmetic (an extra candidate in
 *     the `ch` completion list), not a crash.
 *   - Scope is the entire model (Q2.3 = 全文). Per-track scoping would
 *     require an AST walk to resolve track boundaries and was explicitly
 *     deferred.
 */

import type * as monaco from 'monaco-editor';

/**
 * Regex matching `\chord ("name" …)` or `\chord ('name' …)`.
 *
 * Groups:
 *   - `$1` — content between `"` delimiters (may be empty)
 *   - `$2` — content between `'` delimiters (may be empty)
 *
 * Flags:
 *   - `g` — required for repeated `exec()` / `matchAll()` usage
 *   - `m` — unused here (no anchors involved) but left off for speed
 *
 * The leading `\\` is escaped twice: once for the string literal
 * (TypeScript source) and once for regex syntax — so the pattern
 * actually matches a single backslash in the document text.
 */
const CHORD_DECLARATION_REGEX = /\\chord\s*\(\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Collect every distinct chord name declared in the model, in first-
 * seen order. Empty strings (e.g. `\chord ("" …)`) are filtered out —
 * they are almost certainly mid-typing states and surfacing them as a
 * candidate would be misleading.
 *
 * Complexity: O(n) in the document length. For the ~10k-character
 * worksheets we see in the editor this runs well under a millisecond
 * and is safe to invoke on every completion request (Q-B = a, no cache).
 */
export function collectChordIds(model: monaco.editor.ITextModel): string[] {
    const source = model.getValue();
    const seen = new Set<string>();
    const ordered: string[] = [];

    // `matchAll` returns an iterator of RegExpMatchArray; resetting the
    // regex's `lastIndex` isn't needed because we create a fresh iterator.
    for (const match of source.matchAll(CHORD_DECLARATION_REGEX)) {
        const name = (match[1] ?? match[2] ?? '').trim();
        if (!name) {
            continue;
        }
        if (seen.has(name)) {
            continue;
        }
        seen.add(name);
        ordered.push(name);
    }

    return ordered;
}
