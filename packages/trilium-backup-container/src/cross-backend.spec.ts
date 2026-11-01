import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { webBackend } from "./backend-web.js";
import { FRAME_SIZE, HEADER_BYTES_PLAIN, TRAILER_BYTES } from "./format.js";
import {
    failureOfWeb,
    fakeDatabase,
    FAST_SCRYPT,
    flipByte,
    readFromBuffer,
    readFromBufferWeb,
    reasonOf,
    webSource,
    type WriteOptions,
    writeToBuffer,
    writeToBufferWeb
} from "./test-helpers.js";
import { readBackupContainer as readBackupContainerWeb } from "./web-streams.js";

const PASSPHRASE = "correct horse battery staple";

/** Every format combination, since the backends must agree on all of them. */
const FORMATS: [string, WriteOptions][] = [
    [ "plain", {} ],
    [ "compressed", { compress: true } ],
    [ "encrypted", { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT } ],
    [ "compressed and encrypted", { compress: true, passphrase: PASSPHRASE, scrypt: FAST_SCRYPT } ]
];

describe("cross-backend round trips", () => {
    it.each(FORMATS)("what Node writes, the web reads: %s", async (_label, options) => {
        const database = fakeDatabase(64 * 1024);
        const written = await writeToBuffer(database, {
            ...options,
            plaintextSize: database.length
        });

        const read = await readFromBufferWeb(written.bytes, { passphrase: PASSPHRASE });
        expect(read.bytes.equals(database)).toBe(true);
        expect(read.result).toMatchObject({
            compressed: options.compress === true,
            encrypted: options.passphrase !== undefined,
            bytesWritten: database.length
        });
    });

    it.each(FORMATS)("what the web writes, Node reads: %s", async (_label, options) => {
        const database = fakeDatabase(64 * 1024);
        const written = await writeToBufferWeb(database, {
            ...options,
            plaintextSize: database.length
        });

        const read = await readFromBuffer(written.bytes, { passphrase: PASSPHRASE });
        expect(read.bytes.equals(database)).toBe(true);
        expect(read.result.bytesWritten).toBe(database.length);
    });

    it.each(FORMATS)("what the web writes, the web reads: %s", async (_label, options) => {
        const database = fakeDatabase(64 * 1024);
        const written = await writeToBufferWeb(database, {
            ...options,
            plaintextSize: database.length
        });

        const read = await readFromBufferWeb(written.bytes, { passphrase: PASSPHRASE });
        expect(read.bytes.equals(database)).toBe(true);
    });

    it("writes byte-identical plain containers on both backends", async () => {
        const database = fakeDatabase(9_000);
        // Stated rather than taken from the clock, which is the one field two writes are entitled
        // to disagree on: a millisecond between them would fail this for the wrong reason.
        const shared = { plaintextSize: database.length, timestamp: Date.UTC(2026, 0, 2, 3, 4, 5) };

        const node = await writeToBuffer(database, shared);
        const web = await writeToBufferWeb(database, shared);

        expect(web.bytes.equals(node.bytes)).toBe(true);
    });

    it("survives web input arriving in awkward chunks", async () => {
        const database = fakeDatabase(9_000);
        const written = await writeToBufferWeb(webSource(database, 7), {
            compress: true,
            passphrase: PASSPHRASE,
            scrypt: FAST_SCRYPT
        });

        const read = await readFromBufferWeb(written.bytes, { passphrase: PASSPHRASE });
        expect(read.bytes.equals(database)).toBe(true);
    });

    it("frames a multi-frame payload the same way", async () => {
        const database = fakeDatabase(2 * FRAME_SIZE + 1_000);
        const written = await writeToBufferWeb(database, {
            passphrase: PASSPHRASE,
            scrypt: FAST_SCRYPT
        });

        const read = await readFromBuffer(written.bytes, { passphrase: PASSPHRASE });
        expect(read.bytes.equals(database)).toBe(true);
    });

    it("wraps an empty payload as a single empty final frame", async () => {
        const written = await writeToBufferWeb(
            Buffer.alloc(0),
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );

        const read = await readFromBufferWeb(
            written.bytes,
            { passphrase: PASSPHRASE, requireSqliteHeader: false }
        );
        expect(read.result.bytesWritten).toBe(0);
    });
});

describe("web gzip canonical form", () => {
    it("normalises MTIME and the OS byte whatever the platform compressor emits", async () => {
        const database = fakeDatabase(5_000);
        const written = await writeToBufferWeb(database, { compress: true });
        const payload = written.bytes.subarray(HEADER_BYTES_PLAIN, -TRAILER_BYTES);

        expect(payload.readUInt16BE(0)).toBe(0x1f8b);
        expect(payload.readUInt32LE(4)).toBe(0);           // MTIME, so no timestamp leaks
        expect(payload.readUInt8(9)).toBe(255);            // OS, so the platform does not leak
        expect(gunzipSync(payload).equals(database)).toBe(true);
    });
});

describe("web failure reasons", () => {
    const encrypted = () => writeToBuffer(
        fakeDatabase(2 * FRAME_SIZE),
        { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
    );

    it("rejects the wrong passphrase, and a missing one separately", async () => {
        const written = await encrypted();

        expect(await failureOfWeb(written.bytes, { passphrase: "wrong" }))
            .toBe("wrong-passphrase-or-damaged-header");
        expect(await failureOfWeb(written.bytes)).toBe("passphrase-required");
    });

    it("recovers with skipVerifier when only the verifier tag is damaged", async () => {
        const written = await encrypted();
        const damaged = flipByte(written.bytes, 73);   // inside the verifier tag, bytes 68 to 83

        const recovered = await readFromBufferWeb(
            damaged,
            { passphrase: PASSPHRASE, skipVerifier: true }
        );
        expect(recovered.bytes.equals(fakeDatabase(2 * FRAME_SIZE))).toBe(true);
    });

    it("rejects a flipped bit inside a frame", async () => {
        const written = await encrypted();
        const damaged = flipByte(written.bytes, 200);

        expect(await failureOfWeb(damaged, { passphrase: PASSPHRASE })).toBe("damaged-payload");
    });

    it("rejects trailing data and truncation", async () => {
        const written = await encrypted();

        const extended = Buffer.concat([ written.bytes, Buffer.from("extra") ]);
        expect(await failureOfWeb(extended, { passphrase: PASSPHRASE })).toBe("trailing-data");

        const cut = written.bytes.subarray(0, written.bytes.length - 10);
        expect(await failureOfWeb(cut, { passphrase: PASSPHRASE })).toBe("truncated");
    });

    it("reports a broken gzip stream as a damaged payload, not as a digest mismatch", async () => {
        const written = await writeToBuffer(fakeDatabase(50_000), { compress: true });

        // Corrupt the deflate data, then repair the digest so the failure can only come from the
        // decoder.
        const damaged = flipByte(written.bytes, HEADER_BYTES_PLAIN + 30);
        createHash("sha256").update(damaged.subarray(HEADER_BYTES_PLAIN, -TRAILER_BYTES)).digest()
            .copy(damaged, damaged.length - TRAILER_BYTES);

        expect(await failureOfWeb(damaged)).toBe("damaged-payload");
    });

    it("surfaces a digest mismatch through the decompressor untranslated", async () => {
        const written = await writeToBuffer(fakeDatabase(50_000), { compress: true });
        const damaged = flipByte(written.bytes, written.bytes.length - TRAILER_BYTES + 5);   // in the digest

        expect(await failureOfWeb(damaged)).toBe("digest-mismatch");
    });

    it("stops output that would exceed the ceiling", async () => {
        const written = await writeToBuffer(fakeDatabase(64 * 1024), { compress: true });

        expect(await failureOfWeb(written.bytes, { maxOutputBytes: 1_000 }))
            .toBe("output-too-large");
    });

    it("rejects a payload that is not a database", async () => {
        const written = await writeToBuffer(Buffer.from("this is not a database, it is a note"));

        expect(await failureOfWeb(written.bytes)).toBe("not-a-database");
    });

    it.each([
        [ "a plain container", {} ],
        [ "a compressed container", { compress: true } ]
    ] as [string, WriteOptions][])(
        "lets a destination error through untranslated, reading %s",
        async (_label, options) => {
            const written = await writeToBuffer(fakeDatabase(64 * 1024), options);
            const failing = new WritableStream<Uint8Array>({
                write() {
                    throw new Error("ENOSPC: no space left on device");
                }
            });

            const read = readBackupContainerWeb(webSource(written.bytes), failing);

            await expect(read).rejects.toThrow(/ENOSPC/);
        }
    );
});

describe("web transform plumbing", () => {
    it("surfaces a compressor failure untranslated, and stops the source", async () => {
        let sourceClosed = false;
        const poisoned = (async function* (): AsyncGenerator<Uint8Array> {
            try {
                // Not a byte chunk at all, which the compressor rejects mid-write.
                yield {} as unknown as Uint8Array;
                yield fakeDatabase(1024);
            } finally {
                sourceClosed = true;
            }
        })();

        const error = await consume(webBackend.gzip(poisoned, 6)).catch((thrown) => thrown);

        // Untranslated: a compressor failure is not a damaged payload.
        expect(error).toBeInstanceOf(Error);
        expect((error as { reason?: string }).reason).toBeUndefined();
        expect(sourceClosed).toBe(true);
    });
});

describe("web progress", () => {
    it("reports the database coming out, up to and including a final 1", async () => {
        const reports: number[] = [];
        const database = fakeDatabase(2 * FRAME_SIZE);
        const written = await writeToBuffer(database, { plaintextSize: database.length });

        await readFromBufferWeb(written.bytes, {
            onProgress: (progress) => reports.push(progress),
            progressIntervalMs: 0
        });

        expect(reports.at(-1)).toBe(1);
        expect(reports.every((progress) => progress > 0 && progress <= 1)).toBe(true);
        expect([ ...reports ].sort((first, second) => first - second)).toEqual(reports);
    });
});

describe("without WebCrypto", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("refuses encryption with an explanation rather than an undefined access", async () => {
        // What a plain-HTTP page sees: randomness exists, `subtle` does not.
        vi.stubGlobal("crypto", {
            getRandomValues: (target: Uint8Array) => target.fill(7)
        });

        let message = "did not throw";
        const reason = await reasonOf(
            writeToBufferWeb(fakeDatabase(), { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT })
                .catch((error: Error) => {
                    message = error.message;
                    throw error;
                })
        );

        expect(reason).toBe("invalid-kdf-params");
        expect(message).toMatch(/secure context/);
    });
});

async function consume(source: AsyncIterable<Uint8Array>): Promise<void> {
    for await (const chunk of source) {
        void chunk;
    }
}
