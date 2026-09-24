/**
 * Browser route definitions.
 * This integrates with the shared route builder from @triliumnext/core.
 */

import { BootstrapDefinition } from '@triliumnext/commons';
import { checkIntegrity, consistency_checks, entity_changes, getContext, getPlatform, getSharedBootstrapItems, getSql, isScriptingEnabled, type Request, type Response, routes, sql_init } from '@triliumnext/core';
import llmRoute from '@triliumnext/core/src/routes/api/llm.js';
import type { ShareReply } from '@triliumnext/core/src/share/handlers.js';
import { SHARE_ROUTE_PATHS, type ShareRoutePath } from '@triliumnext/core/src/share/route_paths.js';

import packageJson from '../../package.json' with { type: 'json' };
import { type BrowserRequest, BrowserRouter } from './browser_router';
import { dbLock } from './db_lock';

/** Minimal response object used by apiResultHandler to capture the processed result. */
interface ResultHandlerResponse {
    headers: Record<string, string>;
    result: unknown;
    setHeader(name: string, value: string): void;
}

/**
 * Symbol used to mark a result as an already-formatted BrowserResponse,
 * so that BrowserRouter.formatResult passes it through without JSON-serializing.
 * Uses Symbol.for() so the same symbol is shared across modules.
 */
const RAW_RESPONSE = Symbol.for('RAW_RESPONSE');

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Adapts a {@link BrowserRequest} to the {@link Request} shape shared route handlers read.
 */
function toCoreRequest(req: BrowserRequest): Request {
    /* v8 ignore next -- @preserve: BrowserRouter.dispatch always sets req.headers, so the ?? fallback is unreachable. */
    const headers = req.headers ?? {};
    return {
        params: req.params,
        query: req.query,
        body: req.body,
        headers,
        method: req.method,
        file: req.file,
        get originalUrl() { return req.url; },
        // `fetch` lower-cases the header names it sends, which is the form BrowserRouter stores them in.
        get: (name: string) => headers[name.toLowerCase()]
    };
}

/**
 * Extracts context headers from the request and sets them in the execution context,
 * mirroring what the server does in route_api.ts.
 */
function setContextFromHeaders(req: BrowserRequest) {
    /* v8 ignore next -- @preserve: BrowserRouter.dispatch always sets req.headers, so the ?? fallback is unreachable. */
    const headers = req.headers ?? {};
    const ctx = getContext();
    ctx.set("componentId", headers["trilium-component-id"]);
    ctx.set("localNowDateTime", headers["trilium-local-now-datetime"]);
    ctx.set("hoistedNoteId", headers["trilium-hoisted-note-id"] || "root");
}

/**
 * Wraps a core route handler to work with the BrowserRouter.
 * Core handlers expect an Express-like request object with params, query, and body.
 * Each request is wrapped in an execution context (like cls.init() on the server)
 * to ensure entity change tracking works correctly.
 */
function wrapHandler(handler: (req: Request) => unknown, transactional: boolean) {
    return (req: BrowserRequest) => {
        return dbLock.runShared(() => getContext().init(() => {
            setContextFromHeaders(req);
            const coreReq = toCoreRequest(req);
            if (transactional) {
                return getSql().transactional(() => handler(coreReq));
            }
            return handler(coreReq);
        }));
    };
}

/**
 * Creates an apiRoute function compatible with buildSharedApiRoutes.
 * This bridges the core's route registration to the BrowserRouter.
 */
function createApiRoute(router: BrowserRouter, transactional: boolean) {
    return (method: HttpMethod, path: string, handler: (req: Request) => unknown) => {
        router.register(method, path, wrapHandler(handler, transactional));
    };
}

/**
 * Low-level route registration matching the server's `route()` signature:
 *   route(method, path, middleware[], handler, resultHandler)
 *
 * In standalone mode:
 * - Middleware (e.g. checkApiAuth) is skipped — there's no authentication.
 * - The resultHandler is applied to post-process the result (entity conversion, status codes).
 */
function createRoute(router: BrowserRouter) {
    return (method: HttpMethod, path: string, _middleware: any[], handler: (req: Request, res: Response) => unknown, resultHandler?: ((req: Request, res: ResultHandlerResponse, result: unknown) => unknown) | null) => {
        router.register(method, path, (req: BrowserRequest) => {
            return dbLock.runShared(() => getContext().init(() => {
                setContextFromHeaders(req);
                const coreReq = toCoreRequest(req);
                const mockRes = createMockResponse();
                const result = getSql().transactional(() => handler(coreReq, mockRes));

                // If the handler used the mock response (e.g. image routes that call res.send()),
                // return it as a raw response so BrowserRouter doesn't JSON-serialize it.
                if (mockRes._used) {
                    return toRawResponse(mockRes);
                }

                if (resultHandler) {
                    // Create a minimal response object that captures what apiResultHandler sets.
                    const res = createResultHandlerResponse();
                    resultHandler(coreReq, res, result);
                    return res.result;
                }

                return result;
            }));
        });
    };
}

/**
 * Async variant of createRoute for handlers that return Promises (e.g. import).
 * Uses transactionalAsync (manual BEGIN/COMMIT/ROLLBACK) instead of the synchronous
 * transactional() wrapper, which would commit an empty transaction immediately when
 * passed an async callback.
 */
function createAsyncRoute(router: BrowserRouter, { transactional = true } = {}) {
    return (method: HttpMethod, path: string, _middleware: any[], handler: (req: Request, res: Response) => Promise<unknown>, resultHandler?: ((req: Request, res: ResultHandlerResponse, result: unknown) => unknown) | null) => {
        router.register(method, path, (req: BrowserRequest) => {
            // Exclusive: this transaction stays open across awaits, so no other
            // route may touch the connection until it commits. See db_lock.ts.
            return dbLock.runExclusive(() => getContext().init(async () => {
                setContextFromHeaders(req);
                const coreReq = toCoreRequest(req);
                const mockRes = createMockResponse();
                const run = () => handler(coreReq, mockRes);
                const result = transactional ? await getSql().transactionalAsync(run) : await run();

                // If the handler used the mock response (e.g. image routes that call res.send()),
                // return it as a raw response so BrowserRouter doesn't JSON-serialize it.
                if (mockRes._used) {
                    return toRawResponse(mockRes);
                }

                if (resultHandler) {
                    // Create a minimal response object that captures what apiResultHandler sets.
                    const res = createResultHandlerResponse();
                    resultHandler(coreReq, res, result);
                    return res.result;
                }

                return result;
            }) as Promise<unknown>);
        });
    };
}

/**
 * Creates the {@link Response} a handler that writes its own body (the image routes, the streaming
 * export) is given, capturing the status, headers and body the {@link BrowserRouter} then sends.
 */
function createMockResponse() {
    const chunks: string[] = [];
    const res = {
        _used: false,
        _status: 200,
        _headers: {} as Record<string, string>,
        _body: null as unknown,
        set(name: string, value: string) {
            res._headers[name] = value;
            return res;
        },
        setHeader(name: string, value: string) {
            res._headers[name] = value;
            return res;
        },
        removeHeader(name: string) {
            delete res._headers[name];
            return res;
        },
        status(code: number) {
            res._status = code;
            return res;
        },
        send(body: unknown) {
            res._used = true;
            // Express routes an object, a number or a boolean through res.json(), leaving only
            // strings and bytes to go out as they are. The User Guide's handler example answers
            // `api.res.send(400)`, which reaches BrowserRouter as an unencodable body otherwise.
            if (body !== null && isJsonSent(body)) {
                return res.json(body);
            }
            res._body = body;
            return res;
        },
        json(body: unknown) {
            res._used = true;
            // Express fills in the type only when the handler has not chosen one, so a handler
            // answering `application/problem+json` keeps it.
            if (!hasHeader(res._headers, "Content-Type")) {
                res._headers["Content-Type"] = "application/json; charset=utf-8";
            }
            res._body = JSON.stringify(body);
            return res;
        },
        redirect(url: string) {
            res._used = true;
            res._status = 302;
            res._headers["Location"] = url;
        },
        sendStatus(code: number) {
            res._used = true;
            res._status = code;
            return res;
        },
        write(chunk: string) {
            chunks.push(chunk);
            return true;
        },
        end() {
            res._used = true;
            res._body = chunks.join("");
            return res;
        }
    };
    return res;
}

/** Whether Express would hand this body to `res.json()` rather than write it out as it stands. */
function isJsonSent(body: unknown): boolean {
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        return false;
    }

    return typeof body === "object" || typeof body === "number" || typeof body === "boolean";
}

/** Header names are case-insensitive, while the record a handler writes them into is not. */
function hasHeader(headers: Record<string, string>, name: string): boolean {
    return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

/**
 * Standalone apiResultHandler matching the server's behavior:
 * - Converts Becca entities to POJOs
 * - Handles [statusCode, response] tuple format
 * - Sets trilium-max-entity-change-id (captured in response headers)
 */
function apiResultHandler(_req: Request, res: ResultHandlerResponse, result: unknown) {
    res.headers["trilium-max-entity-change-id"] = String(entity_changes.getMaxEntityChangeId());
    result = routes.convertEntitiesToPojo(result);

    if (Array.isArray(result) && result.length > 0 && Number.isInteger(result[0])) {
        const [_statusCode, response] = result;
        res.result = response;
    } else if (result === undefined) {
        res.result = "";
    } else {
        res.result = result;
    }
}

/**
 * No-op middleware stubs for standalone mode.
 *
 * In a browser context there is no network authentication, rate limiting,
 * or multi-user access, so all auth/rate-limit middleware is a no-op.
 *
 * `checkAppNotInitialized` still guards setup routes: if the database is
 * already initialised the middleware throws so the route handler is never
 * reached (mirrors the server behaviour).
 */
function noopMiddleware() {
    // No-op.
}

function checkAppNotInitialized() {
    if (sql_init.isDbInitialized()) {
        throw new Error("App already initialized.");
    }
}

/**
 * Creates a minimal response-like object for the apiResultHandler.
 */
function createResultHandlerResponse(): ResultHandlerResponse {
    return {
        headers: {},
        result: undefined,
        setHeader(name: string, value: string) {
            this.headers[name] = value;
        }
    };
}

/**
 * Register all API routes on the browser router using the shared builder.
 *
 * @param router - The browser router instance
 */
export function registerRoutes(router: BrowserRouter): void {
    const apiRoute = createApiRoute(router, true);
    routes.buildSharedApiRoutes({
        route: createRoute(router),
        asyncRoute: createAsyncRoute(router),
        asyncRouteWithoutTransaction: createAsyncRoute(router, { transactional: false }),
        apiRoute,
        asyncApiRoute: createApiRoute(router, false),
        apiResultHandler,
        checkApiAuth: noopMiddleware,
        checkApiAuthOrElectron: noopMiddleware,
        checkAppNotInitialized,
        // Nothing reaches this build but the page it is part of: there is no port, no session and
        // nobody else who could ask. The wizard's password gate exists for instances served over a
        // network, which this one never is.
        checkSetupAuth: noopMiddleware,
        checkCredentials: noopMiddleware,
        loginRateLimiter: noopMiddleware,
        uploadMiddlewareWithErrorHandling: noopMiddleware,
        // The browser variant has no disk; uploads already arrive as a buffer (see browser_router.ts), so
        // imports use the same no-op middleware rather than the server's disk-storage one.
        importMiddlewareWithErrorHandling: noopMiddleware,
        csrfMiddleware: noopMiddleware
    });
    apiRoute('get', '/bootstrap', bootstrapRoute);

    // Streaming a chat, in the only form this runtime can serve it: the request
    // starts the completion and returns, and the chunks arrive over the
    // WebSocket-style channel (see core's routes/api/llm.ts). It is registered
    // here rather than in the shared table because the server and the desktop app
    // answer `/api/llm-chat/stream` with Server-Sent Events instead — they can
    // hold a response open, and it delivers the chunks to the one client that
    // asked rather than broadcasting them to every device signed in.
    apiRoute('post', '/api/llm-chat/stream-start', llmRoute.startChatStream);
    apiRoute('post', '/api/llm-chat/stream-abort', llmRoute.abortChatStream);

    // Keeping the database in order, which the server answers from its own routes (see the server's
    // `routes.ts`). Registered here rather than in the shared table because only two of the three
    // belong in this runtime: compacting rebuilds the database through the temporary store, which
    // this build keeps in memory, so it would ask the browser for the size of the database again at
    // the moment the user is short of room.
    apiRoute("get", "/api/database/check-integrity", () => checkIntegrity());
    // Awaited rather than left running, and without a transaction of its own: the checks write as
    // they go and reload becca at the end, which no other request may be interleaved with. The
    // server lets its own run on past the response, having no such connection to protect.
    createAsyncRoute(router, { transactional: false })(
        "post",
        "/api/database/find-and-fix-consistency-issues",
        [],
        () => consistency_checks.runOnDemandChecks(true),
        apiResultHandler
    );

    // Shared notes, served from the same database the app reads. Nobody outside this browser can
    // reach them — there is no server listening — but a published note renders at its real /share
    // URL, which is what makes the feature testable here at all. Registered by path alone and
    // loaded on the first request, so EJS, the share theme and the syntax highlighter stay out of
    // the worker's startup bundle.
    for (const path of SHARE_ROUTE_PATHS) {
        router.get(path, (req) => dispatchShare(path, req));
    }
    // The share root is addressed as `/share/`; `/share` answers with the redirect that adds the
    // slash, which the pattern above cannot match because a parameter needs a segment to fill it.
    router.get("/share", (req) => dispatchShare("/share/", req));

    registerCustomRoute(router);

    // Dummy routes for compatibility.
    apiRoute("get", "/api/script/widgets", () => []);
    apiRoute("get", "/api/script/startup", () => []);
    apiRoute("get", "/api/system-checks", () => ({ isCpuArchMismatch: false }));
}

/** The request as `apiRoute` hands it over: the Express-like wrapper, not the raw {@link BrowserRequest}. */
function bootstrapRoute(req: { query: Record<string, string | undefined> }): BootstrapDefinition {
    const assetPath = ".";

    const isDbInitialized = sql_init.isDbInitialized();
    const commonItems = {
        ...getSharedBootstrapItems(assetPath, isDbInitialized),
        // The setup wizard's password gate exists for instances served over a network. This one is
        // served to nobody, so asking would be asking for nothing — and `checkSetupAuth` here is a
        // no-op, which would leave the screen holding out for an answer it never checks.
        setupAuthRequired: false,
        setupSecondFactorRequired: false,
        isDev: import.meta.env.DEV,
        isStandalone: true,
        // A window torn off into its own popup carries `?extraWindow`, same as on the server. It has
        // to be told, or it restores the saved tab set on load and then writes its own back over it.
        isMainWindow: !req.query.extraWindow,
        isElectron: false,
        hasNativeTitleBar: false,
        hasBackgroundEffects: false,
        triliumVersion: packageJson.version,
        device: false as const, // Let the client detect device type.
        appPath: assetPath,
        instanceName: "standalone",
        TRILIUM_SAFE_MODE: !!getPlatform().getEnv("TRILIUM_SAFE_MODE")
    };

    if (!isDbInitialized) {
        return {
            ...commonItems,
            baseApiUrl: "../api/",
            isProtectedSessionAvailable: false,
        };
    }

    return {
        ...commonItems,
        csrfToken: "dummy-csrf-token",
        baseApiUrl: "../api/",
        platform: "web",
    };
}

/** Answers one share request, loading the share subsystem the first time one arrives. */
async function dispatchShare(path: ShareRoutePath, req: BrowserRequest) {
    const [ share, { registerShareProvider } ] = await Promise.all([
        import("@triliumnext/core/src/share/index.js"),
        import("./share_provider.js")
    ]);

    registerShareProvider();

    /* v8 ignore next -- @preserve: BrowserRouter.dispatch always sets req.headers, so the ?? fallback is unreachable. */
    const headers = req.headers ?? {};
    const shareRequest = {
        path: req.path,
        params: req.params,
        query: req.query,
        // `fetch` lower-cases the header names it sends, which is the form BrowserRouter stores them in.
        getHeader: (name: string) => headers[name.toLowerCase()]
    };

    // Shared, and without a transaction: the share routes only read. The imports above are awaited
    // before the lock is taken, so nothing is held open across them.
    return dbLock.runShared(() => getContext().init(() => {
        const reply = share.handleShareRequest(share.getShareRoute(path), shareRequest);

        return toRawShareResponse(reply);
    }));
}

/** Marks a share reply as already formatted, so {@link BrowserRouter} sends it rather than re-wrapping it. */
function toRawShareResponse(reply: ShareReply) {
    return {
        [RAW_RESPONSE]: true as const,
        status: reply.status,
        headers: reply.redirect ? { ...reply.headers, location: reply.redirect } : reply.headers,
        body: reply.body
    };
}

/**
 * Every method a handler script can answer. The server registers its route as an Express `all`,
 * which covers HEAD and OPTIONS too, so both are registered here to match — `BrowserRouter` matches
 * on the method, and one left out answers the router's own 404 rather than reaching the handler.
 */
const CUSTOM_HANDLER_METHODS = ["get", "head", "post", "put", "patch", "delete", "options"];

/**
 * Serves `/custom/`: the notes labelled `#customRequestHandler` and `#customResourceProvider`.
 *
 * Registered here rather than in the shared table because the server answers it from a route of its
 * own, ahead of the API router and without CSRF, and because it takes any method rather than one.
 */
function registerCustomRoute(router: BrowserRouter) {
    for (const method of CUSTOM_HANDLER_METHODS) {
        router.register(method, "/custom/*path", (req: BrowserRequest) => dbLock.runShared(
            () => getContext().init(async () => {
                setContextFromHeaders(req);
                const path = req.params.path;
                const res = createMockResponse();

                // Handler scripts can await, and a transaction held across that wait would block
                // every other request on the worker's single SQLite connection.
                //
                // Awaited because this runtime sends the response as soon as the handler is done,
                // where Express holds the connection open past it. A script that answers after an
                // `await` returns its promise, which has to settle before the body goes out.
                await routes.handleCustomRequest(path, toCoreRequest(req), res, isScriptingEnabled);

                if (!res._used) {
                    res.setHeader("Content-Type", "text/plain").status(500)
                        .send(`Custom handler for '${path}' did not send a response.`);
                }

                // A HEAD response carries the status and headers of the GET it stands in for, and
                // nothing else. Express strips the body itself.
                return toRawResponse(res, req.method === "HEAD");
            }) as Promise<unknown>
        ));
    }
}

/** Wraps what a handler wrote to its mock response so {@link BrowserRouter} sends it verbatim. */
function toRawResponse(res: ReturnType<typeof createMockResponse>, omitBody = false) {
    return {
        [RAW_RESPONSE]: true as const,
        status: res._status,
        headers: res._headers,
        body: omitBody ? null : res._body
    };
}

/**
 * Create and configure a router with all routes registered.
 */
export function createConfiguredRouter(): BrowserRouter {
    const router = new BrowserRouter();
    registerRoutes(router);
    return router;
}
