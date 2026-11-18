import {
    strFromU8, strToU8, Unzip, UnzipInflate, unzipSync, Zip, ZipDeflate, zipSync
} from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
    byteSourceOf, crc32, readCentralDirectory, readEntryContent, rewriteZip, type ZipDirectory,
    type ZipRecord, ZipRecordError
} from "./zip_records.js";

const MiB = 1024 * 1024;

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

        expect(await readFailure(shorter)).toBe("LENGTH");
        expect(await readFailure(longer)).toBe("LENGTH");
        expect(await readFailure(altered)).toBe("CRC");
        expect(await readFailure(notDeflate)).toBe("DEFLATE");

        // A stored entry whose sizes differ is refused before its data is read.
        const source = byteSourceOf(storedSizes);
        const [ record ] = (await readCentralDirectory(source)).records;
        const read = vi.spyOn(source, "read");
        await expect(readEntryContent(source, record)).rejects.toMatchObject({ reason: "LENGTH" });
        expect(read).not.toHaveBeenCalled();
    });

    it("stops a bomb declared at 1 MiB once its output passes 1 MiB", async () => {
        const bomb = patchCentral(zipSync({ "bomb.bin": new Uint8Array(16 * MiB) }), (view, at) =>
            view.setUint32(at + 24, MiB, true));
        const source = byteSourceOf(bomb);
        const [ record ] = (await readCentralDirectory(source)).records;

        await expect(readEntryContent(source, record)).rejects.toMatchObject({ reason: "LENGTH" });
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
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    return 30 + view.getUint16(26, true) + view.getUint16(28, true);
}

/** Applies `patch` to the first central directory header of `zip`, at the header's offset. */
function patchCentral(zip: Uint8Array, patch: (view: DataView, offset: number) => void) {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = zip.length - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            patch(view, view.getUint32(i + 16, true));
            return zip;
        }
    }
    throw new Error("No end of central directory.");
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
