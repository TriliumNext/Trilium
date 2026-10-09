import { readdirSync, readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";

import {
    buildShareThemeManifest,
    ENGINE_RENDER_ENTRY,
    LANGUAGE_DETECTOR_PACKAGE,
    resolveUniverHyphenationStub,
    stripUniverEmojiSource,
    UI_ENTRY
} from "./vite-plugins.mjs";

const entryPath = createRequire(import.meta.url).resolve("@univerjs/engine-render/lib/es/index.js");
const entrySource = readFileSync(entryPath, "utf8");

/**
 * Canary for `stripUniverHyphenation`. The rules it applies hold for the installed
 * version, but an upgrade could rename the entry, inline the tables, start importing a
 * real sibling module, or reach for `franc-min` somewhere the stub does not cover. The
 * first two turn the plugin into a no-op that silently puts 4.4 MB back into the build;
 * the others make it stub out live code.
 */
describe("stripUniverHyphenation", () => {
    it("matches an entry that still lazy-loads a pattern table per locale", () => {
        expect(entryPath.replace(/\\/g, "/")).toContain(ENGINE_RENDER_ENTRY);
        expect(patternLoaders().length).toBeGreaterThan(50);
    });

    it("finds nothing relative in the entry beyond the tables, so the blanket rule stays safe", () => {
        const relativeImports = [...entrySource.matchAll(/\bimport\("(\.[^"]*)"\)/g)].map(([, source]) => source);

        expect(new Set(relativeImports)).toEqual(new Set(patternLoaders().map(({ source }) => source)));
        expect([...entrySource.matchAll(/\bfrom\s*"(\.[^"]*)"/g)]).toHaveLength(0);
    });

    it("intercepts every table the loader map points at", () => {
        for (const { locale, source } of patternLoaders()) {
            expect(resolveUniverHyphenationStub(source, entryPath)).toContain("univer_hyphenation_pattern");

            // Each table exports its locale Pascal-cased (`de-ch-1901` -> `DeCh1901`),
            // which is also how `Hyphen.loadPattern()` reads it back off the namespace.
            const table = readFileSync(join(dirname(entryPath), source), "utf8");
            expect(table).toContain(`export { ${pascalCaseLocale(locale)} }`);
        }
    });

    it("intercepts the language detector the entry imports, taking only what it uses", () => {
        expect(entrySource).toContain(`import { franc } from "${LANGUAGE_DETECTOR_PACKAGE}"`);
        expect(resolveUniverHyphenationStub(LANGUAGE_DETECTOR_PACKAGE, entryPath)).toContain("franc_min");

        // `detect()` maps franc's code through this table, so the stub's `und` has to
        // land on `unknown` — the value that makes `shaping()` skip hyphenation.
        expect(entrySource).toMatch(/\bund:\s*"unknown"/);
    });

    it("declines a bare specifier and any importer outside the entry", () => {
        expect(resolveUniverHyphenationStub("rxjs", entryPath)).toBeNull();
        expect(resolveUniverHyphenationStub(LANGUAGE_DETECTOR_PACKAGE, "/app/src/services/froca.ts")).toBeNull();
        expect(resolveUniverHyphenationStub("./hu-DVk7Y_ka.js", "/app/src/services/froca.ts")).toBeNull();
        expect(resolveUniverHyphenationStub("./hu-DVk7Y_ka.js", undefined)).toBeNull();
    });

    it("stubs modules that the hyphenation code reads as absent", async () => {
        // `loadPattern()` takes a table off the namespace under its Pascal-cased locale
        // and returns early when it is missing, so nothing throws and `hasPattern()` stays
        // false — the hyphenating line breaker is never built.
        const patterns: Record<string, unknown> = await import("./src/stubs/univer_hyphenation_pattern.js");
        expect(Array.isArray(patterns)).toBe(false);
        for (const { locale } of patternLoaders()) {
            expect(patterns[pascalCaseLocale(locale)]).toBeUndefined();
        }

        const { franc } = await import("./src/stubs/franc_min.js");
        expect(franc()).toBe("und");
    });
});

/**
 * Canary for `stripUniverEmojiData`. An upgrade that renames the generated regions makes
 * the plugin throw during the build; one that moves the data elsewhere, or starts reading
 * it outside the picker, makes the plugin a no-op or breaks live code.
 */
describe("stripUniverEmojiData", () => {
    const uiEntryPath = createRequire(import.meta.url).resolve("@univerjs/ui/lib/es/index.js");
    const uiEntry = readFileSync(uiEntryPath, "utf8");
    const localeDir = join(dirname(uiEntryPath), "locale");

    it("empties the emoji table in the entry, keeping its categories", () => {
        expect(uiEntryPath.replace(/\\/g, "/")).toContain(UI_ENTRY);
        const stripped = stripUniverEmojiSource(uiEntry, uiEntryPath);

        expect(stripped).toContain(`const emojis = {"frequent":[],"people":[]`);
        expect(stripped?.length).toBeLessThan(uiEntry.length - 200_000);
        // The picker reads the locale data through this guard, so an absent index is not an error.
        expect(uiEntry).toContain("if (!emojiPicker || typeof emojiPicker !== \"object\" || Array.isArray(emojiPicker)) return {};");
        expect(uiEntry.match(/\bemojis\b/g)?.length).toBe(stripped?.match(/\bemojis\b/g)?.length);
    });

    it("empties the search index and titles of every locale, leaving its other strings", () => {
        const locales = readdirSync(localeDir).filter((file) => file.endsWith(".js"));
        expect(locales.length).toBeGreaterThan(10);

        for (const file of locales) {
            const path = join(localeDir, file).replace(/\\/g, "/");
            const source = readFileSync(path, "utf8");
            const stripped = stripUniverEmojiSource(source, path);

            expect(stripped).toContain("const emojiLocale = {};");
            expect(stripped).not.toContain("emojiSearchIndex");
            expect(stripped).not.toContain("emojiTitles");
            expect(stripped).toContain("...emojiLocale");
            expect(stripped).toContain("clearFormatting:");
        }
    });

    it("leaves every other module alone and fails loudly when the shape changes", () => {
        expect(stripUniverEmojiSource(uiEntry, "/app/src/services/froca.ts")).toBeNull();
        expect(() => stripUniverEmojiSource("export {};", uiEntryPath)).toThrow("no longer matches");
    });
});

describe("buildShareThemeManifest", () => {
    const MERMAID_ID = "/node_modules/mermaid/dist/mermaid.core.mjs";
    const VIEWER_ID = "/packages/share-theme/src/content/mermaid_zoom.tsx";
    const chunk = (fileName: string, extra: { facade?: string; imports?: string[];
        dynamicImports?: string[]; css?: string[]; assets?: string[] } = {}) => ({
        type: "chunk" as const,
        fileName,
        facadeModuleId: extra.facade ?? null,
        imports: extra.imports ?? [],
        dynamicImports: extra.dynamicImports ?? [],
        viteMetadata: {
            importedCss: new Set(extra.css ?? []),
            importedAssets: new Set(extra.assets ?? [])
        }
    });
    const asset = (fileName: string) => ({ type: "asset" as const, fileName });
    const bundle = Object.fromEntries([
        chunk("src/scripts.js", {
            imports: [ "src/shared-a.js", "src/shared-k.js" ],
            dynamicImports: [ "src/fuse-b.js", "src/mermaid.core-c.js", "src/mermaid_zoom-l.js" ],
            css: [ "src/scripts-j.css" ]
        }),
        chunk("src/shared-a.js", { css: [ "src/shared-a.css" ] }),
        chunk("src/shared-k.js", { css: [ "src/shared-k.css" ] }),
        chunk("src/fuse-b.js", {
            imports: [ "src/shared-a.js" ],
            css: [ "src/fuse-d.css" ],
            assets: [ "src/font-e.woff2" ]
        }),
        chunk("src/mermaid.core-c.js", {
            facade: MERMAID_ID,
            imports: [ "src/shared-k.js", "src/dagre-f.js" ],
            dynamicImports: [ "src/flowchart-g.js" ]
        }),
        chunk("src/mermaid_zoom-l.js", { facade: VIEWER_ID, imports: [ "src/preact-m.js" ] }),
        chunk("src/preact-m.js"),
        chunk("src/dagre-f.js"),
        chunk("src/flowchart-g.js"),
        chunk("src/index-h.js", { imports: [ "src/shared-a.js" ] }),
        ...[ "scripts-j.css", "shared-a.css", "shared-k.css", "fuse-d.css", "font-e.woff2" ]
            .map((name) => asset(`src/${name}`))
    ].map((output) => [ output.fileName, output ]));

    it("lists what every page loads apart from what only the modules of mermaid load", () => {
        // The styles of the chunks `scripts.js` imports are in `scripts.css`, but a chunk loaded on
        // demand preloads the stylesheets of the chunks it imports.
        const styleAssets = [ "src/KaTeX-i.woff2" ];
        const lazyEntries = { mermaid: [ MERMAID_ID, VIEWER_ID ] };
        const manifest = buildShareThemeManifest(bundle, lazyEntries, styleAssets);
        expect(manifest).toEqual({
            files: [
                "KaTeX-i.woff2", "font-e.woff2", "fuse-b.js", "fuse-d.css", "scripts.css",
                "scripts.js", "shared-a.css", "shared-a.js", "shared-k.js", "tree.js"
            ],
            lazy: {
                mermaid: [
                    "dagre-f.js", "flowchart-g.js", "mermaid.core-c.js", "mermaid_zoom-l.js",
                    "preact-m.js", "shared-k.css"
                ]
            }
        });
    });

    it("rejects a bundle without a library's chunk or with files outside one directory", () => {
        expect(() => buildShareThemeManifest(bundle, { mermaid: [ "/elsewhere/mermaid.mjs" ] }, []))
            .toThrow("no chunk for '/elsewhere/mermaid.mjs' of the share theme's 'mermaid'");

        const nested = {
            ...bundle,
            "src/fuse-b.js": chunk("src/fuse-b.js", { imports: [ "src/nested/k.js" ] }),
            "src/nested/k.js": chunk("src/nested/k.js")
        };
        expect(() => buildShareThemeManifest(nested, { mermaid: [ MERMAID_ID ] }, []))
            .toThrow("must all be in 'src/': src/nested/k.js");
    });
});

/** Reads the generated `PATTERN_LOADERS` map, whose keys are the locales Univer hyphenates. */
function patternLoaders(): { locale: string; source: string }[] {
    const entries = entrySource.matchAll(/\["([a-z0-9-]+)"\]\s*:\s*\(\)\s*=>\s*import\("(\.[^"]*)"\)/g);

    return [...entries].map(([, locale, source]) => ({ locale, source }));
}

function pascalCaseLocale(locale: string): string {
    return locale.split("-").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}
