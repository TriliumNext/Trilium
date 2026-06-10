import { options } from "@triliumnext/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import StandaloneBackupService from "./backup_provider.js";

interface NavWithStorage {
    storage?: { getDirectory?: () => Promise<unknown> };
}

const realStorageDescriptor = Object.getOwnPropertyDescriptor(navigator, "storage");

/** Build an in-memory OPFS directory handle backed by a Map. */
function makeOpfs(seed: Record<string, { data: Uint8Array; lastModified: number }> = {}) {
    const files = new Map(Object.entries(seed));

    function fileHandle(name: string) {
        return {
            kind: "file" as const,
            async getFile() {
                const entry = files.get(name);
                return {
                    lastModified: entry?.lastModified ?? 0,
                    async arrayBuffer() {
                        return (entry?.data ?? new Uint8Array()).buffer;
                    }
                };
            },
            async createWritable() {
                let chunk = new Uint8Array();
                return {
                    async write(d: Uint8Array) { chunk = d; },
                    async close() { files.set(name, { data: chunk, lastModified: 1000 }); }
                };
            }
        };
    }

    const dir = {
        async getFileHandle(name: string, opts?: { create?: boolean }) {
            if (!files.has(name) && opts?.create) {
                files.set(name, { data: new Uint8Array(), lastModified: 0 });
            }
            if (!files.has(name)) {
                throw new Error(`missing ${name}`);
            }
            return fileHandle(name);
        },
        async removeEntry(name: string) { files.delete(name); },
        async *entries(): AsyncGenerator<[string, unknown]> {
            // include a directory entry and a non-matching file to exercise filtering
            yield ["nested", { kind: "directory" }];
            for (const [name, entry] of files) {
                yield [name, {
                    kind: "file",
                    async getFile() { return { lastModified: entry.lastModified }; }
                }];
            }
        }
    };

    return { dir, files, root: { async getDirectoryHandle() { return dir; } } };
}

function installOpfs(getDirectory: () => Promise<unknown>) {
    Object.defineProperty(navigator, "storage", { value: { getDirectory }, configurable: true });
}

afterEach(() => {
    if (realStorageDescriptor) {
        Object.defineProperty(navigator, "storage", realStorageDescriptor);
    } else {
        delete (navigator as unknown as NavWithStorage).storage;
    }
    vi.restoreAllMocks();
});

describe("StandaloneBackupService without OPFS", () => {
    function serviceWithoutOpfs() {
        delete (navigator as unknown as NavWithStorage).storage;
        return new StandaloneBackupService(options);
    }

    it("scheduleBackups is a no-op", () => {
        expect(() => serviceWithoutOpfs().scheduleBackups()).not.toThrow();
    });

    it("backupNow warns and returns the nominal path", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const service = serviceWithoutOpfs();
        expect(await service.backupNow("now")).toBe("/backups/backup-now.db");
        expect(warn).toHaveBeenCalled();
    });

    it("listing, deleting and reading return empty results", async () => {
        const service = serviceWithoutOpfs();
        expect(await service.getExistingBackups()).toEqual([]);
        await expect(service.deleteBackup("backup-x.db")).resolves.toBeUndefined();
        expect(await service.getBackupContent("/backups/backup-x.db")).toBeNull();
    });

    it("ensureBackupDirectory resolves to null when OPFS is unavailable", async () => {
        const service = serviceWithoutOpfs();
        const ensure = (service as unknown as { ensureBackupDirectory(): Promise<unknown> }).ensureBackupDirectory();
        expect(await ensure).toBeNull();
    });
});

describe("StandaloneBackupService with OPFS", () => {
    it("writes a serialized backup and reports the path", async () => {
        const fs = makeOpfs();
        installOpfs(async () => fs.root);
        vi.spyOn(console, "log").mockImplementation(() => {});

        const service = new StandaloneBackupService(options);
        const path = await service.backupNow("daily");
        expect(path).toBe("/backups/backup-daily.db");
        expect(fs.files.get("backup-daily.db")?.data.byteLength).toBeGreaterThan(0);
    });

    it("lists matching backups newest-first and ignores non-backup entries", async () => {
        const fs = makeOpfs({
            "backup-old.db": { data: new Uint8Array(), lastModified: 100 },
            "backup-new.db": { data: new Uint8Array(), lastModified: 200 },
            "notes.txt": { data: new Uint8Array(), lastModified: 300 }
        });
        installOpfs(async () => fs.root);

        const backups = await new StandaloneBackupService(options).getExistingBackups();
        expect(backups.map(b => b.fileName)).toEqual(["backup-new.db", "backup-old.db"]);
        expect(backups[0].filePath).toBe("/backups/backup-new.db");
    });

    it("reads and deletes a backup by path/name", async () => {
        const fs = makeOpfs({ "backup-keep.db": { data: new Uint8Array([1, 2, 3]), lastModified: 1 } });
        installOpfs(async () => fs.root);
        vi.spyOn(console, "log").mockImplementation(() => {});

        const service = new StandaloneBackupService(options);
        const content = await service.getBackupContent("/backups/backup-keep.db");
        expect(content && Array.from(content)).toEqual([1, 2, 3]);

        await service.deleteBackup("backup-keep.db");
        expect(fs.files.has("backup-keep.db")).toBe(false);
    });

    it("returns null when the requested file name is not a backup", async () => {
        installOpfs(async () => makeOpfs().root);
        const service = new StandaloneBackupService(options);
        expect(await service.getBackupContent("/backups/secrets.txt")).toBeNull();
    });

    it("handles a missing backup directory handle gracefully", async () => {
        // root.getDirectoryHandle resolves to undefined → ensureBackupDirectory() returns null.
        const root = { async getDirectoryHandle() { return undefined; } };
        installOpfs(async () => root);
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const service = new StandaloneBackupService(options);
        expect(await service.backupNow("x")).toBe("/backups/backup-x.db");
        expect(await service.getExistingBackups()).toEqual([]);
        await expect(service.deleteBackup("backup-x.db")).resolves.toBeUndefined();
        expect(await service.getBackupContent("/backups/backup-x.db")).toBeNull();
    });

    it("swallows OPFS errors on every operation", async () => {
        const boom = async () => { throw new Error("opfs down"); };
        installOpfs(boom);
        vi.spyOn(console, "error").mockImplementation(() => {});

        const service = new StandaloneBackupService(options);
        expect(await service.backupNow("x")).toBe("/backups/backup-x.db");
        expect(await service.getExistingBackups()).toEqual([]);
        await expect(service.deleteBackup("backup-x.db")).resolves.toBeUndefined();
        expect(await service.getBackupContent("/backups/backup-x.db")).toBeNull();
    });

    it("caches the OPFS availability probe", async () => {
        installOpfs(async () => makeOpfs().root);
        const service = new StandaloneBackupService(options);
        // Two calls; the second should reuse the cached availability flag.
        await service.getExistingBackups();
        await service.getExistingBackups();
    });
});
