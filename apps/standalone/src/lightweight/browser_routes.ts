/**
 * Browser route definitions.
 * This integrates with the shared route builder from @triliumnext/core.
 */

import { BootstrapDefinition } from '@triliumnext/commons';
import { entity_changes, getContext, getPlatform, getSharedBootstrapItems, getSql, routes, sql_init } from '@triliumnext/core';

import packageJson from '../../package.json' with { type: 'json' };
import { type BrowserRequest, BrowserRouter } from './browser_router';

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
 * Creates an Express-like request object from a BrowserRequest.
 */
function toExpressLikeReq(req: BrowserRequest) {
    return {
        params: req.params,
        query: req.query,
        body: req.body,
        headers: req.headers ?? {},
        method: req.method,
        file: req.file,
        get originalUrl() { return req.url; }
    };
}

/**
 * Extracts context headers from the request and sets them in the execution context,
 * mirroring what the server does in route_api.ts.
 */
function setContextFromHeaders(req: BrowserRequest) {
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
function wrapHandler(handler: (req: any) => unknown, transactional: boolean) {
    return (req: BrowserRequest) => {
        return getContext().init(() => {
            setContextFromHeaders(req);
            const expressLikeReq = toExpressLikeReq(req);
            if (transactional) {
                return getSql().transactional(() => handler(expressLikeReq));
            }
            return handler(expressLikeReq);
        });
    };
}

/**
 * Creates an apiRoute function compatible with buildSharedApiRoutes.
 * This bridges the core's route registration to the BrowserRouter.
 */
function createApiRoute(router: BrowserRouter, transactional: boolean) {
    return (method: HttpMethod, path: string, handler: (req: any) => unknown) => {
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
    return (method: HttpMethod, path: string, _middleware: any[], handler: (req: any, res: any) => unknown, resultHandler?: ((req: any, res: any, result: unknown) => unknown) | null) => {
        router.register(method, path, (req: BrowserRequest) => {
            return getContext().init(() => {
                setContextFromHeaders(req);
                const expressLikeReq = toExpressLikeReq(req);
                const mockRes = createMockExpressResponse();
                const result = getSql().transactional(() => handler(expressLikeReq, mockRes));

                // If the handler used the mock response (e.g. image routes that call res.send()),
                // return it as a raw response so BrowserRouter doesn't JSON-serialize it.
                if (mockRes._used) {
                    return {
                        [RAW_RESPONSE]: true as const,
                        status: mockRes._status,
                        headers: mockRes._headers,
                        body: mockRes._body
                    };
                }

                if (resultHandler) {
                    // Create a minimal response object that captures what apiResultHandler sets.
                    const res = createResultHandlerResponse();
                    resultHandler(expressLikeReq, res, result);
                    return res.result;
                }

                return result;
            });
        });
    };
}

/**
 * Async variant of createRoute for handlers that return Promises (e.g. import).
 * Uses transactionalAsync (manual BEGIN/COMMIT/ROLLBACK) instead of the synchronous
 * transactional() wrapper, which would commit an empty transaction immediately when
 * passed an async callback.
 */
function createAsyncRoute(router: BrowserRouter) {
    return (method: HttpMethod, path: string, _middleware: any[], handler: (req: any, res: any) => Promise<unknown>, resultHandler?: ((req: any, res: any, result: unknown) => unknown) | null) => {
        router.register(method, path, (req: BrowserRequest) => {
            return getContext().init(async () => {
                setContextFromHeaders(req);
                const expressLikeReq = toExpressLikeReq(req);
                const mockRes = createMockExpressResponse();
                const result = await getSql().transactionalAsync(() => handler(expressLikeReq, mockRes));

                // If the handler used the mock response (e.g. image routes that call res.send()),
                // return it as a raw response so BrowserRouter doesn't JSON-serialize it.
                if (mockRes._used) {
                    return {
                        [RAW_RESPONSE]: true as const,
                        status: mockRes._status,
                        headers: mockRes._headers,
                        body: mockRes._body
                    };
                }

                if (resultHandler) {
                    // Create a minimal response object that captures what apiResultHandler sets.
                    const res = createResultHandlerResponse();
                    resultHandler(expressLikeReq, res, result);
                    return res.result;
                }

                return result;
            });
        });
    };
}

/**
 * Creates a mock Express response object that captures calls to set(), send(), sendStatus(), etc.
 * Used for route handlers (like image routes) that write directly to the response.
 */
function createMockExpressResponse() {
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
            res._body = body;
            return res;
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

/**
 * Standalone apiResultHandler matching the server's behavior:
 * - Converts Becca entities to POJOs
 * - Handles [statusCode, response] tuple format
 * - Sets trilium-max-entity-change-id (captured in response headers)
 */
function apiResultHandler(_req: any, res: ResultHandlerResponse, result: unknown) {
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
        apiRoute,
        asyncApiRoute: createApiRoute(router, false),
        apiResultHandler,
        checkApiAuth: noopMiddleware,
        checkApiAuthOrElectron: noopMiddleware,
        checkAppNotInitialized,
        checkCredentials: noopMiddleware,
        loginRateLimiter: noopMiddleware,
        uploadMiddlewareWithErrorHandling: noopMiddleware,
        csrfMiddleware: noopMiddleware
    });
    apiRoute('get', '/bootstrap', bootstrapRoute);

    // Dummy routes for compatibility.
    apiRoute("get", "/api/script/widgets", () => []);
    apiRoute("get", "/api/script/startup", () => []);
    apiRoute("get", "/api/system-checks", () => ({ isCpuArchMismatch: false }));
}

function bootstrapRoute(): BootstrapDefinition {
    const assetPath = ".";

    const isDbInitialized = sql_init.isDbInitialized();
    const commonItems = {
        ...getSharedBootstrapItems(assetPath, isDbInitialized),
        isDev: import.meta.env.DEV,
        isStandalone: true,
        isMainWindow: true,
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
        headingStyle: "plain",
        layoutOrientation: "vertical",
        platform: "web",
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
