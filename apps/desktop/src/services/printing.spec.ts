import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
    on: new Map<string, Handler>(),
    handle: new Map<string, Handler>(),
    off: [] as Array<[string, unknown]>,
    consoleHandlers: [] as Array<(event: { level: string }, message: string, line: number, sourceId: string) => void>,
    loadURL: vi.fn((..._a: unknown[]) => Promise.resolve()),
    executeJavaScript: vi.fn((..._a: unknown[]): Promise<unknown> => Promise.resolve("REPORT")),
    print: vi.fn((_opts: unknown, cb: (success: boolean, reason?: string) => void) => cb(true)),
    printToPDF: vi.fn((..._a: unknown[]) => Promise.resolve(Buffer.from("pdf-bytes"))),
    destroy: vi.fn((..._a: unknown[]) => {}),
    getPrintersAsync: vi.fn((..._a: unknown[]) => Promise.resolve([] as unknown[])),
    showSaveDialogSync: vi.fn((..._a: unknown[]): string | undefined => "/out.pdf"),
    showErrorBox: vi.fn((..._a: unknown[]) => {}),
    openPath: vi.fn((..._a: unknown[]) => {}),
    getFocusedWindow: vi.fn((..._a: unknown[]): unknown => ({})),
    writeFile: vi.fn((..._a: unknown[]) => Promise.resolve()),
    isDev: true as boolean,
    lastBwOpts: undefined as unknown
}));

vi.mock("electron", () => {
    const ipcMainObj = {
        on: (channel: string, fn: Handler) => h.on.set(channel, fn),
        off: (channel: string, fn: unknown) => h.off.push([channel, fn]),
        handle: (channel: string, fn: Handler) => h.handle.set(channel, fn)
    };
    const webContents = {
        on: (ev: string, cb: never) => { if (ev === "console-message") h.consoleHandlers.push(cb); },
        executeJavaScript: (...a: unknown[]) => h.executeJavaScript(...a),
        print: (...a: unknown[]) => (h.print as (...args: unknown[]) => unknown)(...a),
        printToPDF: (...a: unknown[]) => h.printToPDF(...a)
    };
    class FakeBrowserWindow {
        webContents = webContents;
        loadURL = (...a: unknown[]) => h.loadURL(...a);
        destroy = (...a: unknown[]) => h.destroy(...a);
        constructor(opts: unknown) { h.lastBwOpts = opts; }
        static getFocusedWindow = (...a: unknown[]) => h.getFocusedWindow(...a);
    }
    return {
        default: {
            BrowserWindow: FakeBrowserWindow,
            ipcMain: ipcMainObj,
            dialog: {
                showSaveDialogSync: (...a: unknown[]) => h.showSaveDialogSync(...a),
                showErrorBox: (...a: unknown[]) => h.showErrorBox(...a)
            },
            shell: { openPath: (...a: unknown[]) => h.openPath(...a) }
        },
        ipcMain: ipcMainObj
    };
});

vi.mock("fs/promises", () => ({ default: { writeFile: (...a: unknown[]) => h.writeFile(...a) } }));
vi.mock("i18next", () => ({ t: (key: string) => key }));
vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        getLog: () => ({ info: vi.fn(), error: vi.fn() }),
        utils: { ...actual.utils, isDev: () => h.isDev }
    };
});

const printing = await import("./printing.js");

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

function makeEvent() {
    return {
        sender: {
            send: vi.fn(),
            session: { id: 1 },
            getPrintersAsync: (...a: unknown[]) => h.getPrintersAsync(...a)
        }
    };
}

async function fireOn(channel: string, payload: unknown) {
    const fn = h.on.get(channel);
    if (!fn) throw new Error(`no on-handler for ${channel}`);
    const event = makeEvent();
    await fn(event, payload);
    return event;
}

const PDF_OPTS = {
    notePath: "root/abc",
    title: "My Note",
    landscape: false,
    pageSize: "A4" as const,
    scale: 1,
    margins: "default",
    pageRanges: ""
};

describe("printing — pure helpers", () => {
    describe("parseMargins", () => {
        it("expands presets to uniform numeric margins (mm → inches)", () => {
            expect(printing.parseMargins("default")).toMatchObject({ marginType: "custom", top: 20 / 25.4 });
            expect(printing.parseMargins("")).toMatchObject({ top: 20 / 25.4 });
            expect(printing.parseMargins("none")).toMatchObject({ top: 0 });
            expect(printing.parseMargins("minimum")).toMatchObject({ top: 5 / 25.4 });
        });

        it("parses a four-part custom margin spec", () => {
            expect(printing.parseMargins("10,20,30,40")).toEqual({
                marginType: "custom",
                top: 10 / 25.4,
                right: 20 / 25.4,
                bottom: 30 / 25.4,
                left: 40 / 25.4
            });
        });

        it("falls back to 1cm uniform for malformed specs", () => {
            expect(printing.parseMargins("1,2,bad")).toMatchObject({ top: 10 / 25.4 });
        });
    });

    describe("parsePageRangesForPrint", () => {
        it("returns undefined for empty / whitespace input", () => {
            expect(printing.parsePageRangesForPrint("")).toBeUndefined();
            expect(printing.parsePageRangesForPrint("   ")).toBeUndefined();
        });

        it("parses ranges and single pages, skipping blanks and NaNs", () => {
            expect(printing.parsePageRangesForPrint("1-5, 8, 11-13, , x-y")).toEqual([
                { from: 1, to: 5 },
                { from: 8, to: 8 },
                { from: 11, to: 13 }
            ]);
        });

        it("returns undefined when nothing parses", () => {
            expect(printing.parsePageRangesForPrint("x, y-z")).toBeUndefined();
        });
    });
});

describe("setupPrintingHandlers", () => {
    beforeAll(() => {
        printing.setupPrintingHandlers();
    });

    beforeEach(() => {
        h.on.delete("print-progress");
        h.off.length = 0;
        h.consoleHandlers.length = 0;
        h.loadURL.mockReset().mockResolvedValue(undefined);
        h.executeJavaScript.mockReset().mockResolvedValue("REPORT");
        h.print.mockReset().mockImplementation((_opts, cb) => cb(true));
        h.printToPDF.mockReset().mockResolvedValue(Buffer.from("pdf-bytes"));
        h.destroy.mockReset();
        h.getPrintersAsync.mockReset().mockResolvedValue([]);
        h.showSaveDialogSync.mockReset().mockReturnValue("/out.pdf");
        h.showErrorBox.mockReset();
        h.openPath.mockReset();
        h.getFocusedWindow.mockReset().mockReturnValue({});
        h.writeFile.mockReset().mockResolvedValue(undefined);
        h.isDev = true;
        setPlatform(realPlatform);
    });

    afterEach(() => setPlatform(realPlatform));

    describe("print-note", () => {
        it("prints successfully and forwards the print report", async () => {
            const e = await fireOn("print-note", { notePath: "root/abc" });
            expect(h.print).toHaveBeenCalled();
            expect(e.sender.send).toHaveBeenCalledWith("print-done", "REPORT");
            expect(h.destroy).toHaveBeenCalled();
            expect(h.showErrorBox).not.toHaveBeenCalled();
        });

        it("shows an error box on print failure but not on user cancel", async () => {
            h.print.mockImplementation((_opts, cb) => cb(false, "spooler down"));
            await fireOn("print-note", { notePath: "root/abc" });
            expect(h.showErrorBox).toHaveBeenCalled();

            h.showErrorBox.mockClear();
            h.print.mockImplementation((_opts, cb) => cb(false, "Print job canceled"));
            await fireOn("print-note", { notePath: "root/abc" });
            expect(h.showErrorBox).not.toHaveBeenCalled();
        });

        it("reports an error payload when the print window fails to load", async () => {
            h.loadURL.mockRejectedValue(new Error("load failed"));
            const e = await fireOn("print-note", { notePath: "root/abc" });
            expect(e.sender.send).toHaveBeenCalledWith("print-done", expect.objectContaining({ type: "error", message: "load failed" }));
        });

        it("uses offscreen rendering off Linux and forwards console output + progress", async () => {
            setPlatform("darwin");
            const e = await fireOn("print-note", { notePath: "root/abc" });
            expect((h.lastBwOpts as { webPreferences: { offscreen: boolean } }).webPreferences.offscreen).toBe(true);

            // Exercise the captured console-message handler at each log level.
            const consoleHandler = h.consoleHandlers[0];
            expect(consoleHandler).toBeDefined();
            consoleHandler({ level: "debug" }, "dbg", 1, "s");
            consoleHandler({ level: "error" }, "err", 2, "s");
            consoleHandler({ level: "info" }, "info", 3, "s");

            // Exercise the print-progress relay callback registered for this window.
            const progress = h.on.get("print-progress");
            expect(progress).toBeDefined();
            progress?.({}, 42);
            expect(e.sender.send).toHaveBeenCalledWith("print-progress", { progress: 42, action: "printing" });
        });

        it("stringifies a non-Error rejection in the error payload", async () => {
            // Reject with a plain string so the `err instanceof Error` ternaries
            // take their String(err) / undefined arms.
            h.loadURL.mockRejectedValue("plain string failure");
            const e = await fireOn("print-note", { notePath: "root/abc" });
            expect(e.sender.send).toHaveBeenCalledWith("print-done", { type: "error", message: "plain string failure", stack: undefined });
        });

        it("survives a failed error-handler injection and a failed note-ready wait", async () => {
            // First executeJavaScript (error-handler setup) rejects → caught and ignored.
            // Second executeJavaScript (note-ready) rejects → propagates as an error payload.
            h.executeJavaScript.mockReset()
                .mockRejectedValueOnce(new Error("inject failed"))
                .mockRejectedValueOnce(new Error("note never ready"));
            const e = await fireOn("print-note", { notePath: "root/abc" });
            expect(e.sender.send).toHaveBeenCalledWith("print-done", expect.objectContaining({ type: "error", message: "note never ready" }));
        });
    });

    describe("export-as-pdf", () => {
        it("writes the generated PDF and opens it", async () => {
            const e = await fireOn("export-as-pdf", PDF_OPTS);
            expect(h.printToPDF).toHaveBeenCalled();
            expect(h.writeFile).toHaveBeenCalledWith("/out.pdf", expect.any(Buffer));
            expect(h.openPath).toHaveBeenCalledWith("/out.pdf");
            expect(e.sender.send).toHaveBeenCalledWith("print-done", "REPORT");
            expect(h.destroy).toHaveBeenCalled();
        });

        it("does nothing when the user cancels the save dialog", async () => {
            h.showSaveDialogSync.mockReturnValue(undefined);
            await fireOn("export-as-pdf", PDF_OPTS);
            expect(h.printToPDF).not.toHaveBeenCalled();
            expect(h.destroy).toHaveBeenCalled(); // finally still tears down
        });

        it("shows an error box when PDF generation fails", async () => {
            h.printToPDF.mockRejectedValue(new Error("render failed"));
            await fireOn("export-as-pdf", PDF_OPTS);
            expect(h.showErrorBox).toHaveBeenCalledWith("pdf.unable-to-export-title", "pdf.unable-to-export-message");
            expect(h.writeFile).not.toHaveBeenCalled();
        });

        it("shows an error box when writing the file fails", async () => {
            h.writeFile.mockRejectedValue(new Error("disk full"));
            await fireOn("export-as-pdf", PDF_OPTS);
            expect(h.showErrorBox).toHaveBeenCalledWith("pdf.unable-to-export-title", "pdf.unable-to-save-message");
            expect(h.openPath).not.toHaveBeenCalled();
        });

        it("reports an error payload when the print window fails (Error and non-Error)", async () => {
            h.loadURL.mockRejectedValue(new Error("load failed"));
            const e1 = await fireOn("export-as-pdf", PDF_OPTS);
            expect(e1.sender.send).toHaveBeenCalledWith("print-done", expect.objectContaining({ type: "error", message: "load failed" }));

            h.loadURL.mockRejectedValue("string failure");
            const e2 = await fireOn("export-as-pdf", PDF_OPTS);
            expect(e2.sender.send).toHaveBeenCalledWith("print-done", { type: "error", message: "string failure", stack: undefined });
        });
    });

    describe("export-as-pdf-preview", () => {
        it("returns the rendered buffer to the renderer", async () => {
            const e = await fireOn("export-as-pdf-preview", PDF_OPTS);
            expect(e.sender.send).toHaveBeenCalledWith("export-as-pdf-preview-result", expect.objectContaining({ notePath: "root/abc", buffer: expect.any(Buffer) }));
            expect(e.sender.send).toHaveBeenCalledWith("print-done", "REPORT");
        });

        it("returns an error result when rendering fails (Error and non-Error)", async () => {
            h.printToPDF.mockRejectedValue(new Error("render boom"));
            const e1 = await fireOn("export-as-pdf-preview", PDF_OPTS);
            expect(e1.sender.send).toHaveBeenCalledWith("export-as-pdf-preview-result", { notePath: "root/abc", error: "render boom" });

            h.printToPDF.mockRejectedValue("render string");
            const e2 = await fireOn("export-as-pdf-preview", PDF_OPTS);
            expect(e2.sender.send).toHaveBeenCalledWith("export-as-pdf-preview-result", { notePath: "root/abc", error: "render string" });
        });

        it("reports an error payload when the print window fails (Error and non-Error)", async () => {
            h.loadURL.mockRejectedValue(new Error("load failed"));
            const e1 = await fireOn("export-as-pdf-preview", PDF_OPTS);
            expect(e1.sender.send).toHaveBeenCalledWith("print-done", expect.objectContaining({ type: "error", message: "load failed" }));

            h.loadURL.mockRejectedValue("load string");
            const e2 = await fireOn("export-as-pdf-preview", PDF_OPTS);
            expect(e2.sender.send).toHaveBeenCalledWith("print-done", { type: "error", message: "load string", stack: undefined });
        });
    });

    describe("save-pdf", () => {
        it("writes and opens the supplied buffer", async () => {
            await fireOn("save-pdf", { title: "x", buffer: new Uint8Array([1, 2]) });
            expect(h.writeFile).toHaveBeenCalledWith("/out.pdf", expect.any(Buffer));
            expect(h.openPath).toHaveBeenCalledWith("/out.pdf");
        });

        it("does nothing without a focused window", async () => {
            h.getFocusedWindow.mockReturnValue(null);
            await fireOn("save-pdf", { title: "x", buffer: new Uint8Array([1]) });
            expect(h.showSaveDialogSync).not.toHaveBeenCalled();
        });

        it("does nothing when the save dialog is cancelled", async () => {
            h.showSaveDialogSync.mockReturnValue(undefined);
            await fireOn("save-pdf", { title: "x", buffer: new Uint8Array([1]) });
            expect(h.writeFile).not.toHaveBeenCalled();
        });

        it("shows an error box when writing fails", async () => {
            h.writeFile.mockRejectedValue(new Error("nope"));
            await fireOn("save-pdf", { title: "x", buffer: new Uint8Array([1]) });
            expect(h.showErrorBox).toHaveBeenCalledWith("pdf.unable-to-export-title", "pdf.unable-to-save-message");
        });
    });

    describe("get-printers", () => {
        it("maps printer metadata across the platform variants", async () => {
            h.getPrintersAsync.mockResolvedValue([
                { name: "p1", displayName: "Printer 1", description: "d", options: { "printer-location": "CUPS room" }, isDefault: true },
                { name: "p2", displayName: "Printer 2", description: "", options: { location: "win room" } },
                { name: "p3", displayName: "Printer 3", description: "" }
            ]);
            const handler = h.handle.get("get-printers");
            if (!handler) throw new Error("get-printers not registered");
            const result = await handler(makeEvent()) as Array<{ location: string; isDefault: boolean }>;
            expect(result[0]).toMatchObject({ location: "CUPS room", isDefault: true });
            expect(result[1]).toMatchObject({ location: "win room", isDefault: false });
            expect(result[2]).toMatchObject({ location: "", isDefault: false });
        });

        it("returns an empty list when enumeration throws", async () => {
            h.getPrintersAsync.mockRejectedValue(new Error("no printers"));
            const handler = h.handle.get("get-printers");
            if (!handler) throw new Error("get-printers not registered");
            expect(await handler(makeEvent())).toEqual([]);
        });
    });

    describe("print-from-preview", () => {
        it("prints with mapped options (Ledger → Tabloid)", async () => {
            await fireOn("print-from-preview", { ...PDF_OPTS, pageSize: "Ledger", silent: true, deviceName: "HP", scale: 1, pageRanges: "1-2" });
            const opts = h.print.mock.calls[0][0] as { pageSize: string; scaleFactor: number };
            expect(opts.pageSize).toBe("Tabloid");
            expect(opts.scaleFactor).toBe(100);
        });

        it("shows an error box on failure but not on cancel, and signals done", async () => {
            h.print.mockImplementation((_opts, cb) => cb(false, "jam"));
            const e = await fireOn("print-from-preview", { ...PDF_OPTS, silent: false });
            expect(h.showErrorBox).toHaveBeenCalled();
            expect(e.sender.send).toHaveBeenCalledWith("print-from-preview-done");

            h.showErrorBox.mockClear();
            h.print.mockImplementation((_opts, cb) => cb(false, "Print job canceled"));
            await fireOn("print-from-preview", { ...PDF_OPTS, silent: false });
            expect(h.showErrorBox).not.toHaveBeenCalled();
        });

        it("reports an error payload when the print window fails (Error and non-Error)", async () => {
            h.loadURL.mockRejectedValue(new Error("load failed"));
            const e1 = await fireOn("print-from-preview", { ...PDF_OPTS, silent: false });
            expect(e1.sender.send).toHaveBeenCalledWith("print-from-preview-done");
            expect(e1.sender.send).toHaveBeenCalledWith("print-done", expect.objectContaining({ type: "error", message: "load failed" }));

            h.loadURL.mockRejectedValue("load string");
            const e2 = await fireOn("print-from-preview", { ...PDF_OPTS, silent: false });
            expect(e2.sender.send).toHaveBeenCalledWith("print-done", { type: "error", message: "load string", stack: undefined });
        });
    });
});
