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

/** One package the npm registry offered for a search. */
export interface ScriptModuleSearchResult {
    name: string;
    /** Latest published version, which is what installing this result pins. */
    version: string;
    description?: string;
}
