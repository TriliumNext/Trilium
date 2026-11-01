import { describe, expect, it } from "vitest";

import { BackupContainerError } from "./errors.js";
import {
    authenticatedHeaderEnd,
    containerSize,
    type ContainerHeader,
    decodeFixedHeader,
    decodeHeader,
    decodeTrailer,
    DEFAULT_MAX_HEADER_BYTES,
    encodeHeader,
    encodeTrailer,
    FIXED_HEADER_BYTES,
    HEADER_BYTES_ENCRYPTED,
    HEADER_BYTES_PLAIN,
    KDF_SCRYPT,
    nonceFor,
    SQLITE_MAGIC,
    scryptMemoryBytes,
    TRAILER_BYTES,
    validateScryptParams,
    validateSqliteHeader
} from "./format.js";

const TIMESTAMP = 1_700_000_000_000;

function plainHeader(overrides: Partial<ContainerHeader> = {}): ContainerHeader {
    return {
        version: 1,
        timestamp: TIMESTAMP,
        compressed: true,
        encrypted: false,
        plaintextSize: 4096,
        headerLength: HEADER_BYTES_PLAIN,
        encryption: null,
        ...overrides
    };
}

function encryptedHeader(): ContainerHeader {
    return {
        version: 1,
        timestamp: TIMESTAMP,
        compressed: false,
        encrypted: true,
        plaintextSize: 123456789,
        headerLength: HEADER_BYTES_ENCRYPTED,
        encryption: {
            kdfId: KDF_SCRYPT,
            log2N: 17,
            r: 8,
            p: 1,
            salt: Buffer.alloc(16, 1),
            noncePrefix: Buffer.alloc(8, 2),
            verifierTag: Buffer.alloc(16, 3)
        }
    };
}

describe("header layout", () => {
    it("round-trips an unencrypted header and matches the documented offsets", () => {
        const bytes = Buffer.from(encodeHeader(plainHeader()));

        expect(bytes).toHaveLength(40);
        expect(bytes.subarray(0, 20).toString("ascii")).toBe("Trilium Notes Backup");
        expect(bytes.readUInt8(20)).toBe(1);
        expect(bytes.readBigUInt64LE(21)).toBe(BigInt(TIMESTAMP));
        expect(bytes.readUInt8(29)).toBe(0b01);
        expect(bytes.readUInt16LE(30)).toBe(40);
        expect(bytes.readBigUInt64LE(32)).toBe(4096n);

        const decoded = decodeHeader(bytes, DEFAULT_MAX_HEADER_BYTES);
        expect(decoded).toMatchObject({
            version: 1,
            timestamp: TIMESTAMP,
            compressed: true,
            encrypted: false,
            plaintextSize: 4096
        });
        expect(decoded.encryption).toBeNull();
    });

    it("round-trips an encrypted header, with the verifier tag as its last field", () => {
        const header = encryptedHeader();
        const bytes = Buffer.from(encodeHeader(header));

        expect(bytes).toHaveLength(84);
        expect(bytes.readUInt8(29)).toBe(0b10);
        expect(bytes.readUInt8(40)).toBe(KDF_SCRYPT);
        const params = [ bytes.readUInt8(41), bytes.readUInt8(42), bytes.readUInt8(43) ];
        expect(params).toEqual([ 17, 8, 1 ]);
        // Everything up to the tag is authenticated, the timestamp with it.
        expect(authenticatedHeaderEnd(84)).toBe(68);

        const decoded = decodeHeader(bytes, DEFAULT_MAX_HEADER_BYTES);
        expect(decoded.encryption).toMatchObject({ kdfId: KDF_SCRYPT, log2N: 17, r: 8, p: 1 });
        expect(decoded.encryption ? Buffer.from(decoded.encryption.salt) : null)
            .toEqual(Buffer.alloc(16, 1));
        expect(decoded.encryption ? Buffer.from(decoded.encryption.verifierTag) : null)
            .toEqual(Buffer.alloc(16, 3));
        expect(decoded.plaintextSize).toBe(123456789);
    });

    it("treats an unrepresentable plaintext size or timestamp as unknown", () => {
        // Neither may widen a bound or be shown as a date, so both read as "not stated".
        const bytes = Buffer.from(encodeHeader(plainHeader()));
        bytes.writeBigUInt64LE(2n ** 63n, 32);
        bytes.writeBigUInt64LE(2n ** 63n, 21);

        const decoded = decodeHeader(bytes, DEFAULT_MAX_HEADER_BYTES);
        expect(decoded.plaintextSize).toBe(0);
        expect(decoded.timestamp).toBe(0);
    });
});

describe("trailer", () => {
    it("round-trips the digest and the length the payload came to", () => {
        const digest = Buffer.alloc(32, 9);
        const bytes = Buffer.from(encodeTrailer({ digest, plaintextSize: 987654321 }));

        expect(bytes).toHaveLength(TRAILER_BYTES);
        expect(bytes).toHaveLength(40);

        const decoded = decodeTrailer(bytes);
        expect(Buffer.from(decoded.digest)).toEqual(digest);
        expect(decoded.plaintextSize).toBe(987654321);
    });

    it("refuses anything that is not exactly a trailer, which is what a short file leaves", () => {
        expect(() => decodeTrailer(Buffer.alloc(TRAILER_BYTES - 1)))
            .toThrow(expect.objectContaining({ reason: "truncated" }) as Error);
    });
});

describe("derived container size", () => {
    it("counts the header, the payload and the trailer", () => {
        expect(containerSize(4096, false)).toBe(HEADER_BYTES_PLAIN + 4096 + TRAILER_BYTES);
    });

    it("counts every frame's length field and tag when encrypted, the empty final one included", () => {
        // An exact multiple of the frame size still ends with an empty final frame.
        const oneFrame = 1_048_576;
        expect(containerSize(oneFrame, true))
            .toBe(HEADER_BYTES_ENCRYPTED + oneFrame + 2 * 20 + TRAILER_BYTES);
        expect(containerSize(oneFrame + 1, true))
            .toBe(HEADER_BYTES_ENCRYPTED + oneFrame + 1 + 2 * 20 + TRAILER_BYTES);
    });
});

describe("nonces", () => {
    it("builds a distinct 12-byte nonce per counter", () => {
        const prefix = Buffer.alloc(8, 9);

        expect(nonceFor(prefix, 0)).toHaveLength(12);
        expect(nonceFor(prefix, 0)).not.toEqual(nonceFor(prefix, 1));
        expect(Buffer.from(nonceFor(prefix, 0xffffffff)).subarray(8).toString("hex"))
            .toBe("ffffffff");
    });
});

describe("fixed header validation", () => {
    const decode = (mutate: (bytes: Buffer) => void, max = DEFAULT_MAX_HEADER_BYTES) => {
        const bytes = Buffer.from(encodeHeader(plainHeader())).subarray(0, FIXED_HEADER_BYTES);
        mutate(bytes);

        return () => decodeFixedHeader(bytes, max);
    };

    it.each([
        [
            "magic mismatch",
            (bytes: Buffer) => bytes.write("Trillium Notes Bckp!", 0, "ascii"),
            "not-a-container"
        ],
        [ "version 0", (bytes: Buffer) => bytes.writeUInt8(0, 20), "unsupported-version" ],
        [ "a newer version", (bytes: Buffer) => bytes.writeUInt8(2, 20), "unsupported-version" ],
        [
            "a reserved flag bit",
            (bytes: Buffer) => bytes.writeUInt8(0b100, 29),
            "unsupported-flags"
        ],
        [
            "a header length that does not match the flags",
            (bytes: Buffer) => bytes.writeUInt16LE(41, 30),
            "invalid-header-length"
        ]
    ])("rejects %s", (_label, mutate, reason) => {
        expect(decode(mutate)).toThrow(expect.objectContaining({ reason }) as Error);
    });

    it("rejects a header above the ceiling before anything else", () => {
        expect(decode((bytes) => bytes.writeUInt16LE(4000, 30), 128)).toThrow(
            expect.objectContaining({ reason: "invalid-header-length" }) as Error
        );
    });

    it("accepts the exact length each flag combination requires", () => {
        const lengthOf = (header: ContainerHeader) =>
            decodeFixedHeader(
                encodeHeader(header).subarray(0, FIXED_HEADER_BYTES),
                DEFAULT_MAX_HEADER_BYTES
            ).headerLength;

        expect(lengthOf(plainHeader())).toBe(HEADER_BYTES_PLAIN);
        expect(lengthOf(encryptedHeader())).toBe(HEADER_BYTES_ENCRYPTED);
    });

    it("rejects a KDF id it does not implement", () => {
        const bytes = Buffer.from(encodeHeader(encryptedHeader()));
        bytes.writeUInt8(2, 40);

        expect(() => decodeHeader(bytes, DEFAULT_MAX_HEADER_BYTES)).toThrow(
            expect.objectContaining({ reason: "unsupported-kdf" }) as Error
        );
    });
});

describe("scrypt parameter bounds", () => {
    it("reports the working set the ceiling is applied to", () => {
        expect(scryptMemoryBytes({ log2N: 17, r: 8, p: 1 })).toBe(134217728);
    });

    it.each([
        [ "log2N below the floor", { log2N: 9, r: 8, p: 1 } ],
        [ "log2N above the ceiling", { log2N: 21, r: 8, p: 1 } ],
        [ "r out of range", { log2N: 14, r: 17, p: 1 } ],
        [ "p out of range", { log2N: 14, r: 8, p: 9 } ],
        [ "a non-integer", { log2N: 14.5, r: 8, p: 1 } ]
    ])("rejects %s", (_label, params) => {
        expect(() => validateScryptParams(params, 1024 ** 3)).toThrow(
            expect.objectContaining({ reason: "invalid-kdf-params" }) as Error
        );
    });

    it("rejects a cost above the memory ceiling even when every field is in range", () => {
        const ceiling = 64 * 1024 * 1024;
        const tooExpensive = () => validateScryptParams({ log2N: 20, r: 16, p: 1 }, ceiling);

        expect(tooExpensive).toThrow(BackupContainerError);
        expect(() => validateScryptParams({ log2N: 17, r: 8, p: 1 }, 134217728)).not.toThrow();
    });
});

describe("SQLite header check", () => {
    it("accepts a normal page size and the 1-means-65536 encoding", () => {
        expect(() => validateSqliteHeader(sqliteHead(4096))).not.toThrow();
        expect(() => validateSqliteHeader(sqliteHead(512))).not.toThrow();
        expect(() => validateSqliteHeader(sqliteHead(32768))).not.toThrow();
        expect(() => validateSqliteHeader(sqliteHead(1))).not.toThrow();
    });

    it.each([
        [ "a page size that is not a power of two", sqliteHead(3000) ],
        [ "a page size below the floor", sqliteHead(256) ],
        [ "output that is too short", sqliteHead(4096).subarray(0, 17) ],
        [ "a foreign magic", Buffer.concat([ Buffer.from("Not a database!!"), Buffer.alloc(2) ]) ]
    ])("rejects %s", (_label, head) => {
        expect(() => validateSqliteHeader(head))
            .toThrow(expect.objectContaining({ reason: "not-a-database" }) as Error);
    });
});

function sqliteHead(pageSize: number): Buffer {
    const head = Buffer.alloc(18);
    head.set(SQLITE_MAGIC, 0);
    head.writeUInt16BE(pageSize, 16);

    return head;
}
