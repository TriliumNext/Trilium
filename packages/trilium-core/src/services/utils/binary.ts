import chardet from "chardet";
import stripBom from "strip-bom";

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

    const detectedEncoding = chardet.detect(data);
    switch (detectedEncoding) {
        case "UTF-16LE":
            return stripBom(new TextDecoder("utf-16le").decode(data));
        case "UTF-8":
        default:
            return utf8Decoder.decode(data);
    }
}
