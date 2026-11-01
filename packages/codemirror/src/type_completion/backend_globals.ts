// Global declarations for BACKEND script notes, which run in Node on the server and desktop and in
// a Web Worker in standalone and mobile. Their vfs gets `lib: ["es2020"]` without `dom`, so this
// declares what both runtimes have: the console, timers, URL, text encoding, `fetch()`,
// `AbortController`, `structuredClone()`, base64 and `crypto`. Editor-only typing, not a runtime
// contract: add a global here only once both runtimes provide it.
export const backendGlobals = `
interface Console {
    log(...data: unknown[]): void;
    info(...data: unknown[]): void;
    warn(...data: unknown[]): void;
    error(...data: unknown[]): void;
    debug(...data: unknown[]): void;
    trace(...data: unknown[]): void;
    assert(condition?: boolean, ...data: unknown[]): void;
    count(label?: string): void;
    countReset(label?: string): void;
    dir(item?: unknown, options?: unknown): void;
    group(...data: unknown[]): void;
    groupCollapsed(...data: unknown[]): void;
    groupEnd(): void;
    table(data: unknown): void;
    time(label?: string): void;
    timeEnd(label?: string): void;
    timeLog(label?: string, ...data: unknown[]): void;
}
declare var console: Console;

/** A number in a Web Worker and a \`Timeout\` object in Node; only pass it back to \`clear…()\`. */
type TimerHandle = unknown;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): TimerHandle;
declare function clearTimeout(handle: TimerHandle | undefined): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): TimerHandle;
declare function clearInterval(handle: TimerHandle | undefined): void;
declare function queueMicrotask(callback: () => void): void;

declare function structuredClone<T>(value: T): T;
declare function atob(data: string): string;
declare function btoa(data: string): string;

interface URLSearchParams {
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string): boolean;
    set(name: string, value: string): void;
    forEach(callback: (value: string, key: string) => void): void;
    entries(): IterableIterator<[string, string]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
    toString(): string;
}
declare var URLSearchParams: {
    prototype: URLSearchParams;
    new (init?: string | Record<string, string> | [string, string][]): URLSearchParams;
};

interface URL {
    hash: string;
    host: string;
    hostname: string;
    href: string;
    readonly origin: string;
    password: string;
    pathname: string;
    port: string;
    protocol: string;
    search: string;
    readonly searchParams: URLSearchParams;
    username: string;
    toString(): string;
    toJSON(): string;
}
declare var URL: {
    prototype: URL;
    new (url: string | URL, base?: string | URL): URL;
};

interface TextEncoder {
    readonly encoding: string;
    encode(input?: string): Uint8Array;
}
declare var TextEncoder: {
    prototype: TextEncoder;
    new (): TextEncoder;
};

interface TextDecoder {
    readonly encoding: string;
    decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string;
}
declare var TextDecoder: {
    prototype: TextDecoder;
    new (label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }): TextDecoder;
};

interface AbortSignal {
    readonly aborted: boolean;
    readonly reason: unknown;
    throwIfAborted(): void;
}
declare var AbortSignal: {
    prototype: AbortSignal;
    abort(reason?: unknown): AbortSignal;
    timeout(milliseconds: number): AbortSignal;
};

interface AbortController {
    readonly signal: AbortSignal;
    abort(reason?: unknown): void;
}
declare var AbortController: {
    prototype: AbortController;
    new (): AbortController;
};

interface Headers {
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    has(name: string): boolean;
    set(name: string, value: string): void;
    forEach(callback: (value: string, key: string) => void): void;
    entries(): IterableIterator<[string, string]>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
}
type HeadersInit = Headers | Record<string, string> | [string, string][];
declare var Headers: {
    prototype: Headers;
    new (init?: HeadersInit): Headers;
};

interface RequestInit {
    method?: string;
    headers?: HeadersInit;
    body?: string | ArrayBuffer | ArrayBufferView | URLSearchParams | null;
    signal?: AbortSignal | null;
    redirect?: "follow" | "error" | "manual";
}

interface Response {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly url: string;
    readonly redirected: boolean;
    json(): Promise<any>;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}
declare function fetch(input: string | URL, init?: RequestInit): Promise<Response>;

interface Crypto {
    randomUUID(): string;
    getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}
declare var crypto: Crypto;
`;
