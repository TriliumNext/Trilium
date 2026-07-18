/**
 * KaTeX macros that map commands emitted by the MathLive visual math editor
 * (used in the rich-text editor's math dialog) onto equivalents that KaTeX — the
 * engine Trilium uses to *render* math — actually understands.
 *
 * MathLive produces commands that are not part of KaTeX's command set, so without
 * these macros the formula renders as raw red error text. Defining them here means
 * both newly typed and already-stored formulas render correctly, regardless of how
 * the LaTeX was produced (visual editor, LaTeX textarea, paste, import or sync).
 *
 * This covers every command a user can trigger just by typing — MathLive's inline
 * shortcuts auto-insert `\differentialD` (`dx`/`dy`/`dt`), `\questeq` (`?=`) and
 * `\Colon` (`::`) — plus the rest of the ISO 80000-2 upright-operator family that
 * shares the same definition (`\exponentialE`, `\imaginaryI`, …). Upright operators
 * map to `\mathrm{…}` to match MathLive's own rendering. Obscure macros that only
 * appear when a user deliberately types them are intentionally not mirrored here.
 *
 * This list must be applied to every KaTeX render path: the rich-text editor
 * (`katexRenderOptions`), read-only note rendering, and the share theme.
 *
 * @see https://github.com/TriliumNext/Trilium/issues/9523
 */
export const KATEX_MACROS: Record<string, string> = {
    // ISO 80000-2 upright operators (mathlive MACROS table)
    "\\differentialD": "\\mathrm{d}",
    "\\capitalDifferentialD": "\\mathrm{D}",
    "\\exponentialE": "\\mathrm{e}",
    "\\imaginaryI": "\\mathrm{i}",
    "\\imaginaryJ": "\\mathrm{j}",
    // Relational shortcuts (mathlive inline shortcuts: `?=` and `::`)
    "\\questeq": "\\stackrel{?}{=}", // U+225F questioned-equal: "?" over "="
    "\\Colon": "\\dblcolon" // U+2237 proportion / double colon
};
