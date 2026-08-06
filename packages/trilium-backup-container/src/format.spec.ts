import { describe, expect, it } from "vitest";

import { BackupContainerError } from "./errors.js";
import {
    authenticatedHeaderEnd,
    type ContainerHeader,
    decodeFixedHeader,
    decodeHeader,
    DEFAULT_MAX_HEADER_BYTES,
    digestOffset,
    encodeHeader,
    FIXED_HEADER_BYTES,
    HEADER_BYTES_ENCRYPTED,
    HEADER_BYTES_PLAIN,
    KDF_SCRYPT,
    nonceFor,
    SQLITE_MAGIC,
    scryptMemoryBytes,
    validateScryptParams,
    validateSqliteHeader
} from "./format.js";

function plainHeader(overrides: Partial<ContainerHeader> = {}): ContainerHeader {
    return {
        version: 1,
        compressed: true,
        encrypted: false,
        plaintextSize: 4096,
        headerLength: HEADER_BYTES_PLAIN,
        encryption: null,
        digest: Buffer.alloc(32, 7),
        ...overrides
    };
}

function encryptedHeader(): ContainerHeader {
    return {
        version: 1,
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
        },
        digest: Buffer.alloc(32, 4)
    };
}

describe("header layout", () => {
    it("round-trips an unencrypted header and matches the documented offsets", () => {
        const bytes = encodeHeader(plainHeader());

        expect(bytes).toHaveLength(64);
        expect(bytes.subarray(0, 20).toString("ascii")).toBe("Trilium Notes Backup");
        expect(bytes.readUInt8(20)).toBe(1);
        expect(bytes.readUInt8(21)).toBe(0b01);
        expect(bytes.readUInt16LE(22)).toBe(64);
        expect(bytes.readBigUInt64LE(24)).toBe(4096n);
        expect(digestOffset(64)).toBe(32);

        const decoded = decodeHeader(bytes, DEFAULT_MAX_HEADER_BYTES);
        expect(decoded).toMatchObject({
            version: 1,
            compressed: true,
            encrypted: false,
            plaintextSize: 4096
        });
        expect(decoded.encryption).toBeNull();
        expect(decoded.digest.equals(Buffer.alloc(32, 7))).toBe(true);
    });

    it("round-trips an encrypted header, with the tag and digest as the last two fields", () => {
        const header = encryptedHeader();
        const bytes = encodeHeader(header);

        expect(bytes).toHaveLength(108);
        expect(bytes.readUInt8(21)).toBe(0b10);
        expect(bytes.readUInt8(32)).toBe(KDF_SCRYPT);
        const params = [ bytes.readUInt8(33), bytes.readUInt8(34), bytes.readUInt8(35) ];
        expect(params).toEqual([ 17, 8, 1 ]);
        expect(authenticatedHeaderEnd(108)).toBe(60);
        expect(digestOffset(108)).toBe(76);

        const decoded = decodeHeader(bytes, DEFAULT_MAX_HEADER_BYTES);
        expect(decoded.encryption).toMatchObject({ kdfId: KDF_SCRYPT, log2N: 17, r: 8, p: 1 });
        expect(decoded.encryption?.salt.equals(Buffer.alloc(16, 1))).toBe(true);
        expect(decoded.encryption?.verifierTag.equals(Buffer.alloc(16, 3))).toBe(true);
        expect(decoded.plaintextSize).toBe(123456789);
    });

    it("treats an unrepresentable plaintext size as unknown, so it can never widen a bound", () => {
        const bytes = encodeHeader(plainHeader());
        bytes.writeBigUInt64LE(2n ** 63n, 24);

        expect(decodeHeader(bytes, DEFAULT_MAX_HEADER_BYTES).plaintextSize).toBe(0);
    });

    it("builds a distinct 12-byte nonce per counter", () => {
        const prefix = Buffer.alloc(8, 9);

        expect(nonceFor(prefix, 0)).toHaveLength(12);
        expect(nonceFor(prefix, 0).equals(nonceFor(prefix, 1))).toBe(false);
        expect(nonceFor(prefix, 0xffffffff).subarray(8).toString("hex")).toBe("ffffffff");
    });
});

describe("fixed header validation", () => {
    const decode = (mutate: (bytes: Buffer) => void, max = DEFAULT_MAX_HEADER_BYTES) => {
        const bytes = encodeHeader(plainHeader()).subarray(0, FIXED_HEADER_BYTES);
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
            (bytes: Buffer) => bytes.writeUInt8(0b100, 21),
            "unsupported-flags"
        ],
        [
            "a header length that does not match the flags",
            (bytes: Buffer) => bytes.writeUInt16LE(65, 22),
            "invalid-header-length"
        ]
    ])("rejects %s", (_label, mutate, reason) => {
        expect(decode(mutate)).toThrow(expect.objectContaining({ reason }) as Error);
    });

    it("rejects a header above the ceiling before anything else", () => {
        expect(decode((bytes) => bytes.writeUInt16LE(4000, 22), 128)).toThrow(
            expect.objectContaining({ reason: "invalid-header-length" }) as Error
        );
    });

    it("accepts the exact length each flag combination requires", () => {
        const lengthOf = (header: ContainerHeader) =>
            decodeFixedHeader(
                encodeHeader(header).subarray(0, 32),
                DEFAULT_MAX_HEADER_BYTES
            ).headerLength;

        expect(lengthOf(plainHeader())).toBe(64);
        expect(lengthOf(encryptedHeader())).toBe(108);
    });

    it("rejects a KDF id it does not implement", () => {
        const bytes = encodeHeader(encryptedHeader());
        bytes.writeUInt8(2, 32);

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
    SQLITE_MAGIC.copy(head, 0);
    head.writeUInt16BE(pageSize, 16);

    return head;
}
