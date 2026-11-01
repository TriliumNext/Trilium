/**
 * The Electron API is the bridge between Trilium's interface and Electron's main process, exposed
 * as the global `window.electronApi` in the desktop application.
 *
 * It is not part of the `api` global of script notes, but frontend scripts running in the desktop
 * application can call it directly. It is `undefined` in the browser and in the standalone build,
 * so guard calls with `if (window.electronApi)`.
 *
 * @packageDocumentation
 */
import type { SecurityToggleApi } from "./security_settings.js";
import type { TranscriptSource } from "./transcript.js";

/**
 * Parameters delivered by the main process to the renderer when the user opens
 * the system context menu (right-click) somewhere inside a web view.
 *
 * Mirrors the subset of fields from Electron's `Electron.ContextMenuParams`
 * that the renderer actually consumes when building its custom context menu.
 */
export interface ElectronContextMenuParams {
    /** Horizontal position of the click, in CSS pixels, relative to the web view. */
    x: number;
    /** Vertical position of the click, in CSS pixels, relative to the web view. */
    y: number;
    /** URL of the link the user clicked on, or an empty string if not on a link. */
    linkURL: string;
    /** Visible text of the link the user clicked on, or an empty string. */
    linkText: string;
    /** Media kind under the cursor (e.g. `"none"`, `"image"`, `"video"`, `"audio"`). */
    mediaType: string;
    /** Whether the element under the cursor is editable (input, textarea, contenteditable). */
    isEditable: boolean;
    /** Currently selected text, or an empty string if nothing is selected. */
    selectionText: string;
    /** The misspelled word under the cursor, or an empty string if none. */
    misspelledWord: string;
    /** Spell-check suggestions for {@link misspelledWord}, in order of relevance. */
    dictionarySuggestions: string[];
    /** Hints about which clipboard operations are currently available. */
    editFlags: {
        /** Whether the selection can be cut to the clipboard. */
        canCut: boolean;
        /** Whether the selection can be copied to the clipboard. */
        canCopy: boolean;
        /** Whether the clipboard contents can be pasted at the cursor. */
        canPaste: boolean;
    };
}

/**
 * Startup milestones the renderer may report to the main process for startup
 * timing instrumentation (see `apps/desktop/src/services/startup_metrics.ts`).
 *
 * - `client-full-render` — the client finished its initial render: the layout
 *   widgets are attached to the DOM, the froca note cache is loaded, and a
 *   frame of the rendered layout has been painted.
 */
export type RendererStartupMetric = "client-full-render";

/**
 * Window-level controls: zoom, theme, title bar, full screen, lifecycle, and
 * a handful of main → renderer event subscriptions.
 */
export interface ElectronWindowApi {
    // #region Zoom

    /**
     * Sets the page zoom factor for the current window.
     * @param factor `1.0` is 100%; e.g. `1.2` zooms to 120%.
     */
    setZoomFactor(factor: number): void;

    /** Returns the current page zoom factor (`1.0` = 100%). */
    getZoomFactor(): number;

    // #endregion

    // #region Theme

    /**
     * Overrides the operating system's reported color scheme for this app.
     * @param source The color scheme to report, or `"system"` to follow the OS setting.
     */
    setNativeThemeSource(source: "system" | "light" | "dark"): void;

    // #endregion

    // #region Title bar

    /**
     * Customizes the Windows and Linux native title bar overlay (the area containing the
     * minimize / maximize / close buttons). `height` also controls their vertical placement,
     * since the buttons are centered within the overlay. It is given in device-independent
     * pixels, which the page zoom does not scale — see {@link setWindowButtonPosition}.
     * @param options The overlay's background color, the color of the button symbols, and the
     * overlay's height.
     */
    setTitleBarOverlay(options: { color: string; symbolColor: string; height?: number }): void;

    /**
     * Repositions the macOS traffic-light window buttons. Coordinates are relative to the
     * window's top-left corner and given in device-independent pixels: the buttons are drawn by
     * the system rather than by the page, so unlike the surrounding chrome they are unaffected by
     * the page zoom factor and callers have to scale the offsets themselves.
     * @param position The offset of the buttons from the window's top-left corner.
     */
    setWindowButtonPosition(position: { x: number; y: number }): void;

    // #endregion

    // #region Full screen

    /** Registers a callback fired whenever the window enters full-screen mode. */
    onEnterFullScreen(callback: () => void): void;

    /** Registers a callback fired whenever the window leaves full-screen mode. */
    onLeaveFullScreen(callback: () => void): void;

    /** Synchronously returns whether the window is currently in full-screen mode. */
    isFullScreen(): boolean;

    /**
     * Enters or leaves full-screen mode.
     * @param enabled `true` to enter full-screen mode, `false` to leave it.
     */
    setFullScreen(enabled: boolean): void;

    // #endregion

    // #region Window state

    /** Minimizes the current window to the taskbar / dock. */
    minimizeWindow(): void;

    /** Maximizes the current window to fill the available screen area. */
    maximizeWindow(): void;

    /** Restores the window from a maximized state to its previous size. */
    unmaximizeWindow(): void;

    /** Synchronously returns whether the window is currently maximized. */
    isMaximized(): boolean;

    /** Closes the current window. */
    closeWindow(): void;

    /** Synchronously returns whether the window is pinned above all others. */
    isAlwaysOnTop(): boolean;

    /**
     * Pins the window above all others, or unpins it.
     * @param enabled `true` to pin the window, `false` to unpin it.
     */
    setAlwaysOnTop(enabled: boolean): void;

    /** Opens or closes Chromium DevTools for the current window. */
    toggleDevTools(): void;

    /**
     * Synchronously returns whether DevTools is currently open and docked into this window
     * (as opposed to detached into a separate window).
     */
    isDevToolsDocked(): boolean;

    // #endregion

    // #region Background effects

    /**
     * Sets the Windows 11 backdrop material applied behind the window contents. No-op on other
     * platforms.
     * @param material The material, such as `"mica"`, `"acrylic"`, `"tabbed"` or `"none"`.
     */
    setBackgroundMaterial(material: string): void;

    /**
     * Sets the macOS vibrancy effect applied behind the window contents. No-op on other platforms.
     * @param vibrancy The effect, such as `"sidebar"`, `"under-window"` or `"fullscreen-ui"`.
     */
    setVibrancy(vibrancy: string): void;

    // #endregion

    // #region App lifecycle

    /** Triggers a hard reload of every open Trilium window. */
    reloadAllWindows(): void;

    /** Quits the app and immediately relaunches it. */
    restartApp(): void;

    /**
     * Shows all hidden windows or hides all visible ones — used by the
     * "show/hide app" global shortcut and tray menu entry.
     */
    toggleAllWindows(): void;

    /** Clears the underlying Chromium HTTP cache. Resolves once the cache is empty. */
    clearCache(): Promise<void>;

    /** Brings the main window to the foreground, restoring it if minimized. */
    showWindow(): void;

    /**
     * Reports a renderer startup milestone to the main process, which records
     * it relative to OS process creation alongside the main-process startup
     * metrics. Only the first report of each metric is recorded; later reports
     * (e.g. after a window reload or from extra windows) are ignored.
     * @param metric The milestone the renderer reached.
     */
    reportStartupMetric(metric: RendererStartupMetric): void;

    // #endregion

    // #region Main → renderer events

    /**
     * Subscribes to globally registered keyboard shortcuts.
     * @param callback Receives the name of the action the shortcut triggers, not the keystroke.
     */
    onGlobalShortcut(callback: (actionName: string) => void): void;

    /**
     * Subscribes to "open note in active tab" requests originating from outside
     * the renderer (e.g. tray menu, deep links).
     * @param callback Receives the ID of the note to open.
     */
    onOpenInSameTab(callback: (noteId: string) => void): void;

    /**
     * Subscribes to changes of the DevTools docking state. While DevTools is docked, Chromium
     * disables the native window material (Mica / vibrancy).
     * @param callback Receives `true` while DevTools is attached to this window, and `false` when
     * it is closed or in a separate window.
     */
    onDevToolsDockChanged(callback: (docked: boolean) => void): void;

    // #endregion
}

/** Renderer access to the system clipboard for cases the standard Web API can't cover. */
export interface ElectronClipboardApi {
    /**
     * Writes a raw image (PNG-encoded bytes) to the system clipboard so it can be
     * pasted into other applications as an image rather than as a file.
     * @param buffer The PNG-encoded image.
     */
    copyImageToClipboard(buffer: Uint8Array): void;

    /**
     * Reads plain text from the system clipboard via the main-process
     * `electron.clipboard`. Used instead of `navigator.clipboard.readText()`
     * so the renderer's deny-by-default permission policy does not have to
     * grant the sensitive `clipboard-read` permission to the whole session.
     */
    readText(): Promise<string>;

    /**
     * Reads the HTML flavor of the system clipboard, the same way as {@link readText}. Empty when
     * the clipboard has no HTML.
     */
    readHTML(): Promise<string>;
}

/**
 * Wrappers around Electron's `shell` module for interacting with the OS
 * (default browser, default file handler, downloads, etc.).
 *
 * Every method here is validated in the main process before dispatch — see
 * `apps/server/src/services/shell_validators.ts`. The renderer is treated as
 * untrusted: invalid input throws on the main side rather than being silently
 * passed through to `electron.shell` / `WebContents`.
 */
export interface ElectronShellApi {
    /**
     * Opens a URL in the user's default external browser via
     * `electron.shell.openExternal`.
     *
     * **Security:** the scheme is matched against the allowlist in
     * `SHELL_OPEN_EXTERNAL_PROTOCOLS` (commons). Blocked schemes include
     * `file:`, `data:`, `smb:`, `ldap:`, `ldaps:`, `jar:`, and `view-source:` —
     * they cover Follina-class RCE primitives (`ms-msdt:`, `search-ms:`),
     * NTLM credential theft, and Java loader vectors. URLs that fail to parse
     * are rejected outright.
     *
     * @param url The URL to open.
     */
    openExternal(url: string): void;

    /**
     * Opens a local path with its default OS handler.
     *
     * **Security:** the path is canonicalized and must resolve to either the
     * Trilium data directory (or a descendant) or the Trilium tmp directory
     * (or a descendant). Anything else — absolute paths elsewhere on disk,
     * traversal attempts, UNC paths that don't normalize under those roots —
     * is rejected. Null bytes, empty strings, and non-existent files are also
     * rejected.
     *
     * @param path A file in the Trilium data or tmp directory.
     * @returns An empty string on success, or an error message on failure.
     */
    openPath(path: string): Promise<string>;

    /**
     * Shows a local file in the OS file manager, with the file itself selected,
     * via `electron.shell.showItemInFolder`. For pointing at a file the user is
     * not meant to open — the database, whose reader is Trilium itself.
     *
     * **Security:** the same sandbox as {@link openPath}, with the database
     * file added as a root of its own, since `TRILIUM_DOCUMENT_PATH` may put it
     * outside the data directory. Revealing is the milder act of the two, the
     * file being selected rather than launched, but a path the renderer names
     * is still a path the renderer must not be free to choose.
     *
     * Nothing is reported back: the OS is asked to bring a window forward, and
     * whether it did is not something Electron answers.
     *
     * @param path A file in the Trilium data or tmp directory, or the database file.
     */
    showItemInFolder(path: string): void;

    /**
     * Opens a `file://` URL with its default OS handler. Exists as a separate
     * channel from {@link openExternal} because neither Electron API opens every
     * target correctly on Windows: `shell.openExternal` mishandles Unicode
     * characters in `file:` URLs, while `shell.openPath` opens a directory with
     * the Explorer-specific `explore` verb, bypassing the user's file manager.
     * The main process picks between them per target.
     *
     * **Security:** the URL must use the `file:` scheme and must have an
     * empty hostname. UNC paths (`file://attacker.example/share/x`) are
     * explicitly blocked because Windows would otherwise resolve them to
     * `\\attacker.example\share\x` and leak the user's NTLM hash via SMB
     * authentication. Drive-letter-as-host malformations like `file://C:/path`
     * are normalized to `file:///C:/path` before parsing.
     *
     * Note: unlike {@link openPath}, the resolved path is NOT confined to the
     * Trilium data / tmp directories — this channel handles user-clicked
     * `file://` links inside note content, which routinely reference arbitrary
     * locations on disk (`file:///C:/Users/me/Documents/contract.pdf` and
     * similar). Equivalent to a browser following a `file:` link the user
     * clicked. Treat clicks on attacker-influenced note content accordingly.
     *
     * @param fileUrl A `file:` URL with an empty hostname.
     * @returns An empty string on success, or an error message on failure.
     */
    openFileUrl(fileUrl: string): Promise<string>;

    /**
     * Triggers a Chromium download for the given URL — the file is saved
     * through the normal "Save As" flow instead of being opened in the
     * renderer.
     *
     * **Security:** locked to the renderer's own origin. The scheme, hostname,
     * and port must all match the running app's origin (`http://localhost:PORT`
     * for the dev server, or the custom `trilium-app://app/` protocol for
     * packaged Electron). Cross-origin downloads, hostless URLs (`data:`,
     * `blob:`, `about:`, plain `file:///`), and unparseable URLs are
     * rejected. This stops a compromised renderer from pre-positioning a
     * remote payload in the user's Downloads folder under a familiar name.
     *
     * @param url A URL on the app's own origin.
     */
    downloadURL(url: string): void;

    /**
     * Opens a file with a Trilium-specific custom handler (configured via the
     * "Open With" option), falling back to the OS default if none is set.
     *
     * **Security:** the path must resolve to a strict descendant of Trilium's
     * tmp directory and the file must exist on disk. The legitimate caller
     * always passes a path that was just written by `saveToTmpDir`; anything
     * else (the data dir itself, paths elsewhere on disk, null bytes, empty
     * strings) is rejected.
     *
     * @param filePath A file in Trilium's tmp directory, as written by `saveToTmpDir`.
     */
    openCustom(filePath: string): void;
}

/** Bridge for the native context menu shown over web contents. */
export interface ElectronContextMenuApi {
    /**
     * Subscribes to right-click events forwarded from the main process.
     * @param callback Receives where the user clicked and what is under the cursor.
     */
    onContextMenu(callback: (params: ElectronContextMenuParams) => void): void;

    /**
     * Executes a clipboard / text-input action on the focused web contents.
     * @param action The action to execute.
     * @param text The text to insert. `"insertText"` requires it; the other actions ignore it.
     */
    webContentsAction(action: "cut" | "copy" | "paste" | "pasteAndMatchStyle" | "insertText", text?: string): void;
}

/** Renderer-side access to Chromium's built-in spell checker. */
export interface ElectronSpellcheckApi {
    /** Adds a word to the user's personal dictionary so it is no longer flagged. */
    addWordToDictionary(word: string): void;

    /** Returns the BCP-47 language tags Chromium can spell-check on this platform. */
    getAvailableSpellCheckerLanguages(): string[];

    /**
     * Applies the spell-check language list to every open window's session
     * immediately, without an application restart. No-op on macOS, where the OS
     * spell checker auto-detects the language.
     * @param languageCodes Language tags returned by {@link getAvailableSpellCheckerLanguages}.
     */
    setSpellCheckerLanguages(languageCodes: string[]): void;

    /**
     * Enables or disables the built-in spell checker on every open window's
     * session immediately, without an application restart.
     * @param enabled `true` to enable the spell checker, `false` to disable it.
     */
    setSpellCheckerEnabled(enabled: boolean): void;
}

/** OS integration controls — system tray and autostart / launch-on-login. */
export interface ElectronSystemIntegrationApi {
    /** Rebuilds the tray icon and menu — call after changing tray-related settings. */
    reloadTray(): void;
    /** Re-applies the OS autostart entry after the `launchOnStartup` / `hideOnAutoStart` options change. */
    reapplyLaunchOnStartup(): void;
}

/**
 * Printing and PDF export flow. Trilium drives Electron's printing pipeline
 * through a small state machine that the main process owns, with progress and
 * results pushed back to the renderer via IPC events.
 */
export interface ElectronPrintingApi {
    /**
     * Reports rendering progress from the renderer to the main process.
     * @param progress The percentage rendered, from 0 to 100.
     */
    sendPrintProgress(progress: number): void;

    /**
     * Subscribes to progress updates emitted by the main process during a print
     * or PDF export run.
     * @param callback Receives the percentage done and the current stage, such as `"rendering"`.
     */
    onPrintProgress(callback: (data: { progress: number; action: string }) => void): void;

    /**
     * Subscribes to the "print finished" event, fired once the OS print job is dispatched.
     * @param callback Receives the main process's report on the job, or an error with a `message`,
     * and, for a job that printed the app window itself, the ID of the live print the job ended.
     */
    onPrintDone(callback: (printReport: unknown, liveJobId?: number) => void): void;

    /** Removes all listeners registered via {@link onPrintProgress} and {@link onPrintDone}. */
    removePrintListeners(): void;

    /** Returns the list of printers known to the OS. */
    getPrinters(): Promise<unknown[]>;

    /**
     * Asks the main process to render the current note as a PDF and return the
     * resulting bytes for the in-app preview. Result is delivered via
     * {@link onExportAsPdfPreviewResult}.
     * @param opts The note path, the page size, orientation, scale, margins and page ranges, and a
     * `requestId` the result echoes back.
     */
    exportAsPdfPreview(opts: Record<string, unknown>): void;

    /**
     * Subscribes to the result of an {@link exportAsPdfPreview} call.
     * @param callback Receives the PDF bytes or an error message, and the `requestId` of the call
     * the result answers.
     */
    onExportAsPdfPreviewResult(callback: (result: { buffer?: Uint8Array; error?: string; requestId?: number }) => void): void;

    /** Removes the listener registered via {@link onExportAsPdfPreviewResult}. */
    removeExportAsPdfPreviewResultListener(): void;

    /**
     * Persists a previously generated PDF buffer to disk via the native save
     * dialog.
     * @param data The PDF bytes, and the title to suggest as the file name.
     */
    savePdf(data: { title: string; buffer: Uint8Array }): void;

    /**
     * Sends the previewed PDF to the OS print dialog with the given options.
     * @param opts The options of {@link exportAsPdfPreview}, plus `silent` to print without the
     * dialog and `deviceName` to choose the printer.
     */
    printFromPreview(opts: Record<string, unknown>): void;
}

/**
 * In-process replacement for the renderer↔server WebSocket. Backed by
 * Chromium IPC instead of a TCP socket — no port is bound and no auth check
 * is needed because the channel is only reachable from the renderer the
 * BrowserWindow owns. Wire format is whatever the server's `MessagingProvider`
 * accepts (currently `WebSocketMessage` / log-error / log-info / ping).
 */
export interface ElectronWsApi {
    /**
     * Sends a message from the renderer to the main-process messaging hub.
     * @param message A message the server's `MessagingProvider` accepts.
     */
    send(message: unknown): void;

    /**
     * Subscribes to messages pushed from the main process.
     * @param callback Receives each message.
     * @returns An unsubscribe function. Call it when the listener is no longer needed (e.g. when a
     * BrowserWindow is unloaded) to avoid leaking handlers.
     */
    onMessage(callback: (message: unknown) => void): () => void;
}

/**
 * Accessors for the underlying Chromium navigation history of the current
 * web contents (back/forward stack), exposed so the renderer can mirror it
 * in custom UI such as the breadcrumb / tab back button.
 */
export interface ElectronNavigationApi {
    /** Clears the entire back/forward navigation history. */
    clearNavigationHistory(): void;

    /** Synchronously returns whether a back navigation is possible. */
    navigationCanGoBack(): boolean;

    /** Synchronously returns whether a forward navigation is possible. */
    navigationCanGoForward(): boolean;

    /** Returns every entry in the navigation history, oldest first. */
    navigationGetAllEntries(): Array<{ url: string; title: string }>;

    /** Returns the index of the currently active entry inside {@link navigationGetAllEntries}. */
    navigationGetActiveIndex(): number;

    /** Returns the total number of entries in the navigation history. */
    navigationLength(): number;

    /**
     * Navigates to the entry at the given index in the history stack.
     * @param index An index into {@link navigationGetAllEntries}.
     */
    navigationGoToIndex(index: number): void;

    /** Subscribes to top-level navigation events (URL changes that load a new document). */
    onDidNavigate(callback: () => void): void;

    /** Subscribes to in-page navigation events (hash changes, `history.pushState`). */
    onDidNavigateInPage(callback: () => void): void;

    /** Removes all listeners registered via {@link onDidNavigate} and {@link onDidNavigateInPage}. */
    removeDidNavigateListeners(): void;
}

/**
 * Security settings that live outside the database (in `data_dir/security.json`)
 * to prevent malicious scripts from modifying them. Changes require a native
 * OS confirmation dialog and an app restart to take effect.
 */
export interface ElectronSecurityApi extends SecurityToggleApi {
    /**
     * Requests enabling/disabling LAN access. When enabled, the desktop binds
     * its TCP listener to all interfaces (instead of loopback) so other devices
     * can reach it — e.g. to sync from another device. Same confirmation +
     * restart flow as above.
     * @param enabled `true` to listen on all interfaces, `false` to listen on loopback only.
     * @returns `true` once the user agreed and the change was written.
     */
    setLanAccessEnabled(enabled: boolean): Promise<boolean>;
}

/** What the Options UI needs to know about the stored backup passphrase. */
export interface BackupPassphraseStatus {
    /**
     * Whether the OS offers a keyring to keep the passphrase in. Without one it cannot be stored
     * safely, and since unattended backups cannot ask for it, encryption is unavailable altogether.
     */
    available: boolean;
    /** Whether a passphrase is currently stored. */
    set: boolean;
}

/** What became of a request to change the stored backup passphrase. */
export type BackupPassphraseChange =
    /** The change was confirmed and carried out. */
    | "applied"
    /** The user declined the OS confirmation, so nothing changed. */
    | "cancelled"
    /** There is no keyring on this system to keep a passphrase in. */
    | "unavailable";

/**
 * The backup passphrase, kept encrypted by the OS keyring in a file outside the database (the
 * database is what ends up inside the backup, so a passphrase stored there would ride along inside
 * the very container it protects).
 *
 * Deliberately write-only: there is no way to read the passphrase back, so a frontend script cannot
 * exfiltrate it. Only the main process ever sees the plaintext again, when it writes a backup.
 *
 * Both changes are also gated on a native OS confirmation, which a script can request but cannot
 * answer. Without that, a script could quietly swap in a passphrase of its own and every later
 * backup would be encrypted to it.
 */
export interface ElectronBackupPassphraseApi {
    /** Whether a passphrase can be stored on this system, and whether one already is. */
    getStatus(): Promise<BackupPassphraseStatus>;
    /**
     * Stores a passphrase, replacing any existing one, once the user has confirmed it.
     * @param passphrase The passphrase to encrypt later backups with.
     */
    set(passphrase: string): Promise<BackupPassphraseChange>;
    /**
     * Forgets the stored passphrase. Existing backups keep the passphrase they were written with.
     */
    clear(): Promise<BackupPassphraseChange>;
}

/** Outcome of a {@link ElectronOneNoteApi.login} attempt. */
export interface OneNoteLoginResult {
    /** True if sign-in completed and a Microsoft Graph token was stored. */
    connected: boolean;
    /** The connected Microsoft account, present when `connected` is true. */
    account?: { name: string; email: string };
    /** A human-readable failure reason when `connected` is false (absent on user cancellation). */
    error?: string;
}

/** Desktop-only OneNote importer sign-in, driven from the main process via a loopback OAuth redirect. */
export interface ElectronOneNoteApi {
    /**
     * Runs the Microsoft delegated-Graph OAuth flow: opens the system browser, captures the redirect
     * on a throwaway loopback server, exchanges the code, and stores the token process-side. Resolves
     * once the desktop session is connected (or with `connected: false` on failure/timeout).
     */
    login(): Promise<OneNoteLoginResult>;
}

/** Outcome of a {@link ElectronNativeExportApi.exportSubtreeToFile} request. */
export interface NativeExportResult {
    status: "saved" | "cancelled" | "error";
    /** Absolute path the archive was written to (when `status === "saved"`). */
    filePath?: string;
    /** Failure detail (when `status === "error"`). */
    message?: string;
}

/** Desktop-native subtree export that streams a `.zip` straight to a file. */
export interface ElectronNativeExportApi {
    /**
     * Prompts a native "save as" dialog, then streams a subtree (branch) export
     * to the chosen path on disk. This bypasses the in-memory download path, so
     * memory stays bounded regardless of archive size. Progress/success/error
     * are reported over the WebSocket via `taskId`. Resolves once the dialog is
     * dismissed (`cancelled`) or the export finishes (`saved` / `error`).
     * @param opts The branch to export, the export format (`"html"`, `"markdown"` or `"share"`),
     * the title to suggest as the file name, and the ID of the task that reports progress.
     */
    exportSubtreeToFile(opts: { branchId: string; format: string; title: string; taskId: string }): Promise<NativeExportResult>;
}

/** Import flags forwarded to the native importer (mirrors the HTTP route's options; no path). */
export interface NativeImportOptions {
    safeImport: boolean;
    shrinkImages: boolean;
    textImportedAsText: boolean;
    codeImportedAsCode: boolean;
    spreadsheetImportedAsSpreadsheet: boolean;
    explodeArchives: boolean;
    replaceUnderscoresWithSpaces: boolean;
}

/** A single user-chosen file: a capability token (redeemed to import it) and its display name — never a path. */
export interface NativeImportPickedFile {
    /** Single-use, short-lived grant for the chosen file. */
    token: string;
    /** Display name of the chosen file. */
    fileName: string;
}

/** Outcome of {@link ElectronNativeImportApi.pickFiles}: capability tokens, never paths. */
export interface NativeImportPickResult {
    status: "selected" | "cancelled";
    /** The user-chosen files (when `status === "selected"`); one or more, since the dialog allows multi-select. */
    files?: NativeImportPickedFile[];
}

/** Outcome of {@link ElectronNativeImportApi.importFromToken}. */
export interface NativeImportResult {
    status: "imported" | "error";
    /** Root note of the import (when `status === "imported"`). */
    importedNoteId?: string;
    /** Failure detail (when `status === "error"`). */
    message?: string;
}

/**
 * Desktop-native import that reads the user's file **in place** (bounded memory, no temp copy) — the whole
 * point being multi-GB `.zip` archives, though any importable file is accepted. The renderer never handles
 * a filesystem path: {@link pickFiles} runs the OS dialog in the main process and returns opaque capability
 * tokens, which {@link importFromToken} redeems. A script can't forge a token or pass a path, so it can
 * never read an arbitrary file.
 */
export interface ElectronNativeImportApi {
    /** Prompts a native "open file" dialog (multi-select, any type) and returns single-use tokens for the chosen files. */
    pickFiles(): Promise<NativeImportPickResult>;
    /**
     * Resolves files the user dropped onto a drop zone to capability tokens, so a drag-and-drop import takes
     * the same in-place (streamed) path as the dialog. The `File` is the unforgeable capability: the path is
     * obtained via `webUtils.getPathForFile`, which yields a real path only for a genuinely user-supplied
     * file and an empty string for anything a script constructed — so a script can't smuggle in an arbitrary
     * path. Returns `cancelled` when no dropped file resolved (e.g. dragged from a browser, not the OS), so
     * the caller falls back to the normal upload route.
     * @param files The files of the drop event.
     */
    grantDroppedFiles(files: File[]): Promise<NativeImportPickResult>;
    /**
     * Imports the file behind a token, with progress/success/error reported over the WebSocket like
     * the HTTP import path.
     * @param opts The `token` to redeem, the `parentNoteId` to import under, the `taskId` that reports
     * progress, and the import `options`. When importing several files in one batch, set `last` only
     * on the final call so the success toast fires once, after everything is in. `format` routes the
     * file to a specific importer (e.g. `"obsidian"`), mirroring the HTTP route's format tag.
     */
    importFromToken(opts: { token: string; parentNoteId: string; taskId: string; options: NativeImportOptions; last: boolean; format?: string }): Promise<NativeImportResult>;
}

/**
 * Outcome of {@link ElectronRestoreApi.pickBackup}: what the chosen backup is, never where it is.
 *
 * The file itself stays with the main process, which holds it as the one waiting to be restored, so
 * the renderer is given only what the screen has to show and decide with.
 */
export interface NativeBackupPickResult {
    status: "selected" | "cancelled" | "error";
    /** Display name of the chosen backup (when `status === "selected"`). */
    fileName?: string;
    /** Whether a passphrase has to be asked for before it can be restored. */
    encrypted?: boolean;
    /** Failure detail (when `status === "error"`), e.g. setup already being busy. */
    message?: string;
}

/**
 * Choosing a backup to restore from the desktop, where the file is already on the same disk as the
 * database it is going to replace and has no business being uploaded to reach it.
 *
 * Only usable during setup: what it puts forward is restored by the ordinary
 * `POST /api/setup/restore/start`, which refuses once the application is initialized.
 */
export interface ElectronRestoreApi {
    /**
     * Prompts a native "open file" dialog for a `.db` or `.tnbackup` backup and, if one is chosen,
     * makes it the backup waiting to be restored.
     */
    pickBackup(): Promise<NativeBackupPickResult>;
}

/** Outcome of {@link ElectronDialogApi.pickDirectory}. */
export interface NativeDirectoryPickResult {
    status: "selected" | "cancelled";
    /** Absolute path of the chosen directory (when `status === "selected"`). */
    path?: string;
}

/** Native OS pickers that hand the renderer a location the user chose themselves. */
export interface ElectronDialogApi {
    /**
     * Prompts a native "select folder" dialog. The renderer cannot supply the answer: a script can at
     * most pop the dialog, which the user still has to accept before any path comes back.
     * @param opts The directory the dialog starts in, as `defaultPath`.
     */
    pickDirectory(opts?: { defaultPath?: string }): Promise<NativeDirectoryPickResult>;

    /**
     * Prompts a native message box before the application restarts into the setup screen, where the
     * user may replace or erase their knowledge base.
     *
     * An OS dialog rather than one of the application's own, for the reason the security toggles use
     * one: a note script can reach every dialog the app draws for itself, and this one guards the
     * path to losing everything. It is never suppressible, so there is no "don't ask again" here.
     */
    confirmStartOver(): Promise<boolean>;
}

/** Phase of the meeting transcription; at most one recording runs at a time. */
export type TranscriptionStatus = "idle" | "starting" | "recording" | "stopping";

/**
 * Why a source's audio is not being transcribed: its capture did not start (`not_captured`), it
 * has delivered no audio for 10 s (`no_audio`), as when its capture hangs, or it has delivered
 * only digital silence for a while (`silent`), as from a muted device.
 */
export type TranscriptSourceIssue = "not_captured" | "no_audio" | "silent";

/** What {@link ElectronTranscriptionApi} reports to every window. */
export interface TranscriptionState {
    status: TranscriptionStatus;
    /** The meeting note the recording belongs to, or `null` when idle. */
    noteId: string | null;
    /** The sources heard speaking, or whose speech is still being transcribed. */
    pendingSources: TranscriptSource[];
    /**
     * While recording, the sources whose audio is not being transcribed, and why; absent when
     * every source delivers sound.
     */
    sourceIssues?: Partial<Record<TranscriptSource, TranscriptSourceIssue>>;
    /**
     * When the recording started, in milliseconds since the epoch: set once it records, kept while
     * it stops, absent otherwise.
     */
    startedAt?: number;
    /**
     * A problem to tell the user about, sent once with the state it concerns: the recording ended
     * without being stopped, or its transcript cannot be saved. `getState()` never returns it.
     */
    error?: string;
}

/**
 * Meeting transcription, recorded and transcribed on this computer by the main process. The
 * renderer only starts and stops it; the audio never passes through the renderer.
 */
export interface ElectronTranscriptionApi {
    /**
     * Whether this build can transcribe on this computer: `false` when it carries no speech
     * recognition engine for the platform and processor it runs on.
     */
    isSupported(): Promise<boolean>;

    /**
     * Starts recording the microphone and the system audio for a meeting note.
     *
     * @param noteId The meeting note the transcript belongs to.
     * @returns An empty string once recording runs, or an error message when it cannot start.
     */
    start(noteId: string): Promise<string>;

    /** Stops the recording, once the speech already captured has been transcribed. */
    stop(): Promise<void>;

    getState(): Promise<TranscriptionState>;

    /**
     * Names a speaker of a transcript attachment, if a running recording writes that transcript.
     * The recording applies it, so no utterance it writes meanwhile is lost.
     *
     * @param attachmentId The transcript attachment.
     * @param key The speaker: `microphone` for the local speaker, `system:<n>` for an identified
     * speaker of the system audio.
     * @param name The name to give, or a blank string to restore the default name.
     * @returns `false` when no recording writes `attachmentId`; it can then be saved whole.
     */
    renameSpeaker(attachmentId: string, key: string, name: string): Promise<boolean>;

    /**
     * Returns the directory that keeps the audio and the transcript as produced of each recording
     * while `transcriptionKeepRecordings` is on, creating it if needed.
     */
    getRecordingsDirectory(): Promise<string>;

    /**
     * Subscribes to changes of the transcription state, made from any window.
     *
     * @param callback Receives the new state.
     * @returns A function that removes the listener.
     */
    onStateChanged(callback: (state: TranscriptionState) => void): () => void;

    /**
     * Subscribes to the audio level of the running recording, about four times a second per source.
     *
     * @param callback Receives the source and the RMS, from 0 to 1, of each chunk it delivers.
     * @returns A function that stops the calls.
     */
    onLevel(callback: (source: TranscriptSource, level: number) => void): () => void;
}

/**
 * The complete surface exposed to the renderer as `window.electronApi` via
 * `contextBridge`. The renderer must access Electron-only functionality through
 * this object — direct `require("electron")` and `@electron/remote` are
 * unavailable because `nodeIntegration` is disabled and `contextIsolation` is
 * enabled.
 *
 * The runtime value lives in `apps/desktop/src/preload.ts`; this interface is
 * the contract both the preload script (`satisfies ElectronApi`) and the
 * client (`window.electronApi`) share.
 */
export interface ElectronApi {
    /** Window chrome, zoom, theme, lifecycle, and main → renderer events. */
    window: ElectronWindowApi;
    /** System clipboard access beyond what the standard Web Clipboard API offers. */
    clipboard: ElectronClipboardApi;
    /** Shell integration — opening URLs, files, and downloads with OS handlers. */
    shell: ElectronShellApi;
    /** Native context-menu plumbing for right-click events on web contents. */
    contextMenu: ElectronContextMenuApi;
    /** Chromium spell checker controls (dictionary, language list). */
    spellcheck: ElectronSpellcheckApi;
    /** OS integration — system tray and autostart / launch-on-login. */
    systemIntegration: ElectronSystemIntegrationApi;
    /** Printing and PDF export pipeline. */
    printing: ElectronPrintingApi;
    /** Read/write access to Chromium's back/forward navigation history. */
    navigation: ElectronNavigationApi;
    /** In-process bridge that replaces the renderer↔server WebSocket. */
    ws: ElectronWsApi;
    /** Security settings (backend scripting, SQL console) stored outside the DB. */
    security: ElectronSecurityApi;
    /** Write-only access to the backup passphrase, kept in the OS keyring. */
    backupPassphrase: ElectronBackupPassphraseApi;
    /** OneNote importer sign-in via a loopback OAuth redirect (desktop only). */
    onenote: ElectronOneNoteApi;
    /** Desktop-native subtree export that streams a `.zip` straight to a file. */
    nativeExport: ElectronNativeExportApi;
    /** Desktop-native large-`.zip` import that reads the user's file in place via a capability token. */
    nativeImport: ElectronNativeImportApi;
    /** Native OS pickers that hand the renderer a location the user chose themselves. */
    dialog: ElectronDialogApi;
    /** Choosing a backup to restore during setup, read where it lies rather than uploaded. */
    restore: ElectronRestoreApi;
    /** Meeting transcription: starting and stopping a recording, and following its state. */
    transcription: ElectronTranscriptionApi;
}
