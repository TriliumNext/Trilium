import type { ServerResponse } from "node:http";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import type { ShareThemeManifest } from "@triliumnext/commons";
import {
    buildVsCodeThemeCss, VS_CODE_DARK, VS_CODE_LIGHT
} from "@triliumnext/highlightjs/src/vs_code_theme.js";
import {
    build, type Connect, type InlineConfig, normalizePath, type Plugin, type ResolvedConfig, type Rollup
} from "vite";

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

/**
 * Empties the data `@univerjs/ui` generates for its emoji picker: the emoji table in the
 * entry (about 200 kB) and the search index and titles in every locale (about 520 kB each
 * in English). Only the Univer Docs ribbon opens the picker, so the spreadsheet note type
 * never shows it. The table keeps its category keys, which `EMOJI_CATEGORIES` is built
 * from, and `getEmojiLocaleData()` reads the search index and titles as optional.
 * `vite-plugins.spec.ts` checks the rules still match the installed dependency.
 */
export function stripUniverEmojiData(): Plugin {
    return {
        name: "strip-univer-emoji-data",
        enforce: "pre",
        transform: (code, id) => stripUniverEmojiSource(code, id)
    };
}

/**
 * Returns `code` with the generated emoji data emptied when `id` is the `@univerjs/ui`
 * entry or one of its locales, and `null` for every other module.
 */
export function stripUniverEmojiSource(code: string, id: string): string | null {
    const path = id.replace(/\\/g, "/");
    if (path.endsWith(UI_ENTRY)) {
        return replaceOnce(code, EMOJI_TABLE, (_, region: string, table: string) => {
            const categories = Object.keys(JSON.parse(table) as Record<string, unknown>);
            return `${region}const emojis = ${JSON.stringify(Object.fromEntries(categories.map((key) => [ key, [] ])))};\n`;
        });
    }

    if (UI_LOCALE.test(path)) {
        return replaceOnce(code, EMOJI_LOCALE, (_, region: string) => `${region}const emojiLocale = {};\n`);
    }

    return null;
}

export const UI_ENTRY = "@univerjs/ui/lib/es/index.js";
export const UI_LOCALE = /@univerjs\/ui\/lib\/es\/locale\/[^/]+\.js$/;
export const EMOJI_TABLE = /(\/\/#region src\/views\/emoji-picker\/emojis\.generated\.ts\n)const emojis = (\{[\s\S]*?\n\});\n/;
export const EMOJI_LOCALE = /(\/\/#region src\/locale\/emoji-locale\/[^\n]+\.generated\.ts\n)const emojiLocale = \{[\s\S]*?\n\};\n/;

function replaceOnce(code: string, pattern: RegExp, replacer: (match: string, ...groups: string[]) => string): string {
    if (!pattern.test(code)) {
        throw new Error(`strip-univer-emoji-data: ${pattern} no longer matches; update vite-plugins.mts.`);
    }
    return code.replace(pattern, replacer);
}

/** The share theme's sources, which the app build bundles into the files shared pages load. */
const SHARE_THEME_SRC = join(import.meta.dirname, "../../packages/share-theme/src");

/**
 * The directory the share theme's files go to: the one the app's chunks go to, so the share theme
 * imports the chunks it shares with the app by their file name.
 */
const SHARE_THEME_DIR = "src";

/** The page's files, at the fixed paths `content_renderer.ts` writes into every page. */
const SCRIPTS_FILE = `${SHARE_THEME_DIR}/scripts.js`;
const STYLES_FILE = `${SHARE_THEME_DIR}/scripts.css`;
const TREE_FILE = `${SHARE_THEME_DIR}/tree.js`;
export const SHARE_THEME_MANIFEST_FILE = `${SHARE_THEME_DIR}/share_theme.json`;

/**
 * The browsers `tree.js` and `scripts.css` are built for. Shared pages are open to any visitor,
 * so they target older browsers than the app.
 */
const SHARE_THEME_TARGET = "chrome96";

/**
 * The modules the share theme imports on demand that a share-theme export copies only for the
 * pages that use them, grouped by their name in {@link ShareThemeManifest.lazy}: mermaid, and the
 * viewer a Mermaid note's diagram goes into.
 */
const LAZY_MODULES: Record<string, { specifier: string; importer: string }[]> = {
    mermaid: [
        { specifier: "mermaid", importer: "content/mermaid.ts" },
        { specifier: "./mermaid_zoom.js", importer: "content/mermaid.ts" }
    ],
    app: [
        { specifier: "./app_globals.js", importer: "content/app_view.ts" },
        { specifier: "@triliumnext/client/src/components/app_context.js", importer: "content/app_view.ts" },
        { specifier: "@triliumnext/client/src/services/i18n.js", importer: "content/app_view.ts" },
        { specifier: "./content/collection_view.js", importer: "index.ts" },
        { specifier: "./content/note_view.js", importer: "index.ts" }
    ]
};

const CODE_THEMES_ID = "virtual:code-themes.css";

interface ShareThemeOptions {
    /**
     * Another directory for the page's three files, each of which loads its namesake in `src/`. A
     * static host serves `/share/assets/` from there, as it cannot map that path to `src/`.
     */
    stubDir?: string;
}

/**
 * Builds the share theme as part of the app: `scripts.js` and its chunks next to the app's, so
 * both load one copy of what they share, and `scripts.css` and `tree.js` in builds of their own.
 * Writes the {@link ShareThemeManifest} the share-theme export copies the files by. The
 * development server serves the page's scripts from source instead.
 */
export function shareTheme(options: ShareThemeOptions = {}): Plugin[] {
    let config: ResolvedConfig | undefined;

    return [
        codeThemesPlugin(),
        {
            name: "share-theme-dev",
            apply: "serve",
            configureServer(server) {
                server.middlewares.use((req, res, next) => {
                    serveFromSource(server.config.base, req, res, next);
                });
            }
        },
        {
            name: "share-theme-build",
            apply: "build",
            // After `vite:css-post`, which merges chunks holding only styles into their importers.
            enforce: "post",
            configResolved(resolvedConfig) {
                config = resolvedConfig;
            },
            buildStart() {
                const id = join(SHARE_THEME_SRC, "index.ts");
                this.emitFile({ type: "chunk", id, fileName: SCRIPTS_FILE });
            },
            async generateBundle(_, bundle) {
                await emitShareTheme(this, bundle as Record<string, BundleOutput>, config, options);
            }
        }
    ];
}

/** The modules the development server answers the page's scripts with. */
const DEV_SOURCES: Record<string, string> = {
    "scripts.js": "index.ts",
    "tree.js": "tree.ts"
};

/** Answers the page's files under `${base}share/assets/` from the share theme's sources. */
function serveFromSource(
    base: string,
    req: Connect.IncomingMessage,
    res: ServerResponse,
    next: () => void
) {
    const prefix = `${base}share/assets/`;
    const [ path ] = (req.url ?? "").split("?");
    if (!path.startsWith(prefix)) {
        next();
        return;
    }

    const file = path.slice(prefix.length);
    if (file === "scripts.css") {
        // The development server injects the styles of the modules `scripts.js` imports.
        res.setHeader("Content-Type", "text/css");
        res.end("");
        return;
    }

    const source = DEV_SOURCES[file];
    if (source) {
        req.url = `${base}@fs/${normalizePath(join(SHARE_THEME_SRC, source)).replace(/^\//, "")}`;
    }
    next();
}

/**
 * Adds the share theme's `tree.js`, `scripts.css` with the files it references, the manifest and
 * the stubs of `options` to the app's `bundle`, which holds `scripts.js` and its chunks.
 */
async function emitShareTheme(
    context: Pick<Rollup.PluginContext, "emitFile" | "resolve">,
    bundle: Record<string, BundleOutput>,
    config: ResolvedConfig | undefined,
    options: ShareThemeOptions
) {
    const lazyEntries: Record<string, string[]> = {};
    for (const [ name, modules ] of Object.entries(LAZY_MODULES)) {
        lazyEntries[name] = [];
        for (const { specifier, importer } of modules) {
            const resolved = await context.resolve(specifier, join(SHARE_THEME_SRC, importer));
            if (!resolved) {
                const source = `'${specifier}' from the share theme's ${importer}`;
                throw new Error(`Unable to resolve ${source}.`);
            }
            lazyEntries[name].push(resolved.id);
        }
    }

    const [ tree, styles ] = await Promise.all([ buildTreeScript(config), buildStyles(config) ]);
    const emit = (fileName: string, source: string | Uint8Array) =>
        context.emitFile({ type: "asset", fileName, source });
    emit(TREE_FILE, tree);
    emit(STYLES_FILE, styles.source);
    const styleAssets = styles.assets.map((asset) => ({
        ...asset,
        fileName: `${SHARE_THEME_DIR}/${asset.fileName}`
    }));
    for (const asset of styleAssets) {
        if (!(asset.fileName in bundle)) {
            emit(asset.fileName, asset.source);
        }
    }

    const assetNames = styleAssets.map((asset) => asset.fileName);
    const manifest = buildShareThemeManifest(bundle, lazyEntries, assetNames);
    emit(SHARE_THEME_MANIFEST_FILE, JSON.stringify(manifest));

    const { stubDir } = options;
    if (stubDir) {
        const toSource = (file: string) => posix.relative(stubDir, file);
        emit(`${stubDir}/tree.js`, tree);
        emit(`${stubDir}/scripts.js`, `import "${toSource(SCRIPTS_FILE)}";\n`);
        emit(`${stubDir}/scripts.css`, `@import url("${toSource(STYLES_FILE)}");\n`);
    }
}

/**
 * Serves `virtual:code-themes.css`: the VS Code highlighting themes code notes also use, one per
 * share theme mode. `:where()` keeps the block rules as weak as a stock highlight.js theme's, so
 * the share theme's own `.ck-content code` colors still win inside text notes.
 */
function codeThemesPlugin(): Plugin {
    return {
        name: "share-theme-code-themes",
        resolveId: (id) => (id === CODE_THEMES_ID ? `\0${CODE_THEMES_ID}` : null),
        load: (id) => (id === `\0${CODE_THEMES_ID}`
            ? [
                buildVsCodeThemeCss(VS_CODE_LIGHT, ":where(html.theme-light)"),
                buildVsCodeThemeCss(VS_CODE_DARK, ":where(html.theme-dark)")
            ].join("\n")
            : null)
    };
}

/**
 * Bundles `tree.ts` on its own, so that it loads as one file: in the app's build, the code it
 * shares with `scripts.js` would move into a chunk the page's first paint waits for.
 */
async function buildTreeScript(config: ResolvedConfig | undefined) {
    const outputs = await buildShareThemeFile(config, "tree.ts", {});
    const chunks = outputs.filter((output) => output.type === "chunk");
    if (chunks.length !== 1 || outputs.length !== 1) {
        throw new Error(`tree.ts built to ${outputs.length} files instead of one.`);
    }
    return chunks[0].code;
}

/**
 * Builds the styles of everything `index.ts` imports statically into one stylesheet, in the order
 * it imports them. In the app's build, the stylesheets the theme shares with the app move into the
 * shared chunks, which reorders the cascade. A module imported on demand brings its own styles
 * from the app's build. Returns the stylesheet and the files it references.
 */
async function buildStyles(config: ResolvedConfig | undefined) {
    const outputs = await buildShareThemeFile(config, "index.ts", {
        base: "./",
        plugins: [
            codeThemesPlugin(),
            { name: "share-theme-static-styles", resolveDynamicImport: () => false }
        ],
        css: { transformer: config?.css.transformer },
        build: {
            cssCodeSplit: false,
            assetsDir: ""
        }
    });
    const assets = outputs.flatMap((output) => (output.type === "asset" ? [ output ] : []));
    const stylesheets = assets.filter((asset) => asset.fileName.endsWith(".css"));
    if (stylesheets.length !== 1) {
        const count = stylesheets.length;
        throw new Error(`The share theme's styles built to ${count} stylesheets instead of one.`);
    }

    return {
        source: String(stylesheets[0].source),
        assets: assets.filter((asset) => asset !== stylesheets[0])
            .map(({ fileName, source }) => ({ fileName, source }))
    };
}

/** Builds `input` of the share theme without writing it, with the minification of `config`. */
async function buildShareThemeFile(
    config: ResolvedConfig | undefined,
    input: string,
    overrides: InlineConfig
) {
    const result = await build({
        ...overrides,
        configFile: false,
        root: SHARE_THEME_SRC,
        logLevel: "warn",
        build: {
            ...overrides.build,
            write: false,
            copyPublicDir: false,
            target: SHARE_THEME_TARGET,
            minify: config?.build.minify,
            cssMinify: config?.build.cssMinify,
            rollupOptions: {
                ...overrides.build?.rollupOptions,
                input: join(SHARE_THEME_SRC, input)
            }
        }
    });

    return (Array.isArray(result) ? result : [ result ]).flatMap((output) =>
        "output" in output ? output.output : []);
}

type BundleOutput =
    | { type: "asset"; fileName: string }
    | {
        type: "chunk";
        fileName: string;
        facadeModuleId: string | null;
        moduleIds?: string[];
        imports: string[];
        dynamicImports: string[];
        viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> };
    };

/**
 * Lists the files the share theme loads: the page's three files, `styleAssets` that `scripts.css`
 * references, and every chunk `scripts.js` loads, statically or on demand, with what each loads in
 * turn. The styles of the chunks `scripts.js` imports statically are in `scripts.css`, so their
 * stylesheets are listed only when a chunk loaded on demand imports them, which preloads them. What
 * only the modules in `lazyEntries` load is listed under the name of their group, each module given
 * as the ID the build resolves it to.
 */
export function buildShareThemeManifest(
    bundle: Record<string, BundleOutput>,
    lazyEntries: Record<string, string[]>,
    styleAssets: string[]
): ShareThemeManifest {
    const lazyChunks = new Map<string, string>();
    for (const [ name, ids ] of Object.entries(lazyEntries)) {
        for (const id of ids) {
            const chunk = Object.values(bundle).find((output) =>
                output.type === "chunk" && output.facadeModuleId === id);
            if (!chunk) {
                throw new Error(`The bundle has no chunk for '${id}' of the share theme's`
                    + ` '${name}'.`);
            }
            lazyChunks.set(chunk.fileName, name);
        }
    }

    const appOnly = new Set(Object.values(bundle).flatMap((output) =>
        (output.type === "chunk" && output.moduleIds?.some(isAppOnlyModule) ? [ output.fileName ] : [])));
    const pageFiles = collectFiles(bundle, [ SCRIPTS_FILE ], { dynamic: false });
    const onDemand = [ ...pageFiles ].flatMap((fileName) => {
        const output = bundle[fileName];
        return output?.type === "chunk" ? output.dynamicImports : [];
    });
    const files = new Set([
        ...pageFiles,
        ...collectFiles(bundle, onDemand, { dynamic: true, excluded: new Set([ ...lazyChunks.keys(), ...appOnly ]) }),
        TREE_FILE,
        STYLES_FILE,
        ...styleAssets
    ]);

    const lazy: Record<string, string[]> = {};
    for (const name of Object.keys(lazyEntries)) {
        const chunks = [ ...lazyChunks ].flatMap(([ fileName, group ]) =>
            (group === name ? [ fileName ] : []));
        const lazyFiles = collectFiles(bundle, chunks, { dynamic: true, excluded: appOnly });
        lazy[name] = toManifestPaths([ ...lazyFiles ].filter((file) => !files.has(file)));
    }

    return { files: toManifestPaths([ ...files ]), lazy };
}

/**
 * Whether `id` is one of the app's modules that the client code the share theme reuses imports on
 * demand, on paths a shared page never takes, such as running a script note.
 */
function isAppOnlyModule(id: string) {
    return APP_ONLY_MODULES.some((module) => id.endsWith(module));
}

const APP_ONLY_MODULES = [
    "/apps/client/src/components/app_context.ts",
    "/apps/client/src/services/search.ts",
    "/apps/client/src/services/bundle.ts",
    "/apps/client/src/services/backend_scripting.ts",
    "/apps/client/src/services/dialog.ts"
];

/**
 * Collects `entries` and the chunks and assets they import, without descending into `excluded`.
 * With `dynamic`, also the chunks they load on demand and the stylesheets they preload.
 */
function collectFiles(bundle: Record<string, BundleOutput>, entries: string[], options: {
    dynamic: boolean;
    excluded?: Set<string>;
}) {
    const files = new Set<string>();
    const pending = [ ...entries ];
    for (let fileName = pending.pop(); fileName !== undefined; fileName = pending.pop()) {
        if (files.has(fileName) || options.excluded?.has(fileName)) {
            continue;
        }

        files.add(fileName);
        const output = bundle[fileName];
        if (output?.type === "chunk") {
            pending.push(...output.imports, ...(output.viteMetadata?.importedAssets ?? []));
            if (options.dynamic) {
                pending.push(...output.dynamicImports, ...(output.viteMetadata?.importedCss ?? []));
            }
        }
    }
    return files;
}

/**
 * Sorts `files` and makes them relative to the manifest, checking they share its directory or are
 * in `assets/`. A chunk refers to a file there as `../assets/<file>`, which from
 * `/share/assets/` is the same directory, so both are listed by their name alone.
 */
function toManifestPaths(files: string[]) {
    const outside = files.filter((file) =>
        posix.dirname(file) !== SHARE_THEME_DIR && posix.dirname(file) !== "assets");
    if (outside.length) {
        const list = outside.join(", ");
        throw new Error(`The share theme's files must all be in '${SHARE_THEME_DIR}/': ${list}.`);
    }
    return files.map((file) => posix.basename(file)).sort();
}
