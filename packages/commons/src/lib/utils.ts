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

export function formatLogMessage(message: string | object) {
    if (typeof message === "object") {
        try {
            return JSON.stringify(message, getCircularReplacer(), 4);
        } catch (e) {
            return message.toString();
        }
    }

    return message;
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
