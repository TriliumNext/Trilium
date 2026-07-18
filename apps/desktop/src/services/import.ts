import type { NativeImportOptions, NativeImportPickResult, NativeImportResult } from "@triliumnext/commons";
import { becca, becca_loader, cls, type File, getLog, importDispatchService, type ImportOptions, TaskContext, utils as coreUtils } from "@triliumnext/core";
import { default as electron } from "electron";
import { readFile, stat } from "fs/promises";
import { t } from "i18next";
import { basename, extname } from "path";

interface ImportFromTokenOpts {
    token: string;
    parentNoteId: string;
    taskId: string;
    options: NativeImportOptions;
    /** Set only on the final file of a batch, so the success toast fires once everything is imported. */
    last: boolean;
    /** Routes the file to a specific importer (e.g. "obsidian"); the provider dialogs set this. */
    format?: string;
}

/**
 * Registers the desktop-native import IPC handlers (reachable only from the import dialog's "browse" action).
 *
 * Security model: the renderer **never** supplies a path. The OS dialog runs here in the main process and
 * is the *only* thing that mints an access grant; `import-pick-files` returns single-use, short-lived
 * **tokens** (plus display filenames), and `import-from-token` accepts a token — not a path. So a note
 * script can at most pop the dialog (the user still has to pick a file) and can never read an arbitrary
 * file: it can't forge a valid token, and there's no path parameter to abuse.
 *
 * Any importable file is accepted, but the reason this path exists is large `.zip` archives: a zip is read
 * **in place** (`{ path }`, streamed per entry) so a multi-GB import is never copied to a temp file or held
 * in memory. Smaller single files are read into a buffer and dispatched exactly like an HTTP upload.
 */
export function setupImportHandlers() {
    electron.ipcMain.handle("import-pick-files", async (): Promise<NativeImportPickResult> => {
        const focusedWindow = electron.BrowserWindow.getFocusedWindow();
        if (!focusedWindow) {
            return { status: "cancelled" };
        }

        // Async dialog: showOpenDialogSync blocks the main process event loop (freezing the UI, WebSockets
        // and background tasks) for as long as the picker is open.
        const { canceled, filePaths } = await electron.dialog.showOpenDialog(focusedWindow, {
            properties: ["openFile", "multiSelections"]
        });
        if (canceled || filePaths.length === 0) {
            return { status: "cancelled" };
        }

        return {
            status: "selected",
            files: filePaths.map((path) => ({ token: grantFileAccess(path), fileName: basename(path) }))
        };
    });

    electron.ipcMain.handle("import-grant-dropped", async (_e, paths: string[]): Promise<NativeImportPickResult> => {
        // Paths come from the preload's getPathForFile (user-dropped files only); mint a grant for each, the
        // same capability the OS dialog hands out. Skip anything that isn't a regular file (a dropped folder,
        // or a path that vanished) so the renderer falls back to the upload route instead of failing later.
        const files: { token: string; fileName: string }[] = [];
        for (const path of paths) {
            try {
                if ((await stat(path)).isFile()) {
                    files.push({ token: grantFileAccess(path), fileName: basename(path) });
                }
            } catch {
                // Unreadable/missing path — skip it.
            }
        }

        return files.length > 0 ? { status: "selected", files } : { status: "cancelled" };
    });

    electron.ipcMain.handle("import-from-token", async (_e, opts: ImportFromTokenOpts): Promise<NativeImportResult> => {
        const path = redeemFileAccess(opts.token);
        if (!path) {
            return { status: "error", message: t("import.invalid_file_grant") };
        }

        try {
            return { status: "imported", importedNoteId: await runNativeImport(path, opts) };
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            TaskContext.getInstance(opts.taskId, "importNotes", opts.options).reportError(message);
            getLog().error(`Native import failed: ${coreUtils.safeExtractMessageAndStackFromError(e)}`);
            return { status: "error", message };
        }
    });
}

// token -> { absolute path, expiry }. A grant is the capability handed to the renderer in place of a path.
const fileGrants = new Map<string, { path: string; expiresAt: number }>();
const GRANT_TTL_MS = 5 * 60 * 1000;

/** Mints a single-use, time-limited token for a path the *user* picked in the OS dialog. */
function grantFileAccess(path: string): string {
    // Drop any grants the user never redeemed so the map can't grow unbounded across repeated dialogs.
    const now = Date.now();
    for (const [existingToken, grant] of fileGrants) {
        if (grant.expiresAt < now) {
            fileGrants.delete(existingToken);
        }
    }

    const token = coreUtils.randomString(32);
    fileGrants.set(token, { path, expiresAt: now + GRANT_TTL_MS });
    return token;
}

/** Resolves and consumes a token (single-use); returns null if unknown or expired. */
function redeemFileAccess(token: string): string | null {
    const grant = fileGrants.get(token);
    fileGrants.delete(token);
    if (!grant || grant.expiresAt < Date.now()) {
        return null;
    }
    return grant.path;
}

/** Imports the file at `path` in place, reporting progress/success over the WebSocket like the HTTP route. */
async function runNativeImport(path: string, opts: ImportFromTokenOpts): Promise<string | undefined> {
    const parentNote = becca.getNoteOrThrow(opts.parentNoteId);
    const taskContext = TaskContext.getInstance(opts.taskId, "importNotes", opts.options);
    const options = opts.options satisfies ImportOptions;

    const file = await buildImportFile(path, options.explodeArchives, opts.format);

    const note = await cls.init(async () => {
        // Match the HTTP import route: skip per-entity events and change-id tracking during the bulk import.
        cls.disableEntityEvents();
        cls.ignoreEntityChangeIds();

        try {
            const result = await importDispatchService(taskContext, file, parentNote, options, opts.format);
            if (Array.isArray(result)) {
                // OPML reports a structured failure as a `[httpStatus, message]` array.
                throw new Error(String(result[1]));
            }
            return result;
        } finally {
            // Import ran with entity events disabled, so becca wasn't updated incrementally — reload it to
            // resync the cache even if the import threw partway (some notes may already be written). Must run
            // inside the CLS context: becca_loader.load() toggles slow-query logging via the namespace.
            becca_loader.load();
        }
    });

    // Small delay mirrors the route: let the transaction commit before the client reacts to success. Only
    // the last file of a batch fires the success toast so it doesn't flash once per file.
    if (opts.last) {
        setTimeout(() => taskContext.taskSucceeded({ parentNoteId: opts.parentNoteId, importedNoteId: note?.noteId }), 1000);
    }

    return note?.noteId;
}

/**
 * Builds the {@link File} the importer expects from a path on disk. A zip that's read in place — a generic
 * zip that will be exploded, or any tagged provider zip (obsidian/anytype/notion/keep) — is left unbuffered
 * (an empty buffer + the `path`) so it streams per entry; every other file is small enough to read into
 * memory here. The MIME is resolved by the importer from the filename, so it's left blank.
 */
async function buildImportFile(path: string, explodeArchives: boolean, format?: string): Promise<File> {
    const fileName = basename(path);
    const streamsFromPath = !!format || (extname(fileName).toLowerCase() === ".zip" && explodeArchives);
    return {
        originalname: fileName,
        mimetype: "",
        buffer: streamsFromPath ? Buffer.alloc(0) : await readFile(path),
        path
    };
}
