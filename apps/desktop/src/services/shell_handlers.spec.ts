import fs from "fs";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
    on: new Map<string, Handler>(),
    handle: new Map<string, Handler>(),
    openExternal: vi.fn(),
    openPath: vi.fn(() => Promise.resolve("")),
    execFile: vi.fn()
}));

vi.mock("electron", () => ({
    default: {
        ipcMain: {
            on: (channel: string, fn: Handler) => h.on.set(channel, fn),
            handle: (channel: string, fn: Handler) => h.handle.set(channel, fn)
        },
        shell: {
            openExternal: h.openExternal,
            openPath: h.openPath
        }
    }
}));

vi.mock("child_process", () => ({ execFile: h.execFile }));

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return { ...actual, getLog: () => ({ info: vi.fn(), error: vi.fn() }) };
});

const { setupShellHandlers } = await import("./shell.js");
const dataDirs = (await import("@triliumnext/server/src/services/data_dir.js")).default;

const DATA_DIR = dataDirs.TRILIUM_DATA_DIR;
const TMP_DIR = dataDirs.TMP_DIR;
let tmpFile: string;
let dataFile: string;

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
    setupShellHandlers();
});

afterAll(() => {
    fs.rmSync(tmpFile, { force: true });
    fs.rmSync(dataFile, { force: true });
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
        it("swallows invalid paths", () => {
            fireOn("open-custom", "/etc/passwd");
            expect(h.execFile).not.toHaveBeenCalled();
            expect(h.openPath).not.toHaveBeenCalled();
        });

        it("opens directly via the shell on macOS/other platforms", () => {
            setPlatform("darwin");
            fireOn("open-custom", tmpFile);
            expect(h.openPath).toHaveBeenCalledWith(path.resolve(tmpFile));
            expect(h.execFile).not.toHaveBeenCalled();
        });

        describe("linux", () => {
            beforeEach(() => setPlatform("linux"));

            it("launches the first available terminal", () => {
                h.execFile.mockImplementation((_cmd, _args, cb) => cb(null));
                fireOn("open-custom", tmpFile);
                expect(h.execFile).toHaveBeenCalledTimes(1);
                expect(h.execFile.mock.calls[0][0]).toBe("x-terminal-emulator");
                expect(h.openPath).not.toHaveBeenCalled();
            });

            it("falls through to the next terminal when one fails", () => {
                let calls = 0;
                h.execFile.mockImplementation((_cmd, _args, cb) => cb(calls++ === 0 ? new Error("nope") : null));
                fireOn("open-custom", tmpFile);
                expect(h.execFile).toHaveBeenCalledTimes(2);
            });

            it("falls back to shell.openPath when no terminal works", () => {
                h.execFile.mockImplementation((_cmd, _args, cb) => cb(new Error("nope")));
                fireOn("open-custom", tmpFile);
                // 9 terminals are tried before giving up.
                expect(h.execFile).toHaveBeenCalledTimes(9);
                expect(h.openPath).toHaveBeenCalledWith(path.resolve(tmpFile));
            });
        });

        describe("win32", () => {
            beforeEach(() => setPlatform("win32"));

            it("launches rundll32 for the OpenAs dialog", () => {
                h.execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null));
                fireOn("open-custom", tmpFile);
                expect(h.execFile.mock.calls[0][0]).toBe("rundll32.exe");
                expect(h.openPath).not.toHaveBeenCalled();
            });

            it("falls back to shell.openPath when rundll32 fails", () => {
                h.execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(new Error("boom")));
                fireOn("open-custom", tmpFile);
                expect(h.openPath).toHaveBeenCalledWith(path.resolve(tmpFile));
            });
        });
    });
});
