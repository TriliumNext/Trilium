/**
 * Handles the `trilium://` custom URL protocol that lets external apps open a
 * specific note. The canonical URL form is:
 *
 *     trilium://note/<noteId>
 *
 * The noteId is the 12-char alphanumeric ID produced by
 * `utils.randomString(12)`, the well-known `root`, or an underscore-prefixed
 * system note ID (e.g. `_hidden`). The path component is URI-decoded so links
 * generated via `encodeURIComponent(noteId)` round-trip correctly.
 */

export const TRILIUM_PROTOCOL = "trilium";

const NOTE_ID_PATTERN = /^[A-Za-z0-9_]{1,128}$/;

/**
 * Returns the note ID embedded in a `trilium://note/<noteId>` URL, or null if
 * the input is not a well-formed Trilium app link. Defensively handles both
 * `trilium://note/abc123` (hostname = "note") and `trilium:///note/abc123`
 * (empty host, path = "/note/abc123") since different OS launchers normalize
 * the URL differently.
 */
export function extractNoteIdFromUrl(url: string): string | null {
    if (typeof url !== "string" || !url.startsWith(`${TRILIUM_PROTOCOL}://`)) {
        return null;
    }

    // Reject obvious path-traversal payloads before the URL parser silently
    // normalizes them away (e.g. `trilium://note/../foo` would otherwise
    // resolve to `trilium://note/foo`).
    if (/\/\.\.?(?:\/|$)/.test(url)) {
        return null;
    }

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    if (parsed.protocol !== `${TRILIUM_PROTOCOL}:`) {
        return null;
    }

    let rawPath: string;
    if (parsed.hostname === "note") {
        // trilium://note/<noteId>
        rawPath = parsed.pathname.replace(/^\/+/, "");
    } else if (!parsed.hostname) {
        // trilium:///note/<noteId> — some platforms produce this shape
        const stripped = parsed.pathname.replace(/^\/+/, "");
        if (!stripped.startsWith("note/")) {
            return null;
        }
        rawPath = stripped.slice("note/".length);
    } else {
        return null;
    }

    // Take only the first path segment so trailing slashes / fragments don't
    // pollute the ID, and decode percent-encoding so links generated with
    // `encodeURIComponent` round-trip cleanly.
    const firstSegment = rawPath.split("/")[0] ?? "";
    let decoded: string;
    try {
        decoded = decodeURIComponent(firstSegment);
    } catch {
        return null;
    }

    if (!NOTE_ID_PATTERN.test(decoded)) {
        return null;
    }

    return decoded;
}

/**
 * Scans an argv-like list for a `trilium://note/<noteId>` URL and returns the
 * embedded note ID. Used on cold launch and `second-instance` to recover the
 * note ID the OS passed alongside the executable path.
 */
export function extractNoteIdFromArgs(args: readonly string[]): string | null {
    for (const arg of args) {
        const noteId = extractNoteIdFromUrl(arg);
        if (noteId) {
            return noteId;
        }
    }
    return null;
}

/**
 * Returns the canonical app link URL for a given note ID. Use this everywhere
 * the UI offers users a copy-to-clipboard action so the format stays in lockstep
 * with the parser.
 */
export function buildAppLinkForNote(noteId: string): string {
    return `${TRILIUM_PROTOCOL}://note/${encodeURIComponent(noteId)}`;
}
