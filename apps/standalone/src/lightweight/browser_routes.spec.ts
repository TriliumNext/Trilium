import { consistency_checks, getSql, routes, sql_init } from "@triliumnext/core";
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

    // The model-selection screen calls this while adding a provider. It is an async
    // handler in the shared table, so reaching its validation error here proves the
    // browser router registers and awaits it — a provider name is rejected before the
    // route reaches for the AI SDK, so no provider is contacted.
    it("serves the LLM provider-models route", async () => {
        const res = await router.dispatch("POST", "http://localhost/api/llm-chat/provider-models", {});
        expect(res.status).toBe(400);
        expect(text(res.body)).toContain("provider is required");
    });

    // Streaming is registered here rather than in the shared table, so nothing
    // else would catch its loss. Rejected for a missing stream id, which the
    // handler checks before starting anything — no completion is begun.
    it("serves the LLM stream routes, which only this runtime has", async () => {
        const start = await router.dispatch("POST", "http://localhost/api/llm-chat/stream-start", {});
        expect(start.status).toBe(400);
        expect(text(start.body)).toContain("streamId is required");

        // Aborting an id that is not running is a no-op rather than an error, so
        // reaching a 200 here is what proves the route is wired at all.
        const abort = await router.dispatch("POST", "http://localhost/api/llm-chat/stream-abort", { streamId: "nope" });
        expect(abort.status).toBe(200);
    });

    // Registered here rather than in the shared table, so nothing else would catch their loss. Both
    // run against the browser's own SQLite: the checks the server offers that need no file.
    it("serves the maintenance routes, and no compaction", async () => {
        const integrity = await router.dispatch("GET", "http://localhost/api/database/check-integrity");
        expect(parseJson(integrity.body)).toEqual({ results: [ { integrity_check: "ok" } ] });

        // Awaited rather than left running: the response arriving is what says the checks are over.
        const consistency = vi.spyOn(consistency_checks, "runOnDemandChecks").mockResolvedValue(undefined);
        expect((await router.dispatch("POST", "http://localhost/api/database/find-and-fix-consistency-issues", {})).status).toBe(200);
        expect(consistency).toHaveBeenCalledWith(true);

        // Compacting rebuilds through a temporary store this build keeps in memory, so it is left
        // to the platforms that have somewhere to put it.
        expect((await router.dispatch("POST", "http://localhost/api/database/vacuum-database", {})).status).toBe(404);
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

    it("marks a plain window as the main one, and `?extraWindow` as a detached one", async () => {
        const main = parseJson((await router.dispatch("GET", "http://localhost/bootstrap")).body) as Record<string, unknown>;
        expect(main.isMainWindow).toBe(true);

        // The detached window must not restore or persist `openNoteContexts`, otherwise it
        // overwrites the tab set of the window it was opened from. See TabManager.
        const extra = parseJson((await router.dispatch("GET", "http://localhost/bootstrap?extraWindow=1")).body) as Record<string, unknown>;
        expect(extra.isMainWindow).toBe(false);
    });

    // The upload path end to end: a real FormData body, parsed by the router into the `req.file`
    // the handler reads. What the PDF viewer saves annotations through, and what "upload new
    // revision" sends — on the server multer builds that object, here the router does.
    it("writes an uploaded file over a note", async () => {
        const created = parseJson((await router.dispatch("POST", "http://localhost/api/notes/root/children?target=into",
            { title: "notes.txt", type: "file", mime: "text/plain", content: "original" })).body) as { note: { noteId: string } };
        const { noteId } = created.note;

        const form = new FormData();
        form.append("upload", new File([ "uploaded" ], "notes.txt", { type: "text/plain" }));
        // One Response for both: each encoding of a FormData picks its own boundary, so a body and a
        // content-type taken from two of them describe different messages and parse as neither.
        const encoded = new Response(form);
        const contentType = encoded.headers.get("content-type") ?? "";
        const body = await encoded.arrayBuffer();

        const res = await router.dispatch("PUT", `http://localhost/api/notes/${noteId}/file?replace=1`, body, {
            "content-type": contentType
        });

        expect(res.status).toBe(200);
        expect(parseJson(res.body)).toEqual({ uploaded: true });
        expect(text((await router.dispatch("GET", `http://localhost/api/notes/${noteId}/open`)).body)).toBe("uploaded");
    });

    // The whole standalone media path in one request: the core handler slices the note's content,
    // the mock response carries the slice out as a raw response, and the router turns the view into
    // exactly those bytes. This is what an <audio>/<video> element does every time it seeks.
    it("answers a byte range on open-partial with 206 and just that slice", async () => {
        const created = parseJson((await router.dispatch("POST", "http://localhost/api/notes/root/children?target=into",
            { title: "clip.mp3", type: "file", mime: "audio/mpeg", content: "0123456789" })).body) as { note: { noteId: string } };
        const { noteId } = created.note;

        const res = await router.dispatch("GET", `http://localhost/api/notes/${noteId}/open-partial?v=1`, undefined, {
            range: "bytes=2-5"
        });

        expect(res.status).toBe(206);
        expect(text(res.body)).toBe("2345");
        expect(res.headers["Content-Range"]).toBe("bytes 2-5/10");
        expect(res.headers["Accept-Ranges"]).toBe("bytes");
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
            const { route, asyncRoute, asyncRouteWithoutTransaction, apiRoute, asyncApiRoute, apiResultHandler } = received;

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
            asyncRouteWithoutTransaction("get", "/t/async-no-tx", [], async () => ({ bare: true }), apiResultHandler);
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

    it("leaves the database alone for a route that says it wants no transaction", async () => {
        // The setup screen's erase closes the database and opens another one. A transaction opened
        // around it belongs to a connection that is gone by the time it would be committed, and
        // SQLite answers "cannot rollback - no transaction is active".
        const router = buildRouter();
        const transactional = vi.spyOn(getSql(), "transactionalAsync");

        expect(parseJson((await router.dispatch("GET", "http://localhost/t/async-no-tx")).body))
            .toEqual({ bare: true });
        expect(transactional).not.toHaveBeenCalled();

        // The ordinary async route is unchanged: it still gets one.
        await router.dispatch("GET", "http://localhost/t/async-obj");
        expect(transactional).toHaveBeenCalled();
    });

    it("formats route() results through apiResultHandler (object, tuple, undefined)", async () => {
        const router = buildRouter();
        expect(parseJson((await router.dispatch("GET", "http://localhost/t/r-obj")).body)).toEqual({ a: 1 });
        expect(parseJson((await router.dispatch("GET", "http://localhost/t/r-tuple")).body)).toEqual({ created: true });

        // apiResultHandler turns undefined into "", which goes out as an empty body — what the
        // server's send() does with the same value, rather than a JSON-quoted empty string.
        const undefRes = await router.dispatch("GET", "http://localhost/t/r-undef");
        expect(text(undefRes.body)).toBe("");
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
        for (const mw of [ctx.checkApiAuth, ctx.checkApiAuthOrElectron, ctx.checkSetupAuth, ctx.checkCredentials, ctx.loginRateLimiter, ctx.uploadMiddlewareWithErrorHandling, ctx.importMiddlewareWithErrorHandling, ctx.csrfMiddleware]) {
            expect(() => (mw as () => void)()).not.toThrow();
        }
        // checkAppNotInitialized throws while the DB is initialized...
        expect(() => (ctx.checkAppNotInitialized as () => void)()).toThrow("App already initialized");
        // ...and is a no-op once the DB is reported uninitialized.
        vi.spyOn(sql_init, "isDbInitialized").mockReturnValue(false);
        expect(() => (ctx.checkAppNotInitialized as () => void)()).not.toThrow();
    });
});
