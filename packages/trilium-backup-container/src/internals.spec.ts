import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";

import { ByteReader } from "./byte-reader.js";
import { deriveKey } from "./crypto.js";
import { BackupContainerError, isBackupContainerError } from "./errors.js";
import { FRAME_SIZE, HEADER_BYTES_PLAIN } from "./format.js";
import { FrameEncryptor } from "./streams.js";
import {
    fakeDatabase,
    failureOf,
    flipByte,
    MemorySink,
    reasonOf,
    readFromBuffer,
    writeToBuffer
} from "./test-helpers.js";

describe("BackupContainerError", () => {
    it("narrows only its own errors", () => {
        const own = new BackupContainerError("truncated", "cut short");

        expect(isBackupContainerError(own)).toBe(true);
        expect(isBackupContainerError(new Error("something else"))).toBe(false);
        expect(isBackupContainerError("not even an error")).toBe(false);
    });
});

describe("ByteReader", () => {
    const reader = (...chunks: Buffer[]) => new ByteReader(Readable.from(chunks));

    it("stitches exact reads across chunk boundaries and tracks the offset", async () => {
        const subject = reader(Buffer.from("abc"), Buffer.from("de"), Buffer.from("fgh"));

        expect((await subject.readExactly(4)).toString()).toBe("abcd");
        expect(subject.consumed).toBe(4);
        expect((await subject.readExactly(1)).toString()).toBe("e");
        expect((await subject.readUpTo(99)).toString()).toBe("fgh");
        expect(await subject.atEof()).toBe(true);
    });

    it("returns what is left rather than throwing, when asked for at most n", async () => {
        const subject = reader(Buffer.from("ab"));

        expect(await subject.readUpTo(0)).toHaveLength(0);
        expect((await subject.readUpTo(10)).toString()).toBe("ab");
        expect(await subject.readUpTo(10)).toHaveLength(0);
    });

    it("reports a short input as truncated", async () => {
        const subject = reader(Buffer.from("ab"));

        await expect(subject.readExactly(5)).rejects.toMatchObject({ reason: "truncated" });
    });
});

describe("FrameEncryptor", () => {
    it("refuses a payload that would need more frames than the counter can address", async () => {
        const encryptor = new FrameEncryptor(randomBytes(32), randomBytes(8), Buffer.alloc(60), 0);

        const reason = await reasonOf(
            pipeline(Readable.from([ Buffer.alloc(2 * FRAME_SIZE) ]), encryptor, new MemorySink())
        );

        expect(reason).toBe("payload-too-large");
    });
});

describe("deriveKey", () => {
    it("surfaces a key derivation the platform refuses", async () => {
        await expect(deriveKey("passphrase", Buffer.alloc(16), { log2N: 10, r: 0, p: 1 }))
            .rejects.toMatchObject({ reason: "invalid-kdf-params" });
    });
});

describe("compressed payload damage", () => {
    it("reports a broken gzip stream as a damaged payload, not as a digest mismatch", async () => {
        const written = await writeToBuffer(fakeDatabase(50_000), { compress: true });

        // Corrupt the deflate data, then repair the digest so the failure can only come from zlib.
        const damaged = flipByte(written.bytes, HEADER_BYTES_PLAIN + 30);
        createHash("sha256").update(damaged.subarray(HEADER_BYTES_PLAIN)).digest().copy(
            damaged,
            HEADER_BYTES_PLAIN - 32
        );

        expect(await failureOf(damaged)).toBe("damaged-payload");
    });
});
