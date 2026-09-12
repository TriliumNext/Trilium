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

/**
 * Builds a ZIP whose entry names are raw bytes with the language-encoding flag (general purpose bit 11)
 * *clear* — what a legacy Windows archiver writes for a non-ASCII name, and the only case the encoding
 * detection is meant to rescue. fflate always writes UTF-8 and sets that flag, so the names are patched
 * in afterwards: each replacement must be the same byte length as its ASCII placeholder so every header
 * offset stays valid (the file name is not covered by the CRC or the recorded sizes). An entry given no
 * `nameBytes` is left exactly as fflate wrote it, so one archive can mix both conventions.
 */
function makeLegacyZip(entries: { placeholder: string; nameBytes?: number[] }[]): Uint8Array {
    const zip = zipSync(Object.fromEntries(entries.map(({ placeholder }) => [placeholder, strToU8("x")])));
    const byPlaceholder = new Map(
        entries.flatMap((e) => (e.nameBytes ? [[e.placeholder, e.nameBytes] as const] : []))
    );
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

    for (let i = 0; i + 4 <= zip.length; i++) {
        const signature = view.getUint32(i, true);
        const isLocalHeader = signature === 0x04034b50;
        if (!isLocalHeader && signature !== 0x02014b50) {
            continue;
        }

        // Field offsets differ between the local file header and the central directory header.
        const flagsOffset = i + (isLocalHeader ? 6 : 8);
        const nameLength = view.getUint16(i + (isLocalHeader ? 26 : 28), true);
        const nameOffset = i + (isLocalHeader ? 30 : 46);
        const name = String.fromCharCode(...zip.subarray(nameOffset, nameOffset + nameLength));
        const replacement = byPlaceholder.get(name);

        if (!replacement) {
            continue;
        }
        if (replacement.length !== nameLength) {
            throw new Error(`Replacement for '${name}' must be ${nameLength} bytes, got ${replacement.length}.`);
        }

        zip.set(replacement, nameOffset);
        view.setUint16(flagsOffset, view.getUint16(flagsOffset, true) & ~0x800, true);
    }

    return zip;
}

// "啊.txt" as a legacy Chinese-Windows archiver writes it: 0xB0 0xA1 is the GBK encoding of 啊.
const GBK_NAME_BYTES = [0xb0, 0xa1, 0x2e, 0x74, 0x78, 0x74];

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
        // Raw bytes [0xB0, 0xA1] are invalid UTF-8 but a valid GBK character.
        const zip = makeLegacyZip([{ placeholder: "AB.txt", nameBytes: GBK_NAME_BYTES }]);
        expect(await provider.detectFilenameEncoding(zip)).toBe("gbk");
    });

    it("skips a failing candidate and detects a later one", async () => {
        // Raw bytes [0xB0, 0x2E, ...]: 0x2E is an invalid GBK trail (so GBK is skipped),
        // but 0xB0 is a valid single-byte Shift_JIS katakana.
        const zip = makeLegacyZip([{ placeholder: "A.txt", nameBytes: [0xb0, 0x2e, 0x74, 0x78, 0x74] }]);
        expect(await provider.detectFilenameEncoding(zip)).toBe("shift_jis");
    });

    it("falls back to utf-8 when no candidate encoding matches", async () => {
        // Raw byte 0xFE is invalid UTF-8 and an incomplete/invalid lead byte in
        // every CJK candidate (GBK/Shift_JIS/EUC-KR/Big5), so detection gives up.
        const zip = makeLegacyZip([{ placeholder: "A", nameBytes: [0xfe] }]);
        expect(await provider.detectFilenameEncoding(zip)).toBe("utf-8");
    });

    it("does not mistake a UTF-8-flagged archive for a CJK encoding", async () => {
        // "°" is one byte in Latin-1 but two in UTF-8. Reading a flagged entry's name back as if its
        // char codes were raw bytes makes detection see invalid UTF-8, pick GBK, and then mis-decode
        // every other name in the archive.
        expect(await provider.detectFilenameEncoding(makeZip({ "40°C.txt": "x" }))).toBe("utf-8");
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

describe("BrowserZipProvider UTF-8 filenames", () => {
    it("preserves a character outside Latin-1 in a UTF-8-flagged entry name", async () => {
        // An export names its entries after note titles, so a curly apostrophe (U+2019) is routine.
        // fflate sets the language-encoding flag for such an entry and hands back an already-decoded
        // string; truncating its char codes to single bytes silently corrupts the name, which then
        // matches nothing in !!!meta.json and derails the import.
        const name = "Private Murnahan’s Holotape.html";
        expect(await readNames(makeZip({ [name]: "x" }))).toEqual([name]);
    });

    it("keeps UTF-8-flagged names intact even when the archive also needs a legacy encoding", async () => {
        // A mixed archive: one entry written by a legacy archiver (raw GBK bytes, flag clear) and one
        // written with the flag set. Detection settles on GBK for the former; the latter must not be
        // re-decoded through it.
        const zip = makeLegacyZip([
            { placeholder: "AB.txt", nameBytes: GBK_NAME_BYTES },
            { placeholder: "Café.txt" } // no nameBytes: stays as fflate wrote it, flag and all
        ]);
        const encoding = await provider.detectFilenameEncoding(zip);

        expect(encoding).toBe("gbk");
        expect((await readNames(zip, encoding)).sort()).toEqual(["Café.txt", "啊.txt"]);
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
