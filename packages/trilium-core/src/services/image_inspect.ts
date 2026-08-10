/**
 * Reads what an image is and how large it is, from its header alone.
 *
 * Deliberately never decodes: an inventory has to walk every image a note holds, and decoding them
 * to count them would cost more than compressing them. Pure byte inspection also means this works
 * on every runtime, including the one with no image library at all.
 */

/**
 * Everything a header states. Every field past the format is nullable, and null means the same
 * thing throughout: this format does not say, or this file is too damaged to say — never a default
 * standing in for a measurement that was not taken.
 */
export interface InspectedImage {
    /** "jpg", "png", "gif", "webp", "bmp", "svg", "ico", "avif", or {@link UNKNOWN_FORMAT}. */
    format: string;
    mime: string;
    width: number | null;
    height: number | null;
    /** Bits per channel, as the format stores them — 8 for almost everything, 16 for a deep PNG. */
    bitDepth: number | null;
    /** Channels per pixel: 1 greyscale or indexed, 3 colour, 4 colour with alpha or CMYK. */
    channels: number | null;
    /** Whether the format is storing an alpha channel; not whether any pixel actually uses it. */
    hasAlpha: boolean | null;
    /** Stored as a palette rather than as colour per pixel — already quantized, in other words. */
    indexed: boolean | null;
}

export const UNKNOWN_FORMAT = "unknown";

/** Identifies `buffer` and reads back whatever its header states about it. */
export function inspectImage(buffer: Uint8Array): InspectedImage {
    const format = detectFormat(buffer);

    return {
        format,
        mime: FORMAT_MIMES[format] ?? FORMAT_MIMES[UNKNOWN_FORMAT],
        ...UNMEASURED,
        ...readHeader(format, buffer)
    };
}

type ImageMeasurements = Omit<InspectedImage, "format" | "mime">;

/** What every field says before anything has been read: nothing measured, nothing assumed. */
const UNMEASURED: ImageMeasurements = {
    width: null, height: null, bitDepth: null, channels: null, hasAlpha: null, indexed: null
};

function readHeader(format: string, buffer: Uint8Array): Partial<ImageMeasurements> {
    switch (format) {
        case "png": return readPngHeader(buffer);
        case "jpg": return readJpegHeader(buffer);
        // Their dimensions sit at a fixed offset and are worth having; what they say about depth
        // needs a walk through palette and header variants that nothing here has a use for.
        case "gif": return readUint16LePair(buffer, 6, 8);
        case "bmp": return buffer.length >= 26 ? readUint32LePair(buffer, 18, 22) : {};
        case "ico": return readIcoHeader(buffer);
        default: return {};
    }
}

/** The magic bytes each format opens with; SVG being text, it is recognised by its markup instead. */
function detectFormat(buffer: Uint8Array): string {
    // Shorter than any header worth reading, so nothing can be told from it.
    if (buffer.length < 12) {
        return UNKNOWN_FORMAT;
    }

    if (isSvg(buffer)) {
        return "svg";
    }

    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "jpg";
    }

    if (startsWith(buffer, [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ])) {
        return "png";
    }

    if (startsWith(buffer, [ 0x47, 0x49, 0x46 ])) {
        return "gif";
    }

    // RIFF....WEBP: the four-byte tag sits past the chunk size.
    if (startsWith(buffer, [ 0x52, 0x49, 0x46, 0x46 ])
        && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return "webp";
    }

    // An icon directory: two reserved zero bytes, then the type as a little-endian 1. Type 2 is a
    // cursor, which shares the layout but is not something a note holds.
    if (startsWith(buffer, [ 0x00, 0x00, 0x01, 0x00 ])) {
        return "ico";
    }

    // An ISO base media file whose brand says AVIF: the box length comes first, so the signature
    // starts four bytes in. `avis` is the sequence brand, which an <img> still draws.
    if (startsWith(buffer.subarray(4), [ 0x66, 0x74, 0x79, 0x70 ])
        && (startsWith(buffer.subarray(8), [ 0x61, 0x76, 0x69, 0x66 ]) || startsWith(buffer.subarray(8), [ 0x61, 0x76, 0x69, 0x73 ]))) {
        return "avif";
    }

    return startsWith(buffer, [ 0x42, 0x4d ]) ? "bmp" : UNKNOWN_FORMAT;
}

/**
 * An ICO is a directory of images at different sizes rather than a single picture. Its first entry
 * is the one reported, that being what a renderer handed the whole file sizes from.
 *
 * Each edge is a single byte, and 0 means 256 — how the format fits its largest size into a byte.
 */
function readIcoHeader(buffer: Uint8Array): Partial<ImageMeasurements> {
    if (buffer.length < 8) {
        return {};
    }

    return {
        width: buffer[6] || 256,
        height: buffer[7] || 256
    };
}

/**
 * The IHDR chunk is required to come first, so everything a PNG states about itself sits at a fixed
 * offset: size, then bits per channel, then the colour type the channels follow from.
 */
function readPngHeader(buffer: Uint8Array): Partial<ImageMeasurements> {
    if (buffer.length < 26) {
        return {};
    }

    const colorType = buffer[25];

    return {
        width: readUint32(buffer, 16),
        height: readUint32(buffer, 20),
        bitDepth: buffer[24],
        channels: PNG_CHANNELS[colorType] ?? null,
        // 4 is greyscale with alpha and 6 is colour with alpha; the rest carry none. A palette can
        // still hold transparency in a tRNS chunk, which this deliberately does not go looking for
        // — what matters to a caller is the channel the pixels are stored with.
        hasAlpha: colorType === 4 || colorType === 6,
        indexed: colorType === 3
    };
}

/**
 * Walks the segment structure to the frame header, which is where a JPEG states its size — and
 * which sits after any EXIF or thumbnail the file happens to carry, so it has to be walked to
 * rather than searched for.
 */
function readJpegHeader(buffer: Uint8Array): Partial<ImageMeasurements> {
    let offset = 2;

    while (offset + 3 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            // Out of step with the segments; nothing further can be read with any confidence.
            return {};
        }

        const marker = buffer[offset + 1];

        if (marker === 0xff) {
            // Fill bytes are allowed to pad ahead of a marker.
            offset++;
            continue;
        }

        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            // Standalone markers carry no length to skip by.
            offset += 2;
            continue;
        }

        const length = (buffer[offset + 2] << 8) | buffer[offset + 3];

        if (length < 2 || offset + 2 + length > buffer.length) {
            return {};
        }

        if (isFrameHeader(marker)) {
            return readFrameHeader(buffer, offset);
        }

        offset += 2 + length;
    }

    return {};
}

/**
 * The frame header states, in order: bits per sample, height, width, and how many components the
 * image is made of — one for greyscale, three for colour, four for CMYK. A JPEG never carries an
 * alpha channel, whatever else it says.
 */
function readFrameHeader(buffer: Uint8Array, offset: number): Partial<ImageMeasurements> {
    if (offset + 10 > buffer.length) {
        return {};
    }

    return {
        width: (buffer[offset + 7] << 8) | buffer[offset + 8],
        height: (buffer[offset + 5] << 8) | buffer[offset + 6],
        bitDepth: buffer[offset + 4],
        channels: buffer[offset + 9],
        hasAlpha: false,
        indexed: false
    };
}

/** Reads two little-endian 16-bit figures as a size, which is how GIF states its own. */
function readUint16LePair(buffer: Uint8Array, widthOffset: number, heightOffset: number): Partial<ImageMeasurements> {
    return {
        width: buffer[widthOffset] | (buffer[widthOffset + 1] << 8),
        height: buffer[heightOffset] | (buffer[heightOffset + 1] << 8)
    };
}

/** The same in 32 bits, which is how BMP states its own — negative height meaning top-down. */
function readUint32LePair(buffer: Uint8Array, widthOffset: number, heightOffset: number): Partial<ImageMeasurements> {
    const read = (offset: number) => (
        buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24)
    );

    return { width: Math.abs(read(widthOffset)), height: Math.abs(read(heightOffset)) };
}

/** How many channels each PNG colour type stores; a palette index counts as one. */
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Every SOFn marker states the frame's size, whichever coding it introduces — so all of C0..CF
 * count except the three that are not frame headers at all: DHT, JPG and DAC.
 */
function isFrameHeader(marker: number): boolean {
    return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** Recognises SVG by its opening markup, allowing for an XML declaration ahead of it. */
function isSvg(buffer: Uint8Array): boolean {
    let text = "";

    for (let index = 0; index < Math.min(buffer.length, SVG_SNIFF_BYTES); index++) {
        text += String.fromCharCode(buffer[index]);
    }

    const trimmed = text.trim().toLowerCase();

    return trimmed.startsWith("<svg") || (trimmed.startsWith("<?xml") && trimmed.includes("<svg"));
}

function startsWith(buffer: Uint8Array, signature: number[]): boolean {
    return signature.every((byte, index) => buffer[index] === byte);
}

function readUint32(buffer: Uint8Array, offset: number): number {
    return ((buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]) >>> 0;
}

/** Far enough into the file to clear an XML declaration and any comments before the root element. */
const SVG_SNIFF_BYTES = 1000;

const FORMAT_MIMES: Record<string, string> = {
    jpg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    avif: "image/avif",
    [UNKNOWN_FORMAT]: "application/octet-stream"
};
