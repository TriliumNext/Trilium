import { beforeEach, describe, expect, it, vi } from "vitest";

type OpenDialogResult = { canceled: boolean; filePaths: string[] };
type OpenDialogOptions = { defaultPath?: string };
type Handler = (...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
    handlers: new Map<string, Handler>(),
    showOpenDialog: vi.fn<(...args: unknown[]) => Promise<OpenDialogResult>>(),
    getFocusedWindow: vi.fn<() => object | null>(() => ({})),
    /** Each option write, and whether it ran inside a CLS context. */
    written: [] as { name: string; value: string; isInContext: boolean }[],
    isInContext: false
}));

vi.mock("electron", () => ({
    default: {
        ipcMain: {
            handle: (channel: string, handler: Handler) => h.handlers.set(channel, handler)
        },
        dialog: { showOpenDialog: h.showOpenDialog },
        BrowserWindow: { getFocusedWindow: h.getFocusedWindow }
    }
}));

vi.mock("i18next", () => ({ t: (key: string) => key }));

vi.mock("@triliumnext/core", () => ({
    cls: {
        init<T>(callback: () => T): T {
            h.isInContext = true;
            try {
                return callback();
            } finally {
                h.isInContext = false;
            }
        }
    },
    getBackup: () => ({ getBackupFolderPath: () => "/data/backup" }),
    options: {
        setOption: (name: string, value: string) =>
            h.written.push({ name, value, isInContext: h.isInContext })
    }
}));

const { setupBackupLocationHandlers } = await import("./backup_location.js");

const CHOSEN = "/mnt/usb/trilium";
const invoke = (channel: string) => h.handlers.get(channel)?.({});

describe("backup location handlers", () => {
    beforeEach(() => {
        h.handlers.clear();
        h.written.length = 0;
        vi.clearAllMocks();
        h.getFocusedWindow.mockReturnValue({});
        h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [ CHOSEN ] });
        setupBackupLocationHandlers();
    });

    it("stores the folder the user accepted, opening the picker at the current one", async () => {
        expect(await invoke("backup-location-choose"))
            .toEqual({ status: "selected", path: CHOSEN });

        const [ , options ] = h.showOpenDialog.mock.calls[0] as [ unknown, OpenDialogOptions ];
        expect(options.defaultPath).toBe("/data/backup");
        expect(h.written)
            .toEqual([ { name: "customDbBackupDir", value: CHOSEN, isInContext: true } ]);
    });

    it("stores nothing when the picker is dismissed or has no window to open over", async () => {
        h.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
        expect(await invoke("backup-location-choose")).toEqual({ status: "cancelled" });

        h.getFocusedWindow.mockReturnValue(null);
        expect(await invoke("backup-location-choose")).toEqual({ status: "cancelled" });

        expect(h.written).toEqual([]);
    });

    it("takes no folder from the renderer", async () => {
        await h.handlers.get("backup-location-choose")?.({}, "/");
        await h.handlers.get("backup-location-reset")?.({}, "/");

        expect(h.written.map((write) => write.value)).toEqual([ CHOSEN, "" ]);
    });

    it("goes back to the default folder on reset", async () => {
        await invoke("backup-location-reset");

        expect(h.written).toEqual([ { name: "customDbBackupDir", value: "", isInContext: true } ]);
        expect(h.showOpenDialog).not.toHaveBeenCalled();
    });
});
