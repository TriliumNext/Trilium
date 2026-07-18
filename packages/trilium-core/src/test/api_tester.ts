import { Writable } from "node:stream";

import { HttpError } from "../errors";
import * as routes from "../routes";
import { getContext } from "../services/context";
import entityChanges from "../services/entity_changes";
import { getSql } from "../services/sql/index";

/**
 * In-process, transport-agnostic test driver for the **shared core API routes**
 * (the ones registered by `routes.buildSharedApiRoutes`). Think of it as
 * "supertest for core": it drives the exact same handlers that the Express
 * server (`apps/server`) and the standalone browser router
 * (`apps/standalone/.../browser_routes.ts`) expose, but without an HTTP server,
 * Express, or a socket — so the same spec runs under **both** the node
 * (better-sqlite3) and the standalone (sql.js WASM) test suites.
 *
 * It exercises the real request lifecycle around each handler:
 *   - path/param + query parsing (Express-style `:param`)
 *   - the execution context (cls) and SQL transaction wrapping
 *   - `convertEntitiesToPojo` + the `[statusCode, body]` / `undefined → 204`
 *     result-handler conventions
 *   - `HttpError` → status mapping (404 / 400 / 403 …)
 *   - JSON round-tripping of the response body (so e.g. dates surface as the
 *     strings an HTTP client would actually receive)
 *
 * It deliberately does **not** run the platform middleware (auth, CSRF, rate
 * limiting, multipart parsing) — those are server/Express concerns and are
 * covered by the supertest specs in `apps/server`. Auth/CSRF are treated as
 * always-passing here, mirroring the standalone browser adapter.
 */

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

type Handler = (req: ApiRequest, res?: MockResponse) => unknown;
type ResultHandler = (req: ApiRequest, res: CaptureResponse, result: unknown) => void;

interface ApiRequest {
    params: Record<string, string>;
    query: Record<string, string | undefined>;
    body: unknown;
    headers: Record<string, string>;
    method: string;
    file?: unknown;
    originalUrl: string;
    /** Express-style case-insensitive header accessor (used by e.g. the sync routes). */
    get(name: string): string | undefined;
}

interface RegisteredRoute {
    method: string;
    pattern: RegExp;
    paramNames: string[];
    run: (req: ApiRequest) => Promise<TestResponse>;
}

export interface TestResponse<T = unknown> {
    status: number;
    headers: Record<string, string>;
    body: T;
}

export interface RequestOptions {
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
    /**
     * A fake uploaded file, mirroring the `req.file` that the Express multipart
     * middleware would populate. Lets handlers that read `req.file` (image
     * update, import) be exercised in-process without a real multipart request.
     */
    file?: unknown;
}

function pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    // Drop a trailing slash from the registered path and allow an optional one
    // when matching, mirroring Express's default (non-strict) routing — several
    // core routes are registered with a trailing slash (e.g. /api/attribute-names/).
    const normalized = path.replace(/\/$/, "");
    const regexPattern = normalized
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, paramName) => {
            paramNames.push(paramName);
            return "([^/]+)";
        });
    return { pattern: new RegExp(`^${regexPattern}\\/?$`), paramNames };
}

function jsonRoundTrip(value: unknown): unknown {
    if (value === undefined || typeof value === "string") {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
}

/** Mirrors the server's `apiResultHandler` / browser `formatResult` conventions. */
function formatApiResult(result: unknown): TestResponse {
    const headers: Record<string, string> = {
        "trilium-max-entity-change-id": String(entityChanges.getMaxEntityChangeId())
    };
    const pojo = routes.convertEntitiesToPojo(result);

    if (Array.isArray(pojo) && pojo.length > 0 && Number.isInteger(pojo[0])) {
        const [ status, response ] = pojo as [number, unknown];
        return { status, headers, body: jsonRoundTrip(response) };
    }
    if (pojo === undefined) {
        return { status: 204, headers, body: undefined };
    }
    return { status: 200, headers, body: jsonRoundTrip(pojo) };
}

/** Captures what a result handler writes, for the `route(..., resultHandler)` path. */
interface CaptureResponse {
    captured?: TestResponse;
    setHeader(name: string, value: string): void;
}

/** Preserves strings and raw bytes as-is; JSON round-trips everything else. */
function normalizeResponseBody(body: unknown): unknown {
    if (body === undefined || typeof body === "string") {
        return body;
    }
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        return Buffer.from(body as Uint8Array);
    }
    return jsonRoundTrip(body);
}

/**
 * A faithful in-process stand-in for the Express `res` that handlers write to
 * directly (image routes, file downloads, the streaming export). It extends a
 * Node {@link Writable} so the **server** export path works exactly as in
 * production — `archive.pipe(res)` with the `archiver` package needs a real
 * writable stream — while also supporting the **browser** export path, where
 * `BrowserZipArchive.finalize()` calls `res.send(zipBytes)` (and falls back to
 * `res.write()`/`res.end()`). Both vitest suites (server + standalone) run on
 * Node, so a real stream is available under either runtime.
 *
 * On top of the stream it exposes the small Express surface the handlers use
 * and captures a `{ status, headers, body }` snapshot, keeping the body as raw
 * bytes for streamed/binary responses so tests can inspect them.
 */
class MockResponse extends Writable {

    used = false;
    statusCode = 200;
    headers: Record<string, string> = {};

    private chunks: Buffer[] = [];
    private sendBody: unknown;
    private hasSendBody = false;

    status(code: number) { this.statusCode = code; return this; }
    set(name: string, value: string) { this.headers[name] = value; return this; }
    setHeader(name: string, value: string) { this.headers[name] = value; return this; }
    removeHeader(name: string) { delete this.headers[name]; return this; }
    send(body: unknown) { this.used = true; this.hasSendBody = true; this.sendBody = body; return this; }
    json(body: unknown) { return this.send(body); }
    sendStatus(code: number) { this.used = true; this.statusCode = code; return this; }

    override _write(chunk: Buffer | Uint8Array | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.used = true;
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
        callback();
    }

    snapshot(): TestResponse {
        let body: unknown;
        if (this.chunks.length > 0) {
            body = Buffer.concat(this.chunks);
        } else if (this.hasSendBody) {
            body = normalizeResponseBody(this.sendBody);
        }
        return { status: this.statusCode, headers: this.headers, body };
    }

}

function createMockResponse(): MockResponse {
    return new MockResponse();
}

export class CoreApiTester {

    private routes: RegisteredRoute[] = [];

    private add(method: string, path: string, run: (req: ApiRequest) => Promise<TestResponse>) {
        const { pattern, paramNames } = pathToRegex(path);
        this.routes.push({ method: method.toUpperCase(), pattern, paramNames, run });
    }

    /** Builds a tester with every shared core route registered. */
    static build(): CoreApiTester {
        const tester = new CoreApiTester();
        tester.registerAll();
        return tester;
    }

    private registerAll() {
        const apiRoute = (method: HttpMethod, path: string, handler: Handler) =>
            this.add(method, path, async (req) => {
                const result = await getContext().init(() =>
                    getSql().transactional(() => handler(req)));
                return formatApiResult(result);
            });

        const asyncApiRoute = (method: HttpMethod, path: string, handler: Handler) =>
            this.add(method, path, async (req) => {
                const result = await getContext().init(async () => await handler(req));
                return formatApiResult(result);
            });

        const buildRoute = (transactional: boolean) =>
            (
                method: HttpMethod,
                path: string,
                _mw: unknown[],
                handler: Handler,
                resultHandler?: ResultHandler | null
            ) =>
                this.add(method, path, async (req) => {
                    const mockRes = createMockResponse();
                    const invoke = () => handler(req, mockRes);
                    const result = transactional
                        ? await getContext().init(() => getSql().transactional(invoke))
                        : await getContext().init(async () => await invoke());

                    if (mockRes.used) {
                        return mockRes.snapshot();
                    }
                    if (resultHandler) {
                        const captureHeaders: Record<string, string> = {};
                        const capture: CaptureResponse = {
                            setHeader(name, value) { captureHeaders[name] = value; }
                        };
                        resultHandler(req, capture, result);
                        const base = capture.captured ?? formatApiResult(result);
                        return { ...base, headers: { ...captureHeaders, ...base.headers } };
                    }
                    return formatApiResult(result);
                });

        const apiResultHandler: ResultHandler = (_req, res, result) => {
            res.captured = formatApiResult(result);
        };
        const noop = () => {};

        routes.buildSharedApiRoutes({
            route: buildRoute(true),
            asyncRoute: buildRoute(false),
            apiRoute,
            asyncApiRoute,
            apiResultHandler,
            checkApiAuth: noop,
            checkApiAuthOrElectron: noop,
            checkAppNotInitialized: noop,
            checkCredentials: noop,
            loginRateLimiter: noop,
            uploadMiddlewareWithErrorHandling: noop,
            importMiddlewareWithErrorHandling: noop,
            csrfMiddleware: noop
        });
    }

    async request<T = unknown>(
        method: HttpMethod,
        path: string,
        opts: RequestOptions = {}
    ): Promise<TestResponse<T>> {
        const url = new URL(path, "http://core.test");
        for (const [ key, value ] of Object.entries(opts.query ?? {})) {
            if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        }

        const query: Record<string, string | undefined> = {};
        for (const [ key, value ] of url.searchParams) {
            query[key] = value;
        }

        const upperMethod = method.toUpperCase();
        for (const route of this.routes) {
            if (route.method !== upperMethod) {
                continue;
            }
            const match = url.pathname.match(route.pattern);
            if (!match) {
                continue;
            }

            const params: Record<string, string> = {};
            route.paramNames.forEach((name, i) => {
                params[name] = decodeURIComponent(match[i + 1]);
            });

            const headers = opts.headers ?? {};
            const lowerHeaders: Record<string, string> = {};
            for (const [ key, value ] of Object.entries(headers)) {
                lowerHeaders[key.toLowerCase()] = value;
            }

            const req: ApiRequest = {
                params,
                query,
                body: opts.body,
                headers,
                method: upperMethod,
                originalUrl: url.pathname + url.search,
                file: opts.file,
                get: (name: string) => lowerHeaders[name.toLowerCase()]
            };

            try {
                return (await route.run(req)) as TestResponse<T>;
            } catch (e) {
                const status = e instanceof HttpError ? e.statusCode : 500;
                const message = e instanceof Error ? e.message : String(e);
                return { status, headers: {}, body: { message } as T };
            }
        }

        const message = `No route for ${upperMethod} ${url.pathname}`;
        return { status: 404, headers: {}, body: { message } as T };
    }

    get<T = unknown>(path: string, opts?: RequestOptions) {
        return this.request<T>("get", path, opts);
    }

    post<T = unknown>(path: string, opts?: RequestOptions) {
        return this.request<T>("post", path, opts);
    }

    put<T = unknown>(path: string, opts?: RequestOptions) {
        return this.request<T>("put", path, opts);
    }

    patch<T = unknown>(path: string, opts?: RequestOptions) {
        return this.request<T>("patch", path, opts);
    }

    delete<T = unknown>(path: string, opts?: RequestOptions) {
        return this.request<T>("delete", path, opts);
    }

}
