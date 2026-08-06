import { beforeEach, describe, expect, it, vi } from "vitest";

// --- electron mock: capture the IPC handlers and drive the dialog/window from the test ---
const electronMock = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => electronMock.handlers.set(channel, handler)),
    showOpenDialog: vi.fn<(...args: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>>(),
    getFocusedWindow: vi.fn<() => object | null>(() => ({}))
}));

vi.mock("electron", () => ({
    default: {
        ipcMain: { handle: electronMock.handle },
        dialog: { showOpenDialog: electronMock.showOpenDialog },
        BrowserWindow: { getFocusedWindow: electronMock.getFocusedWindow }
    }
}));

vi.mock("i18next", () => ({ t: (key: string) => key }));

const { setupDialogHandlers } = await import("./dialog.js");

function pickDirectory(opts?: { defaultPath?: string }) {
    return electronMock.handlers.get("dialog-pick-directory")?.({}, opts) as Promise<{ status: string; path?: string }>;
}

describe("desktop native directory picker", () => {
    beforeEach(() => {
        electronMock.handlers.clear();
        vi.clearAllMocks();
        electronMock.getFocusedWindow.mockReturnValue({});
        electronMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/data/backup"] });
        setupDialogHandlers();
    });

    it("returns the chosen directory, opening the picker at the given location", async () => {
        expect(await pickDirectory({ defaultPath: "/data/old" })).toEqual({ status: "selected", path: "/data/backup" });

        const [, options] = electronMock.showOpenDialog.mock.calls[0] as [unknown, { defaultPath?: string; properties: string[] }];
        expect(options.defaultPath).toBe("/data/old");
        expect(options.properties).toEqual(["openDirectory", "createDirectory"]);
    });

    it("works without a starting location", async () => {
        expect(await pickDirectory()).toEqual({ status: "selected", path: "/data/backup" });

        const [, options] = electronMock.showOpenDialog.mock.calls[0] as [unknown, { defaultPath?: string }];
        expect(options.defaultPath).toBeUndefined();
    });

    it("reports a cancelled dialog", async () => {
        electronMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
        expect(await pickDirectory()).toEqual({ status: "cancelled" });
    });

    it("reports a cancel when the dialog comes back empty despite not being cancelled", async () => {
        electronMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
        expect(await pickDirectory()).toEqual({ status: "cancelled" });
    });

    it("does not open a picker when there is no window to own it", async () => {
        electronMock.getFocusedWindow.mockReturnValue(null);

        expect(await pickDirectory()).toEqual({ status: "cancelled" });
        expect(electronMock.showOpenDialog).not.toHaveBeenCalled();
    });
});
