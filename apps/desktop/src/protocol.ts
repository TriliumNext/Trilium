import { Readable } from "node:stream";

import { markAsInternalElectronRequest } from "@triliumnext/server/src/services/electron_request.js";
import electron, { protocol } from "electron";
import EventEmitter from "events";
import type { Application, Response as ExpressResponse } from "express";
import { createResponse, type MockResponse } from "node-mocks-http";

import { isTriliumAppShellUrl, TRILIUM_APP_ORIGIN, TRILIUM_APP_SCHEME } from "./services/trilium_app_origin.js";

/**
 * Registers the `trilium-app://` custom scheme as privileged so the renderer
 * can load the UI from `trilium-app://app/` with a proper origin & cookie jar,
 * fetch support, and CORS. The actual request handler is installed by
 * `setupTriliumAppProtocol` below, once `app.ready` has fired (the Express
 * app may still be building at that point — requests wait for it).
 *
 * **Must be called before `app.ready`.** Electron only honours
 * `registerSchemesAsPrivileged` if it runs synchronously during startup;
 * otherwise Chromium treats the scheme as non-standard with an opaque origin
 * and aborts navigation with `(blocked:origin)`.
 *
 * Shared between `apps/desktop` (main entry) and `apps/edit-docs`
 * (edit-docs / edit-demo entry).
 */
export function registerTriliumAppScheme() {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: TRILIUM_APP_SCHEME,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true,
                // Chromium only code-caches http(s) scripts by default; without
                // this the renderer bundle is recompiled from source on every
                // launch instead of reusing bytecode from the Code Cache dir.
                codeCache: true
            }
        }
    ]);
}

/**
 * Bridges renderer-process requests on the `trilium-app://app/...` custom
 * protocol into the Express application running in the main process.
 *
 * The renderer loads the entire UI from this scheme, so every request the
 * page makes — page load, bootstrap, API calls, static assets — arrives here
 * as a Web Fetch `Request`. We synthesise an IncomingMessage-shaped
 * `Readable` for the request and a node-mocks-http response, then dispatch
 * through the Express app so the real session, CSRF, body-parser, multer and
 * error middleware all run.
 *
 * Accepts a promise of the Express app so the handler can be installed before
 * the server has finished building — windows can then be created (and the
 * renderer can spin up) concurrently with server startup; requests that
 * arrive early simply wait inside the handler until the app resolves.
 */
export function setupTriliumAppProtocol(app: Application | Promise<Application>) {
    electron.app.whenReady().then(() => {
        installFrameOriginGuard();
        electron.protocol.handle(TRILIUM_APP_SCHEME, async (request) => {
            const origin = request.headers.get("origin");
            if (!isDispatchOriginAllowed(origin)) {
                console.error(`[trilium-app] blocked ${request.method} ${request.url} from origin '${origin}'`);
                return new Response("Forbidden", { status: 403 });
            }
            try {
                return await dispatch(await app, request);
            } catch (err) {
                console.error(`[trilium-app] dispatch failed for ${request.method} ${request.url}:`, err);
                return new Response("Internal Server Error", { status: 500 });
            }
        });
    });
}

/**
 * The primary gate in front of `dispatch`. Every dispatched request is tagged
 * with `markAsInternalElectronRequest`, which bypasses auth and CSRF — so a
 * request may only reach `dispatch` if it comes from the app shell itself.
 *
 * Request headers cannot make that distinction. Empirically (Electron 41, and
 * contrary to how http(s) origins behave) Chromium stamps **no** identifying
 * headers on requests to a privileged custom scheme: same-origin renderer
 * requests carry no `Origin` even on POST/PUT, cross-origin `fetch()` calls
 * from foreign http(s) or sandboxed frames *also* arrive without `Origin`,
 * and no `Sec-Fetch-*` or `Referer` headers exist at all. Worse, `corsEnabled`
 * is not actually enforced for reads — a foreign frame can both send and read
 * responses. Only navigation-style requests (e.g. `<form>` POSTs) get an
 * `Origin` stamped. Custom marker headers are no help either: foreign frames
 * can attach them without triggering a CORS preflight.
 *
 * What Chromium *does* expose truthfully is the requesting frame, via
 * `webRequest` — `details.frame` and its `parent` chain are main-process-side
 * state that renderer content cannot forge. So the policy is enforced in
 * `onBeforeRequest`, before the protocol handler ever runs:
 *
 * - Top-level navigations are allowed: they originate from main-process
 *   `loadURL` calls (main / extra / setup / print windows) or are already
 *   vetted by the `will-navigate` guard in `web_contents_security.ts`.
 * - Every other request — subframe navigations, fetch/XHR, scripts, images —
 *   must come from a frame chain consisting solely of the app shell
 *   (`trilium-app://app`, the sole origin ever loaded — see the loadURL call
 *   sites). Uncommitted frames (`about:blank` / `about:srcdoc` / empty URL)
 *   inherit their embedder's trust, mirroring Chromium's own origin
 *   inheritance; the chain still has to contain at least one committed app
 *   frame. This denies requests from foreign frames anywhere in the chain —
 *   e.g. a remote page loaded into an iframe — including frames *nested
 *   inside* such content.
 * - DevTools frames are allowed so source-map fetches for `trilium-app://`
 *   scripts keep working; page content can never navigate a frame to the
 *   privileged `devtools://` scheme.
 *
 * `<webview>` guests are out of scope by construction: they live in a
 * dedicated session partition where the `trilium-app://` handler is not even
 * registered, so the scheme does not resolve there at all.
 */
function installFrameOriginGuard() {
    electron.session.defaultSession.webRequest.onBeforeRequest({ urls: [`${TRILIUM_APP_SCHEME}://*/*`] }, (details, callback) => {
        let frameUrls: string[];
        try {
            frameUrls = [];
            for (let frame = details.frame; frame; frame = frame.parent) {
                frameUrls.push(frame.url);
            }
        } catch {
            // Accessing a disposed frame throws; with no attestation left the
            // requester is gone anyway, so deny.
            frameUrls = ["<disposed frame>"];
        }

        const allowed = isRequestorChainTrusted(details.resourceType, frameUrls);
        if (!allowed) {
            console.error(`[trilium-app] blocked ${details.method} ${details.url} from frame chain [${frameUrls.join(" ← ")}]`);
        }
        callback({ cancel: !allowed });
    });
}

/** Pure policy behind {@link installFrameOriginGuard}; exported for tests. */
export function isRequestorChainTrusted(resourceType: string, frameUrls: string[]): boolean {
    if (resourceType === "mainFrame") {
        return true;
    }
    const committed = frameUrls.filter((frameUrl) => frameUrl !== "" && frameUrl !== "about:blank" && frameUrl !== "about:srcdoc");
    if (committed.length === 0) {
        return false;
    }
    return committed.every(isTrustedFrameUrl);
}

function isTrustedFrameUrl(frameUrl: string): boolean {
    if (isTriliumAppShellUrl(frameUrl)) {
        return true;
    }
    try {
        return new URL(frameUrl).protocol === "devtools:";
    } catch {
        return false;
    }
}

/**
 * Second, weaker layer behind the frame-origin guard: rejects any request
 * that *positively* attests a foreign origin. As described above, the only
 * requests that carry an `Origin` on this scheme are navigation-style ones
 * (e.g. a hostile `<form method=POST>` targeting `trilium-app://`); the app's
 * own traffic and — unfortunately — foreign `fetch()` calls carry none, so
 * the absence of the header proves nothing and must be allowed through.
 */
export function isDispatchOriginAllowed(origin: string | null): boolean {
    return origin === null || origin === TRILIUM_APP_ORIGIN;
}

export async function dispatch(app: Application, request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
        headers[key] = value;
    });

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
            const getBuffer = (res as { _getBuffer?: () => Buffer | null })._getBuffer;
            /* v8 ignore next -- defensive: node-mocks-http always provides _getBuffer */
            const buf = typeof getBuffer === "function" ? getBuffer.call(res) : null;
            const data = res._getData();
            const rawPayload = buf && buf.length > 0 ? buf : data;
            // The Fetch `Response` constructor rejects a non-null body for
            // null-body status codes (101 / 204 / 205 / 304). Express is
            // happy to call `res.status(204).send()` so we must filter here.
            const body = NULL_BODY_STATUSES.has(res.statusCode) ? null : toUint8Array(rawPayload);
            // Express's own Content-Length is stripped (it can mismatch the buffered body), but the
            // media data source (<audio>/<video>) refuses a response with no length — unlike fetch(),
            // which reads to EOF. We own the exact bytes here, so restore an accurate Content-Length.
            const headers = normalizeResponseHeaders(res.getHeaders());
            if (body) {
                headers.push(["content-length", String(body.byteLength)]);
            }
            try {
                resolve(new Response(body as BodyInit | null, {
                    status: res.statusCode,
                    headers
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
                    // The no-error invocation is the unmatched-route (404) case,
                    // which never happens for the real app and would hang here;
                    // only the error path is reachable.
                    /* v8 ignore next */
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
    // Set when write() signalled backpressure (returned false). The producer
    // (e.g. archiver's pipe) then pauses until we emit a 'drain' event.
    let producerPaused = false;
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);

    // Bound how much streamed-but-unread data sits in the queue. Without this a
    // consumer slower than the producer — e.g. Electron writing a multi-GB
    // export to disk — would let the whole payload pile up in memory.
    const HIGH_WATER_MARK = 1024 * 1024; // 1 MiB

    function resumeProducerIfReady() {
        if (producerPaused && controller && controller.desiredSize !== null && controller.desiredSize > 0) {
            producerPaused = false;
            res.emit("drain");
        }
    }

    function commit() {
        if (streaming) return;
        streaming = true;
        const body = new ReadableStream<Uint8Array>({
            start(c) { controller = c; },
            // The consumer pulled (queue has capacity again) → release a producer
            // that paused on backpressure.
            pull() { resumeProducerIfReady(); }
        }, new ByteLengthQueuingStrategy({ highWaterMark: HIGH_WATER_MARK }));
        try {
            onCommit(new Response(body, {
                /* v8 ignore next -- defensive: statusCode is always set before flushHeaders */
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
        /* v8 ignore next -- defensive: close() only throws if the stream was already torn down by a consumer cancel race */
        try { controller.close(); } catch { /* already closed */ }
        controller = null;
    }

    function errorStream(reason: Error) {
        if (!controller) return;
        /* v8 ignore next -- defensive: error() only throws if the stream was already closed by a consumer cancel race */
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
                // Honour backpressure: once the queue is full, tell the producer
                // to pause until the consumer drains it (pull → 'drain').
                if (controller && controller.desiredSize !== null && controller.desiredSize <= 0) {
                    producerPaused = true;
                    return false;
                }
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
            // read() is only pulled when there is a body to deliver, so the
            // empty/absent-buffer side of this guard isn't reachable here.
            /* v8 ignore next */
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

    /* v8 ignore next -- no-op socket shims for Express middleware that may probe the connection but never does in dispatch */
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
        /* v8 ignore next -- defensive: getHeaders() never yields undefined values */
        if (value === undefined) continue;
        if (STRIPPED_HEADERS.has(name.toLowerCase())) continue;
        if (Array.isArray(value)) {
            for (const v of value) out.push([name, String(v)]);
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
