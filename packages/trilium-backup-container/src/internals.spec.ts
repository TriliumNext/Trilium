import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { nodeBackend } from "./backend-node.js";
import { deriveContainerKey } from "./backend.js";
import { ByteReader } from "./byte-reader.js";
import { BackupContainerError, isBackupContainerError } from "./errors.js";
import { FRAME_SIZE, HEADER_BYTES_PLAIN } from "./format.js";
import {
    fakeDatabase,
    failureOf,
    flipByte,
    reasonOf,
    writeToBuffer
} from "./test-helpers.js";
import { encryptFrames } from "./write.js";

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
    const text = (bytes: Uint8Array) => Buffer.from(bytes).toString();

    it("stitches exact reads across chunk boundaries and tracks the offset", async () => {
        const subject = reader(Buffer.from("abc"), Buffer.from("de"), Buffer.from("fgh"));

        expect(text(await subject.readExactly(4))).toBe("abcd");
        expect(subject.consumed).toBe(4);
        expect(text(await subject.readExactly(1))).toBe("e");
        expect(text(await subject.readUpTo(99))).toBe("fgh");
        expect(await subject.atEof()).toBe(true);
    });

    it("returns what is left rather than throwing, when asked for at most n", async () => {
        const subject = reader(Buffer.from("ab"));

        expect(await subject.readUpTo(0)).toHaveLength(0);
        expect(text(await subject.readUpTo(10))).toBe("ab");
        expect(await subject.readUpTo(10)).toHaveLength(0);
    });

    it("reports a short input as truncated", async () => {
        const subject = reader(Buffer.from("ab"));

        await expect(subject.readExactly(5)).rejects.toMatchObject({ reason: "truncated" });
    });
});

describe("encryptFrames", () => {
    it("refuses a payload that would need more frames than the counter can address", async () => {
        const frames = encryptFrames(
            nodeBackend,
            randomBytes(32),
            randomBytes(8),
            Buffer.alloc(60),
            Readable.from([ Buffer.alloc(2 * FRAME_SIZE) ]),
            0
        );

        const reason = await reasonOf((async () => {
            for await (const frame of frames) {
                void frame;
            }
        })());

        expect(reason).toBe("payload-too-large");
    });
});

describe("deriveContainerKey", () => {
    it("surfaces a key derivation the platform refuses", async () => {
        const derivation = deriveContainerKey(
            nodeBackend,
            "passphrase",
            new Uint8Array(16),
            { log2N: 10, r: 0, p: 1 }
        );

        await expect(derivation).rejects.toMatchObject({ reason: "invalid-kdf-params" });
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

    it("surfaces a digest mismatch through the decompressor untranslated", async () => {
        const written = await writeToBuffer(fakeDatabase(50_000), { compress: true });
        const damaged = flipByte(written.bytes, HEADER_BYTES_PLAIN - 5);   // inside the digest

        expect(await failureOf(damaged)).toBe("digest-mismatch");
    });

    it("lets a failing input through the compressor untranslated", async () => {
        const input = Readable.from((async function* (): AsyncGenerator<Buffer> {
            yield fakeDatabase(1024);
            throw new Error("EIO: input went away");
        })());

        const reason = await reasonOf(writeToBuffer(input, { compress: true }));

        // Untranslated: an input failure is not a damaged payload.
        expect(reason).toMatch(/no reason: Error: EIO/);
    });
});
