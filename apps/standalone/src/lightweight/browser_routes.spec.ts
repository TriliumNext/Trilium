import { cls, consistency_checks, getConfig, getSql, note_service as noteService, routes, sql_init } from "@triliumnext/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

// `/custom/` is registered outside the shared table, so nothing else would catch its loss. Unlike
// the server's route it cannot hold the response open past the handler returning, so what the tests
// below pin down is not only that a handler runs but that its answer is complete when it is sent.
describe("custom request handlers and resource providers", () => {
    const router = createConfiguredRouter();
    const coreConfig = getConfig();
    const originalScripting = coreConfig.Security.backendScriptingEnabled;

    beforeAll(() => {
        coreConfig.Security.backendScriptingEnabled = true;

        cls.init(() => {
            createHandler("Greeter", "greet/([a-z]+)", `api.res.status(200).send("handled:" + api.pathParams[0]);`);
            createHandler("Thrower", "explode", `throw new Error("boom in handler");`);
            createHandler("Echo", "echo", `api.res.json({ method: api.req.method, body: api.req.body });`);
            // A handler that answers after an await: what the server gets for free by holding the
            // connection open, this runtime has to wait for.
            createHandler("Deferred", "deferred", `
return (async () => {
    await Promise.resolve();
    api.res.status(200).send("late");
})();`);
            // A handler that returns without answering. The server leaves such a request hanging
            // until the client gives up; here the worker has to send something.
            createHandler("Silent", "silent", `api.log("thinking about it");`);
            // Express routes a number or a boolean through res.json(). The User Guide's own
            // example answers `api.res.send(400)`, so this is the documented shape.
            createHandler("Primitive", "primitive", `api.res.send(api.req.query.kind === "bool" ? false : 404);`);

            const resource = noteService.createNewNote({
                parentNoteId: "root",
                title: "Custom resource",
                type: "text",
                content: "<p>resource body</p>"
            }).note;
            resource.setLabel("customResourceProvider", "resource");
        });
    });

    afterAll(() => {
        coreConfig.Security.backendScriptingEnabled = originalScripting;
    });

    function createHandler(title: string, pattern: string, content: string) {
        const note = noteService.createNewNote({
            parentNoteId: "root",
            title,
            type: "code",
            mime: "application/javascript;env=backend",
            content
        }).note;
        note.setLabel("customRequestHandler", pattern);
    }

    it("runs a handler with the captured path params", async () => {
        const res = await router.dispatch("GET", "http://localhost/custom/greet/world");
        expect(res.status).toBe(200);
        expect(text(res.body)).toBe("handled:world");
    });

    it("reaches a handler over a method other than GET, carrying the parsed body", async () => {
        const body = new TextEncoder().encode(JSON.stringify({ hello: "there" })).buffer as ArrayBuffer;
        const res = await router.dispatch("POST", "http://localhost/custom/echo", body, {
            "content-type": "application/json"
        });

        expect(res.status).toBe(200);
        expect(res.headers["Content-Type"]).toContain("application/json");
        expect(parseJson(res.body)).toEqual({ method: "POST", body: { hello: "there" } });
    });

    // `send()` leaving a number in the body would reach BrowserRouter as something it cannot
    // encode, and the handler would answer 200 with nothing at all.
    it("sends a primitive body the way Express does, through json()", async () => {
        const number = await router.dispatch("GET", "http://localhost/custom/primitive");
        expect(number.status).toBe(200);
        expect(text(number.body)).toBe("404");
        expect(number.headers["Content-Type"]).toContain("application/json");

        const bool = await router.dispatch("GET", "http://localhost/custom/primitive?kind=bool");
        expect(text(bool.body)).toBe("false");
    });

    // The server registers its route as an Express `all`, which covers HEAD. A HEAD reaching the
    // worker with no route to match would answer the router's own 404 instead of the handler.
    it("answers HEAD from the handler, with the body dropped", async () => {
        const res = await router.dispatch("HEAD", "http://localhost/custom/greet/world");
        expect(res.status).toBe(200);
        expect(res.body).toBeNull();
    });

    it("waits for a handler that answers after an await", async () => {
        const res = await router.dispatch("GET", "http://localhost/custom/deferred");
        expect(res.status).toBe(200);
        expect(text(res.body)).toBe("late");
    });

    it("answers 500 when a handler returns without responding", async () => {
        const res = await router.dispatch("GET", "http://localhost/custom/silent");
        expect(res.status).toBe(500);
        expect(text(res.body)).toContain("did not send a response");
    });

    it("answers 500 when the handler throws", async () => {
        const res = await router.dispatch("GET", "http://localhost/custom/explode");
        expect(res.status).toBe(500);
        expect(text(res.body)).toContain("boom in handler");
    });

    it("serves a resource provider note", async () => {
        const res = await router.dispatch("GET", "http://localhost/custom/resource");
        expect(res.status).toBe(200);
        expect(text(res.body)).toContain("resource body");
    });

    it("answers 404 when no handler matches", async () => {
        const res = await router.dispatch("GET", "http://localhost/custom/no-such-path");
        expect(res.status).toBe(404);
        expect(text(res.body)).toContain("No handler matched");
    });

    // A resource provider executes no code, so it stays readable with scripting off; a request
    // handler runs a script and must not.
    it("gates only the request handler on the backend-scripting toggle", async () => {
        coreConfig.Security.backendScriptingEnabled = false;

        try {
            const handler = await router.dispatch("GET", "http://localhost/custom/greet/world");
            expect(handler.status).toBe(403);
            expect(text(handler.body)).toContain("Backend script execution is disabled");

            const resource = await router.dispatch("GET", "http://localhost/custom/resource");
            expect(resource.status).toBe(200);
            expect(text(resource.body)).toContain("resource body");
        } finally {
            coreConfig.Security.backendScriptingEnabled = true;
        }
    });
});
