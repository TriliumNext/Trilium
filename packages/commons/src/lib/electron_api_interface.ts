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
     * Use `"system"` to follow the OS setting.
     */
    setNativeThemeSource(source: "system" | "light" | "dark"): void;

    // #endregion

    // #region Title bar

    /**
     * Customizes the colors of the Windows native title bar overlay
     * (the area containing the minimize / maximize / close buttons).
     */
    setTitleBarOverlay(options: { color: string; symbolColor: string }): void;

    /**
     * Repositions the macOS traffic-light window buttons.
     * Coordinates are in CSS pixels relative to the window's top-left corner.
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

    /** Enters or leaves full-screen mode. */
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

    /**
     * Opens a new top-level Trilium window navigated to the given hash route.
     * @param extraWindowHash The URL hash fragment (without the leading `#`) for the new window.
     */
    createExtraWindow(extraWindowHash: string): void;

    /** Synchronously returns whether the window is pinned above all others. */
    isAlwaysOnTop(): boolean;

    /** Toggles the always-on-top (pinned) state of the window. */
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
     * Sets the Windows 11 backdrop material (e.g. `"mica"`, `"acrylic"`, `"tabbed"`, `"none"`)
     * applied behind the window contents. No-op on other platforms.
     */
    setBackgroundMaterial(material: string): void;

    /**
     * Sets the macOS vibrancy effect (e.g. `"sidebar"`, `"under-window"`, `"fullscreen-ui"`)
     * applied behind the window contents. No-op on other platforms.
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
     */
    reportStartupMetric(metric: RendererStartupMetric): void;

    // #endregion

    // #region Main → renderer events

    /**
     * Subscribes to globally registered keyboard shortcuts.
     * The callback receives the logical action name (not the keystroke).
     */
    onGlobalShortcut(callback: (actionName: string) => void): void;

    /**
     * Subscribes to "open note in active tab" requests originating from outside
     * the renderer (e.g. tray menu, deep links).
     */
    onOpenInSameTab(callback: (noteId: string) => void): void;

    /**
     * Subscribes to changes of the DevTools docking state. `docked` is `true` only while
     * DevTools is attached to this window — where Chromium disables the native window
     * material (Mica / vibrancy) — and `false` when it is closed or in a separate window.
     */
    onDevToolsDockChanged(callback: (docked: boolean) => void): void;

    // #endregion
}

/** Renderer access to the system clipboard for cases the standard Web API can't cover. */
export interface ElectronClipboardApi {
    /**
     * Writes a raw image (PNG-encoded bytes) to the system clipboard so it can be
     * pasted into other applications as an image rather than as a file.
     */
    copyImageToClipboard(buffer: Uint8Array): void;

    /**
     * Reads plain text from the system clipboard via the main-process
     * `electron.clipboard`. Used instead of `navigator.clipboard.readText()`
     * so the renderer's deny-by-default permission policy does not have to
     * grant the sensitive `clipboard-read` permission to the whole session.
     */
    readText(): Promise<string>;
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
     * @returns An empty string on success, or an error message on failure.
     */
    openPath(path: string): Promise<string>;

    /**
     * Opens a `file://` URL with its default OS handler. Exists as a separate
     * channel from {@link openExternal} because Electron's `shell.openExternal`
     * mishandles Unicode characters in `file:` URLs on Windows; converting to
     * a filesystem path and calling `shell.openPath` works correctly.
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
     */
    openCustom(filePath: string): void;
}

/** Bridge for the native context menu shown over web contents. */
export interface ElectronContextMenuApi {
    /** Subscribes to right-click events forwarded from the main process. */
    onContextMenu(callback: (params: ElectronContextMenuParams) => void): void;

    /**
     * Executes a clipboard / text-input action on the focused web contents.
     * `"insertText"` requires the `text` argument; the other actions ignore it.
     */
    webContentsAction(action: "cut" | "copy" | "paste" | "pasteAndMatchStyle" | "insertText", text?: string): void;
}

/** Renderer-side access to Chromium's built-in spell checker. */
export interface ElectronSpellcheckApi {
    /** Adds a word to the user's personal dictionary so it is no longer flagged. */
    addWordToDictionary(word: string): void;

    /** Returns the BCP-47 language tags Chromium can spell-check on this platform. */
    getAvailableSpellCheckerLanguages(): string[];
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
    /** Reports rendering progress (`0..100`) from the renderer to the main process. */
    sendPrintProgress(progress: number): void;

    /**
     * Subscribes to progress updates emitted by the main process during a print
     * or PDF export run. `action` describes the current stage (e.g. `"rendering"`).
     */
    onPrintProgress(callback: (data: { progress: number; action: string }) => void): void;

    /** Subscribes to the "print finished" event, fired once the OS print job is dispatched. */
    onPrintDone(callback: (printReport: unknown) => void): void;

    /** Removes all listeners registered via {@link onPrintProgress} and {@link onPrintDone}. */
    removePrintListeners(): void;

    /** Returns the list of printers known to the OS. */
    getPrinters(): Promise<unknown[]>;

    /**
     * Asks the main process to render the current note as a PDF and return the
     * resulting bytes for the in-app preview. Result is delivered via
     * {@link onExportAsPdfPreviewResult}.
     */
    exportAsPdfPreview(opts: Record<string, unknown>): void;

    /** Subscribes to the result of an {@link exportAsPdfPreview} call. */
    onExportAsPdfPreviewResult(callback: (result: { buffer?: Uint8Array; error?: string }) => void): void;

    /** Removes the listener registered via {@link onExportAsPdfPreviewResult}. */
    removeExportAsPdfPreviewResultListener(): void;

    /**
     * Persists a previously generated PDF buffer to disk via the native save
     * dialog. `title` is used as the suggested filename.
     */
    savePdf(data: { title: string; buffer: Uint8Array }): void;

    /** Sends the previewed PDF to the OS print dialog with the given options. */
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
    /** Sends a message from the renderer to the main-process messaging hub. */
    send(message: unknown): void;

    /**
     * Subscribes to messages pushed from the main process. Returns an
     * unsubscribe function — call it when the listener is no longer needed
     * (e.g. when a BrowserWindow is unloaded) to avoid leaking handlers.
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

    /** Navigates to the entry at the given index in the history stack. */
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
export interface ElectronSecurityApi {
    /**
     * Requests a change to a security setting. Shows a native OS confirmation
     * dialog before writing. Returns `true` if the user confirmed and the
     * change was written (restart required to take effect), `false` if cancelled.
     */
    setBackendScriptingEnabled(enabled: boolean): Promise<boolean>;

    /** Requests a change to the SQL console setting. Same flow as above. */
    setSqlConsoleEnabled(enabled: boolean): Promise<boolean>;
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
}
