import { beforeEach, describe, expect, it, vi } from "vitest";

// --- electron mock: capture the IPC handlers and drive the dialog/window from the test ---
const electronMock = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => electronMock.handlers.set(channel, handler)),
    showOpenDialog: vi.fn<(...args: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>>(),
    showMessageBox: vi.fn<(...args: unknown[]) => Promise<{ response: number }>>(),
    getFocusedWindow: vi.fn<() => object | null>(() => ({}))
}));

vi.mock("electron", () => ({
    default: {
        ipcMain: { handle: electronMock.handle },
        dialog: {
            showOpenDialog: electronMock.showOpenDialog,
            showMessageBox: electronMock.showMessageBox
        },
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

describe("the native confirmation before starting over", () => {
    const confirmStartOver = () =>
        electronMock.handlers.get("dialog-confirm-start-over")?.({}) as Promise<boolean>;

    beforeEach(() => {
        electronMock.handlers.clear();
        vi.clearAllMocks();
        setupDialogHandlers();
    });

    it("only agrees when the second button is the one that was pressed", async () => {
        electronMock.showMessageBox.mockResolvedValue({ response: 1 });
        expect(await confirmStartOver()).toBe(true);

        electronMock.showMessageBox.mockResolvedValue({ response: 0 });
        expect(await confirmStartOver()).toBe(false);
    });

    it("defaults to cancelling, and offers no way to stop being asked", async () => {
        // A note script can pop this dialog; what it must never be able to do is get past it, or
        // wear the user down until they stop seeing it.
        electronMock.showMessageBox.mockResolvedValue({ response: 0 });
        await confirmStartOver();

        const [ options ] = electronMock.showMessageBox.mock.calls[0] as [ {
            type: string; defaultId: number; cancelId: number; checkboxLabel?: string;
        } ];
        expect(options).toMatchObject({ type: "warning", defaultId: 0, cancelId: 0 });
        expect(options.checkboxLabel).toBeUndefined();
    });
});
