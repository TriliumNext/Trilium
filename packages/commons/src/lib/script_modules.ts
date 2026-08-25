/**
 * An installed npm package, as the client is told about it.
 *
 * Carries what a listing shows and nothing more: the module sources are megabytes and belong to the
 * runtime that imports them, not to a pane that lists what is installed.
 */
export interface ScriptModuleSummary {
    /** Note the package is stored in, and the handle for removing it. */
    noteId: string;
    /** `name@version`, as installed. */
    spec: string;
    /** The bare specifier `require()` takes: the package name and subpath, without the version. */
    name: string;
    /** Which build: `portable` runs wherever Trilium does, `node` only where Node.js does. */
    target: "portable" | "node";
    /** Which provider built it. */
    providerId: string;
    /** How many ES modules the package resolved to. */
    fileCount: number;
    /** Bytes of source across those modules. */
    size: number;
    /** When the install last wrote it, as a UTC datetime string. */
    dateModified: string;
}

/**
 * The TypeScript declarations one installed package is typed by, as the script editor is given them.
 *
 * Handed over whole rather than as a listing: the editor needs the text, and this is the only thing
 * that reads it. Laying them out where TypeScript looks for a package is the editor's business — see
 * `script_module_types.ts` in the codemirror package.
 */
export interface ScriptModuleTypes {
    /** The bare specifier these type, matching {@link ScriptModuleSummary.name}. */
    name: string;
    /** `name@version`, which a script can name instead where two versions are installed. */
    spec: string;
    /** Name of the file in {@link files} the package is typed by. */
    entry: string;
    files: { name: string; content: string }[];
}

/** One package the npm registry offered for a search. */
export interface ScriptModuleSearchResult {
    name: string;
    /** Latest published version, which is what installing this result pins. */
    version: string;
    description?: string;
}

/**
 * The name a compiled module file receives `import.meta` under.
 *
 * A function body is not a module, so the compile rewrites `import.meta` to a parameter. Both the
 * side that compiles and the side that evaluates have to agree on what to call it.
 */
export const SCRIPT_MODULE_IMPORT_META = "__triliumImportMeta";

/** One file of a package, compiled to CommonJS for a runtime with no loader for ES modules. */
export interface CompiledModuleFile {
    name: string;
    code: string;
    /** URL the file was built from, which is what its `import.meta.url` reports. */
    url: string;
}

/**
 * A package compiled and handed to the browser so a frontend script can require it.
 *
 * Compiled where the sources are rather than in the browser: the page would otherwise need a
 * compiler of its own, and on the browser-hosted builds that compiler is already in the worker
 * holding the database.
 */
export interface FrontendScriptModule {
    noteId: string;
    /** The specifiers in the bundle that name this package. */
    specifiers: string[];
    /** Name of the file in {@link files} to evaluate first. */
    entry: string;
    /** Identity of the stored files, so a package already evaluated can be reused. */
    fingerprint: string;
    files: CompiledModuleFile[];
}

/** A package a frontend script asks for that cannot be handed to it, and why. */
export interface UnavailableScriptModule {
    specifier: string;
    reason: string;
}
