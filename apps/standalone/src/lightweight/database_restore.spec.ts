import type { SAHPoolUtil } from "@sqlite.org/sqlite-wasm";
import { writeBackupContainer } from "@triliumnext/backup-container";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    DEFAULT_DATABASE_NAME,
    eraseDatabase,
    readCurrentDatabaseName,
    readInSlices,
    restoreDatabase,
    type RestoreProgress,
    type RestoreTarget
} from "./database_restore.js";

/** The name a restore writes to while the default one is live: the two alternate. */
const CANDIDATE_NAME = "/trilium.alt.db";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-standalone-restore-"));

/**
 * Bytes that start the way SQLite does, page size and all: the reader checks the header of what it
 * unwraps, and the service checks the header of what it is given.
 */
function databaseBytes(size = 8192): Uint8Array {
    const bytes = new Uint8Array(size);
    bytes.set(Uint8Array.from("SQLite format 3\0", (c) => c.charCodeAt(0)));
    // Page size, big-endian: 4096.
    bytes[16] = 0x10;
    bytes[17] = 0x00;
    bytes.fill(0x42, 100);

    return bytes;
}

/** Wraps `payload` the way a backup does, using the writer the backup service itself uses. */
async function containerOf(payload: Uint8Array, options: { passphrase?: string; compress?: boolean } = {}) {
    const filePath = path.join(tempRoot, `backup-${Math.random().toString(36).slice(2)}.tnbackup`);
    fs.writeFileSync(filePath, "");

    await writeBackupContainer(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a Node stream over the bytes.
        (await import("stream")).Readable.from([ Buffer.from(payload) ]) as any,
        fs.createWriteStream(filePath),
        {
            compress: options.compress ?? false,
            passphrase: options.passphrase,
            // The production cost takes seconds through pure-JS scrypt under coverage
            // instrumentation, which is a test timeout and then a stray swap polluting the next
            // test. The reader derives with whatever the header records, so a cheap cost changes
            // nothing about what is being tested.
            scrypt: { log2N: 10, r: 8, p: 1 },
            plaintextSize: payload.length,
            patchHeader: async (offset, data) => {
                const handle = await fsp.open(filePath, "r+");
                try {
                    await handle.write(data, 0, data.length, offset);
                } finally {
                    await handle.close();
                }
            }
        }
    );

    return new Blob([ fs.readFileSync(filePath) ]);
}

/**
 * The same, written front to back the way the standalone download writes one: no digest patched in
 * afterwards, and the plaintext size recorded, which is what makes its total length predictable.
 */
async function streamedContainerOf(
    payload: Uint8Array,
    options: { passphrase?: string; compress?: boolean } = {}
) {
    const filePath = path.join(tempRoot, `streamed-${Math.random().toString(36).slice(2)}.tnbackup`);

    await writeBackupContainer(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a Node stream over the bytes.
        (await import("stream")).Readable.from([ Buffer.from(payload) ]) as any,
        fs.createWriteStream(filePath),
        {
            streamed: true,
            compress: options.compress ?? false,
            passphrase: options.passphrase,
            scrypt: { log2N: 10, r: 8, p: 1 },
            plaintextSize: payload.length
        }
    );

    return new Blob([ fs.readFileSync(filePath) ]);
}

/** A pool that keeps its databases in memory and answers the checks however the test says. */
function fakePool() {
    const files = new Map<string, Uint8Array>();
    /** Every statement the checks put to the candidate, so a test can say what was not asked. */
    const asked: string[] = [];
    const answers = {
        integrity: "ok",
        tables: [ "options", "notes", "branches", "blobs" ],
        options: { initialized: "true", dbVersion: "240" } as Record<string, string | undefined>
    };

    class FakeDb {
        constructor(readonly name: string) {
            if (!files.has(name)) {
                throw new Error(`no such database: ${name}`);
            }
        }
        selectValue(sql: string, params?: unknown[]) {
            asked.push(sql);
            if (sql.includes("quick_check")) return answers.integrity;
            return answers.options[String((params ?? [])[0])];
        }
        selectValues(sql: string) {
            asked.push(sql);
            return answers.tables;
        }
        close() { /* nothing to release */ }
    }

    /**
     * Whether the browser has taken the pool's access handles away, and what it took to get them
     * back. A pool never notices the taking, which is the whole difficulty: only pausing clears its
     * belief that it still holds them.
     */
    const handles = { closed: false, paused: 0, unpaused: 0 };

    const pool = {
        OpfsSAHPoolDb: FakeDb,
        getCapacity: () => 6,
        getFileCount: () => files.size,
        addCapacity: async () => 1,
        unlink: (name: string) => files.delete(name),
        pauseVfs() {
            handles.paused++;

            return pool;
        },
        async unpauseVfs() {
            handles.unpaused++;
            handles.closed = false;

            return pool;
        },
        importDb: async (name: string, pull: () => Promise<Uint8Array | undefined>) => {
            const chunks: Uint8Array[] = [];
            for (let chunk = await pull(); chunk; chunk = await pull()) {
                chunks.push(chunk);
            }
            files.set(name, concat(chunks));

            return files.get(name)?.length ?? 0;
        }
    };

    return { asked, files, answers, handles, pool: pool as unknown as SAHPoolUtil };
}

/** What WebKit throws once it has closed a sync access handle underneath the pool holding it. */
function closedAccessHandle(): DOMException {
    return new DOMException("AccessHandle is closed", "InvalidStateError");
}

function concat(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
        joined.set(chunk, at);
        at += chunk.length;
    }

    return joined;
}

/** The database the restore acts on, recording what it was asked to do and in what order. */
function fakeTarget(pool: SAHPoolUtil, options: {
    failToOpen?: string;
    /** Run before each open; throwing from it is how a test makes that open fail its own way. */
    beforeOpen?: (dbName: string) => void;
} = {}) {
    const acted: string[] = [];
    const target: RestoreTarget = {
        pool,
        close: () => { acted.push("close"); },
        open: (dbName) => {
            try {
                options.beforeOpen?.(dbName);
            } catch (e) {
                acted.push(`open-failed:${dbName}`);
                throw e;
            }

            if (dbName === options.failToOpen) {
                acted.push(`open-failed:${dbName}`);
                throw new Error("database is locked");
            }
            acted.push(`open:${dbName}`);
        }
    };

    return { target, acted };
}

/** Stands in for the origin's private filesystem, which is where the pointer lives. */
let pointer: string | undefined;
/** Set by a test to make writing the pointer fail, which is the one write nothing else can repair. */
let refusePointer: ((name: string) => boolean) | undefined;

beforeEach(() => {
    pointer = undefined;
    refusePointer = undefined;
    vi.stubGlobal("navigator", {
        storage: {
            getDirectory: async () => ({
                getFileHandle: async (_name: string, opts?: { create?: boolean }) => {
                    if (pointer === undefined && !opts?.create) {
                        throw new Error("NotFoundError");
                    }

                    return {
                        getFile: async () => ({ text: async () => pointer ?? "" }),
                        createWritable: async () => ({
                            write: async (text: string) => {
                                if (refusePointer?.(text)) {
                                    throw new Error("the pointer could not be written");
                                }
                                pointer = text;
                            },
                            close: async () => {}
                        })
                    };
                }
            })
        }
    });
});

afterEach(() => vi.unstubAllGlobals());

describe("which database is the live one", () => {
    it("is the original name until a restore says otherwise", async () => {
        await expect(readCurrentDatabaseName()).resolves.toBe(DEFAULT_DATABASE_NAME);
    });

    it("is whatever the last restore wrote down", async () => {
        const { pool } = fakePool();
        const { target } = fakeTarget(pool);

        await restoreDatabase(target, new Blob([ databaseBytes() ]));

        await expect(readCurrentDatabaseName()).resolves.toBe(CANDIDATE_NAME);
    });

    it("alternates between the two names, so a restore never prepares over the live database", async () => {
        const { files, pool } = fakePool();
        const { target } = fakeTarget(pool);
        const second = databaseBytes(12288);

        await restoreDatabase(target, new Blob([ databaseBytes() ]));
        await restoreDatabase(target, new Blob([ second ]));

        await expect(readCurrentDatabaseName()).resolves.toBe(DEFAULT_DATABASE_NAME);
        // Only ever the one database: the name it went back to holds the newer backup, and the one
        // it came from was dropped once the swap was through.
        expect([ ...files.keys() ]).toEqual([ DEFAULT_DATABASE_NAME ]);
        expect(files.get(DEFAULT_DATABASE_NAME)).toEqual(second);
    });
});

describe("restoring from a picked backup", () => {
    it("streams a plain database into the pool and makes it live", async () => {
        const { files, pool } = fakePool();
        const { target, acted } = fakeTarget(pool);
        const original = databaseBytes();

        await restoreDatabase(target, new Blob([ original ]));

        expect(files.get(CANDIDATE_NAME)).toEqual(original);
        // Closed, then written down, then opened: the pointer is what makes the swap, and nothing
        // opens until it has been made.
        expect(acted).toEqual([ "close", `open:${CANDIDATE_NAME}` ]);
        expect(pointer).toBe(CANDIDATE_NAME);
    });

    it("reads the file in slices rather than as one read for the whole of it", async () => {
        const { files, pool } = fakePool();
        const { target } = fakeTarget(pool);
        const original = databaseBytes();
        const backup = new Blob([ original ]);
        const sliced = vi.spyOn(backup, "slice");
        const streamed = vi.spyOn(backup, "stream");

        await restoreDatabase(target, backup);

        expect(files.get(CANDIDATE_NAME)).toEqual(original);
        // One read living for the whole file is what a low-memory WebView was seen ending early,
        // with nothing to say it had; bounded reads are what the chunked upload has always used.
        expect(streamed).not.toHaveBeenCalled();
        expect(sliced.mock.calls.length).toBeGreaterThan(1);
    });

    it("unwraps a container back into the database it was made from", async () => {
        const { files, pool } = fakePool();
        const { target } = fakeTarget(pool);
        const original = databaseBytes();

        await restoreDatabase(target, await containerOf(original, { compress: true }));

        expect(files.get(CANDIDATE_NAME)).toEqual(original);
    });

    it("unwraps an encrypted one when it is given the passphrase", async () => {
        const { files, pool } = fakePool();
        const { target } = fakeTarget(pool);
        const original = databaseBytes();
        const backup = await containerOf(original, { passphrase: "hunter2" });

        await restoreDatabase(target, backup, { passphrase: "hunter2" });

        expect(files.get(CANDIDATE_NAME)).toEqual(original);
    });

    it("checks the database without reading all of it", async () => {
        const { asked, pool } = fakePool();
        const { target } = fakeTarget(pool);

        await restoreDatabase(target, new Blob([ databaseBytes() ]));

        // The one check whose cost grows with the database is left out here, where every page would
        // come back through the pool into a WebAssembly engine.
        expect(asked.some((sql) => sql.includes("quick_check"))).toBe(false);
        // The rest is still asked: the schema and the version are what accept a database.
        expect(asked.some((sql) => sql.includes("sqlite_master"))).toBe(true);
        expect(asked.some((sql) => sql.includes("options"))).toBe(true);
    });

    it("says what it is doing as it goes", async () => {
        const { pool } = fakePool();
        const { target } = fakeTarget(pool);
        const seen: RestoreProgress[] = [];

        await restoreDatabase(target, new Blob([ databaseBytes() ]), { report: (p) => seen.push(p) });

        expect(seen.map((p) => p.stage)).toEqual(
            expect.arrayContaining([ "staging", "validating", "swapping", "done" ])
        );
    });
});

describe("reading a file in slices", () => {
    /** Drains a stream the way the readers here do, a chunk at a time. */
    async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        for (let next = await reader.read(); !next.done; next = await reader.read()) {
            chunks.push(next.value);
        }

        return concat(chunks);
    }

    it("hands back exactly the file, whatever the slices fall across", async () => {
        const bytes = Uint8Array.from({ length: 1000 }, (_, at) => at % 251);

        // A size that divides the file evenly, one that leaves a remainder, and one larger than
        // the file: the boundaries are the only thing this has to get right.
        for (const sliceSize of [ 100, 128, 4096 ]) {
            await expect(collect(readInSlices(new Blob([ bytes ]), sliceSize))).resolves.toEqual(bytes);
        }
    });

    it("refuses to end quietly where the file gives less than it claims", async () => {
        const real = Uint8Array.from({ length: 256 }, (_, at) => at);
        const backup = {
            size: 1024,
            slice: (start: number, end: number) =>
                new Blob([ real.slice(start, Math.min(end, real.length)) ])
        } as unknown as Blob;

        await expect(collect(readInSlices(backup, 64))).rejects.toMatchObject({
            reason: "backup-incomplete",
            message: expect.stringContaining("256")
        });
    });
});

describe("a backup that cannot be restored", () => {
    it("asks for a passphrase before reading an encrypted container, and imports nothing", async () => {
        const { files, pool } = fakePool();
        const { target, acted } = fakeTarget(pool);

        await expect(restoreDatabase(target, await containerOf(databaseBytes(), { passphrase: "hunter2" })))
            .rejects.toMatchObject({ reason: "passphrase-required" });

        expect(files.size).toBe(0);
        expect(acted).toEqual([]);
        expect(pointer).toBeUndefined();
    });

    it("says a file that ends early is incomplete, in the bytes it had and the bytes it needed", async () => {
        const { pool } = fakePool();
        const { target } = fakeTarget(pool);
        const real = databaseBytes();
        // A file whose size claims more than it can give, which is the shape the Android WebView
        // presented: the read stops and the reader can only take that at its word.
        const backup = {
            size: real.length * 4,
            slice: (start: number, end: number) =>
                new Blob([ real.slice(start, Math.min(end, real.length)) ])
        } as unknown as Blob;

        await expect(restoreDatabase(target, backup)).rejects.toMatchObject({
            reason: "backup-incomplete",
            message: expect.stringContaining(String(real.length))
        });
    });

    it("does not measure a streamed container that is compressed, since its length is not stated", async () => {
        const { files, pool } = fakePool();
        const { target } = fakeTarget(pool);
        const original = databaseBytes();
        // Compresses to far less than the plaintext size the header records, so measuring the file
        // against that size would condemn a complete backup.
        const whole = await streamedContainerOf(original, { compress: true });
        expect(whole.size).toBeLessThan(original.length);

        await restoreDatabase(target, whole);

        expect(files.get(CANDIDATE_NAME)).toEqual(original);
    });

    it("refuses a streamed container the file is too small to hold, without reading it", async () => {
        const { pool, files } = fakePool();
        const { target } = fakeTarget(pool);
        const whole = await streamedContainerOf(databaseBytes());

        await expect(restoreDatabase(target, whole.slice(0, whole.size - 64)))
            .rejects.toMatchObject({ reason: "backup-incomplete" });

        // Settled from the header alone: a container states the size it should be, so an
        // incomplete one costs a second rather than however long its payload would have taken.
        expect(files.size).toBe(0);
    });

    it("refuses a file that is neither a database nor a backup", async () => {
        const { pool } = fakePool();
        const { target } = fakeTarget(pool);

        await expect(restoreDatabase(target, new Blob([ "a holiday photograph" ])))
            .rejects.toMatchObject({ reason: "not-a-database" });

        expect(pointer).toBeUndefined();
    });

    it("carries the checks' verdict back, and drops the candidate it had imported", async () => {
        const { files, answers, pool } = fakePool();
        const { target, acted } = fakeTarget(pool);
        answers.options.dbVersion = "99999";

        await expect(restoreDatabase(target, new Blob([ databaseBytes() ])))
            .rejects.toMatchObject({ reason: "database-too-new" });

        expect(files.has(CANDIDATE_NAME)).toBe(false);
        // Never swapped: the live database is untouched and still the one to open.
        expect(acted).toEqual([]);
        expect(pointer).toBeUndefined();
    });

    it("puts the previous database back when the restored one will not open", async () => {
        const { pool, handles } = fakePool();
        const { target, acted } = fakeTarget(pool, { failToOpen: CANDIDATE_NAME });

        await expect(restoreDatabase(target, new Blob([ databaseBytes() ])))
            .rejects.toMatchObject({ reason: "swap-failed" });

        expect(acted).toEqual([ "close", `open-failed:${CANDIDATE_NAME}`, `open:${DEFAULT_DATABASE_NAME}` ]);
        expect(pointer).toBe(DEFAULT_DATABASE_NAME);
        // Tried once and not retried: the handles were never the problem, and an open refused for
        // any other reason is refused just the same the second time.
        expect(handles.paused).toBe(0);
    });

    it("takes the handles back mid-import and starts the import over", async () => {
        const { pool, files, handles } = fakePool();
        const { target, acted } = fakeTarget(pool);
        const original = databaseBytes();
        // Closed while the backup was being read, which is the suspension this cannot otherwise
        // survive: the database being replaced is still open, so the pool cannot even be paused
        // until it is let go of.
        let imports = 0;
        const importDb = pool.importDb.bind(pool);
        pool.importDb = async (name, pull) => {
            if (imports++ === 0) {
                handles.closed = true;
                throw closedAccessHandle();
            }

            return importDb(name, pull);
        };

        await restoreDatabase(target, new Blob([ original ]));

        expect(files.get(CANDIDATE_NAME)).toEqual(original);
        expect(imports).toBe(2);
        // Let go of, taken back, put straight back: the screen behind the restore still reads from
        // the database that has not been replaced yet.
        expect(acted.slice(0, 2)).toEqual([ "close", `open:${DEFAULT_DATABASE_NAME}` ]);
        expect(handles).toMatchObject({ paused: 1, unpaused: 1 });
        expect(pointer).toBe(CANDIDATE_NAME);
    });

    it("takes the handles back mid-check rather than calling the backup damaged", async () => {
        const { pool, handles } = fakePool();
        const { target } = fakeTarget(pool);
        const answered = { times: 0 };
        const tables = pool.OpfsSAHPoolDb.prototype.selectValues;
        pool.OpfsSAHPoolDb.prototype.selectValues = function (sql: string) {
            if (answered.times++ === 0) {
                handles.closed = true;
                // Worded differently on purpose, and reported wrapped in the checks' own failure:
                // what marks it out has to be the kind of error it is, not the sentence a given
                // browser version happens to use.
                throw new DOMException("The file handle was invalidated", "InvalidStateError");
            }

            return tables.call(this, sql);
        };

        await restoreDatabase(target, new Blob([ databaseBytes() ]));

        expect(handles).toMatchObject({ paused: 1, unpaused: 1 });
        expect(pointer).toBe(CANDIDATE_NAME);
    });

    it("says the check could not be carried out, rather than calling the backup damaged", async () => {
        const { pool, files } = fakePool();
        const { target } = fakeTarget(pool);
        pool.OpfsSAHPoolDb.prototype.selectValues = () => {
            throw new Error("out of memory");
        };

        // The checks call a database damaged by looking at it. Where the looking is what failed,
        // there is nothing to conclude about the file, and concluding anyway is how someone deletes
        // the only copy of their notes.
        await expect(restoreDatabase(target, new Blob([ databaseBytes() ])))
            .rejects.toMatchObject({ reason: "check-failed", message: expect.stringContaining("out of memory") });

        // Still cleaned up after, and the live database is untouched.
        expect(files.has(CANDIDATE_NAME)).toBe(false);
        expect(pointer).toBeUndefined();
    });

    it("reports what stopped an import that no recovery could help", async () => {
        const { pool, handles } = fakePool();
        const { target } = fakeTarget(pool);
        pool.importDb = async () => {
            throw new Error("the pool is full");
        };

        // Never reached the swap, so it must not say the database was replaced and put back.
        await expect(restoreDatabase(target, new Blob([ databaseBytes() ])))
            .rejects.toMatchObject({
                reason: "restore-failed",
                message: expect.stringContaining("the pool is full")
            });

        // Nothing to take back, so nothing was let go of either.
        expect(handles.paused).toBe(0);
        expect(pointer).toBeUndefined();
    });

    it("keeps the restored database when the pointer cannot be put back on the old one", async () => {
        const { pool, files } = fakePool();
        const { target } = fakeTarget(pool, { failToOpen: CANDIDATE_NAME });
        // The swap fails, and so does putting the pointer back, which leaves it naming the
        // candidate: the one state where that entry is not a leftover but the database itself.
        refusePointer = (name) => name === DEFAULT_DATABASE_NAME;

        await expect(restoreDatabase(target, new Blob([ databaseBytes() ])))
            .rejects.toMatchObject({ reason: "swap-failed-reload" });

        // Kept, because a start would open it and removing it would leave nothing to open at all.
        // It has passed its checks by this point, so opening it is safe.
        expect(files.has(CANDIDATE_NAME)).toBe(true);
        expect(pointer).toBe(CANDIDATE_NAME);
    });

    it("takes the pool's access handles back where the browser has closed them, and opens", async () => {
        const { pool, handles } = fakePool();
        // Closed while the restore was working, which is what a file picker, a screen lock or a
        // switch to another application does on iOS. The pool is never told, so the open is what
        // finds out.
        const { target, acted } = fakeTarget(pool, {
            beforeOpen: () => {
                if (handles.closed) {
                    throw closedAccessHandle();
                }
            }
        });
        handles.closed = true;

        await restoreDatabase(target, new Blob([ databaseBytes() ]));

        expect(acted).toEqual([ "close", `open-failed:${CANDIDATE_NAME}`, `open:${CANDIDATE_NAME}` ]);
        // Paused before unpausing: a pool whose handles were taken still believes it holds them, so
        // unpausing on its own would return having done nothing at all.
        expect(handles).toMatchObject({ paused: 1, unpaused: 1 });
        expect(pointer).toBe(CANDIDATE_NAME);
    });

    it("reports what stopped the swap, not what stopped the rollback, and asks for a reload", async () => {
        const { pool } = fakePool();
        // The candidate will not open, and the previous one cannot be reopened either. Both halves
        // failing is what used to leave the browser's own error standing in place of ours, over a
        // sentence promising the previous database was back.
        const { target } = fakeTarget(pool, {
            failToOpen: CANDIDATE_NAME,
            beforeOpen: (dbName) => {
                if (dbName === DEFAULT_DATABASE_NAME) {
                    throw closedAccessHandle();
                }
            }
        });

        await expect(restoreDatabase(target, new Blob([ databaseBytes() ])))
            .rejects.toMatchObject({ reason: "swap-failed-reload", message: "database is locked" });

        // The pointer is the whole of what a start reads, so the notes that were here are still the
        // ones it opens; this instance just cannot get to them without one.
        expect(pointer).toBe(DEFAULT_DATABASE_NAME);
    });
});

/**
 * Erasing is the same close/exchange/open dance as a restore, and the same thing can go wrong in the
 * middle of it: the pointer that outlives this worker and the entry the worker is actually holding
 * can end up naming different databases. A start reads only the pointer, so everything written into
 * the other one after that is simply never seen again.
 */
describe("erasing the live database", () => {
    it("moves the pointer, unlinks what was live, and opens an empty one in its place", async () => {
        const { files, pool } = fakePool();
        files.set(DEFAULT_DATABASE_NAME, databaseBytes());
        const { target, acted } = fakeTarget(pool);

        await eraseDatabase(target);

        expect(files.has(DEFAULT_DATABASE_NAME)).toBe(false);
        expect(pointer).toBe(DEFAULT_DATABASE_NAME);
        expect(acted).toEqual([ "close", `open:${DEFAULT_DATABASE_NAME}` ]);
    });

    it("comes back on the entry the pointer names, having been live on the other one", async () => {
        // Which is where an instance sits after a restore: the two names alternate, so the live
        // entry is the candidate rather than the default.
        const { files, pool } = fakePool();
        files.set(CANDIDATE_NAME, databaseBytes());
        pointer = CANDIDATE_NAME;
        const { target, acted } = fakeTarget(pool);

        await eraseDatabase(target);

        expect(files.has(CANDIDATE_NAME)).toBe(false);
        expect(pointer).toBe(DEFAULT_DATABASE_NAME);
        expect(acted).toEqual([ "close", `open:${DEFAULT_DATABASE_NAME}` ]);
    });

    it("erases nothing and reopens what was live when the pointer will not move", async () => {
        // The pointer is moved first for exactly this: a write that fails has destroyed nothing, and
        // reopening the entry it still names leaves the two halves agreeing.
        const { files, pool } = fakePool();
        files.set(CANDIDATE_NAME, databaseBytes());
        pointer = CANDIDATE_NAME;
        refusePointer = () => true;
        const { target, acted } = fakeTarget(pool);

        await expect(eraseDatabase(target)).rejects.toThrow(/pointer could not be written/);

        expect(files.has(CANDIDATE_NAME)).toBe(true);
        expect(pointer).toBe(CANDIDATE_NAME);
        expect(acted).toEqual([ "close", `open:${CANDIDATE_NAME}` ]);
    });

    it("still comes back on the entry the pointer names when the old one will not unlink", async () => {
        // The old entry is left behind taking up room, which is a leak and not a trap: nothing reads
        // it again, and the worker and the next start agree on what is live.
        const { files, pool } = fakePool();
        files.set(CANDIDATE_NAME, databaseBytes());
        pointer = CANDIDATE_NAME;
        pool.unlink = () => { throw new Error("the entry is in use"); };
        const { target, acted } = fakeTarget(pool);

        await eraseDatabase(target);

        expect(pointer).toBe(DEFAULT_DATABASE_NAME);
        expect(acted).toEqual([ "close", `open:${DEFAULT_DATABASE_NAME}` ]);
    });

    it("always tries to open something, so the worker is never left holding nothing", async () => {
        // A detached service answers every request with "DB not open" for as long as the worker
        // lives, and the wizard needs one to report what went wrong and offer another path.
        const { files, pool } = fakePool();
        files.set(DEFAULT_DATABASE_NAME, databaseBytes());
        const { target, acted } = fakeTarget(pool, { failToOpen: DEFAULT_DATABASE_NAME });

        await expect(eraseDatabase(target)).rejects.toThrow(/database is locked/);

        expect(acted).toEqual([ "close", `open-failed:${DEFAULT_DATABASE_NAME}` ]);
    });
});
