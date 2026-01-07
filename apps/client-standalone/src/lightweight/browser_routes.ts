/**
 * Browser route definitions.
 * This integrates with the shared route builder from @triliumnext/core.
 */

import { routes, icon_packs as iconPackService } from '@triliumnext/core';
import { BrowserRouter, type BrowserRequest } from './browser_router';

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
}

function bootstrapRoute() {
   const iconPacks = iconPackService.getIconPacks();
   const assetPath = ".";

   return {
        assetPath,
        baseApiUrl: "../api/",
        themeCssUrl: null,
        themeUseNextAsBase: "next",
        device: "desktop",
        headingStyle: "default",
        layoutOrientation: "vertical",
        platform: "web",
        isElectron: false,
        hasNativeTitleBar: false,
        hasBackgroundEffects: true,
        currentLocale: { id: "en", rtl: false },
        iconPackCss: iconPacks
            .map(p => iconPackService.generateCss(p, p.builtin
                ? `${assetPath}/fonts/${p.fontAttachmentId}.${iconPackService.MIME_TO_EXTENSION_MAPPINGS[p.fontMime]}`
                : `api/attachments/download/${p.fontAttachmentId}`))
            .filter(Boolean)
            .join("\n\n"),
        iconRegistry: iconPackService.generateIconRegistry(iconPacks),
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
