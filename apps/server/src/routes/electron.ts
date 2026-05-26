import electron from "electron";
import EventEmitter from "events";
import type { Application, Response as ExpressResponse } from "express";
import { createResponse, type MockResponse } from "node-mocks-http";
import { Readable } from "node:stream";

import { markAsInternalElectronRequest } from "../services/electron_request.js";

/**
 * Bridges renderer-process requests on the `trilium-app://app/...` custom
 * protocol into the Express application running in the main process.
 *
 * The renderer loads the entire UI from this scheme (see
 * `apps/server/src/services/window.ts` and `apps/desktop/src/main.ts`), so
 * every request the page makes — page load, bootstrap, API calls, static
 * assets — arrives here as a Web Fetch `Request`. We synthesise an
 * IncomingMessage-shaped `Readable` for the request and a node-mocks-http
 * response, then dispatch through the Express app so the real session, CSRF,
 * body-parser, multer and error middleware all run.
 */
function init(app: Application) {
    electron.app.whenReady().then(() => {
        electron.protocol.handle("trilium-app", async (request) => {
            try {
                return await dispatch(app, request);
            } catch (err) {
                console.error(`[trilium-app] dispatch failed for ${request.method} ${request.url}:`, err);
                return new Response("Internal Server Error", { status: 500 });
            }
        });
    });
}

export async function dispatch(app: Application, request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
        headers[key] = value;
    });

    // Multi-workspace: a renderer loaded as `trilium-app://app/?dbId=…` carries
    // the workspace id only in its URL. The page-load / bootstrap requests
    // can't set a custom header, so we promote the query param into the
    // `trilium-db-id` header here; subsequent XHRs from the same renderer
    // already set the header themselves (see apps/client/src/services/server.ts).
    if (!headers["trilium-db-id"]) {
        const dbIdParam = url.searchParams.get("dbId");
        if (dbIdParam) {
            headers["trilium-db-id"] = dbIdParam;
        }
    }

    const bodyBuffer = await readBody(request);

    // body-parser / multer call `type-is`'s `hasBody`, which requires either a
    // `content-length` or `transfer-encoding` header. Programmatically built
    // `Request` objects don't carry content-length, so without this the body
    // would be parsed as empty and JSON / multipart middleware would silently
    // skip.
    if (bodyBuffer && headers["content-length"] === undefined) {
        headers["content-length"] = String(bodyBuffer.length);
    }

    return new Promise<Response>((resolve, reject) => {
        const req = buildIncomingRequest({
            method: request.method,
            url: url.pathname + url.search,
            headers,
            bodyBuffer
        });

        const res = createResponse({
            req,
            eventEmitter: EventEmitter
        });

        const bridge = installStreamingBridge(res, resolve, reject, request.signal);

        res.on("end", () => {
            if (bridge.isStreaming) return; // streaming path already resolved
            const buf = typeof (res as any)._getBuffer === "function" ? (res as any)._getBuffer() : null;
            const data = res._getData();
            const rawPayload = buf && buf.length > 0 ? buf : data;
            // The Fetch `Response` constructor rejects a non-null body for
            // null-body status codes (101 / 204 / 205 / 304). Express is
            // happy to call `res.status(204).send()` so we must filter here.
            const body = NULL_BODY_STATUSES.has(res.statusCode) ? null : toUint8Array(rawPayload);
            try {
                resolve(new Response(body as BodyInit | null, {
                    status: res.statusCode,
                    headers: normalizeResponseHeaders(res.getHeaders())
                }));
            } catch (err) {
                reject(err);
            }
        });

        try {
            (app as unknown as (req: object, res: object, next: (err?: unknown) => void) => void)(
                req,
                res,
                (err) => {
                    if (err) {
                        bridge.abort(err instanceof Error ? err : new Error(String(err)));
                        reject(err);
                    }
                }
            );
        } catch (err) {
            reject(err);
        }
    });
}

interface StreamingBridge {
    /** True once `res.flushHeaders()` has been called and we've committed a streaming `Response`. */
    readonly isStreaming: boolean;
    /** Force-fail the streaming body (e.g. when Express's `next(err)` fires mid-stream). */
    abort(reason: Error): void;
}

/**
 * Patches a node-mocks-http response so SSE / chunked handlers (e.g. the LLM
 * chat stream) deliver chunks to the renderer in real time instead of buffering
 * until `res.end()`.
 *
 * When the handler calls `res.flushHeaders()` — the standard "headers now,
 * body coming later" signal — the bridge resolves the Fetch `Response` with a
 * `ReadableStream` body and forwards subsequent `res.write(chunk)` calls into
 * the stream controller. Non-streaming handlers never call `flushHeaders`; for
 * them the original `write` / `end` run unchanged and the caller's existing
 * buffered `res.on("end")` path resolves the Response.
 *
 * The bridge also fixes a crash: Express rewires `res.__proto__` to
 * `app.response` (extends `http.ServerResponse`), so any method not shadowed
 * as an own property falls through to Node's real ServerResponse — whose
 * internals (`outputData`, …) were never initialised on the mock object.
 * `flushHeaders` and `flush` both trigger this and need own-property shims.
 */
function installStreamingBridge(
    res: MockResponse<ExpressResponse>,
    onCommit: (response: Response) => void,
    onCommitError: (err: unknown) => void,
    abortSignal: AbortSignal | null | undefined
): StreamingBridge {
    let streaming = false;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);

    function commit() {
        if (streaming) return;
        streaming = true;
        const body = new ReadableStream<Uint8Array>({
            start(c) { controller = c; }
        });
        try {
            onCommit(new Response(body, {
                status: res.statusCode || 200,
                headers: normalizeResponseHeaders(res.getHeaders())
            }));
        } catch (err) {
            onCommitError(err);
        }
    }

    function enqueue(chunk: unknown) {
        const buf = toUint8Array(chunk);
        if (buf && controller) controller.enqueue(buf);
    }

    function closeStream() {
        if (!controller) return;
        try { controller.close(); } catch { /* already closed */ }
        controller = null;
    }

    function errorStream(reason: Error) {
        if (!controller) return;
        try { controller.error(reason); } catch { /* already closed */ }
        controller = null;
    }

    // Install as own properties so Express's prototype swap can't reveal the
    // broken inherited ServerResponse methods underneath.
    Object.assign(res, {
        flushHeaders: commit,
        // Some handlers / compression middleware probe `res.flush()` to
        // force-flush. Stream controllers deliver each enqueue eagerly, so
        // this is a safe no-op — and prevents the same prototype-swap crash.
        flush: () => {},
        write(chunk: unknown, ...rest: unknown[]): boolean {
            if (streaming) {
                enqueue(chunk);
                return true;
            }
            return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
        },
        end(...args: unknown[]) {
            if (!streaming) {
                return (origEnd as (...a: unknown[]) => unknown)(...args);
            }
            if (args.length > 0 && args[0] != null && typeof args[0] !== "function") {
                enqueue(args[0]);
            }
            closeStream();
            // Keep mock state coherent for `on-finished` etc., but drop any
            // payload args since we already drained them.
            return (origEnd as (...a: unknown[]) => unknown)();
        }
    });

    // Renderer cancelled the fetch (e.g. user hit stop, tab navigated).
    abortSignal?.addEventListener("abort", () => {
        if (streaming) errorStream(new Error("Renderer cancelled request"));
    });

    return {
        get isStreaming() { return streaming; },
        abort: errorStream
    };
}

async function readBody(request: Request): Promise<Buffer | null> {
    if (request.method === "GET" || request.method === "HEAD" || !request.body) {
        return null;
    }
    return Buffer.from(await request.arrayBuffer());
}

/**
 * Builds an IncomingMessage-shaped `Readable` for the request side.
 *
 * Express rewrites the prototype chain of the request it receives so that
 * `req.on` resolves to `Readable.prototype.on`, which dereferences internal
 * Readable state. So a plain `EventEmitter`-based mock breaks the moment
 * body-parser or multer touches the stream. Subclassing `Readable` here means
 * the state is initialised before Express ever sees it.
 *
 * We expose only the IncomingMessage surface Express middleware actually
 * reads (`method`, `url`, `headers`, `socket`, `ip`, ...); session, cookies,
 * `req.params` and so on are populated by middleware as usual.
 */
interface BuildRequestOpts {
    method: string;
    url: string;
    headers: Record<string, string>;
    bodyBuffer: Buffer | null;
}

function buildIncomingRequest(opts: BuildRequestOpts): object {
    const buffer = opts.bodyBuffer;
    const stream = new Readable({
        read() {
            if (buffer && buffer.length > 0) {
                this.push(buffer);
            }
            this.push(null);
        }
    }) as Readable & { complete: boolean };

    // Express swaps in `app.request` (IncomingMessage subclass) as the
    // prototype. IncomingMessage._destroy emits 'aborted' whenever the message
    // wasn't marked complete and then tries to tear down a real socket. Mark
    // complete on natural end (so multer/busboy don't think the request was
    // aborted) and short-circuit the destroy path that touches the socket.
    stream.on("end", () => { stream.complete = true; });
    (stream as unknown as Record<string, unknown>)._destroy = (_err: Error | null, cb: (err?: Error | null) => void) => cb();

    const socket = { remoteAddress: "127.0.0.1", encrypted: false, readable: true, destroy() {}, end() {}, on() {}, removeListener() {} };

    const req = Object.assign(stream, {
        method: opts.method,
        url: opts.url,
        headers: opts.headers,
        httpVersion: "1.1",
        httpVersionMajor: 1,
        httpVersionMinor: 1,
        complete: false,
        aborted: false,
        // express-rate-limit and any IP-based middleware key off `req.ip`.
        // socket / connection are read by Express's `req.ip` derivation and
        // by `on-finished`: it treats the request as already finished when
        // `socket.readable` is falsy, which makes body-parser skip the body.
        socket,
        connection: socket,
        ip: "127.0.0.1"
    });

    // Tag the request so auth/CSRF middleware can distinguish a renderer→main
    // protocol dispatch from a public-HTTP request. Without this they would
    // have to fall back to the process-wide `isElectron` flag, which would
    // also bypass the bypass for LAN-reachable TCP requests on the desktop's
    // HTTP listener.
    markAsInternalElectronRequest(req);

    return req;
}

// Headers that either describe HTTP transport framing or assume an https
// origin. Letting them through on the `trilium-app://` custom scheme
// causes Chromium to abort the renderer with STATUS_BREAKPOINT — HSTS /
// COOP / CORP / origin-agent-cluster all run as part of renderer process
// setup and trip internal asserts when the scheme isn't http(s).
// Content-Length / Transfer-Encoding from Express also don't match what
// the renderer ends up reading, since we hand it a buffered body.
// Status codes for which the Fetch `Response` constructor refuses any body.
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

const STRIPPED_HEADERS = new Set([
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "upgrade",
    "te",
    "trailer",
    "strict-transport-security",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
    "cross-origin-embedder-policy",
    "origin-agent-cluster"
]);

function normalizeResponseHeaders(headers: Record<string, number | string | string[] | undefined>): [string, string][] {
    const out: [string, string][] = [];
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        if (STRIPPED_HEADERS.has(name.toLowerCase())) continue;
        if (Array.isArray(value)) {
            for (const v of value) out.push([name, v]);
        } else {
            out.push([name, String(value)]);
        }
    }
    return out;
}

// Copy whatever node-mocks-http handed us into a fresh Uint8Array the
// Fetch `Response` fully owns. Passing a shared Buffer can leave Chromium
// with a reference that's freed underneath it.
function toUint8Array(payload: unknown): Uint8Array | null {
    if (payload == null) return null;
    if (payload instanceof Uint8Array) return new Uint8Array(payload);
    if (typeof payload === "string") return new TextEncoder().encode(payload);
    if (typeof payload === "object") return new TextEncoder().encode(JSON.stringify(payload));
    return new TextEncoder().encode(String(payload));
}

export default init;
