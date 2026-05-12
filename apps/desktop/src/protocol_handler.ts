/**
 * Handles the `trilium://` custom URL protocol that lets external apps open a
 * specific note. Example: `trilium://abc123def456`.
 *
 * Note IDs are alphanumeric with underscores (see `utils.randomString(12)` in
 * the server). Length is bounded to reject pathological inputs.
 */

export const TRILIUM_PROTOCOL = "trilium";

const NOTE_ID_PATTERN = /^[A-Za-z0-9_]{1,128}$/;

/**
 * Returns the note ID embedded in a `trilium://` URL, or null if the input is
 * not a valid Trilium protocol URL.
 *
 * Both `trilium://abc123` and `trilium:///abc123` are accepted — some
 * platforms include the empty host, others don't.
 */
export function extractNoteIdFromUrl(url: string): string | null {
    if (typeof url !== "string" || !url.startsWith(`${TRILIUM_PROTOCOL}://`)) {
        return null;
    }

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    const candidate =
        parsed.hostname || parsed.pathname.replace(/^\/+/, "") || "";
    if (!NOTE_ID_PATTERN.test(candidate)) {
        return null;
    }

    return candidate;
}

/**
 * Scans an argv-like list for a `trilium://` URL and returns the embedded
 * note ID. Used on cold launch and `second-instance` to recover the note ID
 * the OS passed alongside the executable path.
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
