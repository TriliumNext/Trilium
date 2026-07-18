import type { ZipEntry } from "@triliumnext/core/src/services/zip_provider.js";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import BrowserZipProvider from "./zip_provider.js";

const provider = new BrowserZipProvider();

function makeZip(files: Record<string, string>): Uint8Array {
    const entries: Record<string, Uint8Array> = {};
    for (const [name, content] of Object.entries(files)) {
        entries[name] = strToU8(content);
    }
    return zipSync(entries);
}

async function readAll(buffer: Uint8Array, encoding?: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    await provider.readZipFile(buffer, async (entry: ZipEntry, readContent) => {
        out[entry.fileName] = new TextDecoder().decode(await readContent());
    }, encoding);
    return out;
}

async function readNames(buffer: Uint8Array, encoding?: string): Promise<string[]> {
    const names: string[] = [];
    await provider.readZipFile(buffer, async (entry: ZipEntry) => { names.push(entry.fileName); }, encoding);
    return names;
}

describe("BrowserZipArchive", () => {
    it("appends string and binary entries and sends them to a send()-style destination", async () => {
        const archive = provider.createZipArchive();
        archive.append("hello", { name: "a.txt" });
        archive.append(new Uint8Array([1, 2, 3]), { name: "b.bin" });

        let sent: Uint8Array | undefined;
        archive.pipe({ send: (body: unknown) => { sent = body as Uint8Array; } });
        await archive.finalize();

        expect(sent).toBeInstanceOf(Uint8Array);
        const unzipped = unzipSync(sent ?? new Uint8Array());
        expect(new TextDecoder().decode(unzipped["a.txt"])).toBe("hello");
        expect(Array.from(unzipped["b.bin"])).toEqual([1, 2, 3]);
    });

    it("uses write()+end() when the destination is a stream", async () => {
        const archive = provider.createZipArchive();
        archive.append("x", { name: "f.txt" });

        const chunks: Uint8Array[] = [];
        let ended = false;
        archive.pipe({
            write: (chunk: Uint8Array) => { chunks.push(chunk); },
            end: () => { ended = true; }
        });
        await archive.finalize();

        expect(ended).toBe(true);
        expect(chunks).toHaveLength(1);
    });

    it("uses end(content) when only end() is available", async () => {
        const archive = provider.createZipArchive();
        archive.append("x", { name: "f.txt" });

        let body: Uint8Array | undefined;
        archive.pipe({ end: (chunk?: Uint8Array) => { body = chunk; } });
        await archive.finalize();

        expect(body).toBeInstanceOf(Uint8Array);
    });

    it("throws when finalized without a destination", async () => {
        const archive = provider.createZipArchive();
        await expect(archive.finalize()).rejects.toThrow("ZIP output destination not set.");
    });

    it("throws for an unsupported destination", async () => {
        const archive = provider.createZipArchive();
        archive.pipe({});
        await expect(archive.finalize()).rejects.toThrow("Unsupported ZIP output destination.");
    });
});

describe("BrowserZipArchive store + backpressure", () => {
    it("round-trips an entry appended with store: true (uncompressed)", async () => {
        const archive = provider.createZipArchive();
        archive.append("already-compressed", { name: "image.jpg", store: true });

        let sent: Uint8Array | undefined;
        archive.pipe({ send: (body: unknown) => { sent = body as Uint8Array; } });
        await archive.finalize();

        const unzipped = unzipSync(sent ?? new Uint8Array());
        expect(new TextDecoder().decode(unzipped["image.jpg"])).toBe("already-compressed");
    });

    it("waitForCapacity resolves immediately (the browser builds the archive in memory)", async () => {
        const archive = provider.createZipArchive();
        await expect(archive.waitForCapacity?.()).resolves.toBeUndefined();
    });
});

describe("BrowserZipProvider path sources are unsupported", () => {
    it("readZipFile throws for a { path } source", () => {
        // readZipFile isn't async, so the guard throws synchronously before the work promise is created;
        // real callers await it inside an async function, where the throw surfaces as a rejection anyway.
        expect(() => provider.readZipFile({ path: "/tmp/x.zip" }, async () => {})).toThrow(
            "Path-based zip reading is not supported in the browser"
        );
    });

    it("detectFilenameEncoding rejects a { path } source", async () => {
        await expect(provider.detectFilenameEncoding({ path: "/tmp/x.zip" })).rejects.toThrow(
            "Path-based zip reading is not supported in the browser"
        );
    });
});

describe("BrowserZipProvider.createFileStream", () => {
    it("is unsupported in the browser", () => {
        expect(() => provider.createFileStream("/tmp/x")).toThrow("File stream creation is not supported");
    });
});

describe("BrowserZipProvider.readZipFile", () => {
    it("reads entries and decodes their names", async () => {
        const zip = makeZip({ "one.txt": "first", "dir/two.txt": "second" });
        const result = await readAll(zip);
        expect(result).toEqual({ "one.txt": "first", "dir/two.txt": "second" });
    });

    it("rejects on a corrupt archive", async () => {
        const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        await expect(provider.readZipFile(garbage, async () => {})).rejects.toBeDefined();
    });

    it("propagates errors thrown while processing an entry", async () => {
        const zip = makeZip({ "one.txt": "first" });
        await expect(
            provider.readZipFile(zip, async () => { throw new Error("processing failed"); })
        ).rejects.toThrow("processing failed");
    });
});

describe("BrowserZipProvider.detectFilenameEncoding", () => {
    it("returns utf-8 when all filenames are valid UTF-8", async () => {
        const zip = makeZip({ "plain.txt": "x" });
        expect(await provider.detectFilenameEncoding(zip)).toBe("utf-8");
    });

    it("detects GBK when a filename's raw bytes are a valid GBK pair", async () => {
        // "°¡" round-trips through fflate as char codes 0xB0/0xA1, whose raw bytes
        // [0xB0, 0xA1] are invalid UTF-8 but a valid GBK character.
        const zip = makeZip({ "°¡.txt": "x" });
        expect(await provider.detectFilenameEncoding(zip)).toBe("gbk");
    });

    it("skips a failing candidate and detects a later one", async () => {
        // "°.txt" → raw bytes [0xB0, 0x2E, ...]: 0x2E is an invalid GBK trail
        // (so GBK is skipped), but 0xB0 is a valid single-byte Shift_JIS katakana.
        const zip = makeZip({ "°.txt": "x" });
        expect(await provider.detectFilenameEncoding(zip)).toBe("shift_jis");
    });

    it("falls back to utf-8 when no candidate encoding matches", async () => {
        // Raw byte 0xFE is invalid UTF-8 and an incomplete/invalid lead byte in
        // every CJK candidate (GBK/Shift_JIS/EUC-KR/Big5), so detection gives up.
        const zip = makeZip({ [String.fromCharCode(0xfe)]: "x" });
        expect(await provider.detectFilenameEncoding(zip)).toBe("utf-8");
    });

    it("rejects when the archive cannot be read during detection", async () => {
        await expect(provider.detectFilenameEncoding(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toBeDefined();
    });

    it("skips a candidate encoding that TextDecoder cannot construct", async () => {
        const RealTextDecoder = globalThis.TextDecoder;
        globalThis.TextDecoder = function (label?: string, opts?: TextDecoderOptions) {
            if (label === "gbk") {
                throw new RangeError("unsupported encoding");
            }
            return new RealTextDecoder(label, opts);
        } as unknown as typeof TextDecoder;
        try {
            const zip = makeZip({ [String.fromCharCode(0xfe)]: "x" });
            expect(await provider.detectFilenameEncoding(zip)).toBe("utf-8");
        } finally {
            globalThis.TextDecoder = RealTextDecoder;
        }
    });
});

describe("BrowserZipProvider filename re-decoding", () => {
    it("retries with utf-8 when the requested encoding cannot be constructed", async () => {
        // An unknown encoding makes the primary TextDecoder throw; the ASCII name
        // is then recovered via the utf-8 fallback.
        const names = await readNames(makeZip({ "plain.txt": "x" }), "x-unknown-encoding");
        expect(names).toEqual(["plain.txt"]);
    });

    it("returns the raw name when both the requested encoding and utf-8 fail", async () => {
        const names = await readNames(makeZip({ "þ.txt": "x" }), "x-unknown-encoding");
        expect(names).toEqual(["þ.txt"]);
    });

    it("returns the raw name when no encoding is given and utf-8 fails", async () => {
        const names = await readNames(makeZip({ "þ.txt": "x" }));
        expect(names).toEqual(["þ.txt"]);
    });
});
