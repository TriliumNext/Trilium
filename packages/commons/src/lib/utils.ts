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

/**
 * Hashes a string with FNV-1a, returning the digest as an unsigned 32-bit number.
 *
 * Not a security primitive and not asked to be one: callers use it to tell two values apart. Web
 * Crypto is not an option here — Trilium is served over plain HTTP as often as not, and
 * `crypto.subtle` exists only in a secure context.
 */
export function fnv1a(value: string): number {
    let hash = 0x811c9dc5;

    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0;
}
