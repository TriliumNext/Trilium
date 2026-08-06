import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
    FIXED_HEADER_BYTES,
    FRAME_SIZE,
    HEADER_BYTES_ENCRYPTED,
    HEADER_BYTES_PLAIN,
    TAG_BYTES
} from "./format.js";
import { peekBackupContainer, readBackupContainer } from "./read.js";
import {
    chunked,
    fakeDatabase,
    failureOf,
    FAST_SCRYPT,
    flipByte,
    MemorySink,
    reasonOf,
    readFromBuffer,
    writeToBuffer
} from "./test-helpers.js";
import { writeBackupContainer, type WriteBackupContainerOptions } from "./write.js";

type WriteOptions = Omit<WriteBackupContainerOptions, "patchHeader">;
type PeekCase = [string, WriteOptions, { compressed: boolean; encrypted: boolean }];

const PASSPHRASE = "correct horse battery staple";
const FRAME_OVERHEAD = 4 + TAG_BYTES;

describe("round trip", () => {
    const cases: [string, WriteOptions, number][] = [
        [ "plain", {}, HEADER_BYTES_PLAIN ],
        [ "compressed", { compress: true }, HEADER_BYTES_PLAIN ],
        [ "encrypted", { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }, HEADER_BYTES_ENCRYPTED ],
        [
            "compressed and encrypted",
            { compress: true, passphrase: PASSPHRASE, scrypt: FAST_SCRYPT },
            HEADER_BYTES_ENCRYPTED
        ]
    ];

    it.each(cases)("wraps and unwraps a %s container", async (_label, options, headerLength) => {
        const database = fakeDatabase(64 * 1024);

        const written = await writeToBuffer(
            database,
            { ...options, plaintextSize: database.length }
        );
        expect(written.result.headerLength).toBe(headerLength);
        expect(written.patchedAt).toEqual([ headerLength - 32 ]);

        const read = await readFromBuffer(written.bytes, { passphrase: PASSPHRASE });
        expect(read.bytes.equals(database)).toBe(true);
        expect(read.result).toMatchObject({
            version: 1,
            compressed: options.compress === true,
            encrypted: options.passphrase !== undefined,
            plaintextSize: database.length,
            bytesWritten: database.length
        });
    });

    it("survives input arriving in awkward chunks", async () => {
        const database = fakeDatabase(9_000);
        const written = await writeToBuffer(chunked(database, 7), {
            compress: true,
            passphrase: PASSPHRASE,
            scrypt: FAST_SCRYPT
        });

        const read = await readFromBuffer(written.bytes, { passphrase: PASSPHRASE });
        expect(read.bytes.equals(database)).toBe(true);
    });

    it("wraps an empty payload as a single empty final frame", async () => {
        const written = await writeToBuffer(
            Buffer.alloc(0),
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );
        expect(written.bytes).toHaveLength(HEADER_BYTES_ENCRYPTED + FRAME_OVERHEAD);

        const read = await readFromBuffer(
            written.bytes,
            { passphrase: PASSPHRASE, requireSqliteHeader: false }
        );
        expect(read.result.bytesWritten).toBe(0);
    });

    it("compresses, so a repetitive database gets much smaller", async () => {
        const database = fakeDatabase(256 * 1024);

        const plain = await writeToBuffer(database);
        const compressed = await writeToBuffer(database, { compress: true });

        expect(compressed.bytes.length).toBeLessThan(plain.bytes.length / 10);
    });
});

describe("payload digest", () => {
    it("is the SHA-256 of the payload as stored, patched in after the payload", async () => {
        const written = await writeToBuffer(
            fakeDatabase(20_000),
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );

        const payload = written.bytes.subarray(HEADER_BYTES_ENCRYPTED);
        const stored = written.bytes.subarray(HEADER_BYTES_ENCRYPTED - 32, HEADER_BYTES_ENCRYPTED);

        expect(stored.equals(createHash("sha256").update(payload).digest())).toBe(true);
        expect(written.result.digest.equals(stored)).toBe(true);
        expect(written.result.payloadBytes).toBe(payload.length);
    });

    it("catches damage to an unencrypted payload", async () => {
        const written = await writeToBuffer(fakeDatabase(4096));
        const damaged = flipByte(written.bytes, written.bytes.length - 5);

        expect(await failureOf(damaged)).toBe("digest-mismatch");
    });
});

describe("gzip payload", () => {
    it("is a plain gzip stream with no metadata, recoverable with stock tools", async () => {
        const database = fakeDatabase(5_000);
        const written = await writeToBuffer(database, { compress: true });
        const payload = written.bytes.subarray(HEADER_BYTES_PLAIN);

        expect(payload.readUInt16BE(0)).toBe(0x1f8b);
        expect(payload.readUInt8(3)).toBe(0);              // no FNAME, no FEXTRA
        expect(payload.readUInt32LE(4)).toBe(0);           // MTIME, so no timestamp leaks
        expect(payload.readUInt8(9)).toBe(255);            // OS, so the platform does not leak
        expect(gunzipSync(payload).equals(database)).toBe(true);
    });
});

describe("canonical framing", () => {
    it("ends a payload that is an exact multiple of the frame size emptily", async () => {
        const database = fakeDatabase(2 * FRAME_SIZE);
        const written = await writeToBuffer(
            database,
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );

        const fullFrames = 2 * (FRAME_SIZE + FRAME_OVERHEAD);
        expect(written.bytes).toHaveLength(HEADER_BYTES_ENCRYPTED + fullFrames + FRAME_OVERHEAD);

        const read = await readFromBuffer(written.bytes, { passphrase: PASSPHRASE });
        expect(read.bytes.equals(database)).toBe(true);
    });

    it("ends a partial payload with a short final frame", async () => {
        const database = fakeDatabase(FRAME_SIZE + 1_000);
        const written = await writeToBuffer(
            database,
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );

        expect(written.bytes).toHaveLength(
            HEADER_BYTES_ENCRYPTED + (FRAME_SIZE + FRAME_OVERHEAD) + (1_000 + FRAME_OVERHEAD)
        );
    });
});

describe("passphrase handling", () => {
    it("rejects the wrong passphrase before reading any frame", async () => {
        const written = await writeToBuffer(
            fakeDatabase(),
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );

        expect(await failureOf(written.bytes, { passphrase: "wrong" }))
            .toBe("wrong-passphrase-or-damaged-header");
    });

    it("reports a missing passphrase separately", async () => {
        const written = await writeToBuffer(
            fakeDatabase(),
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );

        expect(await failureOf(written.bytes)).toBe("passphrase-required");
    });

    it("normalises to NFC, so a decomposed and a composed passphrase agree", async () => {
        const decomposed = "café secret";   // e plus combining acute
        const composed = "café secret";             // precomposed e-acute
        expect(decomposed).not.toBe(composed);

        const written = await writeToBuffer(
            fakeDatabase(),
            { passphrase: decomposed, scrypt: FAST_SCRYPT }
        );

        const read = await readFromBuffer(written.bytes, { passphrase: composed });
        expect(read.result.bytesWritten).toBe(4096);
    });

    it("uses a fresh salt and nonce prefix per file", async () => {
        const first = await writeToBuffer(
            fakeDatabase(),
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );
        const second = await writeToBuffer(
            fakeDatabase(),
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );

        expect(first.bytes.subarray(36, 60).equals(second.bytes.subarray(36, 60))).toBe(false);
    });
});

describe("damage and tampering", () => {
    const encrypted = () => writeToBuffer(
        fakeDatabase(2 * FRAME_SIZE),
        { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
    );

    it("recovers when only the verifier tag is damaged", async () => {
        const written = await encrypted();
        const damaged = flipByte(written.bytes, 65);   // inside the verifier tag, bytes 60 to 75

        expect(await failureOf(damaged, { passphrase: PASSPHRASE }))
            .toBe("wrong-passphrase-or-damaged-header");

        // The tag sits outside the authenticated header, so the frames are still intact.
        const recovered = await readFromBuffer(
            damaged,
            { passphrase: PASSPHRASE, skipVerifier: true }
        );
        expect(recovered.bytes.equals(fakeDatabase(2 * FRAME_SIZE))).toBe(true);
    });

    it("rejects a flipped bit in the salt, which no recovery can undo", async () => {
        const written = await encrypted();
        const damaged = flipByte(written.bytes, 40);

        const reason = await failureOf(damaged, { passphrase: PASSPHRASE, skipVerifier: true });

        expect(reason).toBe("damaged-payload");
    });

    it("rejects a flipped bit inside a frame", async () => {
        const written = await encrypted();
        const damaged = flipByte(written.bytes, HEADER_BYTES_ENCRYPTED + 500);

        const reason = await failureOf(damaged, { passphrase: PASSPHRASE });

        expect(reason).toBe("damaged-payload");
    });

    it("rejects bytes appended after the final frame", async () => {
        const written = await encrypted();
        const extended = Buffer.concat([ written.bytes, Buffer.from("extra") ]);

        expect(await failureOf(extended, { passphrase: PASSPHRASE })).toBe("trailing-data");
    });

    it("rejects a truncated container", async () => {
        const written = await encrypted();

        const cut = written.bytes.subarray(0, written.bytes.length - 10);

        expect(await failureOf(cut, { passphrase: PASSPHRASE })).toBe("truncated");
    });

    it("rejects a non-final frame that is not exactly one frame long", async () => {
        const written = await encrypted();
        const tampered = Buffer.from(written.bytes);
        tampered.writeUInt32LE(5, HEADER_BYTES_ENCRYPTED);

        expect(await failureOf(tampered, { passphrase: PASSPHRASE })).toBe("invalid-frame-length");
    });

    it("rejects an oversized frame length before reading that many bytes", async () => {
        const written = await writeToBuffer(
            fakeDatabase(),
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );
        const tampered = Buffer.from(written.bytes);
        // The final flag plus a 2 GiB claim.
        tampered.writeUInt32LE(0xffffffff, HEADER_BYTES_ENCRYPTED);

        expect(await failureOf(tampered, { passphrase: PASSPHRASE })).toBe("invalid-frame-length");
    });

    it("rejects a damaged compressed payload", async () => {
        const written = await writeToBuffer(fakeDatabase(50_000), { compress: true });
        const damaged = flipByte(written.bytes, HEADER_BYTES_PLAIN + 40);

        expect([ "damaged-payload", "digest-mismatch" ]).toContain(await failureOf(damaged));
    });
});

describe("peeking at a container", () => {
    it.each([
        [ "plain", {}, { compressed: false, encrypted: false } ],
        [ "compressed", { compress: true }, { compressed: true, encrypted: false } ],
        [
            "encrypted",
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT },
            { compressed: false, encrypted: true }
        ],
        [
            "both",
            { compress: true, passphrase: PASSPHRASE, scrypt: FAST_SCRYPT },
            { compressed: true, encrypted: true }
        ]
    ] as PeekCase[])("reports a %s container from its first bytes alone", async (
        _label,
        options,
        expected
    ) => {
        const database = fakeDatabase(9_000);
        const written = await writeToBuffer(
            database,
            { ...options, plaintextSize: database.length }
        );

        // Only the fixed header, and no passphrase, which is the whole point of the peek.
        expect(peekBackupContainer(written.bytes.subarray(0, FIXED_HEADER_BYTES))).toEqual({
            version: 1,
            plaintextSize: 9_000,
            ...expected
        });
    });

    it("reports an unrecorded plaintext size as zero rather than guessing", async () => {
        const written = await writeToBuffer(fakeDatabase(4096), { compress: true });

        expect(peekBackupContainer(written.bytes)?.plaintextSize).toBe(0);
    });

    it.each([
        [ "fewer bytes than a header", Buffer.alloc(20) ],
        [ "something that is not a container", Buffer.alloc(64, 9) ],
        [ "a version it does not know", tamper((bytes) => bytes.writeUInt8(2, 20)) ],
        [ "a reserved flag bit", tamper((bytes) => bytes.writeUInt8(0b100, 21)) ]
    ])("answers null for %s, so one bad file cannot derail a listing", (_label, bytes) => {
        expect(peekBackupContainer(bytes)).toBeNull();
    });
});

function tamper(mutate: (bytes: Buffer) => void): Buffer {
    const header = Buffer.alloc(FIXED_HEADER_BYTES);
    Buffer.from("Trilium Notes Backup", "ascii").copy(header, 0);
    header.writeUInt8(1, 20);
    header.writeUInt16LE(64, 22);
    mutate(header);

    return header;
}

describe("input that is not a container", () => {
    it.each([
        [ "random bytes", Buffer.alloc(300, 9), "not-a-container" ],
        [ "an empty file, which identifies itself as nothing", Buffer.alloc(0), "not-a-container" ],
        [
            "a short file whose bytes are not the start of the magic",
            Buffer.from("Trillium"),
            "not-a-container"
        ]
    ])("rejects %s", async (_label, bytes, reason) => {
        expect(await failureOf(bytes)).toBe(reason);
    });

    it("reports a container cut off inside its header as truncated", async () => {
        const written = await writeToBuffer(fakeDatabase());

        // A valid prefix of the magic is ambiguous, and a cut-off container is the useful reading.
        expect(await failureOf(Buffer.from("Tril"))).toBe("truncated");
        expect(await failureOf(written.bytes.subarray(0, 24))).toBe("truncated");
        expect(await failureOf(written.bytes.subarray(0, 40))).toBe("truncated");
    });
});

describe("output bounds", () => {
    it("stops output that would exceed the ceiling", async () => {
        const written = await writeToBuffer(fakeDatabase(64 * 1024), { compress: true });

        expect(await failureOf(written.bytes, { maxOutputBytes: 1_000 })).toBe("output-too-large");
    });

    it("lets a recorded plaintext size tighten the ceiling", async () => {
        const database = fakeDatabase(64 * 1024);
        const written = await writeToBuffer(
            database,
            { compress: true, plaintextSize: database.length }
        );
        const tightened = Buffer.from(written.bytes);
        tightened.writeBigUInt64LE(1_000n, 24);

        expect(await failureOf(tightened)).toBe("output-too-large");
    });

    it("never lets a crafted plaintext size widen the ceiling", async () => {
        const written = await writeToBuffer(fakeDatabase(64 * 1024), { compress: true });
        const crafted = Buffer.from(written.bytes);
        crafted.writeBigUInt64LE(2n ** 63n, 24);

        expect(await failureOf(crafted, { maxOutputBytes: 1_000 })).toBe("output-too-large");
    });

    it("rejects output whose length disagrees with the recorded size", async () => {
        const database = fakeDatabase(4096);
        const written = await writeToBuffer(database, { plaintextSize: database.length });
        const lying = Buffer.from(written.bytes);
        lying.writeBigUInt64LE(5_000n, 24);

        expect(await failureOf(lying)).toBe("size-mismatch");
    });
});

describe("SQLite check", () => {
    it("rejects a payload that is not a database, and can be told not to", async () => {
        const written = await writeToBuffer(Buffer.from("this is not a database, it is a note"));

        expect(await failureOf(written.bytes)).toBe("not-a-database");
        const read = await readFromBuffer(written.bytes, { requireSqliteHeader: false });
        expect(read.result.bytesWritten).toBe(36);
    });

    it("rejects output too short to hold a SQLite header", async () => {
        const written = await writeToBuffer(Buffer.from("short"));

        expect(await failureOf(written.bytes)).toBe("not-a-database");
    });
});

describe("option validation", () => {
    it("requires patchHeader, since the digest is written after the payload", async () => {
        const reason = await reasonOf(
            writeBackupContainer(Readable.from([ fakeDatabase() ]), new MemorySink(), {} as never)
        );

        expect(reason).toBe("invalid-options");
    });

    it.each([
        [ "a negative plaintext size", { plaintextSize: -1 }, "invalid-options" ],
        [ "a fractional plaintext size", { plaintextSize: 1.5 }, "invalid-options" ],
        [
            "scrypt parameters out of bounds",
            { passphrase: PASSPHRASE, scrypt: { log2N: 30, r: 8, p: 1 } },
            "invalid-kdf-params"
        ],
        [
            "a scrypt cost above the writer ceiling",
            { passphrase: PASSPHRASE, maxKdfMemoryBytes: 1024 },
            "invalid-kdf-params"
        ]
    ])("rejects %s", async (_label, options, reason) => {
        expect(await reasonOf(writeToBuffer(fakeDatabase(), options))).toBe(reason);
    });

    it("refuses a key derivation the reader considers too expensive", async () => {
        const written = await writeToBuffer(
            fakeDatabase(),
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );

        expect(await failureOf(written.bytes, { passphrase: PASSPHRASE, maxKdfMemoryBytes: 1024 }))
            .toBe("invalid-kdf-params");
    });
});

describe("errors", () => {
    it("carries a machine-readable reason and a plain English message", async () => {
        try {
            await readFromBuffer(Buffer.alloc(300, 9));
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error).toMatchObject({
                name: "BackupContainerError",
                reason: "not-a-container"
            });
            expect((error as Error).message).toMatch(/container magic/);
        }
    });

    it("lets a destination error through untranslated", async () => {
        const written = await writeToBuffer(fakeDatabase());
        const failing = new MemorySink();
        failing._write = (_chunk, _encoding, callback) =>
            callback(new Error("ENOSPC: no space left on device"));

        const read = readBackupContainer(Readable.from([ written.bytes ]), failing);

        await expect(read).rejects.toThrow(/ENOSPC/);
    });
});
