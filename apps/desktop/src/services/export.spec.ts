import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    getFocusedWindow: vi.fn<() => object | null>(),
    showSaveDialog: vi.fn<(...args: unknown[]) => Promise<{ canceled: boolean; filePath?: string }>>(),
    showItemInFolder: vi.fn(),
    exportBranchToZipFile: vi.fn<(...args: unknown[]) => Promise<void>>(),
    rm: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    logError: vi.fn()
}));

vi.mock("electron", () => ({
    default: {
        ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn) },
        BrowserWindow: { getFocusedWindow: h.getFocusedWindow },
        dialog: { showSaveDialog: h.showSaveDialog },
        shell: { showItemInFolder: h.showItemInFolder }
    }
}));
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ error: h.logError }),
    utils: {
        formatDownloadTitle: (title: string) => `${title}.zip`,
        safeExtractMessageAndStackFromError: (e: unknown) => String(e)
    },
    zipExportService: { exportBranchToZipFile: h.exportBranchToZipFile }
}));
vi.mock("fs/promises", () => ({ default: { rm: h.rm } }));
vi.mock("i18next", () => ({ t: (key: string) => key }));

const { setupExportHandlers } = await import("./export.js");

const OPTS = { branchId: "b1", format: "html", title: "My notes", taskId: "task1" };

function exportSubtree() {
    return h.handlers.get("export-subtree-to-file")?.({}, OPTS) as Promise<unknown>;
}

describe("export-subtree-to-file", () => {
    const window = { id: 1 };

    beforeEach(() => {
        h.handlers.clear();
        vi.clearAllMocks();
        h.getFocusedWindow.mockReturnValue(window);
        h.exportBranchToZipFile.mockResolvedValue(undefined);
        setupExportHandlers();
    });

    it("streams the export to the chosen file and reveals it", async () => {
        h.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/out/My notes.zip" });

        expect(await exportSubtree()).toEqual({ status: "saved", filePath: "/out/My notes.zip" });
        expect(h.showSaveDialog).toHaveBeenCalledWith(window, {
            defaultPath: "My notes.zip",
            filters: [{ name: "export.zip_filter", extensions: ["zip"] }]
        });
        expect(h.exportBranchToZipFile).toHaveBeenCalledWith("b1", "html", "/out/My notes.zip", "task1");
        expect(h.showItemInFolder).toHaveBeenCalledWith("/out/My notes.zip");
    });

    it("cancels without exporting when there is no window or the dialog is dismissed", async () => {
        h.getFocusedWindow.mockReturnValueOnce(null);
        expect(await exportSubtree()).toEqual({ status: "cancelled" });
        expect(h.showSaveDialog).not.toHaveBeenCalled();

        h.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: "/out/x.zip" });
        expect(await exportSubtree()).toEqual({ status: "cancelled" });
        h.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: "" });
        expect(await exportSubtree()).toEqual({ status: "cancelled" });

        expect(h.exportBranchToZipFile).not.toHaveBeenCalled();
    });

    it("removes the partial archive and reports the error, including a non-Error throw", async () => {
        h.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/out/a.zip" });

        h.exportBranchToZipFile.mockRejectedValueOnce(new Error("disk full"));
        expect(await exportSubtree()).toEqual({ status: "error", message: "disk full" });

        h.exportBranchToZipFile.mockRejectedValueOnce("aborted");
        expect(await exportSubtree()).toEqual({ status: "error", message: "aborted" });

        expect(h.rm).toHaveBeenCalledTimes(2);
        expect(h.rm).toHaveBeenCalledWith("/out/a.zip", { force: true });
        expect(h.logError).toHaveBeenCalledTimes(2);
        expect(h.showItemInFolder).not.toHaveBeenCalled();
    });
});
