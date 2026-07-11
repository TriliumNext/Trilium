import { getCrypto } from "../encryption/crypto.js";

const utf8Decoder = new TextDecoder("utf-8");
const utf8Encoder = new TextEncoder();

export function concat2(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

/**
 * Encodes a string (UTF-8) or raw bytes to a standard base64 string. The heavy lifting is
 * delegated to the active crypto provider so each platform uses its fastest implementation
 * (native `Buffer` on server/desktop, a chunked encoder in the browser).
 */
export function encodeBase64(stringOrBuffer: string | Uint8Array): string {
    return getCrypto().base64Encode(wrapStringOrBuffer(stringOrBuffer));
}

/** Decodes a standard base64 string into raw bytes via the active crypto provider. */
export function decodeBase64(base64: string): Uint8Array {
    return getCrypto().base64Decode(base64);
}

/**
 * Decodes a standard base64 string into a caller-provided buffer (at least
 * `(base64.length * 3) >> 2` bytes), returning the number of bytes written — or `null` when the
 * active crypto provider has no in-place decoder, in which case the caller should fall back to
 * {@link decodeBase64}. Used to reuse one scratch buffer across many decodes instead of
 * allocating a fresh ArrayBuffer per call (see the blob decode pool in sync_update).
 */
export function decodeBase64Into(base64: string, target: Uint8Array): number | null {
    const provider = getCrypto();

    return provider.base64DecodeInto ? provider.base64DecodeInto(base64, target) : null;
}

export function decodeUtf8(stringOrBuffer: string | Uint8Array) {
    if (typeof stringOrBuffer === "string") {
        return stringOrBuffer;
    } else {
        return utf8Decoder.decode(stringOrBuffer);
    }
}

export function encodeUtf8(string: string | Uint8Array) {
    return utf8Encoder.encode(unwrapStringOrBuffer(string));
}

/**
 * Truncates a string so that its UTF-8 encoding does not exceed `maxBytes`,
 * without ever splitting a multi-byte character (the cut is moved back to the
 * nearest character boundary). Returns the input unchanged when it already fits.
 */
export function truncateUtf8Bytes(text: string, maxBytes: number): string {
    const encoded = encodeUtf8(text);
    if (encoded.length <= maxBytes) {
        return text;
    }

    // UTF-8 continuation bytes match 0b10xxxxxx (0x80–0xBF); back up while the
    // cut would land inside a multi-byte sequence so we never emit a partial char.
    let end = Math.max(0, maxBytes);
    while (end > 0 && (encoded[end] & 0xc0) === 0x80) {
        end--;
    }

    return decodeUtf8(encoded.slice(0, end));
}

export function unwrapStringOrBuffer(stringOrBuffer: string | Uint8Array) {
    if (typeof stringOrBuffer === "string") {
        return stringOrBuffer;
    } else {
        return decodeUtf8(stringOrBuffer);
    }
}

export function wrapStringOrBuffer(stringOrBuffer: string | Uint8Array) {
    if (typeof stringOrBuffer === "string") {
        return encodeUtf8(stringOrBuffer);
    } else {
        return stringOrBuffer;
    }
}

/**
 * Strips a leading byte order mark (U+FEFF) from a string, if present. A
 * buffer-to-string conversion translates a UTF-8 BOM (EF BB BF) into the same
 * U+FEFF code point, so this covers both UTF-8 and UTF-16 BOMs.
 */
export function stripBom(text: string): string {
    return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

/**
 * For buffers, they are scanned for a supported encoding and decoded (UTF-8, UTF-16). In some cases, the BOM is also stripped.
 *
 * For strings, they are returned immediately without any transformation.
 *
 * For nullish values, an empty string is returned.
 *
 * @param data the string or buffer to process.
 * @returns the string representation of the buffer, or the same string is it's a string.
 */
export function processStringOrBuffer(data: string | Uint8Array | null) {
    if (!data) {
        return "";
    }

    if (typeof data === "string") {
        return data;
    }

    // The only non-UTF-8 encoding we decode is UTF-16LE. Detection previously used chardet, but chardet
    // only ever resolved to UTF-16LE when the FF FE byte-order mark was present — BOM-less UTF-16 was
    // detected as a single-byte encoding and decoded as UTF-8 anyway. A cheap BOM check reproduces that
    // behaviour exactly, without running statistical charset detection on every imported note's content.
    if (data.length >= 2 && data[0] === 0xFF && data[1] === 0xFE) {
        return stripBom(new TextDecoder("utf-16le").decode(data));
    }

    return utf8Decoder.decode(data);
}
