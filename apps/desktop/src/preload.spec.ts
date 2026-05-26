import { beforeEach, describe, expect, it, vi } from "vitest";

let exposedApi: Record<string, Record<string, unknown>> = {};
let mockZoomFactor = 1.0;
const ipcRendererListeners = new Map<string, Function[]>();
const ipcRendererSent: Array<{ channel: string; args: unknown[] }> = [];
const ipcRendererInvoked: Array<{ channel: string; args: unknown[] }> = [];
const ipcRendererSyncResults = new Map<string, unknown>();

vi.mock("electron", () => ({
    contextBridge: {
        exposeInMainWorld(apiKey: string, api: Record<string, unknown>) {
            exposedApi[apiKey] = api;
        }
    },
    webFrame: {
        setZoomFactor(factor: number) {
            mockZoomFactor = factor;
        },
        getZoomFactor() {
            return mockZoomFactor;
        }
    },
    ipcRenderer: {
        on(channel: string, listener: Function) {
            const listeners = ipcRendererListeners.get(channel) ?? [];
            listeners.push(listener);
            ipcRendererListeners.set(channel, listeners);
        },
        send(channel: string, ...args: unknown[]) {
            ipcRendererSent.push({ channel, args });
        },
        invoke(channel: string, ...args: unknown[]) {
            ipcRendererInvoked.push({ channel, args });
            return Promise.resolve("");
        },
        sendSync(channel: string, ...args: unknown[]) {
            return ipcRendererSyncResults.get(`${channel}:${args[0]}`);
        },
        removeAllListeners(channel: string) {
            ipcRendererListeners.delete(channel);
        },
        removeListener(channel: string, listener: Function) {
            const listeners = ipcRendererListeners.get(channel);
            if (!listeners) return;
            const filtered = listeners.filter(l => l !== listener);
            if (filtered.length === 0) {
                ipcRendererListeners.delete(channel);
            } else {
                ipcRendererListeners.set(channel, filtered);
            }
        }
    }
}));

function getGroup(name: string) {
    return (exposedApi.electronApi as Record<string, Record<string, Function>>)[name];
}

describe("preload script", () => {
    beforeEach(async () => {
        exposedApi = {};
        mockZoomFactor = 1.0;
        ipcRendererListeners.clear();
        ipcRendererSent.length = 0;
        ipcRendererInvoked.length = 0;
        ipcRendererSyncResults.clear();
        vi.resetModules();
        await import("./preload.js");
    });

    it("exposes electronApi on the window", () => {
        expect(exposedApi).toHaveProperty("electronApi");
    });

    describe("window", () => {
        const win = () => getGroup("window");

        it("setZoomFactor delegates to webFrame", () => {
            win().setZoomFactor(1.5);
            expect(mockZoomFactor).toBe(1.5);
        });

        it("getZoomFactor delegates to webFrame", () => {
            mockZoomFactor = 0.8;
            expect(win().getZoomFactor()).toBe(0.8);
        });

        it("setNativeThemeSource sends correct IPC message", () => {
            win().setNativeThemeSource("dark");
            expect(ipcRendererSent).toContainEqual({
                channel: "set-native-theme-source",
                args: ["dark"]
            });
        });

        it("setTitleBarOverlay sends correct IPC message", () => {
            win().setTitleBarOverlay({ color: "#fff", symbolColor: "#000" });
            expect(ipcRendererSent).toContainEqual({
                channel: "set-title-bar-overlay",
                args: [{ color: "#fff", symbolColor: "#000" }]
            });
        });

        it("setWindowButtonPosition sends correct IPC message", () => {
            win().setWindowButtonPosition({ x: 10, y: 20 });
            expect(ipcRendererSent).toContainEqual({
                channel: "set-window-button-position",
                args: [{ x: 10, y: 20 }]
            });
        });

        it("onEnterFullScreen registers and forwards enter-full-screen channel", () => {
            const callback = vi.fn();
            win().onEnterFullScreen(callback);
            const listeners = ipcRendererListeners.get("enter-full-screen")!;
            expect(listeners).toHaveLength(1);
            listeners[0]();
            expect(callback).toHaveBeenCalled();
        });

        it("onLeaveFullScreen registers and forwards leave-full-screen channel", () => {
            const callback = vi.fn();
            win().onLeaveFullScreen(callback);
            const listeners = ipcRendererListeners.get("leave-full-screen")!;
            expect(listeners).toHaveLength(1);
            listeners[0]();
            expect(callback).toHaveBeenCalled();
        });

        it("isFullScreen uses sendSync", () => {
            ipcRendererSyncResults.set("is-full-screen:undefined", true);
            expect(win().isFullScreen()).toBe(true);
        });

        it("setFullScreen sends correct IPC message", () => {
            win().setFullScreen(true);
            expect(ipcRendererSent).toContainEqual({
                channel: "set-full-screen",
                args: [true]
            });
        });

        it("minimizeWindow sends correct IPC message", () => {
            win().minimizeWindow();
            expect(ipcRendererSent).toContainEqual({ channel: "minimize-window", args: [] });
        });

        it("maximizeWindow sends correct IPC message", () => {
            win().maximizeWindow();
            expect(ipcRendererSent).toContainEqual({ channel: "maximize-window", args: [] });
        });

        it("unmaximizeWindow sends correct IPC message", () => {
            win().unmaximizeWindow();
            expect(ipcRendererSent).toContainEqual({ channel: "unmaximize-window", args: [] });
        });

        it("isMaximized uses sendSync", () => {
            ipcRendererSyncResults.set("is-maximized:undefined", true);
            expect(win().isMaximized()).toBe(true);
        });

        it("closeWindow sends correct IPC message", () => {
            win().closeWindow();
            expect(ipcRendererSent).toContainEqual({ channel: "close-window", args: [] });
        });

        it("createExtraWindow sends correct IPC message", () => {
            win().createExtraWindow("#root/abc123");
            expect(ipcRendererSent).toContainEqual({
                channel: "create-extra-window",
                args: [{ extraWindowHash: "#root/abc123" }]
            });
        });

        it("isAlwaysOnTop uses sendSync", () => {
            ipcRendererSyncResults.set("is-always-on-top:undefined", true);
            expect(win().isAlwaysOnTop()).toBe(true);
        });

        it("setAlwaysOnTop sends correct IPC message", () => {
            win().setAlwaysOnTop(true);
            expect(ipcRendererSent).toContainEqual({ channel: "set-always-on-top", args: [true] });
        });

        it("toggleDevTools sends correct IPC message", () => {
            win().toggleDevTools();
            expect(ipcRendererSent).toContainEqual({ channel: "toggle-dev-tools", args: [] });
        });

        it("reloadAllWindows sends correct IPC message", () => {
            win().reloadAllWindows();
            expect(ipcRendererSent).toContainEqual({ channel: "reload-all-windows", args: [] });
        });

        it("restartApp sends correct IPC message", () => {
            win().restartApp();
            expect(ipcRendererSent).toContainEqual({ channel: "restart-app", args: [] });
        });

        it("toggleAllWindows sends correct IPC message", () => {
            win().toggleAllWindows();
            expect(ipcRendererSent).toContainEqual({ channel: "toggle-all-windows", args: [] });
        });

        it("showWindow sends correct IPC message", () => {
            win().showWindow();
            expect(ipcRendererSent).toContainEqual({ channel: "show-window", args: [] });
        });

        it("clearCache invokes correct IPC channel", async () => {
            await win().clearCache();
            expect(ipcRendererInvoked).toContainEqual({ channel: "clear-cache", args: [] });
        });

        it("setBackgroundMaterial sends correct IPC message", () => {
            win().setBackgroundMaterial("mica");
            expect(ipcRendererSent).toContainEqual({ channel: "set-background-material", args: ["mica"] });
        });

        it("setVibrancy sends correct IPC message", () => {
            win().setVibrancy("under-window");
            expect(ipcRendererSent).toContainEqual({ channel: "set-vibrancy", args: ["under-window"] });
        });

        it("onGlobalShortcut registers and forwards globalShortcut channel", () => {
            const callback = vi.fn();
            win().onGlobalShortcut(callback);
            const listeners = ipcRendererListeners.get("globalShortcut")!;
            expect(listeners).toHaveLength(1);
            listeners[0]({}, "toggleNoteHoisting");
            expect(callback).toHaveBeenCalledWith("toggleNoteHoisting");
        });

        it("onOpenInSameTab registers and forwards openInSameTab channel", () => {
            const callback = vi.fn();
            win().onOpenInSameTab(callback);
            const listeners = ipcRendererListeners.get("openInSameTab")!;
            expect(listeners).toHaveLength(1);
            listeners[0]({}, "abc123");
            expect(callback).toHaveBeenCalledWith("abc123");
        });
    });

    describe("clipboard", () => {
        const clip = () => getGroup("clipboard");

        it("copyImageToClipboard sends correct IPC message", () => {
            const buffer = new Uint8Array([1, 2, 3]);
            clip().copyImageToClipboard(buffer);
            expect(ipcRendererSent).toContainEqual({
                channel: "copy-image-to-clipboard",
                args: [buffer]
            });
        });
    });

    describe("shell", () => {
        const shell = () => getGroup("shell");

        it("openExternal sends correct IPC message", () => {
            shell().openExternal("https://example.com");
            expect(ipcRendererSent).toContainEqual({
                channel: "open-external",
                args: ["https://example.com"]
            });
        });

        it("openPath invokes correct IPC channel", async () => {
            await shell().openPath("/tmp/test.txt");
            expect(ipcRendererInvoked).toContainEqual({
                channel: "open-path",
                args: ["/tmp/test.txt"]
            });
        });

        it("openFileUrl invokes correct IPC channel", async () => {
            await shell().openFileUrl("file:///tmp/test.txt");
            expect(ipcRendererInvoked).toContainEqual({
                channel: "open-file-url",
                args: ["file:///tmp/test.txt"]
            });
        });

        it("downloadURL sends correct IPC message", () => {
            shell().downloadURL("https://example.com/file.zip");
            expect(ipcRendererSent).toContainEqual({
                channel: "download-url",
                args: ["https://example.com/file.zip"]
            });
        });

        it("openCustom sends correct IPC message", () => {
            shell().openCustom("/tmp/test.txt");
            expect(ipcRendererSent).toContainEqual({
                channel: "open-custom",
                args: ["/tmp/test.txt"]
            });
        });
    });

    describe("contextMenu", () => {
        const ctx = () => getGroup("contextMenu");

        it("onContextMenu registers and forwards context-menu channel", () => {
            const callback = vi.fn();
            ctx().onContextMenu(callback);
            const listeners = ipcRendererListeners.get("context-menu")!;
            expect(listeners).toHaveLength(1);
            const params = { x: 100, y: 200, selectionText: "test" };
            listeners[0]({}, params);
            expect(callback).toHaveBeenCalledWith(params);
        });

        it("webContentsAction sends action and optional text", () => {
            ctx().webContentsAction("cut");
            expect(ipcRendererSent).toContainEqual({
                channel: "web-contents-action",
                args: ["cut", undefined]
            });
            ctx().webContentsAction("insertText", "hello");
            expect(ipcRendererSent).toContainEqual({
                channel: "web-contents-action",
                args: ["insertText", "hello"]
            });
        });
    });

    describe("spellcheck", () => {
        const spell = () => getGroup("spellcheck");

        it("addWordToDictionary sends correct IPC message", () => {
            spell().addWordToDictionary("trilium");
            expect(ipcRendererSent).toContainEqual({
                channel: "add-word-to-dictionary",
                args: ["trilium"]
            });
        });

        it("getAvailableSpellCheckerLanguages uses sendSync", () => {
            ipcRendererSyncResults.set("get-available-spellchecker-languages:undefined", ["en-US", "de-DE"]);
            expect(spell().getAvailableSpellCheckerLanguages()).toEqual(["en-US", "de-DE"]);
        });
    });

    describe("tray", () => {
        const tray = () => getGroup("tray");

        it("reloadTray sends correct IPC message", () => {
            tray().reloadTray();
            expect(ipcRendererSent).toContainEqual({ channel: "reload-tray", args: [] });
        });
    });

    describe("printing", () => {
        const printing = () => getGroup("printing");

        it("sendPrintProgress sends correct IPC message", () => {
            printing().sendPrintProgress(50);
            expect(ipcRendererSent).toContainEqual({ channel: "print-progress", args: [50] });
        });

        it("onPrintProgress registers and forwards print-progress channel", () => {
            const callback = vi.fn();
            printing().onPrintProgress(callback);
            const listeners = ipcRendererListeners.get("print-progress")!;
            expect(listeners).toHaveLength(1);
            listeners[0]({}, { progress: 50, action: "printing" });
            expect(callback).toHaveBeenCalledWith({ progress: 50, action: "printing" });
        });

        it("onPrintDone registers and forwards print-done channel", () => {
            const callback = vi.fn();
            printing().onPrintDone(callback);
            const listeners = ipcRendererListeners.get("print-done")!;
            expect(listeners).toHaveLength(1);
            listeners[0]({}, { success: true });
            expect(callback).toHaveBeenCalledWith({ success: true });
        });

        it("removePrintListeners clears both print listeners", () => {
            printing().onPrintProgress(vi.fn());
            printing().onPrintDone(vi.fn());
            expect(ipcRendererListeners.has("print-progress")).toBe(true);
            expect(ipcRendererListeners.has("print-done")).toBe(true);
            printing().removePrintListeners();
            expect(ipcRendererListeners.has("print-progress")).toBe(false);
            expect(ipcRendererListeners.has("print-done")).toBe(false);
        });

        it("getPrinters invokes correct IPC channel", async () => {
            await printing().getPrinters();
            expect(ipcRendererInvoked).toContainEqual({ channel: "get-printers", args: [] });
        });

        it("exportAsPdfPreview sends correct IPC message", () => {
            const opts = { notePath: "root/abc", pageSize: "A4" };
            printing().exportAsPdfPreview(opts);
            expect(ipcRendererSent).toContainEqual({ channel: "export-as-pdf-preview", args: [opts] });
        });

        it("onExportAsPdfPreviewResult registers and forwards channel", () => {
            const callback = vi.fn();
            printing().onExportAsPdfPreviewResult(callback);
            const listeners = ipcRendererListeners.get("export-as-pdf-preview-result")!;
            expect(listeners).toHaveLength(1);
            const result = { buffer: new Uint8Array([1, 2, 3]) };
            listeners[0]({}, result);
            expect(callback).toHaveBeenCalledWith(result);
        });

        it("removeExportAsPdfPreviewResultListener clears listener", () => {
            printing().onExportAsPdfPreviewResult(vi.fn());
            expect(ipcRendererListeners.has("export-as-pdf-preview-result")).toBe(true);
            printing().removeExportAsPdfPreviewResultListener();
            expect(ipcRendererListeners.has("export-as-pdf-preview-result")).toBe(false);
        });

        it("savePdf sends correct IPC message", () => {
            const data = { title: "Test", buffer: new Uint8Array([1]) };
            printing().savePdf(data);
            expect(ipcRendererSent).toContainEqual({ channel: "save-pdf", args: [data] });
        });

        it("printFromPreview sends correct IPC message", () => {
            const opts = { notePath: "root/abc", silent: true };
            printing().printFromPreview(opts);
            expect(ipcRendererSent).toContainEqual({ channel: "print-from-preview", args: [opts] });
        });
    });

    describe("navigation", () => {
        const nav = () => getGroup("navigation");

        it("clearNavigationHistory sends correct IPC message", () => {
            nav().clearNavigationHistory();
            expect(ipcRendererSent).toContainEqual({ channel: "clear-navigation-history", args: [] });
        });

        it("navigationCanGoBack uses sendSync", () => {
            ipcRendererSyncResults.set("navigation-history:canGoBack", true);
            expect(nav().navigationCanGoBack()).toBe(true);
        });

        it("navigationCanGoForward uses sendSync", () => {
            ipcRendererSyncResults.set("navigation-history:canGoForward", false);
            expect(nav().navigationCanGoForward()).toBe(false);
        });

        it("navigationGetAllEntries uses sendSync", () => {
            const entries = [{ url: "trilium-app://app/?#abc", title: "Note" }];
            ipcRendererSyncResults.set("navigation-history:getAllEntries", entries);
            expect(nav().navigationGetAllEntries()).toEqual(entries);
        });

        it("navigationGetActiveIndex uses sendSync", () => {
            ipcRendererSyncResults.set("navigation-history:getActiveIndex", 3);
            expect(nav().navigationGetActiveIndex()).toBe(3);
        });

        it("navigationLength uses sendSync", () => {
            ipcRendererSyncResults.set("navigation-history:length", 5);
            expect(nav().navigationLength()).toBe(5);
        });

        it("navigationGoToIndex sends correct IPC message", () => {
            nav().navigationGoToIndex(2);
            expect(ipcRendererSent).toContainEqual({
                channel: "navigation-history-go-to-index",
                args: [2]
            });
        });

        it("onDidNavigate registers and forwards did-navigate channel", () => {
            const callback = vi.fn();
            nav().onDidNavigate(callback);
            const listeners = ipcRendererListeners.get("did-navigate")!;
            expect(listeners).toHaveLength(1);
            listeners[0]();
            expect(callback).toHaveBeenCalled();
        });

        it("removeDidNavigateListeners clears both navigation listeners", () => {
            nav().onDidNavigate(vi.fn());
            nav().onDidNavigateInPage(vi.fn());
            expect(ipcRendererListeners.has("did-navigate")).toBe(true);
            expect(ipcRendererListeners.has("did-navigate-in-page")).toBe(true);
            nav().removeDidNavigateListeners();
            expect(ipcRendererListeners.has("did-navigate")).toBe(false);
            expect(ipcRendererListeners.has("did-navigate-in-page")).toBe(false);
        });
    });

    describe("ws", () => {
        const ws = () => getGroup("ws");

        it("send forwards the message on the trilium-ws-from-renderer channel", () => {
            ws().send({ type: "ping", lastEntityChangeId: 42 });
            expect(ipcRendererSent).toContainEqual({
                channel: "trilium-ws-from-renderer",
                args: [{ type: "ping", lastEntityChangeId: 42 }]
            });
        });

        it("onMessage subscribes to trilium-ws-message and forwards payloads", () => {
            const callback = vi.fn();
            ws().onMessage(callback);
            const listeners = ipcRendererListeners.get("trilium-ws-message")!;
            expect(listeners).toHaveLength(1);
            listeners[0]({}, { type: "frontend-update", data: { entityChanges: [] } });
            expect(callback).toHaveBeenCalledWith({ type: "frontend-update", data: { entityChanges: [] } });
        });

        it("onMessage returns an unsubscribe that detaches only its own listener", () => {
            const first = vi.fn();
            const second = vi.fn();
            const unsubFirst = ws().onMessage(first);
            ws().onMessage(second);
            expect(ipcRendererListeners.get("trilium-ws-message")).toHaveLength(2);

            unsubFirst();

            const remaining = ipcRendererListeners.get("trilium-ws-message")!;
            expect(remaining).toHaveLength(1);
            remaining[0]({}, { type: "toast", message: "hi" });
            expect(first).not.toHaveBeenCalled();
            expect(second).toHaveBeenCalledWith({ type: "toast", message: "hi" });
        });
    });
});
