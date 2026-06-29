const utf8Decoder = new TextDecoder("utf-8");
const utf8Encoder = new TextEncoder();

export function concat2(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

export function encodeBase64(stringOrBuffer: string | Uint8Array): string {
    const bytes = wrapStringOrBuffer(stringOrBuffer);
    let binary = "";
    const len = bytes.length;

    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
}

export function decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const len = binary.length;

    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
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
