import type { File } from "./services/import/common";

/** One value out of a query string. Bracket notation (`?a[b]=c`) nests, which no shared route reads. */
export type QueryValue = string | QueryString | (string | QueryString)[];

/**
 * A parsed query string, as wide as the server's query parser can make it. Declare the shape a
 * route expects as {@link Request}'s second argument rather than narrowing a read by hand.
 */
export interface QueryString { [key: string]: QueryValue | undefined }

/** Request headers, lower-cased. A header sent more than once arrives as an array. */
export type RequestHeaders = Record<string, string | string[] | undefined>;

/**
 * The request surface a shared route handler is allowed to read.
 *
 * Deliberately narrower than Express: core also runs in standalone's Web Worker, where the request
 * is assembled by `BrowserRouter` and no Express object exists. Express's own `Request` satisfies
 * this structurally, so the server passes its objects through unchanged.
 *
 * @param P the shape of the path parameters the route declares, e.g. `Request<{ noteId: string }>`.
 *   A wildcard segment matches more than once, so an undeclared parameter can be an array.
 * @param Q the shape of the query string, e.g. `Request<{ noteId: string }, { preview?: string }>`.
 */
export interface Request<P = Record<string, string | string[]>, Q = QueryString> {
    params: P;
    query: Q;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: any;
    headers: RequestHeaders;
    method: string;
    originalUrl: string;
    /** The parsed multipart upload — multer on the server, `BrowserRouter` in standalone. */
    file?: File;
    get(name: string): string | undefined;
}

/**
 * The response surface a shared route handler is allowed to write to, and the counterpart to
 * {@link Request}. Express's `Response` and standalone's mock response both satisfy it.
 *
 * The header and status methods return the response itself, so a handler can chain them as
 * `res.setHeader("Content-Type", "text/plain").status(404).send(message)`.
 */
export interface Response {
    status(code: number): this;
    set(name: string, value: string): this;
    setHeader(name: string, value: string): this;
    removeHeader(name: string): void;
    send(body?: unknown): this;
    sendStatus(code: number): this;
    /**
     * Writes one chunk of a body assembled piece by piece, which only the OPML export does. Binary
     * is deliberately absent: standalone's response joins the chunks into a string. Send bytes with
     * `send()` instead, or widen this together with that implementation.
     */
    write(chunk: string): boolean;
    end(): unknown;
}
