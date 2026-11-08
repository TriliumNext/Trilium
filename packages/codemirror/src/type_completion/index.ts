import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { VirtualTypeScriptEnvironment } from "@typescript/vfs";

/**
 * Full IntelliSense for backend/frontend script notes.
 *
 * Runs the real TypeScript language service (via `@typescript/vfs` and the
 * extensions in `./codemirror-ts`, vendored from `@valtown/codemirror-ts`)
 * over the script source, fed with a curated declaration of Trilium's `api`
 * global. This replaces the ESLint-based linting for these two MIME types with
 * type-aware completion, hover docs and diagnostics from a single source.
 *
 * Everything here is dynamically imported so the TypeScript compiler (a large
 * dependency) is only pulled into a lazy chunk when a script note is opened —
 * plain code notes never load it.
 */

export const SCRIPT_MIME_FRONTEND = "application/javascript;env=frontend";
export const SCRIPT_MIME_BACKEND = "application/javascript;env=backend";
/**
 * JSX render notes. They run in the browser like frontend scripts but are
 * transpiled (sucrase) to Preact `h`/`Fragment` calls before execution — see
 * `buildJsx` in `packages/trilium-core/src/services/script.ts`.
 */
export const SCRIPT_MIME_JSX = "text/jsx";

export function isScriptMime(mime: string): boolean {
    return mime === SCRIPT_MIME_FRONTEND || mime === SCRIPT_MIME_BACKEND || mime === SCRIPT_MIME_JSX;
}

/**
 * Per-note context that tunes the script `api` surface offered to the editor,
 * beyond what the MIME type alone implies.
 */
export interface ScriptApiContext {
    /**
     * Whether the note is a custom request handler (has the `#customRequestHandler`
     * label). Only such backend notes receive Express `req`/`res`/`pathParams` at
     * runtime, so the `api.req`/`api.res`/`api.pathParams` members are offered only
     * when this is true.
     */
    customRequestHandler?: boolean;
    /**
     * Whether the script is a bulk action's "Execute script", which the server runs once per note
     * with that note in scope as `note`. Declares `note` as a backend note.
     */
    bulkActionNote?: boolean;
}

/**
 * `BackendApi` members that exist only inside custom request handlers. When the
 * note isn't a custom request handler we `Omit` these from the `api` global so
 * they don't show up as (always-undefined) completions.
 */
const CUSTOM_REQUEST_HANDLER_MEMBERS = ["req", "res", "pathParams"] as const;

/** Frontend and JSX scripts share the browser runtime (frontend `api`, jQuery). */
function isFrontendMime(mime: string): boolean {
    return mime === SCRIPT_MIME_FRONTEND || mime === SCRIPT_MIME_JSX;
}

const SCRIPT_PATH = "/script.js";
// TypeScript only parses JSX when the source file has a `.tsx`/`.jsx` extension,
// so JSX notes get their own virtual path.
const JSX_SCRIPT_PATH = "/script.tsx";
/** Ambient file declaring the `api` global (a bridge for frontend, the curated stub for backend). */
const API_GLOBALS_PATH = "/trilium-api.d.ts";
/** The shared public API types module (frontend), injected verbatim from commons. */
const API_TYPES_PATH = "/trilium-script-api.ts";
const JQUERY_DTS_PATH = "/jquery-globals.d.ts";
const GLOB_DTS_PATH = "/trilium-glob.d.ts";
const BACKEND_GLOBALS_DTS_PATH = "/backend-globals.d.ts";
const TRILIUM_MODULES_DTS_PATH = "/trilium-modules.d.ts";

/** The virtual source-file path used for a given script MIME type. */
export function scriptPath(mime: string): string {
    return mime === SCRIPT_MIME_JSX ? JSX_SCRIPT_PATH : SCRIPT_PATH;
}

const COMPILER_OPTIONS = {
    // `target`/`lib` are filled in lazily once TypeScript is loaded (needs the ts enums).
    allowJs: true,
    checkJs: true,
    // Script notes are loose JS — `@typescript/vfs` forces `strict: true`, which makes
    // every untyped parameter a TS7006 ("implicitly has an 'any' type") error. Keep the
    // useful semantic checks (unknown api members, wrong arg counts) but don't nag about
    // missing type annotations.
    noImplicitAny: false,
    // Surface dead code (e.g. statements after a `return`) as a TS7027 "Unreachable
    // code detected." diagnostic, which `tsCategoryToSeverity()` renders as a
    // *warning* marker rather than an error — the one warning-severity diagnostic
    // the script linter emits.
    allowUnreachableCode: false,
    // `@typescript/vfs` defaults moduleResolution to the legacy `node10`, which
    // TypeScript 6 rejects unless deprecations are explicitly silenced.
    ignoreDeprecations: "6.0"
};

/** Cached lib.*.d.ts map; built once (see `createEnv`) and cloned per editor. */
let cachedLibFilesMap: Map<string, string> | null = null;

export async function createEnv(mime: string, context: ScriptApiContext = {}) {
    const tsModule = await import("typescript");
    /* v8 ignore next -- typescript ships as CJS, so the interop namespace always carries
       `default`; the fallback only covers a future ESM-native build. */
    const ts = tsModule.default ?? tsModule;
    const { createSystem, createVirtualTypeScriptEnvironment } = await import("@typescript/vfs");
    // Dynamically imported so the bundled lib.*.d.ts text lands in the lazy
    // script-editor chunk (loaded only when a script note opens), not the editor
    // core used by every code note.
    const { tsLibFiles } = await import("./ts_lib_files.js");

    // The TypeScript lib.*.d.ts files are bundled (see ./ts_lib_files) so the
    // language service works offline — no CDN fetch. The lib map is built once
    // and cached at module level: `Object.entries` over dozens of large .d.ts
    // strings is expensive, so subsequent calls clone the cached map instead.
    // Each editor still gets its own copy so concurrent script notes (e.g.
    // split view) don't clobber each other's source file.
    if (!cachedLibFilesMap) {
        cachedLibFilesMap = new Map<string, string>(Object.entries(tsLibFiles));
    }
    const fsMap = new Map<string, string>(cachedLibFilesMap);
    const path = scriptPath(mime);
    // Seed with a space, never an empty string: `@typescript/vfs` treats an
    // empty root file as "not found" (TS6053) at program creation. `tsSync`
    // likewise pushes `doc || ' '`, so the script file is never empty at runtime.
    fsMap.set(path, " ");

    const rootFiles = [path, API_GLOBALS_PATH];

    if (isFrontendMime(mime)) {
        // Frontend `api` types come from the shared, self-contained public surface
        // in @triliumnext/commons (single source of truth, drift-guarded against the
        // real implementation). Inject the module verbatim plus a bridge that exposes
        // it as the `api` global. Relative `?raw` (not a bare specifier) so it lands
        // in the lazy chunk and isn't gated by package `exports`.
        const apiTypes = (await import("../../../commons/src/lib/script_api.ts?raw")).default;
        fsMap.set(API_TYPES_PATH, apiTypes);
        // The api's library types are empty interfaces in commons, which has no jQuery or Preact
        // types; here, where those load, they extend the real ones.
        const preactAugmentation = mime === SCRIPT_MIME_JSX
            ? `    type TriliumPreact = typeof import("trilium:preact");\n    interface ScriptPreact extends TriliumPreact {}\n`
            : "";
        fsMap.set(API_GLOBALS_PATH, `import type { FrontendApi } from "./trilium-script-api";\ndeclare global {\n    // eslint-disable-next-line no-var\n    var api: FrontendApi;\n}\n`
            + `declare module "./trilium-script-api" {\n    interface ScriptJQuery extends JQuery<HTMLElement> {}\n${preactAugmentation}}\n`);
        rootFiles.push(API_TYPES_PATH);

        // Frontend scripts run in the browser with jQuery available as `$` / `jQuery`;
        // backend scripts run server-side and have neither.
        const { jqueryGlobals } = await import("./jquery_types.js");
        fsMap.set(JQUERY_DTS_PATH, jqueryGlobals);
        rootFiles.push(JQUERY_DTS_PATH);

        // Frontend scripts also have the browser `glob` global (`window.glob`);
        // backend scripts don't. Its real type lives in the client app, so a curated
        // declaration is injected here (see ./glob_types).
        const { globGlobals } = await import("./glob_types.js");
        fsMap.set(GLOB_DTS_PATH, globGlobals);
        rootFiles.push(GLOB_DTS_PATH);
    } else {
        // Backend `api` types come from the same shared public surface in commons
        // (single source of truth, drift-guarded). No jQuery or DOM: backend scripts run in Node
        // and in a Web Worker, whose shared globals ./backend_globals declares.
        const apiTypes = (await import("../../../commons/src/lib/script_api.ts?raw")).default;
        fsMap.set(API_TYPES_PATH, apiTypes);
        // `req`/`res`/`pathParams` only exist at runtime for custom request handlers,
        // so omit them from the `api` global for every other backend note.
        const apiType = context.customRequestHandler
            ? "BackendApi"
            : `Omit<BackendApi, ${CUSTOM_REQUEST_HANDLER_MEMBERS.map((m) => `"${m}"`).join(" | ")}>`;
        const noteGlobal = context.bulkActionNote ? "    var note: ScriptBNote;\n" : "";
        fsMap.set(API_GLOBALS_PATH, `import type { BackendApi, ScriptBNote } from "./trilium-script-api";\ndeclare global {\n    // eslint-disable-next-line no-var\n    var api: ${apiType};\n${noteGlobal}}\n`);
        rootFiles.push(API_TYPES_PATH);

        const { backendGlobals } = await import("./backend_globals.js");
        fsMap.set(BACKEND_GLOBALS_DTS_PATH, backendGlobals);
        rootFiles.push(BACKEND_GLOBALS_DTS_PATH);
    }

    if (mime === SCRIPT_MIME_JSX) {
        // JSX notes import Preact/the api via bare specifiers (`trilium:preact`,
        // `trilium:api`). Inject the real Preact .d.ts under `/node_modules/preact`
        // so those modules — and the `JSX.IntrinsicElements` namespace — resolve.
        const { preactVfsFiles, triliumModulesDts } = await import("./preact_types.js");
        for (const [filePath, content] of Object.entries(preactVfsFiles)) {
            fsMap.set(filePath, content);
        }
        fsMap.set(TRILIUM_MODULES_DTS_PATH, triliumModulesDts);
        rootFiles.push(TRILIUM_MODULES_DTS_PATH);
    }

    const compilerOptions = {
        ...COMPILER_OPTIONS,
        target: ts.ScriptTarget.ES2020,
        lib: isFrontendMime(mime) ? [ "es2020", "dom" ] : [ "es2020" ],
        // The runtime uses the classic `h` transform, but we only type-check (never
        // emit), so the automatic runtime is cleaner: it pulls `JSX.IntrinsicElements`
        // from `preact/jsx-runtime`, giving real element/attribute typing without a
        // factory symbol in scope.
        ...(mime === SCRIPT_MIME_JSX
            ? { jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "preact" }
            : {})
    };

    const system = createSystem(fsMap);
    return createVirtualTypeScriptEnvironment(system, rootFiles, ts, compilerOptions);
}

export interface TypeCompletion {
    /** Editor extensions wiring the TypeScript environment (sync, lint, hover). */
    extensions: Extension[];
    /** Looks up the completions at a position, or null for a MIME type with no language service. */
    complete: TypeCompleter | null;
}

/** The completions at `pos`, best first, or null where the language service offers none there. */
export type TypeCompleter = (pos: number) => Promise<TypeCompletionEntry[] | null>;

/** A completion the TypeScript language service offers. */
export interface TypeCompletionEntry {
    label: string;
    /** The kind of symbol, as CodeMirror names it (`function`, `property`, …). */
    type?: string;
}

/**
 * Wires the TypeScript language service into the editor for the given script
 * MIME type. The completions are returned as a `complete` function rather than an
 * extension, so the host can list them alongside its own entries, such as snippets.
 *
 * Returns empty extensions and a null `complete` for non-script MIME types.
 *
 * `context` tunes the offered `api` surface per note (e.g. exposing
 * `req`/`res`/`pathParams` only for custom request handlers).
 */
export async function buildTypeCompletion(mime: string, context: ScriptApiContext = {}): Promise<TypeCompletion> {
    if (!isScriptMime(mime)) {
        return { extensions: [], complete: null };
    }

    const env = await createEnv(mime, context);
    const [ { getAutocompletion }, { tsLinter }, { tsHover } ] = await Promise.all([
        import("./codemirror-ts/autocomplete.js"),
        import("./codemirror-ts/lint.js"),
        import("./codemirror-ts/hover.js")
    ]);
    // `tsLinter` only underlines diagnostics inline; `lintGutter` adds the
    // error/warning markers in the gutter (as the old ESLint integration did).
    const { lintGutter } = await import("@codemirror/lint");
    const path = scriptPath(mime);

    return {
        extensions: [
            tsSync(env, path),
            tsLinter({ env, path, diagnosticCodesToIgnore: ignoredDiagnosticCodes(mime) }),
            tsHover({ env, path, renderTooltip: renderHoverTooltip }),
            lintGutter(),
            hoverTheme
        ],
        async complete(pos) {
            const options = await getAutocompletion({ env, path, pos });
            if (!options) return null;

            return options
                .sort((a, b) => b.boost - a.boost)
                .map(({ label, type }) => ({ label, type }));
        }
    };
}

/**
 * Writes the editor's document into the script at `path`: when the plugin joins an editor, at its
 * creation or through a reconfiguration, and on every change after that.
 */
export function tsSync(env: VirtualTypeScriptEnvironment, path: string) {
    // An empty script reads as missing to `@typescript/vfs` (see `createEnv()`).
    const sync = (state: EditorState) => env.updateFile(path, state.doc.toString() || " ");

    return ViewPlugin.fromClass(class {
        constructor(view: EditorView) {
            sync(view.state);
        }

        update(update: ViewUpdate) {
            if (update.docChanged) sync(update.state);
        }
    });
}

/** Separates the JSDoc body/tags from the signature in the hover tooltip. */
const hoverTheme = EditorView.baseTheme({
    ".cm-ts-hover-doc": {
        marginTop: "4px",
        paddingTop: "4px",
        borderTop: "1px solid rgba(128, 128, 128, 0.3)",
        whiteSpace: "pre-wrap",
        opacity: "0.85"
    },
    ".cm-ts-hover-tag": {
        marginTop: "2px",
        opacity: "0.8"
    },
    ".cm-ts-hover-tag-name": {
        fontWeight: "bold"
    }
});

/** A SymbolDisplayPart-ish text fragment, as returned by the TS quick-info API. */
interface DisplayPart {
    text: string;
    kind?: string;
}

/**
 * Hover tooltip renderer that — unlike `defaultRenderer` in `./codemirror-ts/hover`, which
 * shows only the signature — also renders the JSDoc body and tags (`@param`,
 * `@returns`, `@example`, …). The doc text comes straight from the shared API
 * surface's `/** … *​/` comments.
 */
export function renderHoverTooltip(info: { quickInfo?: { displayParts?: DisplayPart[]; documentation?: DisplayPart[]; tags?: { name: string; text?: DisplayPart[] }[] } }): { dom: HTMLElement } {
    const quickInfo = info.quickInfo;
    const dom = document.createElement("div");
    dom.className = "cm-ts-hover";

    const signature = dom.appendChild(document.createElement("div"));
    signature.className = "cm-ts-hover-signature";
    for (const part of quickInfo?.displayParts ?? []) {
        const span = signature.appendChild(document.createElement("span"));
        span.className = `quick-info-${part.kind ?? "text"}`;
        span.textContent = part.text;
    }

    const documentation = (quickInfo?.documentation ?? []).map((p) => p.text).join("");
    if (documentation) {
        const docEl = dom.appendChild(document.createElement("div"));
        docEl.className = "cm-ts-hover-doc";
        docEl.textContent = documentation;
    }

    for (const tag of quickInfo?.tags ?? []) {
        const tagEl = dom.appendChild(document.createElement("div"));
        tagEl.className = "cm-ts-hover-tag";
        const name = tagEl.appendChild(document.createElement("span"));
        name.className = "cm-ts-hover-tag-name";
        name.textContent = `@${tag.name}`;
        const text = (tag.text ?? []).map((p) => p.text).join("");
        if (text) {
            tagEl.appendChild(document.createTextNode(` ${text}`));
        }
    }

    return { dom };
}

/** TS1108: A 'return' statement can only be used within a function body. */
const TS_RETURN_OUTSIDE_FUNCTION = 1108;
/** TS1375: top-level 'await' is only allowed when the file is a module. */
const TS_TOP_LEVEL_AWAIT = 1375;

/**
 * Diagnostic codes suppressed for the given script MIME type. Trilium wraps every
 * script in a function before executing it (see the client's `bundle.ts` and the
 * server's `script.ts`), so grammar that's only valid inside a function body is
 * fine at runtime:
 *  - both wrappers are functions, so a top-level `return` is always valid;
 *  - only the frontend wrapper is `async`, so top-level `await` is valid in
 *    frontend scripts but genuinely invalid in backend ones.
 */
function ignoredDiagnosticCodes(mime: string): number[] {
    // JSX render notes are real modules (`import`/`export default`) transpiled by
    // `buildJsx`, not wrapped in a function — so the function-body grammar
    // exemptions below don't apply (top-level `return` is genuinely invalid, and
    // top-level `await` is allowed natively in a module).
    if (mime === SCRIPT_MIME_JSX) {
        return [];
    }
    const codes = [TS_RETURN_OUTSIDE_FUNCTION];
    if (mime === SCRIPT_MIME_FRONTEND) {
        codes.push(TS_TOP_LEVEL_AWAIT);
    }
    return codes;
}

/**
 * Returns the TypeScript diagnostic codes the script-note language service
 * surfaces for `code` under the given script MIME type, using the exact compiler
 * options and ignore list the editor uses. Mirrors `getLints()` in
 * `./codemirror-ts/lint` (syntactic + semantic, minus the ignored codes), so tests reflect
 * what the user actually sees. Intended for tests asserting which diagnostics
 * are (and aren't) surfaced.
 */
export async function getScriptDiagnosticCodes(mime: string, code: string, context: ScriptApiContext = {}): Promise<number[]> {
    const env = await createEnv(mime, context);
    const path = scriptPath(mime);
    env.updateFile(path, code.length ? code : " ");
    const diagnostics = [
        ...env.languageService.getSyntacticDiagnostics(path),
        ...env.languageService.getSemanticDiagnostics(path)
    ];
    const ignored = ignoredDiagnosticCodes(mime);
    return diagnostics
        .map((d) => d.code)
        .filter((code) => !ignored.includes(code));
}

/**
 * Returns the diagnostics the editor's `tsLinter` shows for `code` under the given
 * script MIME type, as CodeMirror diagnostics. Intended for tests asserting how a
 * diagnostic reads.
 */
export async function getScriptLints(mime: string, code: string, context: ScriptApiContext = {}) {
    const env = await createEnv(mime, context);
    const path = scriptPath(mime);
    env.updateFile(path, code.length ? code : " ");
    const { getLints } = await import("./codemirror-ts/lint.js");
    return getLints({ env, path, diagnosticCodesToIgnore: ignoredDiagnosticCodes(mime) });
}

/**
 * Returns the completion entry names the language service offers at `offset` in
 * `code` for the given script MIME type — the same `getCompletionsAtPosition`
 * call that `getAutocompletion()` makes for the editor's completion list. Intended for tests
 * asserting which completions (api members, JSX elements/attributes, …) are
 * surfaced.
 */
export async function getScriptCompletions(mime: string, code: string, offset: number, context: ScriptApiContext = {}): Promise<string[]> {
    const env = await createEnv(mime, context);
    const path = scriptPath(mime);
    env.updateFile(path, code.length ? code : " ");
    const completions = env.languageService.getCompletionsAtPosition(path, offset, {});
    /* v8 ignore next -- the service clamps an out-of-range offset rather than returning nothing,
       so this only guards a language-service failure. */
    return completions?.entries.map((entry) => entry.name) ?? [];
}
