import { deflateSync, Inflate } from "fflate";

import { decodeUtf8 } from "./binary.js";

/** Random access to the bytes of an archive, whether they are in memory or behind a `Blob`. */
export interface ByteSource {
    size: number;
    read(offset: number, length: number): Promise<Uint8Array>;
}

/** One central directory record: everything needed to find, name, read and copy an entry. */
export interface ZipRecord {
    /** The name exactly as stored, undecoded. */
    rawName: Uint8Array;
    /** The general purpose flags. */
    flags: number;
    /** Whether the language encoding flag (general purpose bit 11) is set: the name is UTF-8. */
    isUtf8Flagged: boolean;
    isEncrypted: boolean;
    compressionMethod: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    /** Whether a size or the offset came from the record's ZIP64 extra field. */
    isZip64: boolean;
    /** The offset of the record in the archive. */
    centralOffset: number;
}

/** The central directory of an archive and the record that closes it. */
export interface ZipDirectory {
    /** In the order of the directory. */
    records: ZipRecord[];
    /** The offset of the central directory in the archive. */
    offset: number;
    /** The length of the central directory, a digital signature record included. */
    size: number;
    /** The offset of the end-of-central-directory record, which runs to the end of the archive. */
    endOffset: number;
    /** Whether the archive has a ZIP64 end-of-central-directory record. */
    isZip64: boolean;
}

/** The central directory of an archive, and its records by name. */
export interface ZipIndex {
    directory: ZipDirectory;
    /** The first record of each name, named as `fflate` names entries. */
    records: Map<string, ZipRecord>;
}

/** Why an archive or one of its entries cannot be read or rewritten. */
export type ZipFailure =
    | "DIRECTORY" | "ZIP64" | "ENCRYPTED_ENTRY" | "METHOD" | "LENGTH" | "DEFLATE" | "CRC"
    | "ENTRY_ORDER" | "OUTPUT_TOO_LARGE" | "ENTRY_TOO_LARGE";

/** A failure to read or rewrite an archive, with its `reason`. The same bytes fail the same way. */
export class ZipRecordError extends Error {
    constructor(readonly reason: ZipFailure, message: string) {
        super(message);
        this.name = "ZipRecordError";
    }
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
/** The optional record that closes a central directory and is counted in its size. */
const DIGITAL_SIGNATURE_SIGNATURE = 0x05054b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const LOCAL_HEADER_LENGTH = 30;
const CENTRAL_HEADER_LENGTH = 46;
const END_OF_CENTRAL_DIRECTORY_LENGTH = 22;
const ZIP64_LOCATOR_LENGTH = 20;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LENGTH = 56;
/** The longest comment the end-of-central-directory record can carry after itself. */
const MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
/** A 32-bit size or offset that holds this value is in the entry's ZIP64 extra field instead. */
const ZIP64_SATURATED = 0xffffffff;
/** General purpose bit 0: the entry is encrypted. */
const ENCRYPTED_FLAG = 0x1;
/** General purpose bit 3: the entry's CRC-32 and sizes follow its data, in a data descriptor. */
const DATA_DESCRIPTOR_FLAG = 0x8;
/** General purpose bit 11: the file name and comment are UTF-8. */
const UTF8_FLAG = 0x800;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
/** The version of the format that a reader needs for a deflated entry: 2.0. */
const DEFLATE_VERSION = 20;
/** How much compressed data an entry's inflater takes at a time, as `officeparser`'s does. */
const INFLATE_SLICE_LENGTH = 16 * 1024;

/** A source of `bytes`, which are in memory. */
export function byteSourceOf(bytes: Uint8Array): ByteSource {
    return {
        size: bytes.byteLength,
        read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length))
    };
}

/**
 * Reads the end-of-central-directory record (and its ZIP64 counterpart, for an archive past 4 GiB
 * or 65535 entries), then the central directory it points to.
 */
export async function readCentralDirectory(source: ByteSource): Promise<ZipDirectory> {
    if (source.size < END_OF_CENTRAL_DIRECTORY_LENGTH) {
        throw directoryError("Truncated ZIP: no end-of-central-directory record.");
    }

    // The ZIP64 locator sits right before the end record, so the tail covers it at any comment
    // length.
    const tailStart = Math.max(
        0,
        source.size - ZIP64_LOCATOR_LENGTH - END_OF_CENTRAL_DIRECTORY_LENGTH - MAX_COMMENT_LENGTH
    );
    const tail = await source.read(tailStart, source.size - tailStart);
    const tailView = viewOf(tail);

    let eocd = -1;
    for (let i = tail.byteLength - END_OF_CENTRAL_DIRECTORY_LENGTH; i >= 0; i--) {
        if (tailView.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) {
        throw directoryError("Truncated ZIP: no end-of-central-directory record.");
    }

    let directorySize = tailView.getUint32(eocd + 12, true);
    let directoryOffset = tailView.getUint32(eocd + 16, true);

    const locator = eocd - ZIP64_LOCATOR_LENGTH;
    const isZip64 = locator >= 0 && tailView.getUint32(locator, true) === ZIP64_LOCATOR_SIGNATURE;
    if (isZip64) {
        const zip64Offset = readUint64(tailView, locator + 8);
        const zip64 = viewOf(await source.read(zip64Offset, ZIP64_END_OF_CENTRAL_DIRECTORY_LENGTH));
        if (zip64.byteLength < ZIP64_END_OF_CENTRAL_DIRECTORY_LENGTH
            || zip64.getUint32(0, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
            throw directoryError(
                "Corrupt ZIP: the ZIP64 end-of-central-directory record is missing.");
        }
        directorySize = readUint64(zip64, 40);
        directoryOffset = readUint64(zip64, 48);
    }

    if (directoryOffset + directorySize > source.size) {
        throw directoryError("Corrupt ZIP: the central directory lies past the end of the file.");
    }

    const directory = await source.read(directoryOffset, directorySize);
    const view = viewOf(directory);
    const records: ZipRecord[] = [];

    // Walked by header rather than by the recorded entry count, which saturates at 65535.
    let offset = 0;
    while (offset + CENTRAL_HEADER_LENGTH <= directory.byteLength
        && view.getUint32(offset, true) === CENTRAL_HEADER_SIGNATURE) {
        const flags = view.getUint16(offset + 8, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const nameStart = offset + CENTRAL_HEADER_LENGTH;
        const extraStart = nameStart + nameLength;
        if (extraStart + extraLength > directory.byteLength) {
            throw directoryError(
                "Corrupt ZIP: a central directory record runs past the directory.");
        }

        const record: ZipRecord = {
            rawName: directory.subarray(nameStart, extraStart),
            flags,
            isUtf8Flagged: !!(flags & UTF8_FLAG),
            isEncrypted: !!(flags & ENCRYPTED_FLAG),
            compressionMethod: view.getUint16(offset + 10, true),
            crc32: view.getUint32(offset + 16, true),
            compressedSize: view.getUint32(offset + 20, true),
            uncompressedSize: view.getUint32(offset + 24, true),
            localHeaderOffset: view.getUint32(offset + 42, true),
            isZip64: false,
            centralOffset: directoryOffset + offset
        };
        applyZip64Extra(record, view, extraStart, extraLength);
        records.push(record);

        offset = extraStart + extraLength + commentLength;
    }

    // The entries are imported from this list, so a directory that stops early must not pass as
    // complete.
    if (offset < directory.byteLength && (offset + 4 > directory.byteLength
        || view.getUint32(offset, true) !== DIGITAL_SIGNATURE_SIGNATURE)) {
        throw directoryError("Corrupt ZIP: the central directory ends in an unreadable record.");
    }

    return {
        records, offset: directoryOffset, size: directorySize, endOffset: tailStart + eocd, isZip64
    };
}

/**
 * Reads an entry's bytes through its local header, which can carry a different extra field length.
 * Proves that the entry inflates to exactly its declared size, never allocating past that size and
 * one slice's expansion, and that its CRC-32 is the declared one.
 */
export async function readEntryContent(source: ByteSource, record: ZipRecord): Promise<Uint8Array> {
    if (record.isEncrypted) {
        throw new ZipRecordError("ENCRYPTED_ENTRY", "Encrypted ZIP entries are not supported.");
    }
    const method = record.compressionMethod;
    if (method !== METHOD_STORED && method !== METHOD_DEFLATED) {
        throw new ZipRecordError("METHOD",
            `Unsupported ZIP compression method ${record.compressionMethod}.`);
    }
    if (record.compressionMethod === METHOD_STORED
        && record.compressedSize !== record.uncompressedSize) {
        throw lengthError();
    }

    const header = viewOf(await source.read(record.localHeaderOffset, LOCAL_HEADER_LENGTH));
    if (header.byteLength < LOCAL_HEADER_LENGTH
        || header.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
        throw directoryError("Corrupt ZIP: an entry's local header is missing.");
    }
    const dataStart = record.localHeaderOffset + LOCAL_HEADER_LENGTH
        + header.getUint16(26, true) + header.getUint16(28, true);
    const data = await source.read(dataStart, record.compressedSize);
    if (data.byteLength < record.compressedSize) {
        throw directoryError("Truncated ZIP: an entry's data runs past the end of the file.");
    }

    const content = record.compressionMethod === METHOD_STORED
        ? data
        : inflateExactly(data, record.uncompressedSize);
    if (crc32(content) !== record.crc32) {
        throw new ZipRecordError("CRC",
            "Corrupt ZIP: an entry's checksum is not the declared one.");
    }
    return content;
}

/**
 * Reads the central directory of the archive `bytes` and names its records as `fflate` does:
 * UTF-8 when flagged, else one character per byte. A repeated name keeps its first record.
 */
export async function readZipIndex(bytes: Uint8Array): Promise<ZipIndex> {
    const directory = await readCentralDirectory(byteSourceOf(bytes));
    const records = new Map<string, ZipRecord>();
    for (const record of directory.records) {
        const name = decodeName(record);
        if (!records.has(name)) {
            records.set(name, record);
        }
    }
    return { directory, records };
}

/**
 * The content of the entry `name` of the archive `bytes`, or `undefined` when it has none. Throws
 * a `ZipRecordError` when the archive or the entry cannot be read, a wrong checksum included, and
 * for an entry declared longer than `maxLength`, before anything is allocated for it.
 */
export async function readZipPart(bytes: Uint8Array, name: string, maxLength: number) {
    const record = (await readZipIndex(bytes)).records.get(name);
    if (!record) {
        return undefined;
    }
    if (record.uncompressedSize > maxLength) {
        throw new ZipRecordError("ENTRY_TOO_LARGE",
            `A ZIP entry declares more than ${maxLength} bytes.`);
    }
    return await readEntryContent(byteSourceOf(bytes), record);
}

/**
 * `bytes`, an archive whose central directory is `directory`, with the entries of `replacements`
 * given new content, deflated and written without a data descriptor. Every other entry is copied as
 * it is, still compressed, in the order of the archive. Refuses a ZIP64 archive, entries out of
 * order or overlapping, and a result longer than `maxLength`.
 */
export function rewriteZip(
    bytes: Uint8Array, directory: ZipDirectory, replacements: Map<ZipRecord, Uint8Array>,
    maxLength: number
): Uint8Array {
    if (directory.isZip64 || directory.records.some(({ isZip64 }) => isZip64)) {
        throw new ZipRecordError("ZIP64", "ZIP64 archives are not rewritten.");
    }
    const view = viewOf(bytes);
    const entries = readEntrySpans(view, directory);

    const parts: Uint8Array[] = [];
    let length = 0;
    const append = (part: Uint8Array) => {
        length += part.byteLength;
        if (length > maxLength) {
            throw new ZipRecordError("OUTPUT_TOO_LARGE",
                `The rewritten archive is longer than ${maxLength} bytes.`);
        }
        parts.push(part);
    };

    append(bytes.subarray(0, entries[0]?.record.localHeaderOffset ?? directory.offset));
    const newOffsets = new Map<ZipRecord, number>();
    const rewritten = new Map<ZipRecord, { crc: number; compressedSize: number; size: number }>();
    for (const { record, headerLength, end } of entries) {
        newOffsets.set(record, length);
        const content = replacements.get(record);
        if (!content) {
            append(bytes.subarray(record.localHeaderOffset, end));
            continue;
        }

        const data = deflateSync(content, { level: 6 });
        const entry = {
            crc: crc32(content), compressedSize: data.byteLength, size: content.byteLength
        };
        rewritten.set(record, entry);
        const at = record.localHeaderOffset;
        const header = bytes.slice(at, at + headerLength);
        writeEntryFields(viewOf(header), 4, entry);
        append(header);
        append(data);
    }

    const centralDirectory = bytes.slice(directory.offset, directory.offset + directory.size);
    const centralView = viewOf(centralDirectory);
    for (const [ record, offset ] of newOffsets) {
        const at = record.centralOffset - directory.offset;
        centralView.setUint32(at + 42, offset, true);
        const entry = rewritten.get(record);
        if (entry) {
            writeEntryFields(centralView, at + 6, entry);
        }
    }
    const directoryOffset = length;
    append(centralDirectory);
    const end = bytes.slice(directory.endOffset);
    viewOf(end).setUint32(16, directoryOffset, true);
    append(end);

    const archive = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        archive.set(part, offset);
        offset += part.byteLength;
    }
    return archive;
}

/** The CRC-32 of `bytes`, as ZIP computes it. */
export function crc32(bytes: Uint8Array) {
    let crc = -1;
    for (const byte of bytes) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
}

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value;
});

/**
 * Replaces the saturated 32-bit fields with the 64-bit values from the ZIP64 extra field, which
 * carries only the saturated ones, in the order uncompressed size, compressed size, local header
 * offset.
 */
function applyZip64Extra(record: ZipRecord, view: DataView, start: number, length: number) {
    const end = start + length;
    for (let offset = start; offset + 4 <= end;) {
        const id = view.getUint16(offset, true);
        const size = view.getUint16(offset + 2, true);
        let field = offset + 4;
        if (id === ZIP64_EXTRA_FIELD_ID) {
            const keys = [ "uncompressedSize", "compressedSize", "localHeaderOffset" ] as const;
            for (const key of keys) {
                if (record[key] === ZIP64_SATURATED && field + 8 <= offset + 4 + size) {
                    record[key] = readUint64(view, field);
                    record.isZip64 = true;
                    field += 8;
                }
            }
            return;
        }
        offset += 4 + size;
    }
}

/**
 * The entries of the archive in the order of their local headers, each with the length of its
 * local header and the end of its span: the next entry's local header, or the central directory.
 */
function readEntrySpans(view: DataView, directory: ZipDirectory) {
    const records = directory.records.toSorted((a, b) => a.localHeaderOffset - b.localHeaderOffset);
    return records.map((record, index) => {
        const at = record.localHeaderOffset;
        const end = records[index + 1]?.localHeaderOffset ?? directory.offset;
        if (at + LOCAL_HEADER_LENGTH > end || view.getUint32(at, true) !== LOCAL_HEADER_SIGNATURE) {
            throw new ZipRecordError("ENTRY_ORDER",
                "Corrupt ZIP: an entry's local header is missing.");
        }
        if (view.getUint32(at + 18, true) === ZIP64_SATURATED
            || view.getUint32(at + 22, true) === ZIP64_SATURATED) {
            throw new ZipRecordError("ZIP64", "ZIP64 archives are not rewritten.");
        }
        const headerLength = LOCAL_HEADER_LENGTH + view.getUint16(at + 26, true)
            + view.getUint16(at + 28, true);
        if (at + headerLength + record.compressedSize > end) {
            throw new ZipRecordError("ENTRY_ORDER", "Corrupt ZIP: two entries overlap.");
        }
        return { record, headerLength, end };
    });
}

/**
 * Writes the fields of a deflated entry without a data descriptor into the header at `at`, which
 * starts at the version needed: a local header's fields start at 4, a central header's at 6.
 */
function writeEntryFields(
    view: DataView, at: number,
    { crc, compressedSize, size }: { crc: number; compressedSize: number; size: number }
) {
    view.setUint16(at, Math.max(view.getUint16(at, true), DEFLATE_VERSION), true);
    view.setUint16(at + 2, view.getUint16(at + 2, true) & ~DATA_DESCRIPTOR_FLAG, true);
    view.setUint16(at + 4, METHOD_DEFLATED, true);
    view.setUint32(at + 10, crc, true);
    view.setUint32(at + 14, compressedSize, true);
    view.setUint32(at + 18, size, true);
}

/**
 * Inflates `data` into exactly `length` bytes, a slice of input at a time: refuses an output that
 * passes `length` as soon as it does, and one that ends short.
 */
function inflateExactly(data: Uint8Array, length: number) {
    const content = new Uint8Array(length);
    let written = 0;
    const inflater = new Inflate((chunk) => {
        if (written + chunk.byteLength > length) {
            throw lengthError();
        }
        content.set(chunk, written);
        written += chunk.byteLength;
    });
    try {
        let offset = 0;
        do {
            const end = offset + INFLATE_SLICE_LENGTH;
            inflater.push(data.subarray(offset, end), end >= data.byteLength);
            offset = end;
        } while (offset < data.byteLength);
    } catch (error) {
        throw error instanceof ZipRecordError
            ? error
            : new ZipRecordError("DEFLATE", "Corrupt ZIP: an entry's data does not inflate.");
    }
    if (written !== length) {
        throw lengthError();
    }
    return content;
}

/** The name of `record`: UTF-8 when flagged, else one character per byte. */
function decodeName(record: ZipRecord) {
    if (record.isUtf8Flagged) {
        return decodeUtf8(record.rawName);
    }
    let name = "";
    for (const byte of record.rawName) {
        name += String.fromCharCode(byte);
    }
    return name;
}

function lengthError() {
    return new ZipRecordError("LENGTH", "Corrupt ZIP: an entry's length is not the declared one.");
}

function directoryError(message: string) {
    return new ZipRecordError("DIRECTORY", message);
}

function viewOf(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** ZIP64 values fit in a double for any archive a browser can hold. */
function readUint64(view: DataView, offset: number): number {
    return Number(view.getBigUint64(offset, true));
}
