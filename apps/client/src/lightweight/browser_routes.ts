/**
 * Browser route definitions.
 * This mirrors the server's routes.ts but for the browser worker.
 */

import type { routes as coreRoutes } from '@triliumnext/core';
import { BrowserRouter, type BrowserRequest } from './browser_router';

type CoreRoutes = typeof coreRoutes;

/**
 * Register all API routes on the browser router.
 * 
 * @param router - The browser router instance
 * @param routes - The core routes module from @triliumnext/core
 */
export function registerRoutes(router: BrowserRouter, routes: CoreRoutes): void {
    const { optionsApiRoute, treeApiRoute, keysApiRoute } = routes;

    // Tree routes
    router.get('/api/tree', (req) => 
        treeApiRoute.getTree({
            query: {
                subTreeNoteId: req.query.subTreeNoteId
            }
        } as any)
    );
    
    router.post('/api/tree/load', (req) => 
        treeApiRoute.load({
            body: req.body
        } as any)
    );

    // Options routes
    router.get('/api/options', () => 
        optionsApiRoute.getOptions()
    );
    
    router.put('/api/options/:name/:value', (req) => 
        optionsApiRoute.updateOption({
            params: req.params
        } as any)
    );
    
    router.put('/api/options', (req) => 
        optionsApiRoute.updateOptions({
            body: req.body
        } as any)
    );
    
    router.get('/api/options/user-themes', () => 
        optionsApiRoute.getUserThemes()
    );
    
    router.get('/api/options/locales', () => 
        optionsApiRoute.getSupportedLocales()
    );

    // Keyboard actions routes
    router.get('/api/keyboard-actions', () => 
        keysApiRoute.getKeyboardActions()
    );
    
    router.get('/api/keyboard-shortcuts-for-notes', () => 
        keysApiRoute.getShortcutsForNotes()
    );

    // Add more routes here as they are implemented in @triliumnext/core
    // Follow the pattern from apps/server/src/routes/routes.ts
}

/**
 * Create and configure a router with all routes registered.
 */
export function createConfiguredRouter(routes: CoreRoutes): BrowserRouter {
    const router = new BrowserRouter();
    registerRoutes(router, routes);
    return router;
}
