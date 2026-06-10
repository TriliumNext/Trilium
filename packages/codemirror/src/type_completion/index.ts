import type { CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Full IntelliSense for backend/frontend script notes.
 *
 * Runs the real TypeScript language service (via `@typescript/vfs` +
 * `@valtown/codemirror-ts`) over the script source, fed with a curated
 * declaration of Trilium's `api` global. This replaces the ESLint-based
 * linting for these two MIME types with type-aware completion, hover docs
 * and diagnostics from a single source.
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
const TRILIUM_MODULES_DTS_PATH = "/trilium-modules.d.ts";

/** The virtual source-file path used for a given script MIME type. */
function scriptPath(mime: string): string {
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
    // code detected." diagnostic, which `@valtown/codemirror-ts` renders as a
    // *warning* marker rather than an error — the one warning-severity diagnostic
    // the script linter emits.
    allowUnreachableCode: false,
    // `@typescript/vfs` defaults moduleResolution to the legacy `node10`, which
    // TypeScript 6 rejects unless deprecations are explicitly silenced.
    ignoreDeprecations: "6.0"
};

/** Cached lib.*.d.ts map; built once (see `createEnv`) and cloned per editor. */
let cachedLibFilesMap: Map<string, string> | null = null;

async function createEnv(mime: string, context: ScriptApiContext = {}) {
    const tsModule = await import("typescript");
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
        fsMap.set(API_GLOBALS_PATH, `import type { FrontendApi } from "./trilium-script-api";\ndeclare global {\n    // eslint-disable-next-line no-var\n    var api: FrontendApi;\n}\n`);
        rootFiles.push(API_TYPES_PATH);

        // Frontend scripts run in the browser with jQuery available as `$` / `jQuery`;
        // backend scripts run server-side and have neither.
        const { jqueryGlobals } = await import("./jquery_types.js");
        fsMap.set(JQUERY_DTS_PATH, jqueryGlobals);
        rootFiles.push(JQUERY_DTS_PATH);
    } else {
        // Backend `api` types come from the same shared public surface in commons
        // (single source of truth, drift-guarded). No jQuery/DOM server-side.
        const apiTypes = (await import("../../../commons/src/lib/script_api.ts?raw")).default;
        fsMap.set(API_TYPES_PATH, apiTypes);
        // `req`/`res`/`pathParams` only exist at runtime for custom request handlers,
        // so omit them from the `api` global for every other backend note.
        const apiType = context.customRequestHandler
            ? "BackendApi"
            : `Omit<BackendApi, ${CUSTOM_REQUEST_HANDLER_MEMBERS.map((m) => `"${m}"`).join(" | ")}>`;
        fsMap.set(API_GLOBALS_PATH, `import type { BackendApi } from "./trilium-script-api";\ndeclare global {\n    // eslint-disable-next-line no-var\n    var api: ${apiType};\n}\n`);
        rootFiles.push(API_TYPES_PATH);
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
        lib: ["es2020", "dom"],
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
    /** Autocompletion source for the editor's shared `autocompletion()`, or null. */
    source: CompletionSource | null;
}

/**
 * Wires the TypeScript language service into the editor for the given script
 * MIME type. The completion `source` is returned separately (rather than as its
 * own `autocompletion()` extension) so it can be merged with other sources —
 * e.g. snippet slash-commands — into the editor's single autocompletion.
 *
 * Returns empty extensions and a null source for non-script MIME types.
 *
 * `context` tunes the offered `api` surface per note (e.g. exposing
 * `req`/`res`/`pathParams` only for custom request handlers).
 */
export async function buildTypeCompletion(mime: string, context: ScriptApiContext = {}): Promise<TypeCompletion> {
    if (!isScriptMime(mime)) {
        return { extensions: [], source: null };
    }

    const env = await createEnv(mime, context);
    const { tsFacet, tsSync, tsAutocomplete, tsLinter, tsHover } = await import("@valtown/codemirror-ts");
    // `tsLinter` only underlines diagnostics inline; `lintGutter` adds the
    // error/warning markers in the gutter (as the old ESLint integration did).
    const { lintGutter } = await import("@codemirror/lint");

    return {
        extensions: [
            tsFacet.of({ env, path: scriptPath(mime) }),
            tsSync(),
            tsLinter({ diagnosticCodesToIgnore: ignoredDiagnosticCodes(mime) }),
            tsHover({ renderTooltip: renderHoverTooltip }),
            lintGutter(),
            hoverTheme
        ],
        source: tsAutocomplete()
    };
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
 * Hover tooltip renderer that — unlike `@valtown/codemirror-ts`'s default, which
 * shows only the signature — also renders the JSDoc body and tags (`@param`,
 * `@returns`, `@example`, …). The doc text comes straight from the shared API
 * surface's `/** … *​/` comments.
 */
function renderHoverTooltip(info: { quickInfo?: { displayParts?: DisplayPart[]; documentation?: DisplayPart[]; tags?: { name: string; text?: DisplayPart[] }[] } }): { dom: HTMLElement } {
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
 * options and ignore list the editor uses. Mirrors `@valtown/codemirror-ts`'s
 * `getLints` (syntactic + semantic, minus the ignored codes), so tests reflect
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
 * Returns the completion entry names the language service offers at `offset` in
 * `code` for the given script MIME type — the same `getCompletionsAtPosition`
 * call that backs the editor's `tsAutocomplete()` source. Intended for tests
 * asserting which completions (api members, JSX elements/attributes, …) are
 * surfaced.
 */
export async function getScriptCompletions(mime: string, code: string, offset: number, context: ScriptApiContext = {}): Promise<string[]> {
    const env = await createEnv(mime, context);
    const path = scriptPath(mime);
    env.updateFile(path, code.length ? code : " ");
    const completions = env.languageService.getCompletionsAtPosition(path, offset, {});
    return completions?.entries.map((entry) => entry.name) ?? [];
}
