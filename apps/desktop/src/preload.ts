import type { ElectronApi, ElectronContextMenuParams } from "@triliumnext/commons";
import { contextBridge, ipcRenderer, webFrame } from "electron";

contextBridge.exposeInMainWorld("electronApi", {
    window: {
        // Zoom
        setZoomFactor(factor: number) {
            webFrame.setZoomFactor(factor);
        },
        getZoomFactor(): number {
            return webFrame.getZoomFactor();
        },

        // Theme
        setNativeThemeSource(source: "system" | "light" | "dark") {
            ipcRenderer.send("set-native-theme-source", source);
        },

        // Title bar
        setTitleBarOverlay(options: { color: string; symbolColor: string }) {
            ipcRenderer.send("set-title-bar-overlay", options);
        },
        setWindowButtonPosition(position: { x: number; y: number }) {
            ipcRenderer.send("set-window-button-position", position);
        },

        // Full screen
        onEnterFullScreen(callback: () => void) {
            ipcRenderer.on("enter-full-screen", () => callback());
        },
        onLeaveFullScreen(callback: () => void) {
            ipcRenderer.on("leave-full-screen", () => callback());
        },
        isFullScreen(): boolean {
            return ipcRenderer.sendSync("is-full-screen");
        },
        setFullScreen(enabled: boolean) {
            ipcRenderer.send("set-full-screen", enabled);
        },

        // Window state
        minimizeWindow() {
            ipcRenderer.send("minimize-window");
        },
        maximizeWindow() {
            ipcRenderer.send("maximize-window");
        },
        unmaximizeWindow() {
            ipcRenderer.send("unmaximize-window");
        },
        isMaximized(): boolean {
            return ipcRenderer.sendSync("is-maximized");
        },
        closeWindow() {
            ipcRenderer.send("close-window");
        },
        createExtraWindow(extraWindowHash: string) {
            ipcRenderer.send("create-extra-window", { extraWindowHash });
        },
        isAlwaysOnTop(): boolean {
            return ipcRenderer.sendSync("is-always-on-top");
        },
        setAlwaysOnTop(enabled: boolean) {
            ipcRenderer.send("set-always-on-top", enabled);
        },
        toggleDevTools() {
            ipcRenderer.send("toggle-dev-tools");
        },

        // App lifecycle
        reloadAllWindows() {
            ipcRenderer.send("reload-all-windows");
        },
        restartApp() {
            ipcRenderer.send("restart-app");
        },
        toggleAllWindows() {
            ipcRenderer.send("toggle-all-windows");
        },
        clearCache(): Promise<void> {
            return ipcRenderer.invoke("clear-cache");
        },
        showWindow() {
            ipcRenderer.send("show-window");
        },

        // Background effects
        setBackgroundMaterial(material: string) {
            ipcRenderer.send("set-background-material", material);
        },
        setVibrancy(vibrancy: string) {
            ipcRenderer.send("set-vibrancy", vibrancy);
        },

        // Main → renderer events
        onGlobalShortcut(callback: (actionName: string) => void) {
            ipcRenderer.on("globalShortcut", (_event, actionName) => callback(actionName));
        },
        onOpenInSameTab(callback: (noteId: string) => void) {
            ipcRenderer.on("openInSameTab", (_event, noteId) => callback(noteId));
        }
    },

    clipboard: {
        copyImageToClipboard(buffer: Uint8Array) {
            ipcRenderer.send("copy-image-to-clipboard", buffer);
        }
    },

    shell: {
        openExternal(url: string) {
            ipcRenderer.send("open-external", url);
        },
        openPath(path: string): Promise<string> {
            return ipcRenderer.invoke("open-path", path);
        },
        openFileUrl(fileUrl: string): Promise<string> {
            return ipcRenderer.invoke("open-file-url", fileUrl);
        },
        downloadURL(url: string) {
            ipcRenderer.send("download-url", url);
        },
        openCustom(filePath: string) {
            ipcRenderer.send("open-custom", filePath);
        }
    },

    contextMenu: {
        onContextMenu(callback: (params: ElectronContextMenuParams) => void) {
            ipcRenderer.on("context-menu", (_event, params: ElectronContextMenuParams) => callback(params));
        },
        webContentsAction(action: "cut" | "copy" | "paste" | "pasteAndMatchStyle" | "insertText", text?: string) {
            ipcRenderer.send("web-contents-action", action, text);
        }
    },

    spellcheck: {
        addWordToDictionary(word: string) {
            ipcRenderer.send("add-word-to-dictionary", word);
        },
        getAvailableSpellCheckerLanguages(): string[] {
            return ipcRenderer.sendSync("get-available-spellchecker-languages");
        }
    },

    tray: {
        reloadTray() {
            ipcRenderer.send("reload-tray");
        }
    },

    printing: {
        sendPrintProgress(progress: number) {
            ipcRenderer.send("print-progress", progress);
        },
        onPrintProgress(callback: (data: { progress: number; action: string }) => void) {
            ipcRenderer.on("print-progress", (_event, data) => callback(data));
        },
        onPrintDone(callback: (printReport: unknown) => void) {
            ipcRenderer.on("print-done", (_event, printReport) => callback(printReport));
        },
        removePrintListeners() {
            ipcRenderer.removeAllListeners("print-progress");
            ipcRenderer.removeAllListeners("print-done");
        },
        getPrinters(): Promise<unknown[]> {
            return ipcRenderer.invoke("get-printers");
        },
        exportAsPdfPreview(opts: Record<string, unknown>) {
            ipcRenderer.send("export-as-pdf-preview", opts);
        },
        onExportAsPdfPreviewResult(callback: (result: { buffer?: Uint8Array; error?: string }) => void) {
            ipcRenderer.on("export-as-pdf-preview-result", (_event, result) => callback(result));
        },
        removeExportAsPdfPreviewResultListener() {
            ipcRenderer.removeAllListeners("export-as-pdf-preview-result");
        },
        savePdf(data: { title: string; buffer: Uint8Array }) {
            ipcRenderer.send("save-pdf", data);
        },
        printFromPreview(opts: Record<string, unknown>) {
            ipcRenderer.send("print-from-preview", opts);
        }
    },

    ws: {
        // Renderer → main process. Mirror channel name with the server-side
        // IpcMessagingProvider constants.
        send(message: unknown) {
            ipcRenderer.send("trilium-ws-from-renderer", message);
        },
        onMessage(callback: (message: unknown) => void) {
            const listener = (_event: unknown, message: unknown) => callback(message);
            ipcRenderer.on("trilium-ws-message", listener);
            return () => ipcRenderer.removeListener("trilium-ws-message", listener);
        }
    },

    navigation: {
        clearNavigationHistory() {
            ipcRenderer.send("clear-navigation-history");
        },
        navigationCanGoBack(): boolean {
            return ipcRenderer.sendSync("navigation-history", "canGoBack");
        },
        navigationCanGoForward(): boolean {
            return ipcRenderer.sendSync("navigation-history", "canGoForward");
        },
        navigationGetAllEntries(): Array<{ url: string; title: string }> {
            return ipcRenderer.sendSync("navigation-history", "getAllEntries");
        },
        navigationGetActiveIndex(): number {
            return ipcRenderer.sendSync("navigation-history", "getActiveIndex");
        },
        navigationLength(): number {
            return ipcRenderer.sendSync("navigation-history", "length");
        },
        navigationGoToIndex(index: number) {
            ipcRenderer.send("navigation-history-go-to-index", index);
        },
        onDidNavigate(callback: () => void) {
            ipcRenderer.on("did-navigate", () => callback());
        },
        onDidNavigateInPage(callback: () => void) {
            ipcRenderer.on("did-navigate-in-page", () => callback());
        },
        removeDidNavigateListeners() {
            ipcRenderer.removeAllListeners("did-navigate");
            ipcRenderer.removeAllListeners("did-navigate-in-page");
        }
    },

    security: {
        setBackendScriptingEnabled(enabled: boolean): Promise<boolean> {
            return ipcRenderer.invoke("security-set-backend-scripting", enabled);
        },
        setSqlConsoleEnabled(enabled: boolean): Promise<boolean> {
            return ipcRenderer.invoke("security-set-sql-console", enabled);
        }
    }
} satisfies ElectronApi);
