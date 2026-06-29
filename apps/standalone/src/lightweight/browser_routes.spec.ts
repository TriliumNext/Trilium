import { routes, sql_init } from "@triliumnext/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserRouter } from "./browser_router.js";
import { createConfiguredRouter, registerRoutes } from "./browser_routes.js";

const decoder = new TextDecoder();

function parseJson(body: ArrayBuffer | null): unknown {
    return body ? JSON.parse(decoder.decode(body)) : null;
}

function text(body: ArrayBuffer | null): string {
    return body ? decoder.decode(body) : "";
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("registerRoutes (real wiring)", () => {
    const router = createConfiguredRouter();

    it("registers routes onto a provided router", async () => {
        const fresh = new BrowserRouter();
        registerRoutes(fresh);
        const res = await fresh.dispatch("GET", "http://localhost/api/system-checks");
        expect(parseJson(res.body)).toEqual({ isCpuArchMismatch: false });
    });

    it("serves the compatibility dummy routes", async () => {
        expect(parseJson((await router.dispatch("GET", "http://localhost/api/script/widgets")).body)).toEqual([]);
        expect(parseJson((await router.dispatch("GET", "http://localhost/api/script/startup")).body)).toEqual([]);
    });

    it("runs a real transactional apiRoute handler with context headers", async () => {
        const res = await router.dispatch("GET", "http://localhost/api/options", undefined, {
            "trilium-component-id": "comp-1",
            "trilium-hoisted-note-id": "root"
        });
        expect(res.status).toBe(200);
        expect(parseJson(res.body)).toBeTypeOf("object");
    });

    it("returns the full bootstrap payload when the database is initialized", async () => {
        const data = parseJson((await router.dispatch("GET", "http://localhost/bootstrap")).body) as Record<string, unknown>;
        expect(data.isStandalone).toBe(true);
        expect(data.isElectron).toBe(false);
        expect(data.csrfToken).toBe("dummy-csrf-token");
        expect(typeof data.triliumVersion).toBe("string");
    });

    it("returns the setup payload when the database is not initialized", async () => {
        vi.spyOn(sql_init, "isDbInitialized").mockReturnValue(false);
        const data = parseJson((await router.dispatch("GET", "http://localhost/bootstrap")).body) as Record<string, unknown>;
        expect(data.isProtectedSessionAvailable).toBe(false);
        expect(data.csrfToken).toBeUndefined();
    });
});

// The route-wrapping helpers are private; the only way to drive every branch is
// through buildSharedApiRoutes. Mock it so we can register handlers that hit each
// path deterministically instead of relying on specific core routes + fixtures.
describe("route wrapper branches (via controlled handlers)", () => {
    type RouteCtx = Parameters<typeof routes.buildSharedApiRoutes>[0];
    let ctx: RouteCtx;

    function buildRouter(): BrowserRouter {
        vi.spyOn(routes, "buildSharedApiRoutes").mockImplementation((received: RouteCtx) => {
            ctx = received;
            const { route, asyncRoute, apiRoute, asyncApiRoute, apiResultHandler } = received;

            apiRoute("get", "/t/api", (req: { originalUrl: string }) => ({ url: req.originalUrl }));
            asyncApiRoute("get", "/t/asyncapi", () => ({ ok: true }));

            route("get", "/t/r-obj", [], () => ({ a: 1 }), apiResultHandler);
            route("get", "/t/r-tuple", [], () => [201, { created: true }], apiResultHandler);
            route("get", "/t/r-undef", [], () => undefined, apiResultHandler);
            route("get", "/t/r-noresult", [], () => ({ plain: true }));
            route("get", "/t/r-res", [], (_req: unknown, res: MockRes) => {
                res.set("A", "1").setHeader("B", "2").removeHeader("A").status(206).send("body");
            });
            route("get", "/t/r-sendstatus", [], (_req: unknown, res: MockRes) => { res.sendStatus(204); });
            route("get", "/t/r-stream", [], (_req: unknown, res: MockRes) => { res.write("chunk1"); res.write("chunk2"); res.end(); });
            route("get", "/t/r-customrh", [], () => ({ x: 1 }), (_req: unknown, res: { setHeader(n: string, v: string): void; result: unknown }, result: unknown) => {
                res.setHeader("X-Custom", "y");
                res.result = result;
            });

            asyncRoute("get", "/t/async-obj", [], async () => ({ z: 9 }), apiResultHandler);
            asyncRoute("get", "/t/async-res", [], async (_req: unknown, res: MockRes) => { res.send("async-body"); });
            asyncRoute("get", "/t/async-noresult", [], async () => ({ done: true }));
        });
        return createConfiguredRouter();
    }

    interface MockRes {
        set(n: string, v: string): MockRes;
        setHeader(n: string, v: string): MockRes;
        removeHeader(n: string): MockRes;
        status(c: number): MockRes;
        send(b: unknown): MockRes;
        sendStatus(c: number): MockRes;
        write(c: string): boolean;
        end(): MockRes;
    }

    it("runs transactional and non-transactional api routes (and reads originalUrl)", async () => {
        const router = buildRouter();
        const apiRes = await router.dispatch("GET", "http://localhost/t/api");
        expect((parseJson(apiRes.body) as { url: string }).url).toBe("http://localhost/t/api");
        expect(parseJson((await router.dispatch("GET", "http://localhost/t/asyncapi")).body)).toEqual({ ok: true });
    });

    it("formats route() results through apiResultHandler (object, tuple, undefined)", async () => {
        const router = buildRouter();
        expect(parseJson((await router.dispatch("GET", "http://localhost/t/r-obj")).body)).toEqual({ a: 1 });
        expect(parseJson((await router.dispatch("GET", "http://localhost/t/r-tuple")).body)).toEqual({ created: true });

        const undefRes = await router.dispatch("GET", "http://localhost/t/r-undef");
        expect(text(undefRes.body)).toBe('""');
    });

    it("returns a plain route() result when no result handler is supplied", async () => {
        const router = buildRouter();
        expect(parseJson((await router.dispatch("GET", "http://localhost/t/r-noresult")).body)).toEqual({ plain: true });
    });

    it("passes raw (res.*) route() responses through, covering every mock response method", async () => {
        const router = buildRouter();
        const res = await router.dispatch("GET", "http://localhost/t/r-res");
        expect(res.status).toBe(206);
        expect(res.headers).toEqual({ B: "2" });
        expect(text(res.body)).toBe("body");

        expect((await router.dispatch("GET", "http://localhost/t/r-sendstatus")).status).toBe(204);
        expect(text((await router.dispatch("GET", "http://localhost/t/r-stream")).body)).toBe("chunk1chunk2");
    });

    it("invokes a custom result handler that sets a header", async () => {
        const router = buildRouter();
        const res = await router.dispatch("GET", "http://localhost/t/r-customrh");
        expect(parseJson(res.body)).toEqual({ x: 1 });
    });

    it("handles asyncRoute() result-handler, raw and plain paths", async () => {
        const router = buildRouter();
        expect(parseJson((await router.dispatch("GET", "http://localhost/t/async-obj")).body)).toEqual({ z: 9 });
        expect(text((await router.dispatch("GET", "http://localhost/t/async-res")).body)).toBe("async-body");
        expect(parseJson((await router.dispatch("GET", "http://localhost/t/async-noresult")).body)).toEqual({ done: true });
    });

    it("serves the dummy compatibility routes (which real routes would otherwise shadow)", async () => {
        const router = buildRouter();
        expect(parseJson((await router.dispatch("GET", "http://localhost/api/script/widgets")).body)).toEqual([]);
        expect(parseJson((await router.dispatch("GET", "http://localhost/api/script/startup")).body)).toEqual([]);
        expect(parseJson((await router.dispatch("GET", "http://localhost/api/system-checks")).body)).toEqual({ isCpuArchMismatch: false });
    });

    it("provides no-op middleware and an init guard", async () => {
        buildRouter();
        // No-op middleware stubs do nothing and never throw.
        for (const mw of [ctx.checkApiAuth, ctx.checkApiAuthOrElectron, ctx.checkCredentials, ctx.loginRateLimiter, ctx.uploadMiddlewareWithErrorHandling, ctx.importMiddlewareWithErrorHandling, ctx.csrfMiddleware]) {
            expect(() => (mw as () => void)()).not.toThrow();
        }
        // checkAppNotInitialized throws while the DB is initialized...
        expect(() => (ctx.checkAppNotInitialized as () => void)()).toThrow("App already initialized");
        // ...and is a no-op once the DB is reported uninitialized.
        vi.spyOn(sql_init, "isDbInitialized").mockReturnValue(false);
        expect(() => (ctx.checkAppNotInitialized as () => void)()).not.toThrow();
    });
});
