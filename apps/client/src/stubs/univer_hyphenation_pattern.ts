/**
 * Stand-in for the 77 TeX hyphenation tables `@univerjs/engine-render` ships under
 * `components/docs/layout/hyphenation/patterns/`. Only `Hyphen.loadPattern()` imports
 * them, and `shaping()` calls it just for a paragraph whose section sets
 * `autoHyphenation` — a Univer Docs setting the spreadsheet note type never turns on.
 * `loadPattern()` reads the table off the namespace under its Pascal-cased locale name
 * and returns early when it is missing, so an empty module disables hyphenation instead
 * of breaking layout. See `stripUniverHyphenationPatterns` in vite-plugins.mts.
 */
const noPatterns: Record<string, unknown> = {};

export default noPatterns;
