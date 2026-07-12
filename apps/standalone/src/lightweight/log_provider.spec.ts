import type { LogFileInfo } from "@triliumnext/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import StandaloneLogService from "./log_provider.js";

interface NavWithStorage {
    storage?: { getDirectory?: () => Promise<unknown> };
}

interface LogInternals {
    readonly eol: string;
    ensureLogDirectory(): Promise<void>;
    openLogFile(fileName: string): Promise<void>;
    closeLogFile(): void;
    writeEntry(entry: string): void;
    readLogFile(fileName: string): string | null;
    listLogFiles(): Promise<LogFileInfo[]>;
    deleteLogFile(fileName: string): Promise<void>;
    getRetentionDays(): number;
    currentFile: unknown;
    currentFileName: string;
    logDir: unknown;
}

const realStorageDescriptor = Object.getOwnPropertyDescriptor(navigator, "storage");

/** A fake FileSystemSyncAccessHandle backed by a growable byte array. */
function makeSyncHandle() {
    let data = new Uint8Array();
    const close = vi.fn();
    return {
        getSize: () => data.length,
        truncate: (n: number) => { data = data.slice(0, n); },
        write: (chunk: ArrayBufferView, opts?: { at?: number }) => {
            const at = opts?.at ?? 0;
            const incoming = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            if (at + incoming.length > data.length) {
                const grown = new Uint8Array(at + incoming.length);
                grown.set(data);
                data = grown;
            }
            data.set(incoming, at);
            return incoming.length;
        },
        read: (view: ArrayBufferView, opts?: { at?: number }) => {
            const at = opts?.at ?? 0;
            const out = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
            const slice = data.subarray(at, at + out.length);
            out.set(slice);
            return slice.length;
        },
        flush: vi.fn(),
        close
    };
}

/** Install an OPFS root whose log directory uses the given file handle + entries. */
function installOpfs(opts: {
    createSyncAccessHandle?: () => Promise<unknown>;
    entries?: () => AsyncGenerator<[string, unknown]>;
    removeEntry?: (name: string) => Promise<void>;
}) {
    const dir = {
        async getFileHandle() {
            return { createSyncAccessHandle: opts.createSyncAccessHandle ?? (async () => makeSyncHandle()) };
        },
        async *entries() {
            if (opts.entries) {
                yield* opts.entries();
            }
        },
        removeEntry: opts.removeEntry ?? (async () => {})
    };
    Object.defineProperty(navigator, "storage", {
        value: { getDirectory: async () => ({ async getDirectoryHandle() { return dir; } }) },
        configurable: true
    });
    return dir;
}

function internalsOf(service: StandaloneLogService): LogInternals {
    return service as unknown as LogInternals;
}

afterEach(() => {
    if (realStorageDescriptor) {
        Object.defineProperty(navigator, "storage", realStorageDescriptor);
    } else {
        delete (navigator as unknown as NavWithStorage).storage;
    }
    vi.restoreAllMocks();
});

describe("StandaloneLogService basics", () => {
    it("uses LF line endings and the default 7-day retention", () => {
        const internal = internalsOf(new StandaloneLogService());
        expect(internal.eol).toBe("\n");
        expect(internal.getRetentionDays()).toBe(7);
    });
});

describe("StandaloneLogService file handling", () => {
    it("opens, writes, reads back, and closes the current log file", async () => {
        const handle = makeSyncHandle();
        installOpfs({ createSyncAccessHandle: async () => handle });

        const service = new StandaloneLogService();
        const internal = internalsOf(service);
        await internal.ensureLogDirectory();
        await internal.openLogFile("trilium-2024-01-15.log");
        expect(internal.currentFileName).toBe("trilium-2024-01-15.log");

        internal.writeEntry("hello world\n");
        expect(internal.readLogFile("trilium-2024-01-15.log")).toBe("hello world\n");

        // A different file name cannot be read via the sync handle.
        expect(internal.readLogFile("trilium-2024-01-14.log")).toBeNull();

        internal.closeLogFile();
        expect(handle.close).toHaveBeenCalled();
        expect(internal.currentFile).toBeNull();
    });

    it("opens the directory lazily and replaces an already-open file", async () => {
        installOpfs({ createSyncAccessHandle: async () => makeSyncHandle() });
        const service = new StandaloneLogService();
        const internal = internalsOf(service);

        // No ensureLogDirectory() call first → openLogFile creates the directory.
        await internal.openLogFile("trilium-2024-02-01.log");
        await internal.openLogFile("trilium-2024-02-02.log");
        expect(internal.currentFileName).toBe("trilium-2024-02-02.log");
    });

    it("retries acquiring the sync handle and recovers", async () => {
        let attempts = 0;
        installOpfs({
            createSyncAccessHandle: async () => {
                attempts++;
                if (attempts === 1) {
                    throw new Error("locked");
                }
                return makeSyncHandle();
            }
        });
        const internal = internalsOf(new StandaloneLogService());
        await internal.ensureLogDirectory();
        await internal.openLogFile("trilium-2024-03-01.log");
        expect(attempts).toBe(2);
        expect(internal.currentFileName).toBe("trilium-2024-03-01.log");
    });

    it("falls back to console-only logging when the handle never opens", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        installOpfs({ createSyncAccessHandle: async () => { throw new Error("always locked"); } });
        const internal = internalsOf(new StandaloneLogService());
        await internal.ensureLogDirectory();
        await internal.openLogFile("trilium-2024-04-01.log");
        expect(internal.currentFile).toBeNull();
        expect(internal.currentFileName).toBe("");
    });

    it("writeEntry logs to the console when no file is open", () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        internalsOf(new StandaloneLogService()).writeEntry("console fallback");
        expect(logSpy).toHaveBeenCalledWith("console fallback");
    });

    it("closeLogFile is a no-op when nothing is open", () => {
        expect(() => internalsOf(new StandaloneLogService()).closeLogFile()).not.toThrow();
    });

    it("readLogFile returns null without a directory and swallows read errors", async () => {
        const service = new StandaloneLogService();
        const internal = internalsOf(service);
        expect(internal.readLogFile("trilium-2024-01-15.log")).toBeNull();

        // With an open current file whose read throws → caught, returns null.
        const handle = makeSyncHandle();
        handle.read = () => { throw new Error("read fail"); };
        installOpfs({ createSyncAccessHandle: async () => handle });
        await internal.openLogFile("trilium-2024-05-01.log");
        expect(internal.readLogFile("trilium-2024-05-01.log")).toBeNull();
    });
});

describe("StandaloneLogService listing and deletion", () => {
    it("lists only well-formed log files with parsed dates", async () => {
        installOpfs({
            entries: async function* () {
                yield ["nested", { kind: "directory" }];
                yield ["trilium-2024-01-15.log", { kind: "file" }];
                yield ["not-a-log.txt", { kind: "file" }];
            }
        });
        const internal = internalsOf(new StandaloneLogService());
        await internal.ensureLogDirectory();
        const files = await internal.listLogFiles();
        expect(files).toHaveLength(1);
        expect(files[0].name).toBe("trilium-2024-01-15.log");
        expect(files[0].mtime.getFullYear()).toBe(2024);
    });

    it("returns an empty list when there is no directory", async () => {
        expect(await internalsOf(new StandaloneLogService()).listLogFiles()).toEqual([]);
    });

    it("deletes other files, skips the current file, and ignores removal errors", async () => {
        const removeEntry = vi.fn(async () => {});
        installOpfs({ createSyncAccessHandle: async () => makeSyncHandle(), removeEntry });
        const internal = internalsOf(new StandaloneLogService());

        // No directory yet → early return.
        await internal.deleteLogFile("trilium-2024-01-01.log");
        expect(removeEntry).not.toHaveBeenCalled();

        await internal.ensureLogDirectory();
        await internal.openLogFile("trilium-2024-06-01.log");

        // Skips the current file.
        await internal.deleteLogFile("trilium-2024-06-01.log");
        expect(removeEntry).not.toHaveBeenCalled();

        // Deletes a different file.
        await internal.deleteLogFile("trilium-2024-05-01.log");
        expect(removeEntry).toHaveBeenCalledWith("trilium-2024-05-01.log");
    });

    it("swallows errors thrown by removeEntry", async () => {
        installOpfs({
            createSyncAccessHandle: async () => makeSyncHandle(),
            removeEntry: async () => { throw new Error("locked"); }
        });
        const internal = internalsOf(new StandaloneLogService());
        await internal.ensureLogDirectory();
        await expect(internal.deleteLogFile("trilium-2024-05-01.log")).resolves.toBeUndefined();
    });
});

describe("StandaloneLogService without OPFS", () => {
    it("falls back to console-only logging instead of throwing", async () => {
        Object.defineProperty(navigator, "storage", { value: undefined, configurable: true });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        const internal = internalsOf(new StandaloneLogService());

        // ensureLogDirectory tolerates the missing API...
        await expect(internal.ensureLogDirectory()).resolves.toBeUndefined();
        expect(internal.logDir).toBeNull();
        expect(warn).toHaveBeenCalledWith(
            "[LogService] OPFS unavailable, using console-only logging:",
            expect.anything()
        );

        // ...openLogFile stays in console-only mode...
        await expect(internal.openLogFile("trilium-2024-01-15.log")).resolves.toBeUndefined();
        expect(internal.currentFile).toBeNull();

        // ...and entries land on the console.
        internal.writeEntry("hello");
        expect(log).toHaveBeenCalledWith("hello");
    });
});
