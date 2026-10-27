import type { ZipEntry, ZipSource } from "@triliumnext/core/src/services/zip_provider.js";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import BrowserZipProvider from "./zip_provider.js";

const provider = new BrowserZipProvider();

function makeZip(files: Record<string, string>): Uint8Array {
    const entries: Record<string, Uint8Array> = {};
    for (const [name, content] of Object.entries(files)) {
        entries[name] = strToU8(content);
    }
    return zipSync(entries);
}

async function readAll(source: ZipSource, encoding?: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    await provider.readZipFile(source, async (entry: ZipEntry, readContent) => {
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
    it("readZipFile rejects a { path } source", async () => {
        await expect(provider.readZipFile({ path: "/tmp/x.zip" }, async () => {})).rejects.toThrow(
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

describe("BrowserZipProvider Blob sources", () => {
    it("reads the same entries and names from a Blob as from the bytes", async () => {
        const zip = makeLegacyZip([
            { placeholder: "AB.txt", nameBytes: GBK_NAME_BYTES },
            { placeholder: "Café.txt" }
        ]);
        const blobSource = { blob: new Blob([ zip ]) };

        expect(await provider.detectFilenameEncoding(blobSource)).toBe("gbk");
        expect(await readAll(blobSource, "gbk")).toEqual(await readAll(zip, "gbk"));
    });

    it("reads one byte range at a time, never the whole archive", async () => {
        const entries: Record<string, string> = {};
        for (let i = 0; i < 8; i++) {
            entries[`note-${i}.txt`] = incompressibleText(40_000, i + 1);
        }
        const zip = makeZip(entries);
        const blob = new Blob([ zip ]);
        const slice = vi.spyOn(blob, "slice");

        expect(await readAll({ blob })).toEqual(entries);
        // Bigger than the tail the reader fetches to find the end-of-central-directory record.
        expect(blob.size).toBeGreaterThan(2 * 0x10000);

        expect(slice).toHaveBeenCalled();
        for (const [ start = 0, end = blob.size ] of slice.mock.calls) {
            expect(end - start).toBeLessThan(blob.size / 2);
        }
    });

    it("reads nothing past the central directory until an entry's content is asked for", async () => {
        const zip = makeZip({ "a.txt": "a".repeat(50_000), "b.txt": "b" });
        const blob = new Blob([ zip ]);
        const slice = vi.spyOn(blob, "slice");

        const names: string[] = [];
        await provider.readZipFile({ blob }, async (entry) => { names.push(entry.fileName); });

        expect(names).toEqual([ "a.txt", "b.txt" ]);
        // The tail holding the end-of-central-directory record, then the directory itself.
        expect(slice).toHaveBeenCalledTimes(2);
    });
});

describe("BrowserZipProvider entry formats", () => {
    it("reads a stored (uncompressed) entry", async () => {
        const zip = zipSync({ "plain.txt": [ strToU8("as is"), { level: 0 } ] });
        expect(await readAll(zip)).toEqual({ "plain.txt": "as is" });

        const withExtraField = zipSync({ "plain.txt": [ strToU8("as is"), { level: 0, extra: { 0x5455: new Uint8Array([ 1 ]) } } ] });
        expect(await readAll(withExtraField)).toEqual({ "plain.txt": "as is" });
    });

    it("reads a ZIP64 archive, whose sizes and offsets are in 64-bit records", async () => {
        expect(await readAll(makeZip64("big.txt", "sixty-four"))).toEqual({ "big.txt": "sixty-four" });
        expect(await readAll({ blob: new Blob([ makeZip64("big.txt", "sixty-four") ]) })).toEqual({ "big.txt": "sixty-four" });
        expect(await readAll(makeZip64("big.txt", "sixty-four", 0xffff))).toEqual({ "big.txt": "sixty-four" });
    });

    it("rejects a central directory that stops short instead of importing the entries before the damage", async () => {
        const zip = makeZip({ "a.txt": "x", "b.txt": "y" });
        const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
        const headers: number[] = [];
        for (let i = 0; i + 4 <= zip.length; i++) {
            if (view.getUint32(i, true) === 0x02014b50) {
                headers.push(i);
            }
        }
        expect(headers).toHaveLength(2);
        view.setUint32(headers[1] ?? 0, 0, true);

        await expect(readNames(zip)).rejects.toThrow("Corrupt ZIP: the central directory ends in an unreadable record.");
    });

    it("rejects an archive whose directory records point outside the file", async () => {
        const zip64 = makeZip64("big.txt", "sixty-four");
        const zip64View = new DataView(zip64.buffer);
        zip64View.setUint32(zip64.length - 22 - 20 - 56, 0, true);
        await expect(readNames(zip64)).rejects.toThrow("the ZIP64 end-of-central-directory record is missing");

        const directoryPastEnd = makeZip({ "a.txt": "x" });
        new DataView(directoryPastEnd.buffer).setUint32(directoryPastEnd.length - 22 + 16, 0x7fffffff, true);
        await expect(readNames(directoryPastEnd)).rejects.toThrow("the central directory lies past the end of the file");

        const recordPastDirectory = patchCentralHeader(makeZip({ "a.txt": "x" }), (view, at) => view.setUint16(at + 30, 0xffff, true));
        await expect(readNames(recordPastDirectory)).rejects.toThrow("a central directory record runs past the directory");

        await expect(readNames(new Uint8Array(64))).rejects.toThrow("Truncated ZIP: no end-of-central-directory record.");
    });

    it("rejects entry content that lies outside the file", async () => {
        const shortZip64Extra = makeZip64("big.txt", "sixty-four");
        const extraSizeField = 30 + 7 + 10 + 46 + 7 + 2;
        new DataView(shortZip64Extra.buffer).setUint16(extraSizeField, 8, true);
        await expect(readAll(shortZip64Extra)).rejects.toThrow("Corrupt ZIP: an entry's local header is missing.");

        const truncated = patchCentralHeader(makeZip({ "a.txt": "x" }), (view, at) => view.setUint32(at + 20, 0xffff, true));
        await expect(readAll(truncated)).rejects.toThrow("Truncated ZIP: an entry's data runs past the end of the file.");
    });

    it("keeps an unflagged name that decodes in no encoding as one character per byte", async () => {
        const zip = makeLegacyZip([{ placeholder: "A", nameBytes: [0xfe] }]);
        expect(await readNames(zip, "x-unknown-encoding")).toEqual([ "þ" ]);
    });

    it("rejects an entry it cannot read, but only when its content is asked for", async () => {
        const unsupported = patchCentralHeader(makeZip({ "a.txt": "x" }), (view, at) => view.setUint16(at + 10, 12, true));
        const encrypted = patchCentralHeader(makeZip({ "a.txt": "x" }), (view, at) => view.setUint16(at + 8, view.getUint16(at + 8, true) | 1, true));

        expect(await readNames(unsupported)).toEqual([ "a.txt" ]);
        await expect(readAll(unsupported)).rejects.toThrow("Unsupported ZIP compression method 12.");
        await expect(readAll(encrypted)).rejects.toThrow("Encrypted ZIP entries are not supported.");
    });
});

/** Letters from a fixed-seed generator, which deflate cannot shrink much. */
function incompressibleText(length: number, seed: number): string {
    let state = seed;
    let text = "";
    for (let i = 0; i < length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        text += String.fromCharCode(97 + state % 26);
    }
    return text;
}

/** Applies `patch` to the first central directory header in `zip`, at the header's offset. */
function patchCentralHeader(zip: Uint8Array, patch: (view: DataView, offset: number) => void): Uint8Array {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i + 4 <= zip.length; i++) {
        if (view.getUint32(i, true) === 0x02014b50) {
            patch(view, i);
            return zip;
        }
    }
    throw new Error("No central directory header found.");
}

/**
 * Builds a one-entry stored archive in ZIP64 form: every size and offset in the classic records is
 * saturated, and the real values sit in the entry's ZIP64 extra field and the ZIP64 end record.
 * The archive comment is `commentLength` spaces.
 */
function makeZip64(name: string, content: string, commentLength = 0): Uint8Array {
    const nameBytes = strToU8(name);
    const data = strToU8(content);
    const SATURATED = 0xffffffff;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 45, true);
    local.setUint32(18, SATURATED, true);
    local.setUint32(22, SATURATED, true);
    local.setUint16(26, nameBytes.length, true);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 45, true);
    central.setUint16(6, 45, true);
    central.setUint32(20, SATURATED, true);
    central.setUint32(24, SATURATED, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 28, true);
    central.setUint32(42, SATURATED, true);

    const extra = new DataView(new ArrayBuffer(28));
    extra.setUint16(0, 0x0001, true);
    extra.setUint16(2, 24, true);
    extra.setBigUint64(4, BigInt(data.length), true);
    extra.setBigUint64(12, BigInt(data.length), true);
    extra.setBigUint64(20, 0n, true);

    const directoryOffset = 30 + nameBytes.length + data.length;
    const directorySize = 46 + nameBytes.length + 28;
    const zip64EndOffset = directoryOffset + directorySize;

    const zip64End = new DataView(new ArrayBuffer(56));
    zip64End.setUint32(0, 0x06064b50, true);
    zip64End.setBigUint64(4, 44n, true);
    zip64End.setBigUint64(24, 1n, true);
    zip64End.setBigUint64(32, 1n, true);
    zip64End.setBigUint64(40, BigInt(directorySize), true);
    zip64End.setBigUint64(48, BigInt(directoryOffset), true);

    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, 0x07064b50, true);
    locator.setBigUint64(8, BigInt(zip64EndOffset), true);
    locator.setUint32(16, 1, true);

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, 0xffff, true);
    end.setUint16(10, 0xffff, true);
    end.setUint32(12, SATURATED, true);
    end.setUint32(16, SATURATED, true);
    end.setUint16(20, commentLength, true);

    const comment = new Uint8Array(commentLength).fill(0x20);
    const parts = [ local, nameBytes, data, central, nameBytes, extra, zip64End, locator, end, comment ]
        .map((part) => part instanceof DataView ? new Uint8Array(part.buffer) : part);
    const zip = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        zip.set(part, offset);
        offset += part.length;
    }
    return zip;
}
