import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

/**
 * Drops the hyphenation machinery `@univerjs/engine-render` carries for Univer Docs.
 * `shaping()` hyphenates only a paragraph whose section sets `autoHyphenation`, which
 * the spreadsheet note type never turns on, so none of it can run:
 *
 * - The 77 TeX pattern tables, 4.4 MB of lazy chunks (Hungarian alone 747 kB). The
 *   entry makes exactly 77 relative imports and every one is a table, so resolving
 *   them all to one empty module collapses them into a single stub chunk.
 * - `franc-min`, whose 102 kB trigram model backs the `LanguageDetector` call that
 *   `shaping()` makes ahead of the hyphenation check, on every paragraph it lays out.
 *
 * Both stubs are keyed on the importer, so a second consumer of `franc-min` would still
 * get the real package. Both the client and the standalone build bundle Univer, so both
 * apply this. `vite-plugins.spec.ts` checks the rules still match the installed
 * dependency.
 */
export function stripUniverHyphenation(): Plugin {
    return {
        name: "strip-univer-hyphenation",
        enforce: "pre",
        resolveId: resolveUniverHyphenationStub
    };
}

/**
 * Returns the stub for a hyphenation import made by `@univerjs/engine-render`'s entry,
 * and `null` for everything else so other resolvers keep their turn.
 */
export function resolveUniverHyphenationStub(source: string, importer: string | undefined): string | null {
    if (!importer?.replace(/\\/g, "/").endsWith(ENGINE_RENDER_ENTRY)) {
        return null;
    }

    if (source === LANGUAGE_DETECTOR_PACKAGE) {
        return stubPath("franc_min");
    }

    return source.startsWith("./") ? stubPath("univer_hyphenation_pattern") : null;
}

export const ENGINE_RENDER_ENTRY = "@univerjs/engine-render/lib/es/index.js";
export const LANGUAGE_DETECTOR_PACKAGE = "franc-min";

function stubPath(name: string): string {
    return fileURLToPath(new URL(`./src/stubs/${name}.ts`, import.meta.url));
}
