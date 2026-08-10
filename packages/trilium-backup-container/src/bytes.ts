/**
 * Byte-level helpers over plain `Uint8Array`, so the whole format layer runs identically under
 * Node and in a browser. Nothing in this module may touch `Buffer` or any other runtime-specific
 * type: these helpers exist precisely so nothing else has to.
 */

const encoder = new TextEncoder();

/**
 * Encodes text as UTF-8. The format's magic strings are pure ASCII, for which UTF-8 and Latin-1
 * agree byte for byte.
 */
export function utf8(text: string): Uint8Array {
    return encoder.encode(text);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const part of parts) {
        total += part.length;
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        merged.set(part, offset);
        offset += part.length;
    }

    return merged;
}

/** Plain equality, for public values such as magics. Not for tags or digests. */
export function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
    if (first.length !== second.length) {
        return false;
    }

    for (let index = 0; index < first.length; index++) {
        if (first[index] !== second[index]) {
            return false;
        }
    }

    return true;
}

/**
 * Constant-time equality for values a timing side channel could otherwise leak, i.e. the payload
 * digest. Reads every byte whatever it finds along the way.
 */
export function constantTimeEqual(first: Uint8Array, second: Uint8Array): boolean {
    if (first.length !== second.length) {
        return false;
    }

    let difference = 0;
    for (let index = 0; index < first.length; index++) {
        difference |= first[index] ^ second[index];
    }

    return difference === 0;
}

export function readU16LE(bytes: Uint8Array, offset: number): number {
    return viewOf(bytes).getUint16(offset, true);
}

export function writeU16LE(bytes: Uint8Array, offset: number, value: number): void {
    viewOf(bytes).setUint16(offset, value, true);
}

export function readU16BE(bytes: Uint8Array, offset: number): number {
    return viewOf(bytes).getUint16(offset, false);
}

export function readU32LE(bytes: Uint8Array, offset: number): number {
    return viewOf(bytes).getUint32(offset, true);
}

export function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
    viewOf(bytes).setUint32(offset, value, true);
}

export function readU64LE(bytes: Uint8Array, offset: number): bigint {
    return viewOf(bytes).getBigUint64(offset, true);
}

export function writeU64LE(bytes: Uint8Array, offset: number, value: bigint): void {
    viewOf(bytes).setBigUint64(offset, value, true);
}

/** A view over exactly the array's own span, which `subarray` slices would otherwise escape. */
function viewOf(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
