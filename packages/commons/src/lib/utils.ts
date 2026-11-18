const MAX_LOG_DEPTH = 3;

/**
 * Creates a JSON replacer that handles circular references and limits depth.
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Cyclic_object_value#examples
 */
function getCircularReplacer() {
    const ancestors: object[] = [];
    return function (this: object, _key: string, value: unknown) {
        if (typeof value !== "object" || value === null) {
            return value;
        }
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
            ancestors.pop();
        }
        if (ancestors.includes(value)) {
            return "[Circular]";
        }
        if (ancestors.length >= MAX_LOG_DEPTH) {
            return "[Object]";
        }
        ancestors.push(value);
        return value;
    };
}

function formatSingleArg(arg: unknown): string {
    if (typeof arg === "object" && arg !== null) {
        try {
            return JSON.stringify(arg, getCircularReplacer(), 4);
        } catch (e) {
            return String(arg);
        }
    }

    return String(arg);
}

export function formatLogMessage(...args: unknown[]): string {
    return args.map(formatSingleArg).join(" ");
}

export interface DeferredPromise<T> extends Promise<T> {
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
}

export function deferred<T>(): DeferredPromise<T> {
    return (() => {
        let resolve!: (value: T | PromiseLike<T>) => void;
        let reject!: (reason?: any) => void;

        let promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        }) as DeferredPromise<T>;

        promise.resolve = resolve;
        promise.reject = reject;
        return promise as DeferredPromise<T>;
    })();
}

/** Runs callbacks one at a time, in the order `runExclusive()` was called. */
export class Mutex {
    private tail: Promise<unknown> = Promise.resolve();

    runExclusive<T>(callback: () => T | PromiseLike<T>): Promise<T> {
        const result = this.tail.then(() => callback());
        this.tail = result.catch(() => undefined);
        return result;
    }
}

/**
 * Hashes a string with FNV-1a, returning the digest as an unsigned 32-bit number.
 *
 * Not a security primitive and not asked to be one: callers use it to tell two values apart. Web
 * Crypto is not an option here — Trilium is served over plain HTTP as often as not, and
 * `crypto.subtle` exists only in a secure context.
 */
export function fnv1a(value: string): number {
    return fnv1aUpdate(FNV1A_OFFSET_BASIS, value);
}

/** The state that {@link fnv1a} starts from. */
export const FNV1A_OFFSET_BASIS = 0x811c9dc5;

/**
 * Continues an FNV-1a hash from `hash`, a state that {@link fnv1a} or this function returned, with
 * `value`. `fnv1aUpdate(fnv1a(a), b)` equals `fnv1a(a + b)`.
 */
export function fnv1aUpdate(hash: number, value: string): number {
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0;
}

/**
 * Goes in front of the content of a protected entity before its `blobId` is computed, so that its
 * encrypted and its decrypted content never share a blob row.
 */
export const PROTECTED_BLOB_PREFIX = "t$[nvQg7q)&_ENCRYPTED_?M:Bf&j3jr_";

/** The `blobId` of content whose SHA-512 digest is `digest`. */
export function blobIdFromDigest(digest: Uint8Array): string {
    // The first 15 bytes give the first 20 characters of the base 64 of the whole digest.
    let binary = "";
    for (const byte of digest.subarray(0, 15)) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll("+", "X").replaceAll("/", "Y");
}

/**
 * Escapes `&`, `<`, `>`, `"` and `'`, so that the value can go into HTML text or a quoted
 * attribute.
 */
export function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}

/**
 * Decodes the numeric character references and the basic named entities in `value`. A reference
 * that names no character, such as one above U+10FFFF or a surrogate, stays as text.
 */
export function decodeHtmlEntities(value: string): string {
    return value.replace(ENTITY, (match, entity: string) => decodeEntity(entity) ?? match);
}

/** Whether every numeric character reference in `value` names a character. */
export function hasOnlyDecodableReferences(value: string) {
    for (const [ , entity ] of value.matchAll(ENTITY)) {
        if (entity.startsWith("#") && decodeEntity(entity) === null) {
            return false;
        }
    }
    return true;
}

/** The character of `entity`, a reference without its `&` and `;`, or `null`. */
function decodeEntity(entity: string) {
    if (!entity.startsWith("#")) {
        return NAMED_ENTITIES[entity] ?? null;
    }

    const isHex = entity[1] === "x" || entity[1] === "X";
    const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
    const isCharacter = codePoint > 0 && codePoint <= 0x10ffff
        && (codePoint < 0xd800 || codePoint > 0xdfff);
    return isCharacter ? String.fromCodePoint(codePoint) : null;
}

const ENTITY = /&(#\d+|#[xX][0-9a-fA-F]+|\w+);/g;

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: "\u{a0}"
};
