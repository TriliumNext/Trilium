/**
 * Browser route definitions.
 * This integrates with the shared route builder from @triliumnext/core.
 */

import { BootstrapDefinition } from '@triliumnext/commons';
import { getSharedBootstrapItems, routes } from '@triliumnext/core';

import packageJson from '../../package.json' with { type: 'json' };
import { type BrowserRequest,BrowserRouter } from './browser_router';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Wraps a core route handler to work with the BrowserRouter.
 * Core handlers expect an Express-like request object with params, query, and body.
 */
function wrapHandler(handler: (req: any) => unknown) {
    return (req: BrowserRequest) => {
        // Create an Express-like request object
        const expressLikeReq = {
            params: req.params,
            query: req.query,
            body: req.body
        };
        return handler(expressLikeReq);
    };
}

/**
 * Creates an apiRoute function compatible with buildSharedApiRoutes.
 * This bridges the core's route registration to the BrowserRouter.
 */
function createApiRoute(router: BrowserRouter) {
    return (method: HttpMethod, path: string, handler: (req: any) => unknown) => {
        router.register(method, path, wrapHandler(handler));
    };
}

/**
 * Register all API routes on the browser router using the shared builder.
 *
 * @param router - The browser router instance
 */
export function registerRoutes(router: BrowserRouter): void {
    const apiRoute = createApiRoute(router);
    routes.buildSharedApiRoutes(apiRoute);
    apiRoute('get', '/bootstrap', bootstrapRoute);

    // Dummy routes for compatibility.
    apiRoute("get", "/api/script/widgets", () => []);
    apiRoute("get", "/api/script/startup", () => []);
    apiRoute("get", "/api/system-checks", () => ({ isCpuArchMismatch: false }));
    apiRoute("get", "/api/search/:searchString", () => []);
    apiRoute("get", "/api/search-templates", () => []);
    apiRoute("get", "/api/autocomplete", () => []);
}

function bootstrapRoute() {

    const assetPath = ".";

    return {
        ...getSharedBootstrapItems(assetPath),
        appPath: assetPath,
        device: false, // Let the client detect device type.
        csrfToken: "dummy-csrf-token",
        themeCssUrl: false,
        themeUseNextAsBase: "next",
        triliumVersion: packageJson.version,
        baseApiUrl: "../api/",
        headingStyle: "plain",
        layoutOrientation: "vertical",
        platform: "web",
        isDev: import.meta.env.DEV,
        isMainWindow: true,
        isElectron: false,
        isStandalone: true,
        hasNativeTitleBar: false,
        hasBackgroundEffects: false,

        // TODO: Fill properly
        currentLocale: { id: "en", name: "English", rtl: false },
        isRtl: false,
        instanceName: null,
        appCssNoteIds: [],
        TRILIUM_SAFE_MODE: false
    } satisfies BootstrapDefinition;
}

/**
 * Create and configure a router with all routes registered.
 */
export function createConfiguredRouter(): BrowserRouter {
    const router = new BrowserRouter();
    registerRoutes(router);
    return router;
}
