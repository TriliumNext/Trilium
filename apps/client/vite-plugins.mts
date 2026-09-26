import { posix } from "node:path";
import { fileURLToPath } from "node:url";

import type { ShareMermaidManifest } from "@triliumnext/commons";
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

/** The name of the entry the share theme loads mermaid through, `src/share_mermaid.ts`. */
export const SHARE_MERMAID_ENTRY = "share_mermaid";

/**
 * Adds `src/share_mermaid.ts` as the `share_mermaid` entry and writes its
 * {@link ShareMermaidManifest} to `manifestPath`. Shared pages read the manifest to import the
 * entry, and the share-theme export reads it to copy the files.
 *
 * The entry is emitted here rather than listed in `input` because an app build drops the exports
 * of its entries, and shared pages import the entry's default export.
 */
export function shareMermaidManifest(manifestPath: string): Plugin {
    return {
        name: "share-mermaid-manifest",
        apply: "build",
        buildStart() {
            this.emitFile({
                type: "chunk",
                id: fileURLToPath(new URL("./src/share_mermaid.ts", import.meta.url)),
                name: SHARE_MERMAID_ENTRY,
                preserveSignature: "exports-only"
            });
        },
        generateBundle(_, bundle) {
            this.emitFile({
                type: "asset",
                fileName: manifestPath,
                source: JSON.stringify(buildShareMermaidManifest(bundle, manifestPath))
            });
        }
    };
}

type BundleOutput =
    | { type: "asset"; fileName: string }
    | {
        type: "chunk";
        fileName: string;
        name: string;
        isEntry: boolean;
        imports: string[];
        dynamicImports: string[];
        viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> };
    };

/**
 * Collects the `share_mermaid` entry and everything it imports, statically or dynamically,
 * including the CSS and assets Vite preloads alongside a chunk.
 */
export function buildShareMermaidManifest(
    bundle: Record<string, BundleOutput>,
    manifestPath: string
): ShareMermaidManifest {
    const entry = Object.values(bundle).find((output) =>
        output.type === "chunk" && output.isEntry && output.name === SHARE_MERMAID_ENTRY);
    if (!entry) {
        throw new Error(`The bundle has no '${SHARE_MERMAID_ENTRY}' entry.`);
    }

    const files = new Set<string>();
    const pending = [ entry.fileName ];
    for (let fileName = pending.pop(); fileName !== undefined; fileName = pending.pop()) {
        const output = bundle[fileName];
        if (!output || files.has(fileName)) {
            continue;
        }

        files.add(fileName);
        if (output.type === "chunk") {
            pending.push(
                ...output.imports,
                ...output.dynamicImports,
                ...(output.viteMetadata?.importedCss ?? []),
                ...(output.viteMetadata?.importedAssets ?? [])
            );
        }
    }

    const directories = new Set([ ...files ].map((fileName) => posix.dirname(fileName)));
    if (directories.size !== 1) {
        const list = [ ...directories ].join(", ");
        throw new Error(`The '${SHARE_MERMAID_ENTRY}' files span several directories: ${list}.`);
    }

    const manifestDir = posix.dirname(manifestPath);
    return {
        entry: posix.relative(manifestDir, entry.fileName),
        files: [ ...files ].sort().map((fileName) => posix.relative(manifestDir, fileName))
    };
}
