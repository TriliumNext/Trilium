import { type MediaFileEmbedType, toAspectRatio } from "@triliumnext/commons";

/** What a probe found out about a media file. */
export interface ProbedMedia {
    type: MediaFileEmbedType;
    /** The shape of a video, such as `16/9`, where its header gives one. */
    aspectRatio?: string;
}

/** How much of a media file the probe reads: the header of most files, and a few frames. */
export const MEDIA_PROBE_LENGTH = 64 * 1024;

/** The media types other than `video/*` and `audio/*` that a media file is served as. */
const PROBED_APPLICATION_TYPES = new Set([
    "application/octet-stream", "binary/octet-stream", "application/ogg", "application/mp4",
    "application/x-matroska"
]);

/**
 * Whether a body of the media type `contentType` can be a media file, which the probe reads the
 * header of. A body that names no type can be one too.
 */
export function isProbedContentType(contentType: string) {
    return contentType === "" || /^(?:video|audio)\//.test(contentType)
        || PROBED_APPLICATION_TYPES.has(contentType);
}

/**
 * The type of the media file whose first bytes are `bytes`, served as `contentType`, or `null` when
 * it is none that `<video>` or `<audio>` plays. The header of a known container decides, and the
 * media type decides for any other file.
 */
export function probeMedia(bytes: Uint8Array, contentType: string): ProbedMedia | null {
    const probed = probeContainer(bytes, contentType);
    if (probed !== undefined) {
        return probed;
    }
    if (contentType.includes("mpegurl")) {
        return null;
    }
    if (contentType.startsWith("video/")) {
        return { type: "video" };
    }
    return contentType.startsWith("audio/") ? { type: "audio" } : null;
}

/** What the container that `bytes` start with holds, or `undefined` for an unknown container. */
function probeContainer(bytes: Uint8Array, contentType: string): ProbedMedia | null | undefined {
    if (hasBytesAt(bytes, 4, "ftyp")) {
        return probeIsoMedia(bytes, contentType);
    }
    if (hasBytesAt(bytes, 0, "\x1A\x45\xDF\xA3")) {
        return probeMatroska(bytes) ?? fromContentType(contentType);
    }
    if (hasBytesAt(bytes, 0, "OggS")) {
        return probeOgg(bytes);
    }
    if (hasBytesAt(bytes, 0, "ID3") || hasBytesAt(bytes, 0, "fLaC")
        || (hasBytesAt(bytes, 0, "RIFF") && hasBytesAt(bytes, 8, "WAVE"))
        || isMpegAudioFrame(bytes)) {
        return { type: "audio" };
    }
    return undefined;
}

/** A video, or an audio file when the media type is that of one. */
function fromContentType(contentType: string): ProbedMedia {
    return { type: contentType.startsWith("audio/") ? "audio" : "video" };
}

/** The major brands of MP4 files that hold audio only. */
const AUDIO_ONLY_BRANDS = new Set([ "M4A ", "M4B ", "M4P ", "F4A ", "F4B " ]);

/**
 * An MP4 or QuickTime file: a video when a track of its `moov` box is one, with the shape of that
 * track. A file whose `moov` box comes after its media data has none in the first bytes, so its
 * brand and media type decide.
 */
function probeIsoMedia(bytes: Uint8Array, contentType: string): ProbedMedia {
    const moov = findBox(readBoxes(bytes, 0, bytes.length), "moov");
    const tracks = moov
        ? [ ...readBoxes(bytes, moov.start, moov.end) ]
            .filter((box) => box.type === "trak")
            .map((trak) => readIsoTrack(bytes, trak))
        : [];
    const video = tracks.find((track) => track.handler === "vide");
    if (video) {
        return { type: "video", aspectRatio: toAspectRatio(video.width, video.height) };
    }
    if (tracks.some((track) => track.handler === "soun")
        || AUDIO_ONLY_BRANDS.has(readText(bytes, 8, 4))) {
        return { type: "audio" };
    }
    return fromContentType(contentType);
}

interface IsoBox {
    type: string;
    /** Where the content of the box starts. */
    start: number;
    /** Where the content of the box ends, or where `bytes` end when they hold only part of it. */
    end: number;
    isComplete: boolean;
}

/** The boxes from `start` to `end` of an MP4 file. */
function* readBoxes(bytes: Uint8Array, start: number, end: number): Generator<IsoBox> {
    let offset = start;
    while (offset + 8 <= end) {
        let size = readUint(bytes, offset, 4);
        let headerSize = 8;
        if (size === 1) {
            if (offset + 16 > end) {
                return;
            }
            size = readUint(bytes, offset + 8, 8);
            headerSize = 16;
        } else if (size === 0) {
            size = end - offset;
        }
        if (size < headerSize) {
            return;
        }

        yield {
            type: readText(bytes, offset + 4, 4),
            start: offset + headerSize,
            end: Math.min(offset + size, end),
            isComplete: offset + size <= end
        };
        offset += size;
    }
}

function findBox(boxes: Iterable<IsoBox>, type: string) {
    for (const box of boxes) {
        if (box.type === type) {
            return box;
        }
    }
    return undefined;
}

/**
 * The handler of the track `trak`, `vide` for a video and `soun` for audio, and its size as shown:
 * the width and height that its `tkhd` box ends with, swapped when its matrix turns it a quarter.
 */
function readIsoTrack(bytes: Uint8Array, trak: IsoBox) {
    const tkhd = findBox(readBoxes(bytes, trak.start, trak.end), "tkhd");
    const mdia = findBox(readBoxes(bytes, trak.start, trak.end), "mdia");
    const hdlr = mdia && findBox(readBoxes(bytes, mdia.start, mdia.end), "hdlr");
    const handler = hdlr && hdlr.start + 12 <= hdlr.end ? readText(bytes, hdlr.start + 8, 4) : "";
    if (!tkhd?.isComplete || tkhd.end - tkhd.start < 84) {
        return { handler, width: 0, height: 0 };
    }

    const width = Math.round(readUint(bytes, tkhd.end - 8, 4) / 0x10000);
    const height = Math.round(readUint(bytes, tkhd.end - 4, 4) / 0x10000);
    // The first and fifth numbers of the matrix are zero for a turn of 90 or 270 degrees.
    const isTurned = readUint(bytes, tkhd.end - 44, 4) === 0
        && readUint(bytes, tkhd.end - 28, 4) === 0;
    return isTurned ? { handler, width: height, height: width } : { handler, width, height };
}

const MATROSKA_SEGMENT = 0x18538067;
const MATROSKA_TRACKS = 0x1654AE6B;
const MATROSKA_CLUSTER = 0x1F43B675;
const MATROSKA_TRACK_ENTRY = 0xAE;
const MATROSKA_TRACK_TYPE = 0x83;
const MATROSKA_VIDEO = 0xE0;
const MATROSKA_PIXEL_WIDTH = 0xB0;
const MATROSKA_PIXEL_HEIGHT = 0xBA;
const MATROSKA_DISPLAY_WIDTH = 0x54B0;
const MATROSKA_DISPLAY_HEIGHT = 0x54BA;
const MATROSKA_VIDEO_TRACK = 1;
const MATROSKA_AUDIO_TRACK = 2;

/**
 * A Matroska or WebM file: a video when one of its tracks is one, with the shape it is shown at.
 * `undefined` when its tracks come after the first bytes.
 */
function probeMatroska(bytes: Uint8Array): ProbedMedia | undefined {
    const segment = findElement(readElements(bytes, 0, bytes.length), MATROSKA_SEGMENT);
    if (!segment) {
        return undefined;
    }

    for (const element of readElements(bytes, segment.start, segment.end)) {
        if (element.id === MATROSKA_CLUSTER) {
            return undefined;
        }
        if (element.id === MATROSKA_TRACKS) {
            return readMatroskaTracks(bytes, element);
        }
    }
    return undefined;
}

function readMatroskaTracks(bytes: Uint8Array, tracks: EbmlElement): ProbedMedia | undefined {
    let hasAudio = false;
    for (const entry of readElements(bytes, tracks.start, tracks.end)) {
        if (entry.id !== MATROSKA_TRACK_ENTRY) {
            continue;
        }

        const fields = [ ...readElements(bytes, entry.start, entry.end) ];
        const type = readElementUint(bytes, findElement(fields, MATROSKA_TRACK_TYPE));
        if (type === MATROSKA_VIDEO_TRACK) {
            const video = findElement(fields, MATROSKA_VIDEO);
            const size = video ? readMatroskaVideoSize(bytes, video) : undefined;
            return { type: "video", aspectRatio: size && toAspectRatio(size.width, size.height) };
        }
        hasAudio ||= type === MATROSKA_AUDIO_TRACK;
    }
    return hasAudio ? { type: "audio" } : undefined;
}

/**
 * The size a video track is shown at, in pixels: its height in pixels, in the shape of its display
 * size, which can be in units of an aspect ratio, such as 16 by 9.
 */
function readMatroskaVideoSize(bytes: Uint8Array, video: EbmlElement) {
    const fields = [ ...readElements(bytes, video.start, video.end) ];
    const read = (id: number) => readElementUint(bytes, findElement(fields, id));
    const width = read(MATROSKA_PIXEL_WIDTH);
    const height = read(MATROSKA_PIXEL_HEIGHT);
    const displayWidth = read(MATROSKA_DISPLAY_WIDTH);
    const displayHeight = read(MATROSKA_DISPLAY_HEIGHT);
    return displayWidth && displayHeight && height
        ? { width: Math.round(height * displayWidth / displayHeight), height }
        : { width, height };
}

interface EbmlElement {
    id: number;
    start: number;
    end: number;
}

/**
 * The elements from `start` to `end` of a Matroska file. An element of unknown size, such as the
 * segment of a live stream, runs to `end` and is the last one.
 */
function* readElements(bytes: Uint8Array, start: number, end: number): Generator<EbmlElement> {
    let offset = start;
    while (offset < end) {
        const id = readVint(bytes, offset, 4);
        const size = id && readVint(bytes, offset + id.length, 8);
        if (!id || !size) {
            return;
        }

        const dataStart = offset + id.length + size.length;
        const idValue = readUint(bytes, offset, id.length);
        if (size.isUnknown) {
            yield { id: idValue, start: dataStart, end };
            return;
        }
        yield { id: idValue, start: dataStart, end: Math.min(dataStart + size.value, end) };
        offset = dataStart + size.value;
    }
}

/** The unsigned number that `element` holds, or 0 without one. */
function readElementUint(bytes: Uint8Array, element: EbmlElement | undefined) {
    return element ? readUint(bytes, element.start, element.end - element.start) : 0;
}

function findElement(elements: Iterable<EbmlElement>, id: number) {
    for (const element of elements) {
        if (element.id === id) {
            return element;
        }
    }
    return undefined;
}

/**
 * The variable-length number at `offset`, of at most `maxLength` bytes: its value without the
 * length marker, and whether all its value bits are set, which marks an unknown size.
 */
function readVint(bytes: Uint8Array, offset: number, maxLength: number) {
    const first = bytes[offset];
    if (first === undefined || first === 0) {
        return null;
    }

    const length = Math.clz32(first) - 23;
    if (length > maxLength || offset + length > bytes.length) {
        return null;
    }

    const mask = 0xFF >> length;
    let value = first & mask;
    let isUnknown = value === mask;
    for (let index = 1; index < length; index++) {
        value = value * 256 + bytes[offset + index];
        isUnknown &&= bytes[offset + index] === 0xFF;
    }
    return { value, length, isUnknown };
}

/**
 * An Ogg file: a video when a stream starts with a Theora header, audio when one starts with a
 * Vorbis, Opus or FLAC header.
 */
function probeOgg(bytes: Uint8Array): ProbedMedia | null {
    if (indexOfBytes(bytes, "\x80theora") >= 0) {
        return { type: "video" };
    }
    const isAudio = [ "\x01vorbis", "OpusHead", "\x7FFLAC" ]
        .some((marker) => indexOfBytes(bytes, marker) >= 0);
    return isAudio ? { type: "audio" } : null;
}

/** Whether `bytes` start with an MPEG audio frame, as an MP3 or an AAC stream without tags does. */
function isMpegAudioFrame(bytes: Uint8Array) {
    return bytes[0] === 0xFF && ((bytes[1] ?? 0) & 0xE0) === 0xE0;
}

/** Whether `bytes` hold the characters of `text`, as Latin-1 bytes, at `offset`. */
function hasBytesAt(bytes: Uint8Array, offset: number, text: string) {
    return offset + text.length <= bytes.length
        && [ ...text ].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}

function indexOfBytes(bytes: Uint8Array, text: string) {
    for (let offset = 0; offset + text.length <= bytes.length; offset++) {
        if (hasBytesAt(bytes, offset, text)) {
            return offset;
        }
    }
    return -1;
}

/** The big-endian unsigned number of `length` bytes at `offset`, or 0 past the end of `bytes`. */
function readUint(bytes: Uint8Array, offset: number, length: number) {
    /* v8 ignore start -- every caller bounds its read by `bytes.length` already; kept as a guard */
    if (offset < 0 || offset + length > bytes.length) {
        return 0;
    }
    /* v8 ignore stop */

    let value = 0;
    for (let index = 0; index < length; index++) {
        value = value * 256 + bytes[offset + index];
    }
    return value;
}

function readText(bytes: Uint8Array, offset: number, length: number) {
    return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
