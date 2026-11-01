import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
    on: new Map<string, Handler>(),
    handle: new Map<string, Handler>(),
    openExternal: vi.fn(() => Promise.resolve()),
    openPath: vi.fn(() => Promise.resolve("")),
    showItemInFolder: vi.fn(),
    execFile: vi.fn(),
    spawn: vi.fn(),
    showOpenDialog: vi.fn<(...args: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>>(),
    logError: vi.fn()
}));

vi.mock("electron", () => ({
    default: {
        ipcMain: {
            on: (channel: string, fn: Handler) => h.on.set(channel, fn),
            handle: (channel: string, fn: Handler) => h.handle.set(channel, fn)
        },
        BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
        dialog: { showOpenDialog: h.showOpenDialog },
        shell: {
            openExternal: h.openExternal,
            openPath: h.openPath,
            showItemInFolder: h.showItemInFolder
        }
    }
}));

vi.mock("child_process", () => ({ execFile: h.execFile, spawn: h.spawn }));

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return { ...actual, getLog: () => ({ info: vi.fn(), error: h.logError }) };
});

const { setupShellHandlers } = await import("./shell.js");
const dataDirs = (await import("@triliumnext/server/src/services/data_dir.js")).default;

const DATA_DIR = dataDirs.TRILIUM_DATA_DIR;
const TMP_DIR = dataDirs.TMP_DIR;
let tmpFile: string;
let dataFile: string;
let tmpDir: string;
let unicodeDir: string;

function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

const realPlatform = process.platform;

beforeAll(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    tmpFile = path.join(TMP_DIR, "shell-handlers-test.txt");
    dataFile = path.join(DATA_DIR, "shell-handlers-data.txt");
    fs.writeFileSync(tmpFile, "");
    fs.writeFileSync(dataFile, "");
    tmpDir = path.join(TMP_DIR, "shell-handlers-test-dir");
    unicodeDir = path.join(TMP_DIR, "shell-handlers-资料");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(unicodeDir, { recursive: true });
    setupShellHandlers();
});

afterAll(() => {
    fs.rmSync(tmpFile, { force: true });
    fs.rmSync(dataFile, { force: true });
    fs.rmSync(tmpDir, { force: true, recursive: true });
    fs.rmSync(unicodeDir, { force: true, recursive: true });
    setPlatform(realPlatform);
});

beforeEach(() => {
    vi.clearAllMocks();
    setPlatform(realPlatform);
});

function fireOn(channel: string, ...args: unknown[]) {
    const fn = h.on.get(channel);
    if (!fn) throw new Error(`no on-handler for ${channel}`);
    return fn({ sender: { getURL: () => "trilium-app://app/", downloadURL: h.openExternal } }, ...args);
}

function fireHandle(channel: string, ...args: unknown[]) {
    const fn = h.handle.get(channel);
    if (!fn) throw new Error(`no handle-handler for ${channel}`);
    return fn({}, ...args);
}

describe("setupShellHandlers", () => {
    describe("open-external", () => {
        it("opens a validated URL", () => {
            fireOn("open-external", "https://example.com/");
            expect(h.openExternal).toHaveBeenCalledWith("https://example.com/");
        });

        it("swallows invalid URLs without opening anything", () => {
            fireOn("open-external", "javascript:alert(1)");
            expect(h.openExternal).not.toHaveBeenCalled();
        });
    });

    describe("open-path", () => {
        it("opens a path inside the sandbox", () => {
            fireHandle("open-path", dataFile);
            expect(h.openPath).toHaveBeenCalledWith(path.resolve(dataFile));
        });

        it("returns an error message for a path outside the sandbox", () => {
            const result = fireHandle("open-path", process.platform === "win32" ? "C:\\Windows\\evil" : "/etc/passwd");
            expect(result).toBeTruthy();
            expect(h.openPath).not.toHaveBeenCalled();
        });
    });

    describe("show-item-in-folder", () => {
        it("reveals a file inside the sandbox", () => {
            fireOn("show-item-in-folder", dataFile);
            expect(h.showItemInFolder).toHaveBeenCalledWith(path.resolve(dataFile));
        });

        it("reveals nothing for a path outside the sandbox", () => {
            fireOn("show-item-in-folder", process.platform === "win32" ? "C:\\Windows\\evil" : "/etc/passwd");
            expect(h.showItemInFolder).not.toHaveBeenCalled();
        });
    });

    describe("open-file-url", () => {
        it("opens a valid file: URL", () => {
            const url = process.platform === "win32" ? "file:///C:/Windows/notepad.exe" : "file:///etc/hosts";
            fireHandle("open-file-url", url);
            expect(h.openPath).toHaveBeenCalled();
        });

        it("returns an error message for a non-file URL", () => {
            const result = fireHandle("open-file-url", "https://example.com/x");
            expect(result).toBeTruthy();
            expect(h.openPath).not.toHaveBeenCalled();
        });

        it("opens a directory through the file: protocol handler on Windows", async () => {
            setPlatform("win32");
            const result = await fireHandle("open-file-url", pathToFileURL(tmpDir).href);
            expect(h.openExternal).toHaveBeenCalledWith(pathToFileURL(tmpDir).href);
            expect(h.openPath).not.toHaveBeenCalled();
            expect(result).toBe("");
        });

        it("reports a failure of the protocol handler back to the renderer", async () => {
            setPlatform("win32");
            h.openExternal.mockRejectedValueOnce(new Error("no handler"));
            const result = await fireHandle("open-file-url", pathToFileURL(tmpDir).href);
            expect(result).toContain("no handler");
        });

        it("keeps openPath for a file, and for a directory whose name is not ASCII", () => {
            setPlatform("win32");
            fireHandle("open-file-url", pathToFileURL(tmpFile).href);
            fireHandle("open-file-url", pathToFileURL(unicodeDir).href);
            expect(h.openPath).toHaveBeenCalledTimes(2);
            expect(h.openExternal).not.toHaveBeenCalled();
        });

        it("keeps openPath for a directory outside Windows", () => {
            setPlatform("linux");
            fireHandle("open-file-url", pathToFileURL(tmpDir).href);
            expect(h.openPath).toHaveBeenCalledWith(path.resolve(tmpDir));
            expect(h.openExternal).not.toHaveBeenCalled();
        });
    });

    describe("download-url", () => {
        it("downloads a same-origin URL via the sender", () => {
            fireOn("download-url", "trilium-app://app/api/notes/abc/download");
            expect(h.openExternal).toHaveBeenCalledWith("trilium-app://app/api/notes/abc/download");
        });

        it("swallows a cross-origin download", () => {
            fireOn("download-url", "https://attacker.example/malware.exe");
            expect(h.openExternal).not.toHaveBeenCalled();
        });
    });

    describe("open-custom", () => {
        it("reports an invalid path as a failure without opening anything", async () => {
            expect(await fireHandle("open-custom", "/etc/passwd")).toBe(false);
            expect(h.execFile).not.toHaveBeenCalled();
            expect(h.openPath).not.toHaveBeenCalled();
        });

        it("reports a failure on platforms without an application chooser", async () => {
            setPlatform("freebsd");
            expect(await fireHandle("open-custom", tmpFile)).toBe(false);
            expect(h.openPath).not.toHaveBeenCalled();
            expect(h.execFile).not.toHaveBeenCalled();
        });

        describe("darwin", () => {
            beforeEach(() => setPlatform("darwin"));

            it("opens the file in the application picked from /Applications", async () => {
                h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [ "/Applications/TextEdit.app" ] });
                h.execFile.mockImplementation((_cmd, _args, cb) => cb(null));
                expect(await fireHandle("open-custom", tmpFile)).toBe(true);

                const [ window, options ] = h.showOpenDialog.mock.calls[0] as [ unknown, { defaultPath: string; properties: string[]; filters: { extensions: string[] }[] } ];
                expect(window).toEqual({ id: 1 });
                expect(options.defaultPath).toBe("/Applications");
                expect(options.properties).toEqual([ "openFile" ]);
                expect(options.filters[0].extensions).toEqual([ "app" ]);
                expect(h.execFile).toHaveBeenCalledWith("open", [ "-a", "/Applications/TextEdit.app", tmpFile ], expect.any(Function));
                expect(h.openPath).not.toHaveBeenCalled();
            });

            it("opens nothing when the picker is canceled", async () => {
                h.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
                expect(await fireHandle("open-custom", tmpFile)).toBe(true);
                expect(h.execFile).not.toHaveBeenCalled();
                expect(h.openPath).not.toHaveBeenCalled();
            });

            it("reports a failure when the application cannot open the file", async () => {
                h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [ "/Applications/Broken.app" ] });
                h.execFile.mockImplementation((_cmd, _args, cb) => cb(new Error("LSOpenURLsWithRole() failed")));
                expect(await fireHandle("open-custom", tmpFile)).toBe(false);
                expect(h.logError).toHaveBeenCalledWith(expect.stringContaining("LSOpenURLsWithRole"));
                expect(h.openPath).not.toHaveBeenCalled();
            });
        });

        describe("linux", () => {
            beforeEach(() => setPlatform("linux"));

            /** Makes the next `spawn()` emit `event` with `arg` on the following tick. */
            function spawnEmits(event: "close" | "error", arg: unknown) {
                h.spawn.mockImplementationOnce(() => {
                    const child = new EventEmitter();
                    setImmediate(() => child.emit(event, arg));
                    return child;
                });
            }

            it("asks the desktop portal to show its chooser for the file", async () => {
                spawnEmits("close", 0);
                expect(await fireHandle("open-custom", tmpFile)).toBe(true);

                expect(h.spawn).toHaveBeenCalledTimes(1);
                const [ command, args, options ] = h.spawn.mock.calls[0];
                expect(command).toBe("gdbus");
                expect(args).toEqual(expect.arrayContaining([
                    "org.freedesktop.portal.Desktop",
                    "org.freedesktop.portal.OpenURI.OpenFile",
                    "@h 3"
                ]));
                expect(args.at(-1)).toContain("'ask': <true>");
                expect(options.stdio[3]).toEqual(expect.any(Number));
                expect(h.execFile).not.toHaveBeenCalled();
                expect(h.openPath).not.toHaveBeenCalled();
            });

            it("reports a failure without opening the file when the portal call fails", async () => {
                spawnEmits("close", 1);
                expect(await fireHandle("open-custom", tmpFile)).toBe(false);
                expect(h.openPath).not.toHaveBeenCalled();
            });

            it("reports a failure without opening the file when gdbus is missing", async () => {
                spawnEmits("error", Object.assign(new Error("spawn gdbus ENOENT"), { code: "ENOENT" }));
                expect(await fireHandle("open-custom", tmpFile)).toBe(false);
                expect(h.openPath).not.toHaveBeenCalled();
            });

            it("settles once and logs the portal's stderr when a failed spawn emits both error and close", async () => {
                const closeSync = vi.spyOn(fs, "closeSync");
                h.spawn.mockImplementationOnce(() => {
                    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
                    setImmediate(() => {
                        child.stderr.emit("data", "No such interface\n");
                        child.emit("close", 1);
                        child.emit("error", new Error("late"));
                    });
                    return child;
                });

                expect(await fireHandle("open-custom", tmpFile)).toBe(false);
                expect(closeSync).toHaveBeenCalledOnce();
                expect(h.logError).toHaveBeenCalledWith(expect.stringContaining("No such interface"));
            });
        });

        describe("win32", () => {
            beforeEach(() => setPlatform("win32"));

            it("launches rundll32 for the OpenAs dialog", async () => {
                h.execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null));
                expect(await fireHandle("open-custom", tmpFile)).toBe(true);
                expect(h.execFile.mock.calls[0][0]).toBe("rundll32.exe");
                expect(h.openPath).not.toHaveBeenCalled();
            });

            it("reports a failure without opening the file when rundll32 fails", async () => {
                h.execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(new Error("boom")));
                expect(await fireHandle("open-custom", tmpFile)).toBe(false);
                expect(h.openPath).not.toHaveBeenCalled();
            });
        });
    });
});
