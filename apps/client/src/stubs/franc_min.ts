/**
 * Stand-in for `franc-min`, whose 102 kB trigram model is loaded by one caller in the
 * tree: `@univerjs/engine-render`'s `LanguageDetector`. `shaping()` runs the detector on
 * every paragraph it lays out, ahead of the check that decides whether to hyphenate at
 * all, so a spreadsheet pays for detection it cannot use. Returning `und` takes the
 * `LANG_MAP_TO_HYPHEN_LANG` entry that resolves to `unknown`, the value that already
 * makes `shaping()` skip hyphenation. See `stripUniverHyphenation` in vite-plugins.mts.
 */
export function franc(): string {
    return "und";
}
