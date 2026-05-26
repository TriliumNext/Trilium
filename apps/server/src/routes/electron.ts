import electron from "electron";
import EventEmitter from "events";
import type { Application } from "express";
import { createResponse } from "node-mocks-http";
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

        res.on("end", () => {
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
                    if (err) reject(err);
                }
            );
        } catch (err) {
            reject(err);
        }
    });
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
