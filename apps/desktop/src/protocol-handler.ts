import windowService from "@triliumnext/server/src/services/window.js";

const PROTOCOL = "trilium";

/** Note ID to navigate to once the main window finishes loading. */
let pendingNoteId: string | null = null;

/**
 * Parses a `trilium://` URL and returns the note ID, or `null` if the URL
 * cannot be parsed.
 *
 * Supported formats:
 *   trilium://note/<noteId>   (canonical)
 *   trilium://<noteId>        (shorthand)
 */
function parseTriliumUrl(rawUrl: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return null;
    }

    if (parsed.protocol !== `${PROTOCOL}:`) {
        return null;
    }

    // trilium://note/<noteId> → hostname = "note", pathname = "/<noteId>"
    if (parsed.hostname === "note") {
        const noteId = parsed.pathname.replace(/^\/+/, "").trim();
        return noteId || null;
    }

    // trilium://<noteId> → hostname = "<noteId>"
    const noteId = parsed.hostname.trim();
    return noteId || null;
}

/**
 * Scans process arguments for a `trilium://` URL or `--open-note=<noteId>`
 * flag and returns the target note ID.
 */
function extractNoteIdFromArgs(args: string[]): string | null {
    for (const arg of args) {
        if (arg.startsWith(`${PROTOCOL}://`)) {
            return parseTriliumUrl(arg);
        }

        const match = arg.match(/^--open-note=(.+)$/);
        if (match) {
            return match[1].trim() || null;
        }
    }
    return null;
}

/**
 * Focuses the appropriate window and sends navigation IPC to the renderer.
 * Waits for `did-finish-load` if the page is still loading (first launch).
 *
 * Returns `false` when no usable window exists yet.
 */
function navigateToNote(noteId: string): boolean {
    const win =
        windowService.getLastFocusedWindow() ?? windowService.getMainWindow();
    if (!win || win.isDestroyed()) {
        return false;
    }

    if (win.isMinimized()) {
        win.restore();
    }
    win.show();
    win.focus();

    if (win.webContents.isLoading()) {
        win.webContents.once("did-finish-load", () => {
            win.webContents.send("openInSameTab", noteId);
        });
    } else {
        win.webContents.send("openInSameTab", noteId);
    }

    return true;
}

/**
 * Handles an incoming protocol URL (from `open-url`, `second-instance`, or
 * first-launch argv).  If the main window is not yet available the note ID is
 * queued for {@link processPendingNavigation}.
 */
function handleProtocolUrl(url: string): void {
    const noteId = parseTriliumUrl(url);
    if (!noteId) {
        return;
    }

    if (!navigateToNote(noteId)) {
        // Window not created yet — defer until after onReady().
        pendingNoteId = noteId;
    }
}

/**
 * Navigates to the note that was requested before the window was ready, then
 * clears the pending state.  Safe to call when there is nothing pending.
 */
function processPendingNavigation(): void {
    if (pendingNoteId) {
        const noteId = pendingNoteId;
        pendingNoteId = null;
        navigateToNote(noteId);
    }
}

export default {
    PROTOCOL,
    parseTriliumUrl,
    extractNoteIdFromArgs,
    navigateToNote,
    handleProtocolUrl,
    processPendingNavigation,
};
