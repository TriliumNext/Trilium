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
    /** Which provider built it. */
    providerId: string;
    /** How many ES modules the package resolved to. */
    fileCount: number;
    /** Bytes of source across those modules. */
    size: number;
    /** When the install last wrote it, as a UTC datetime string. */
    dateModified: string;
}
