import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
    FIXED_HEADER_BYTES,
    FRAME_SIZE,
    HEADER_BYTES_ENCRYPTED,
    HEADER_BYTES_PLAIN,
    containerSize,
    SCRYPT_DEFAULTS,
    TRAILER_BYTES,
    TAG_BYTES
} from "./format.js";
import { readBackupContainer, writeBackupContainer } from "./node-streams.js";
import { getInfo } from "./read.js";
import {
    chunked,
    fakeDatabase,
    failureOf,
    FAST_SCRYPT,
    flipByte,
    MemorySink,
    reasonOf,
    readFromBuffer,
    readFromBufferWeb,
    type WriteOptions,
    writeToBuffer
} from "./test-helpers.js";
type PeekCase = [string, WriteOptions, { isCompressed: boolean; isEncrypted: boolean }];

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
        expect(written.bytes).toHaveLength(HEADER_BYTES_ENCRYPTED + FRAME_OVERHEAD + TRAILER_BYTES);

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
    it("is the SHA-256 of the payload as stored, written into the trailer after it", async () => {
        const written = await writeToBuffer(
            fakeDatabase(20_000),
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT }
        );

        const payload = written.bytes.subarray(HEADER_BYTES_ENCRYPTED, -TRAILER_BYTES);
        const stored = written.bytes.subarray(-TRAILER_BYTES, -TRAILER_BYTES + 32);

        expect(stored.equals(createHash("sha256").update(payload).digest())).toBe(true);
        expect(Buffer.from(written.result.digest).equals(stored)).toBe(true);
        expect(written.result.payloadBytes).toBe(payload.length);
    });

    it("catches damage to an unencrypted payload", async () => {
        const written = await writeToBuffer(fakeDatabase(4096));
        const damaged = flipByte(written.bytes, written.bytes.length - TRAILER_BYTES - 5);

        expect(await failureOf(damaged)).toBe("digest-mismatch");
    });
});

describe("gzip payload", () => {
    it("is a plain gzip stream with no metadata, recoverable with stock tools", async () => {
        const database = fakeDatabase(5_000);
        const written = await writeToBuffer(database, { compress: true });
        const payload = written.bytes.subarray(HEADER_BYTES_PLAIN, -TRAILER_BYTES);

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
        expect(written.bytes).toHaveLength(HEADER_BYTES_ENCRYPTED + fullFrames + FRAME_OVERHEAD + TRAILER_BYTES);

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
            + TRAILER_BYTES
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
        const damaged = flipByte(written.bytes, 73);   // inside the verifier tag, bytes 68 to 83

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
        const damaged = flipByte(written.bytes, 48);

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

describe("describing a container for a listing", () => {
    it.each([
        [ "plain", {}, { isCompressed: false, isEncrypted: false } ],
        [ "compressed", { compress: true }, { isCompressed: true, isEncrypted: false } ],
        [
            "encrypted",
            { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT },
            { isCompressed: false, isEncrypted: true }
        ],
        [
            "both",
            { compress: true, passphrase: PASSPHRASE, scrypt: FAST_SCRYPT },
            { isCompressed: true, isEncrypted: true }
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

        // Only the fixed header, and no passphrase, which is the whole point of describing one.
        expect(getInfo(written.bytes.subarray(0, FIXED_HEADER_BYTES))).toEqual({
            isValid: true,
            isSupported: true,
            version: 1,
            size: 9_000,
            creationTimestamp: expect.any(Number),
            ...expected
        });
    });

    it("dates the backup from the container, not from the file it sits in", async () => {
        const taken = Date.UTC(2026, 1, 3, 4, 5, 6);
        const written = await writeToBuffer(fakeDatabase(4096), { timestamp: taken });

        const info = getInfo(written.bytes);

        expect(info).toMatchObject({ isValid: true, isSupported: true });
        expect(info.isValid && info.isSupported && info.creationTimestamp).toBe(taken);
    });

    it("reports an unrecorded size as zero rather than guessing", async () => {
        const written = await writeToBuffer(fakeDatabase(4096), { compress: true });
        const info = getInfo(written.bytes);

        expect(info.isValid && info.isSupported && info.size).toBe(0);
    });

    it.each([
        [ "an ArrayBuffer", (head: Uint8Array) => copyOf(head, 0) ],
        [ "a view over one", (head: Uint8Array) => new DataView(copyOf(head, 0)) ],
        // The one an offset-blind reader gets silently wrong, since the bytes it wants are there.
        [
            "a view starting partway into one",
            (head: Uint8Array) => new DataView(copyOf(head, 8), 8)
        ]
    ])("takes the head as %s, since callers hold it differently", async (_label, wrap) => {
        const written = await writeToBuffer(fakeDatabase(4096), { plaintextSize: 4096 });
        const head = written.bytes.subarray(0, FIXED_HEADER_BYTES);

        expect(getInfo(wrap(head))).toEqual(getInfo(head));
    });

    it.each([
        [ "fewer bytes than a header", Buffer.alloc(20) ],
        [ "something that is not a container", Buffer.alloc(64, 9) ],
        [ "an empty file", Buffer.alloc(0) ]
    ])("says %s is not a backup at all, so one foreign file cannot derail a listing", (
        _label,
        bytes
    ) => {
        expect(getInfo(bytes)).toEqual({ isValid: false });
    });

    it.each([
        [ "a version written after this build", (bytes: Buffer) => bytes.writeUInt8(2, 20), 2 ],
        [ "a version nothing could have written", (bytes: Buffer) => bytes.writeUInt8(0, 20), 0 ],
        [ "a reserved flag bit", (bytes: Buffer) => bytes.writeUInt8(0b100, 29), 1 ],
        [ "a header that does not measure up", (bytes: Buffer) => bytes.writeUInt16LE(64, 30), 1 ]
    ])("owns %s as a backup it cannot open, rather than disowning it", (
        _label,
        mutate,
        version
    ) => {
        // The difference a listing lives on: "not a backup" and "a backup this build is too old
        // for" are the same null to a reader that only answers yes or no.
        expect(getInfo(tamper(mutate))).toEqual({ isValid: true, isSupported: false, version });
    });
});

/**
 * The bytes in an `ArrayBuffer` of their own, which a `Buffer` never has: Node allocates those out
 * of a shared pool, so `.buffer` on one is most of the heap and starts nowhere near the bytes.
 *
 * @param offset how far into the buffer to put them, so a view at a non-zero offset can be built.
 */
function copyOf(bytes: Uint8Array, offset: number): ArrayBuffer {
    const buffer = new ArrayBuffer(offset + bytes.length);
    new Uint8Array(buffer).set(bytes, offset);

    return buffer;
}

function tamper(mutate: (bytes: Buffer) => void): Buffer {
    const header = Buffer.alloc(FIXED_HEADER_BYTES);
    Buffer.from("Trilium Notes Backup", "ascii").copy(header, 0);
    header.writeUInt8(1, 20);
    header.writeUInt16LE(40, 30);
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
        tightened.writeBigUInt64LE(1_000n, 32);

        expect(await failureOf(tightened)).toBe("output-too-large");
    });

    it("never lets a crafted plaintext size widen the ceiling", async () => {
        const written = await writeToBuffer(fakeDatabase(64 * 1024), { compress: true });
        const crafted = Buffer.from(written.bytes);
        crafted.writeBigUInt64LE(2n ** 63n, 32);

        expect(await failureOf(crafted, { maxOutputBytes: 1_000 })).toBe("output-too-large");
    });

    it("rejects output whose length disagrees with the recorded size", async () => {
        const database = fakeDatabase(4096);
        const written = await writeToBuffer(database, { plaintextSize: database.length });
        const lying = Buffer.from(written.bytes);
        lying.writeBigUInt64LE(5_000n, 32);

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
    it("rejects a plaintext size that is not a non-negative safe integer", async () => {
        expect(await reasonOf(writeToBuffer(fakeDatabase(), { plaintextSize: -1 })))
            .toBe("invalid-options");
    });
});

describe("forward-only writing", () => {
    const FORWARD: WriteOptions = { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT };

    it("is sized exactly as derived, and reads back on both runtimes", async () => {
        const database = fakeDatabase(64 * 1024);
        const written = await writeToBuffer(database, { ...FORWARD, plaintextSize: database.length });

        // Nothing was written back to: what the sink received in order is the whole file.
        expect(written.bytes.length).toBe(containerSize(database.length, true));
        expect(getInfo(written.bytes.subarray(0, FIXED_HEADER_BYTES)))
            .toMatchObject({ isEncrypted: true, isCompressed: false });

        const read = await readFromBuffer(written.bytes, { passphrase: PASSPHRASE });
        expect(read.bytes.equals(database)).toBe(true);

        const readWeb = await readFromBufferWeb(written.bytes, { passphrase: PASSPHRASE });
        expect(readWeb.bytes.equals(database)).toBe(true);
    });

    it("sizes a payload that is an exact multiple of the frame size, empty final frame included", async () => {
        const database = fakeDatabase(FRAME_SIZE);
        const written = await writeToBuffer(database, FORWARD);

        expect(written.bytes.length).toBe(containerSize(FRAME_SIZE, true));
        const read = await readFromBuffer(written.bytes, { passphrase: PASSPHRASE });
        expect(read.bytes.equals(database)).toBe(true);
    });

    it("catches tampering through the frames as well as the digest", async () => {
        const database = fakeDatabase(64 * 1024);
        const written = await writeToBuffer(database, FORWARD);

        const tampered = flipByte(written.bytes, HEADER_BYTES_ENCRYPTED + 4 + 100);
        expect(await failureOf(tampered, { passphrase: PASSPHRASE })).toBe("damaged-payload");
    });

    it("writes and reads a container with neither compression nor encryption", async () => {
        // The case with nothing else standing behind it: the trailer's digest is the whole of its
        // integrity, and it is there because no writer has to seek to produce one any more.
        const database = fakeDatabase(64 * 1024);
        const written = await writeToBuffer(database, { plaintextSize: database.length });

        expect(written.bytes.length).toBe(containerSize(database.length, false));
        expect(getInfo(written.bytes.subarray(0, FIXED_HEADER_BYTES)))
            .toMatchObject({ isEncrypted: false, isCompressed: false });

        expect((await readFromBuffer(written.bytes)).bytes.equals(database)).toBe(true);
        expect((await readFromBufferWeb(written.bytes)).bytes.equals(database)).toBe(true);
    });

    it("catches a truncated unencrypted one, which is what a broken download leaves", async () => {
        const database = fakeDatabase(64 * 1024);
        const written = await writeToBuffer(database, { plaintextSize: database.length });

        // Cutting the end takes the trailer with it, so what is left cannot even claim a digest.
        expect(await failureOf(written.bytes.subarray(0, written.bytes.length - 1024)))
            .toBe("digest-mismatch");
    });

    it("records the length it actually wrote, whatever it was told in advance", async () => {
        const database = fakeDatabase(64 * 1024);
        // Told nothing: the trailer still states the size, counted as the payload went past.
        const written = await writeToBuffer(database, {});

        expect((await readFromBuffer(written.bytes)).result.bytesWritten).toBe(database.length);
    });
});

describe("what the trailer is holding the file to", () => {
    it("refuses a payload that is not the length the trailer counted", async () => {
        const database = fakeDatabase(9_000);
        const written = await writeToBuffer(database, { plaintextSize: database.length });

        // The size field alone, leaving the digest beside it intact: this is the check that stands
        // on its own, rather than the one the digest would have caught anyway.
        const lying = Buffer.from(written.bytes);
        lying.writeBigUInt64LE(8_000n, lying.length - 8);

        expect(await failureOf(lying)).toBe("size-mismatch");
    });

    it("reads a container whose payload is shorter than its own trailer", async () => {
        // The edge the rolling window exists for: with nothing but a trailer left to look at, the
        // reader has to hold all of it back rather than emit any of it as payload.
        const written = await writeToBuffer(Buffer.alloc(0));

        expect(written.bytes).toHaveLength(containerSize(0, false));

        const read = await readFromBuffer(written.bytes, { requireSqliteHeader: false });
        expect(read.bytes).toHaveLength(0);
    });

});

describe("the cost of a key nobody chose", () => {
    it("derives at the recommended cost when the caller does not say", async () => {
        // Every other test here asks for a cheap derivation, which leaves the default untried; it
        // is the one real users get, and the one whose bounds a reader checks against.
        const written = await writeToBuffer(fakeDatabase(4096), { passphrase: PASSPHRASE });

        expect([ ...written.bytes.subarray(41, 44) ])
            .toEqual([ SCRYPT_DEFAULTS.log2N, SCRYPT_DEFAULTS.r, SCRYPT_DEFAULTS.p ]);
    });
});
