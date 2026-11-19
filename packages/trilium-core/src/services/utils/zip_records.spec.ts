import {
    strFromU8, strToU8, Unzip, UnzipInflate, unzipSync, Zip, ZipDeflate, zipSync
} from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
    byteSourceOf, crc32, readCentralDirectory, readEntryContent, readZipIndex, readZipPart,
    rewriteZip, type ZipDirectory, type ZipRecord, ZipRecordError
} from "./zip_records.js";

const MiB = 1024 * 1024;

describe("readCentralDirectory", () => {
    it("reads a ZIP64 archive, whose sizes and offsets are in 64-bit records", async () => {
        const zip64 = makeZip64("big.txt", "sixty-four");
        const directory = await readCentralDirectory(byteSourceOf(zip64));
        const otherExtra = zipSync({
            "a.txt": [ strToU8("x"), { extra: { 0x5455: new Uint8Array([ 1 ]) } } ]
        });

        expect([ directory.isZip64, directory.records[0].isZip64 ]).toStrictEqual([ true, true ]);
        expect(await readTexts(zip64)).toStrictEqual({ "big.txt": "sixty-four" });
        expect(await readTexts(makeZip64("big.txt", "sixty-four", 0xffff)))
            .toStrictEqual({ "big.txt": "sixty-four" });
        expect(await readTexts(otherExtra)).toStrictEqual({ "a.txt": "x" });
    });

    it("refuses a directory that is cut, lies past the file or ends in an unreadable record",
        async () => {
        const zip64 = makeZip64("big.txt", "sixty-four");
        const zip64End = zip64.length - 22 - 20 - 56;
        const noZip64End = zip64.slice();
        viewOf(noZip64End).setUint32(zip64End, 0, true);
        const zip64EndPastFile = zip64.slice();
        viewOf(zip64EndPastFile).setBigUint64(zip64End + 56 + 8, BigInt(zip64.length - 8), true);
        const twoEntries = () => zipSync({ "a.txt": strToU8("x"), "b.txt": strToU8("y") });
        const pastFile = patchEnd(twoEntries(), (view, at) =>
            view.setUint32(at + 16, 0x7fffffff, true));
        const recordPastDirectory = patchCentral(twoEntries(), (view, at) =>
            view.setUint16(at + 30, 0xffff, true));
        // The second record, after the 46 bytes and the name of the first.
        const stopsShort = patchCentral(twoEntries(), (view, at) =>
            view.setUint32(at + 46 + "a.txt".length, 0, true));
        const endsInPart = patchEnd(twoEntries(), (view, at) =>
            view.setUint32(at + 12, view.getUint32(at + 12, true) + 2, true));
        const read = (zip: Uint8Array) => readCentralDirectory(byteSourceOf(zip));

        await expect(read(new Uint8Array(21))).rejects.toThrow("no end-of-central-directory");
        await expect(read(new Uint8Array(64))).rejects.toThrow("no end-of-central-directory");
        await expect(read(noZip64End)).rejects.toThrow("ZIP64 end-of-central-directory record");
        await expect(read(zip64EndPastFile))
            .rejects.toThrow("ZIP64 end-of-central-directory record");
        await expect(read(pastFile)).rejects.toThrow("the central directory lies past the end");
        await expect(read(recordPastDirectory)).rejects.toThrow("runs past the directory");
        await expect(read(stopsShort)).rejects.toThrow("ends in an unreadable record");
        await expect(read(endsInPart)).rejects.toThrow("ends in an unreadable record");
        expect((await read(withDigitalSignature(twoEntries()))).records).toHaveLength(2);
    });
});

describe("readEntryContent", () => {
    it("reads deflated and stored entries, and an empty one", async () => {
        const zip = zipSync({
            "a.txt": strToU8("deflated text"),
            "b.txt": [ strToU8("stored text"), { level: 0 } ],
            "empty.txt": new Uint8Array(0)
        });
        expect(await readTexts(zip)).toStrictEqual({
            "a.txt": "deflated text", "b.txt": "stored text", "empty.txt": ""
        });
    });

    it("tells apart the reasons why an entry cannot be read", async () => {
        const text = "a line of text that deflate shrinks well. ".repeat(100);
        const shorter = patchCentral(zipSync({ "a.txt": strToU8(text) }), (view, at) =>
            view.setUint32(at + 24, 10, true));
        const longer = patchCentral(zipSync({ "a.txt": strToU8(text) }), (view, at) =>
            view.setUint32(at + 24, text.length + 1, true));
        const storedSizes = patchCentral(zipSync({ "a.txt": [ strToU8(text), { level: 0 } ] }),
            (view, at) => view.setUint32(at + 24, text.length - 1, true));
        const altered = zipSync({ "a.txt": [ strToU8(text), { level: 0 } ] });
        altered[readDataStart(altered)] ^= 1;
        // A deflate block of the reserved type 3.
        const reserved = new Uint8Array([ 7, 0, 0 ]);
        const notDeflate = patchCentral(zipSync({ "a.txt": [ reserved, { level: 0 } ] }),
            (view, at) => view.setUint16(at + 10, 8, true));

        const encrypted = patchCentral(zipSync({ "a.txt": strToU8(text) }), (view, at) =>
            view.setUint16(at + 8, view.getUint16(at + 8, true) | 1, true));
        const method = patchCentral(zipSync({ "a.txt": strToU8(text) }), (view, at) =>
            view.setUint16(at + 10, 12, true));

        expect(await readFailure(shorter)).toBe("LENGTH");
        expect(await readFailure(longer)).toBe("LENGTH");
        expect(await readFailure(altered)).toBe("CRC");
        expect(await readFailure(notDeflate)).toBe("DEFLATE");
        expect(await readFailure(encrypted)).toBe("ENCRYPTED_ENTRY");
        expect(await readFailure(method)).toBe("METHOD");

        // A stored entry whose sizes differ is refused before its data is read.
        const source = byteSourceOf(storedSizes);
        const [ record ] = (await readCentralDirectory(source)).records;
        const read = vi.spyOn(source, "read");
        await expect(readEntryContent(source, record)).rejects.toMatchObject({ reason: "LENGTH" });
        expect(read).not.toHaveBeenCalled();
    });

    it("refuses an entry whose local header or data lies outside the file", async () => {
        const offsetNotInExtra = makeZip64("big.txt", "sixty-four");
        // The extra field has both sizes, but not the saturated offset of the local header.
        viewOf(offsetNotInExtra).setUint16(30 + 7 + 10 + 46 + 7 + 2, 16, true);
        const misplaced = patchCentral(zipSync({ "a.txt": strToU8("x") }), (view, at) =>
            view.setUint32(at + 42, 1, true));
        const cut = patchCentral(zipSync({ "a.txt": strToU8("x") }), (view, at) =>
            view.setUint32(at + 20, 0xffff, true));

        await expect(readTexts(offsetNotInExtra)).rejects.toThrow("local header is missing");
        await expect(readTexts(misplaced)).rejects.toThrow("local header is missing");
        await expect(readTexts(cut)).rejects.toThrow("data runs past the end of the file");
    });

    it("stops a bomb declared at 1 MiB once its output passes 1 MiB", async () => {
        const bomb = patchCentral(zipSync({ "bomb.bin": new Uint8Array(16 * MiB) }), (view, at) =>
            view.setUint32(at + 24, MiB, true));
        const source = byteSourceOf(bomb);
        const [ record ] = (await readCentralDirectory(source)).records;

        await expect(readEntryContent(source, record)).rejects.toMatchObject({ reason: "LENGTH" });
    });
});

describe("readZipIndex and readZipPart", () => {
    it("name each record once, by its first, and decode only a flagged name as UTF-8", async () => {
        const zip = zipSync({
            "café.txt": strToU8("c"), "a.txt": strToU8("first"), "b.txt": strToU8("second")
        });
        const directory = await readCentralDirectory(byteSourceOf(zip));
        const cafe = findRecord(directory, "café.txt");
        expect([ ...(await readZipIndex(zip)).records.keys() ])
            .toStrictEqual([ "café.txt", "a.txt", "b.txt" ]);

        viewOf(zip).setUint16(cafe.centralOffset + 8, cafe.flags & ~0x800, true);
        // Renames `b.txt` to `a.txt`, after the real one.
        zip[findRecord(directory, "b.txt").centralOffset + 46] = "a".charCodeAt(0);
        const index = await readZipIndex(zip);

        expect([ ...index.records.keys() ]).toStrictEqual([ "caf\u{c3}\u{a9}.txt", "a.txt" ]);
        expect(index.directory.records).toHaveLength(3);
        const part = await readZipPart(zip, "a.txt", MiB);
        expect(strFromU8(part ?? new Uint8Array(0))).toBe("first");
    });

    it("read nothing for a missing part, and refuse a long, altered or broken one", async () => {
        const zip = zipSync({ "a.txt": [ strToU8("text"), { level: 0 } ] });
        expect(await readZipPart(zip, "b.txt", MiB)).toBeUndefined();
        await expect(readZipPart(zip, "a.txt", 3))
            .rejects.toMatchObject({ reason: "ENTRY_TOO_LARGE" });
        expect(await readZipPart(zip, "a.txt", 4)).toBeDefined();

        zip[readDataStart(zip)] ^= 1;
        await expect(readZipPart(zip, "a.txt", MiB)).rejects.toMatchObject({ reason: "CRC" });
        await expect(readZipPart(new Uint8Array(64), "a.txt", MiB))
            .rejects.toMatchObject({ reason: "DIRECTORY" });
    });
});

describe("rewriteZip", () => {
    it("copies unchanged entries byte for byte and deflates the changed one", async () => {
        const image = new Uint8Array(5000).map((_, index) => (index * 7919) % 251);
        const zip = zipSync({
            mimetype: [ strToU8("application/epub+zip"), { level: 0 } ],
            "a.xhtml": strToU8("<p>Chapter</p>"),
            "image.png": image,
            "b.xhtml": strToU8("<p>Other</p>")
        });
        const directory = await readCentralDirectory(byteSourceOf(zip));
        const changed = findRecord(directory, "a.xhtml");

        const rewritten = rewriteZip(zip, directory,
            new Map([ [ changed, strToU8("<p><a id=\"m\"></a>Chapter</p>") ] ]), MiB);

        expect(Object.keys(unzipSync(rewritten))).toStrictEqual(
            [ "mimetype", "a.xhtml", "image.png", "b.xhtml" ]);
        expect(await readTexts(rewritten)).toMatchObject({
            "a.xhtml": "<p><a id=\"m\"></a>Chapter</p>", "b.xhtml": "<p>Other</p>"
        });
        const after = await readCentralDirectory(byteSourceOf(rewritten));
        for (const name of [ "mimetype", "image.png", "b.xhtml" ]) {
            expect(readSpan(rewritten, after, name)).toStrictEqual(readSpan(zip, directory, name));
            expect(findRecord(after, name).compressionMethod)
                .toBe(findRecord(directory, name).compressionMethod);
        }
        const record = findRecord(after, "a.xhtml");
        expect(record.compressionMethod).toBe(8);
        expect(record.crc32).toBe(crc32(strToU8("<p><a id=\"m\"></a>Chapter</p>")));
    });

    it("writes a changed entry without a data descriptor, keeping the others' ones", async () => {
        const zip = zipStreaming({ "a.xhtml": "<p>Changed</p>", "b.xhtml": "<p>Kept</p>" });
        const directory = await readCentralDirectory(byteSourceOf(zip));
        expect(directory.records.every(({ flags }) => flags & 0x8)).toBe(true);

        const rewritten = rewriteZip(zip, directory,
            new Map([ [ findRecord(directory, "a.xhtml"), strToU8("<p>Changed again</p>") ] ]),
            MiB);

        const after = await readCentralDirectory(byteSourceOf(rewritten));
        const changed = findRecord(after, "a.xhtml");
        expect(changed.flags & 0x8).toBe(0);
        expect(new DataView(rewritten.buffer).getUint16(changed.localHeaderOffset + 6, true) & 0x8)
            .toBe(0);
        expect(findRecord(after, "b.xhtml").flags & 0x8).toBe(0x8);
        expect(readSpan(rewritten, after, "b.xhtml"))
            .toStrictEqual(readSpan(zip, directory, "b.xhtml"));

        const expected = { "a.xhtml": "<p>Changed again</p>", "b.xhtml": "<p>Kept</p>" };
        expect(await readTexts(rewritten)).toStrictEqual(expected);
        expect(readStreaming(rewritten)).toStrictEqual(expected);
    });

    it("refuses ZIP64 archives, overlapping entries and an archive past its limit", async () => {
        const zip = zipSync({ "a.xhtml": strToU8("<p>A</p>"), "b.xhtml": strToU8("<p>B</p>") });
        const directory = await readCentralDirectory(byteSourceOf(zip));
        const noise = new Uint8Array(300).map((_, index) => (index * 7919) % 251);
        const replacements = new Map([ [ findRecord(directory, "a.xhtml"), noise ] ]);

        expect(rewriteFailure(zip, { ...directory, isZip64: true }, replacements)).toBe("ZIP64");
        const overlapping = { ...directory, records: directory.records.map((record) =>
            ({ ...record, localHeaderOffset: directory.records[0].localHeaderOffset })) };
        expect(rewriteFailure(zip, overlapping, new Map())).toBe("ENTRY_ORDER");
        expect(rewriteFailure(zip, directory, replacements, zip.byteLength + 100))
            .toBe("OUTPUT_TOO_LARGE");
        expect(rewriteZip(zip, directory, replacements, zip.byteLength + 1000).byteLength)
            .toBeGreaterThan(zip.byteLength + 100);

        // The first local header is at offset 0; its sizes are at 18 and 22.
        const saturated = (field: number) => {
            const copy = zip.slice();
            viewOf(copy).setUint32(field, 0xffffffff, true);
            return copy;
        };
        expect(rewriteFailure(saturated(18), directory, new Map())).toBe("ZIP64");
        expect(rewriteFailure(saturated(22), directory, new Map())).toBe("ZIP64");
        const longer = { ...directory, records: directory.records.map((record, index) =>
            (index === 0 ? { ...record, compressedSize: record.compressedSize + 1 } : record)) };
        expect(() => rewriteZip(zip, longer, new Map(), MiB)).toThrow("two entries overlap");
    });

    it("rewrites an archive without entries as it is", async () => {
        const empty = zipSync({});
        const directory = await readCentralDirectory(byteSourceOf(empty));

        expect(rewriteZip(empty, directory, new Map(), MiB)).toStrictEqual(empty);
    });
});

describe("crc32", () => {
    it("computes ZIP's checksum", () => {
        expect(crc32(strToU8("123456789"))).toBe(0xcbf43926);
        expect(crc32(new Uint8Array(0))).toBe(0);
    });
});

async function readTexts(zip: Uint8Array) {
    const source = byteSourceOf(zip);
    const texts: Record<string, string> = {};
    for (const record of (await readCentralDirectory(source)).records) {
        texts[strFromU8(record.rawName)] = strFromU8(await readEntryContent(source, record));
    }
    return texts;
}

async function readFailure(zip: Uint8Array) {
    const source = byteSourceOf(zip);
    const [ record ] = (await readCentralDirectory(source)).records;
    try {
        await readEntryContent(source, record);
    } catch (error) {
        return error instanceof ZipRecordError ? error.reason : error;
    }
    return "read";
}

function rewriteFailure(
    zip: Uint8Array, directory: ZipDirectory, replacements: Map<ZipRecord, Uint8Array>,
    maxLength = MiB
) {
    try {
        rewriteZip(zip, directory, replacements, maxLength);
    } catch (error) {
        return error instanceof ZipRecordError ? error.reason : error;
    }
    return "rewritten";
}

function findRecord(directory: ZipDirectory, name: string) {
    const record = directory.records.find(({ rawName }) => strFromU8(rawName) === name);
    if (!record) {
        throw new Error(`No entry '${name}'.`);
    }
    return record;
}

/** The bytes of the entry `name` from its local header to the next entry's. */
function readSpan(zip: Uint8Array, directory: ZipDirectory, name: string) {
    const record = findRecord(directory, name);
    const next = directory.records.map(({ localHeaderOffset }) => localHeaderOffset)
        .filter((offset) => offset > record.localHeaderOffset);
    const end = next.length > 0 ? Math.min(...next) : directory.offset;
    return zip.slice(record.localHeaderOffset, end);
}

/** The offset of the data of the first entry of `zip`, after its local header. */
function readDataStart(zip: Uint8Array) {
    const view = viewOf(zip);
    return 30 + view.getUint16(26, true) + view.getUint16(28, true);
}

/** Applies `patch` to the first central directory header of `zip`, at the header's offset. */
function patchCentral(zip: Uint8Array, patch: (view: DataView, offset: number) => void) {
    const view = viewOf(zip);
    patch(view, view.getUint32(findEnd(zip) + 16, true));
    return zip;
}

/** Applies `patch` to the end-of-central-directory record of `zip`, at the record's offset. */
function patchEnd(zip: Uint8Array, patch: (view: DataView, offset: number) => void) {
    patch(viewOf(zip), findEnd(zip));
    return zip;
}

/** The offset of the end-of-central-directory record of `zip`. */
function findEnd(zip: Uint8Array) {
    const view = viewOf(zip);
    for (let at = zip.length - 22; at >= 0; at--) {
        if (view.getUint32(at, true) === 0x06054b50) {
            return at;
        }
    }
    throw new Error("No end of central directory.");
}

/** `zip` with an empty digital signature record at the end of its central directory. */
function withDigitalSignature(zip: Uint8Array) {
    const end = findEnd(zip);
    const signed = new Uint8Array(zip.length + 6);
    signed.set(zip.subarray(0, end));
    signed.set(zip.subarray(end), end + 6);
    const view = viewOf(signed);
    view.setUint32(end, 0x05054b50, true);
    view.setUint32(end + 6 + 12, view.getUint32(end + 6 + 12, true) + 6, true);
    return signed;
}

function viewOf(bytes: Uint8Array) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * A one-entry stored archive in ZIP64 form: every size and offset in the classic records is
 * saturated, and the real values are in the entry's ZIP64 extra field and the ZIP64 end record.
 * The archive comment is `commentLength` spaces.
 */
function makeZip64(name: string, content: string, commentLength = 0) {
    const nameBytes = strToU8(name);
    const data = strToU8(content);
    const SATURATED = 0xffffffff;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 45, true);
    local.setUint32(14, crc32(data), true);
    local.setUint32(18, SATURATED, true);
    local.setUint32(22, SATURATED, true);
    local.setUint16(26, nameBytes.length, true);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 45, true);
    central.setUint16(6, 45, true);
    central.setUint32(16, crc32(data), true);
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

    const zip64End = new DataView(new ArrayBuffer(56));
    zip64End.setUint32(0, 0x06064b50, true);
    zip64End.setBigUint64(4, 44n, true);
    zip64End.setBigUint64(24, 1n, true);
    zip64End.setBigUint64(32, 1n, true);
    zip64End.setBigUint64(40, BigInt(directorySize), true);
    zip64End.setBigUint64(48, BigInt(directoryOffset), true);

    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, 0x07064b50, true);
    locator.setBigUint64(8, BigInt(directoryOffset + directorySize), true);
    locator.setUint32(16, 1, true);

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, 0xffff, true);
    end.setUint16(10, 0xffff, true);
    end.setUint32(12, SATURATED, true);
    end.setUint32(16, SATURATED, true);
    end.setUint16(20, commentLength, true);

    const comment = new Uint8Array(commentLength).fill(0x20);
    const parts = [
        local, nameBytes, data, central, nameBytes, extra, zip64End, locator, end, comment
    ].map((part) => (part instanceof DataView ? new Uint8Array(part.buffer) : part));
    const zip = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        zip.set(part, offset);
        offset += part.length;
    }
    return zip;
}

/** An archive written by `fflate`'s streaming `Zip`, every entry with a data descriptor. */
function zipStreaming(files: Record<string, string>) {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
        if (error) {
            throw error;
        }
        chunks.push(chunk);
    });
    for (const [ name, text ] of Object.entries(files)) {
        const file = new ZipDeflate(name, { level: 6 });
        zip.add(file);
        file.push(strToU8(text), true);
    }
    zip.end();
    const archive = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
        archive.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return archive;
}

/** The texts of `zip` as `fflate`'s streaming `Unzip` reads them, trusting the local headers. */
function readStreaming(zip: Uint8Array) {
    const texts: Record<string, string> = {};
    const unzip = new Unzip((file) => {
        const parts: Uint8Array[] = [];
        file.ondata = (error, data, final) => {
            if (error) {
                throw error;
            }
            parts.push(data);
            if (final) {
                texts[file.name] = parts.map((part) => strFromU8(part)).join("");
            }
        };
        file.start();
    });
    unzip.register(UnzipInflate);
    unzip.push(zip, true);
    return texts;
}
