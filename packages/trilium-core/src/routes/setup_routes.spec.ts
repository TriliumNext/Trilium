import { describe, expect, it } from "vitest";

import { buildSharedApiRoutes } from "./index.js";

/**
 * How the setup routes are registered, rather than what they do.
 *
 * Two properties are worth pinning down here, because nothing else catches either and both fail far
 * from their cause.
 *
 * A handler that erases the knowledge base must not be wrapped in a transaction. `asyncRoute` opens
 * one in the browser and not on the server, so a route that erases goes on working on the desktop
 * and dies on the standalone build with "cannot rollback - no transaction is active" — the
 * transaction belonged to a connection the erasure closed, and the one opened in its place has
 * nothing to roll back.
 *
 * And a handler that can lose a knowledge base must carry the wizard's own password gate. The
 * session check the rest of the application relies on stands down on an instance that reports itself
 * uninitialized, which is exactly what an instance sitting in the wizard does, so `checkSetupAuth`
 * is the only thing between these routes and whoever can reach the port.
 */
describe("how the setup routes are registered", () => {
    /** Every route that erases the knowledge base before it creates one in its place. */
    const ERASING_ROUTES = [
        "POST /api/setup/new-document",
        "POST /api/setup/sync-from-server",
        "POST /api/setup/existing/delete",
        // Not an erasure, but it reopens the database it was asked to leave alone, which closes the
        // connection just the same.
        "POST /api/setup/existing/keep"
    ];

    /** Every route a knowledge base can be lost, replaced or read through while the wizard holds it. */
    const GATED_ROUTES = [
        "POST /api/setup/new-document",
        "POST /api/setup/sync-from-server",
        "POST /api/setup/existing/backup",
        "GET /api/setup/existing/backup-defaults",
        "GET /api/setup/existing/status",
        "POST /api/setup/existing/delete",
        "POST /api/setup/existing/keep",
        // Not a way to lose one, but a way to send somebody else's instance to the screen it can be
        // lost from, or to call off a start-over its owner is waiting to act on.
        "POST /api/setup/boot",
        "GET /api/setup/boot",
        "DELETE /api/setup/boot"
    ];

    /**
     * Every route that belongs to the wizard and must be refused on an instance that is running.
     *
     * The `boot` three are deliberately absent: asking for a start-over is something a running
     * instance does, and it is guarded by the session instead.
     */
    const WIZARD_ONLY_ROUTES = [
        "POST /api/setup/new-document",
        "POST /api/setup/sync-from-server",
        "POST /api/setup/sync-seed",
        "POST /api/setup/auth",
        "POST /api/setup/existing/backup",
        "GET /api/setup/existing/backup-defaults",
        "GET /api/setup/existing/status",
        "POST /api/setup/existing/delete",
        "POST /api/setup/existing/keep"
    ];

    it("keeps every route that closes the database out of a transaction", () => {
        const { builders } = captureRegistrations();

        for (const route of ERASING_ROUTES) {
            expect(builders.get(route), `${route} is not registered at all`)
                .toBe("asyncRouteWithoutTransaction");
        }
    });

    it("puts the wizard's password gate in front of everything a knowledge base can be lost through", () => {
        const { middleware } = captureRegistrations();

        for (const route of GATED_ROUTES) {
            expect(middleware.get(route), `${route} is not registered at all`)
                .toContain("checkSetupAuth");
        }
    });

    it("keeps the wizard's own routes off a running instance, which is a different guard entirely", () => {
        // `checkSetupAuth` does nothing on a running instance: it asks for a password only while
        // there is a knowledge base behind the wizard, and on a running instance there is no wizard.
        // What refuses these there is `checkAppNotInitialized`, so it is the one carrying the weight
        // for the case where no start-over was ever asked for.
        const { middleware } = captureRegistrations();

        for (const route of WIZARD_ONLY_ROUTES) {
            expect(middleware.get(route), `${route} is not registered at all`)
                .toContain("checkAppNotInitialized");
        }
    });

    it("leaves open only the routes that have to be", () => {
        // Read as a whole rather than one at a time: what matters is that the list of setup routes
        // anybody can reach stays this short, and that each one on it is deliberate. A route added
        // without the gate lands here and has to be argued for.
        const { middleware } = captureRegistrations();
        const open = [ ...middleware ]
            .filter(([ route ]) => route.includes(" /api/setup/"))
            .filter(([ , guards ]) => !guards.includes("checkSetupAuth"))
            .map(([ route ]) => route)
            .sort();

        expect(open).toEqual([
            // Says whether there is a database and whether the wizard is locked, and nothing about
            // the knowledge base behind it — see `getStatus`.
            "GET /api/setup/status",
            // Answered with the caller's own password rather than with a token of ours.
            "GET /api/setup/sync-seed",
            // The password check itself, which is what every gate above is satisfied by. Rate limited.
            "POST /api/setup/auth",
            // Pushed by another device, which can carry nothing this instance issued. Refused from
            // inside while there is a knowledge base to lose — see `saveSyncSeed`.
            "POST /api/setup/sync-seed"
        ]);
    });
});

/**
 * Runs the route builder against a context that records what each route was registered with, and
 * does nothing else. Enough for the questions above, which are about registration rather than about
 * anything a handler does.
 *
 * The middleware are recorded by name: each is handed in as a distinguishable stub, so a route's
 * guards can be read back as the names of the ones it was given.
 */
function captureRegistrations(): { builders: Map<string, string>; middleware: Map<string, string[]> } {
    const builders = new Map<string, string>();
    const middleware = new Map<string, string[]>();
    const names = new Map<unknown, string>();
    const stub = (name: string) => {
        const fn = () => {};
        names.set(fn, name);
        return fn;
    };
    const record = (builder: string) => (method: string, path: string, ...rest: unknown[]) => {
        const route = `${method.toUpperCase()} ${path}`;
        builders.set(route, builder);
        // The middleware array is the third argument where there is one; the shorthand builders
        // (`apiRoute`, `asyncApiRoute`) take the handler there instead and supply their own.
        const given = Array.isArray(rest[0]) ? rest[0] : [];
        middleware.set(route, given.map((fn) => names.get(fn) ?? "unknown"));
    };

    buildSharedApiRoutes({
        route: record("route"),
        asyncRoute: record("asyncRoute"),
        asyncRouteWithoutTransaction: record("asyncRouteWithoutTransaction"),
        apiRoute: record("apiRoute"),
        asyncApiRoute: record("asyncApiRoute"),
        apiResultHandler: stub("apiResultHandler"),
        checkApiAuth: stub("checkApiAuth"),
        checkApiAuthOrElectron: stub("checkApiAuthOrElectron"),
        checkAppNotInitialized: stub("checkAppNotInitialized"),
        checkSetupAuth: stub("checkSetupAuth"),
        checkCredentials: stub("checkCredentials"),
        loginRateLimiter: stub("loginRateLimiter"),
        uploadMiddlewareWithErrorHandling: stub("uploadMiddlewareWithErrorHandling"),
        importMiddlewareWithErrorHandling: stub("importMiddlewareWithErrorHandling"),
        csrfMiddleware: stub("csrfMiddleware")
    });

    return { builders, middleware };
}
