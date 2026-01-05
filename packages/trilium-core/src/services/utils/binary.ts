const utf8Decoder = new TextDecoder("utf-8");

export function concat2(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

export function encodeBase64(bytes: Uint8Array): string {
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

export function decodeUtf8(bytes: Uint8Array) {
    return utf8Decoder.decode(bytes);
}
