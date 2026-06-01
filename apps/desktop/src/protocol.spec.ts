import express from "express";
import multer from "multer";
import { describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn()
}));

vi.mock("electron", () => ({
    default: {
        app: { whenReady: () => Promise.resolve() },
        protocol: { handle: electronMock.handle }
    },
    protocol: { registerSchemesAsPrivileged: electronMock.registerSchemesAsPrivileged }
}));

const { dispatch, registerTriliumAppScheme, setupTriliumAppProtocol } = await import("./protocol.js");
const { isInternalElectronRequest } = await import("@triliumnext/server/src/services/electron_request.js");

function buildTestApp() {
    const app = express();
    app.use(express.json());

    const upload = multer().single("upload");
    app.post("/upload", upload, (req, res) => {
        res.json({
            field: (req.body as Record<string, unknown>)?.note,
            filename: req.file?.originalname,
            size: req.file?.size,
            content: req.file?.buffer?.toString("utf-8")
        });
    });

    app.post("/echo-json", (req, res) => {
        res.json({ echo: req.body });
    });

    return app;
}

describe("trilium-app protocol dispatcher", () => {
    it("forwards multipart/form-data through multer so handlers see req.file", async () => {
        const app = buildTestApp();
        const formData = new FormData();
        formData.append("upload", new Blob(["hello world"], { type: "text/plain" }), "hello.txt");
        formData.append("note", "abc123");

        const request = new Request("trilium-app://app/upload", { method: "POST", body: formData });
        const response = await dispatch(app, request);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            field: "abc123",
            filename: "hello.txt",
            size: 11,
            content: "hello world"
        });
    });

    it("forwards application/json bodies as parsed objects", async () => {
        const app = buildTestApp();
        const request = new Request("trilium-app://app/echo-json", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hello: "world" })
        });
        const response = await dispatch(app, request);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ echo: { hello: "world" } });
    });

    // Auth + CSRF middleware rely on this marker to distinguish a
    // renderer→main protocol dispatch from a public-HTTP request hitting the
    // desktop's TCP listener. Regression for the auth bypass that used to
    // key off the process-wide `isElectron` flag.
    it("tags dispatched requests with the internal-electron marker", async () => {
        const app = express();
        let markedOnHandler: boolean | undefined;
        app.get("/probe", (req, res) => {
            markedOnHandler = isInternalElectronRequest(req);
            res.status(200).send("");
        });

        await dispatch(app, new Request("trilium-app://app/probe"));

        expect(markedOnHandler).toBe(true);
    });

    // SSE / streaming endpoints (e.g. LLM chat) commit headers up front with
    // `res.flushHeaders()` and then write chunks over time. The bridge must
    // (a) not crash on flushHeaders — Express rewires `res.__proto__` to the
    // real ServerResponse, whose internal `outputData` was never initialised
    // on the mock — and (b) deliver subsequent `res.write` chunks to the
    // renderer in real time instead of buffering until `res.end`.
    it("streams chunks to the renderer as soon as flushHeaders is called", async () => {
        const app = express();
        let resolveWriteGate: (() => void) | undefined;
        const writeGate = new Promise<void>((r) => { resolveWriteGate = r; });

        app.get("/stream", async (_req, res) => {
            res.setHeader("Content-Type", "text/event-stream");
            res.flushHeaders();
            res.write("first\n");
            // Hold the second chunk until the test confirms the first was
            // already readable from the Response body — proving real-time
            // delivery instead of buffer-then-flush.
            await writeGate;
            res.write("second\n");
            res.end();
        });

        const dispatched = dispatch(app, new Request("trilium-app://app/stream"));
        const response = await dispatched;
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/event-stream");

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const first = await reader.read();
        expect(decoder.decode(first.value)).toBe("first\n");

        resolveWriteGate!();
        let rest = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            rest += decoder.decode(value);
        }
        expect(rest).toBe("second\n");
    });

    // `res.flush()` is the second crash vector from Express's prototype swap:
    // some compression / response-time middleware probes it to force-flush,
    // which would otherwise dereference uninitialised ServerResponse internals.
    it("does not crash when handlers probe res.flush()", async () => {
        const app = express();
        app.get("/probe", (_req, res) => {
            (res as unknown as { flush: () => void }).flush();
            res.send("ok");
        });

        const response = await dispatch(app, new Request("trilium-app://app/probe"));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok");
    });

    it("delivers a final chunk passed to res.end() in streaming mode", async () => {
        const app = express();
        app.get("/stream", (_req, res) => {
            res.setHeader("Content-Type", "text/event-stream");
            res.flushHeaders();
            res.write("part1\n");
            res.end("part2\n");
        });

        const response = await dispatch(app, new Request("trilium-app://app/stream"));
        expect(await response.text()).toBe("part1\npart2\n");
    });

    it("captures the status code at flushHeaders time for streaming responses", async () => {
        const app = express();
        app.get("/stream", (_req, res) => {
            res.status(202);
            res.flushHeaders();
            res.end("body");
        });

        const response = await dispatch(app, new Request("trilium-app://app/stream"));
        expect(response.status).toBe(202);
        expect(await response.text()).toBe("body");
    });

    it("treats repeated flushHeaders() calls as idempotent", async () => {
        const app = express();
        app.get("/stream", (_req, res) => {
            res.setHeader("Content-Type", "text/event-stream");
            res.flushHeaders();
            res.flushHeaders(); // no-op
            res.write("hi");
            res.end();
        });

        const response = await dispatch(app, new Request("trilium-app://app/stream"));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hi");
    });

    // When the renderer aborts the fetch (user hits stop, tab navigates, ...),
    // the bridge must error the stream so reads reject. Otherwise the upstream
    // handler keeps writing into a closed channel and the renderer hangs.
    it("errors the streaming body when the renderer aborts the fetch", async () => {
        const app = express();
        app.get("/stream", (_req, res) => {
            res.setHeader("Content-Type", "text/event-stream");
            res.flushHeaders();
            res.write("first\n");
            // Intentionally do not call res.end — the abort must tear down.
        });

        const abortController = new AbortController();
        const request = new Request("trilium-app://app/stream", { signal: abortController.signal });
        const response = await dispatch(app, request);

        const reader = response.body!.getReader();
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toBe("first\n");

        abortController.abort();
        await expect(reader.read()).rejects.toThrow();
    });

    it("returns a 500 Response when dispatch throws inside the protocol handler", async () => {
        electronMock.handle.mockReset();
        setupTriliumAppProtocol(express());
        await Promise.resolve(); // let whenReady().then(...) run

        expect(electronMock.handle).toHaveBeenCalledWith("trilium-app", expect.any(Function));
        const handler = electronMock.handle.mock.calls[0][1] as (req: Request) => Promise<Response>;

        // A malformed URL makes `new URL(request.url)` throw inside dispatch;
        // the handler must convert that into a 500 rather than rejecting.
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const response = await handler({ url: "::::not-a-url", method: "GET", headers: new Headers(), signal: null } as unknown as Request);
        errorSpy.mockRestore();

        expect(response.status).toBe(500);
        expect(await response.text()).toBe("Internal Server Error");
    });

    it("rejects when Express forwards an unhandled error to next()", async () => {
        const app = express();
        app.get("/boom", (_req, _res, next) => next(new Error("downstream failure")));

        await expect(dispatch(app, new Request("trilium-app://app/boom"))).rejects.toThrow(/downstream failure/);
    });

    it("rejects (buffered path) when the response status is out of the Response range", async () => {
        const app = express();
        app.get("/bad", (_req, res) => {
            res.statusCode = 999; // RangeError inside the Fetch Response constructor
            res.end("x");
        });

        await expect(dispatch(app, new Request("trilium-app://app/bad"))).rejects.toThrow();
    });

    it("rejects (streaming path) when flushHeaders commits an out-of-range status", async () => {
        const app = express();
        app.get("/bad-stream", (_req, res) => {
            res.statusCode = 999;
            res.flushHeaders();
            res.end();
        });

        await expect(dispatch(app, new Request("trilium-app://app/bad-stream"))).rejects.toThrow();
    });

    it("rejects when the Express app throws synchronously", async () => {
        const app = () => { throw new Error("sync explosion"); };
        await expect(dispatch(app as never, new Request("trilium-app://app/x"))).rejects.toThrow(/sync explosion/);
    });

    it("emits one header entry per value for multi-valued response headers", async () => {
        const app = express();
        app.get("/multi", (_req, res) => {
            // Set-Cookie is the canonical header Express keeps as an array in getHeaders().
            res.setHeader("Set-Cookie", ["a=1", "b=2"]);
            res.send("ok");
        });

        const response = await dispatch(app, new Request("trilium-app://app/multi"));
        expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    });

    it("passes binary buffer responses through untouched", async () => {
        // Force the mock to expose a non-empty `_getBuffer` so the buffered
        // branch picks the raw buffer rather than `_getData`.
        type FakeRes = { statusCode: number; _getData: () => unknown; _getBuffer: () => Buffer; end: () => void };
        const app = (_req: object, res: FakeRes) => {
            res.statusCode = 200;
            res._getData = () => "";
            res._getBuffer = () => Buffer.from([1, 2, 3, 4]);
            res.end();
        };

        const response = await dispatch(app as never, new Request("trilium-app://app/bin"));
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it("ignores a fetch abort that fires after a buffered response already completed", async () => {
        const app = express();
        app.get("/done", (_req, res) => res.send("done"));

        const ac = new AbortController();
        const response = await dispatch(app, new Request("trilium-app://app/done", { signal: ac.signal }));
        expect(await response.text()).toBe("done");
        // Late abort: the bridge's abort listener runs with streaming === false
        // and must be a no-op.
        ac.abort();
    });

    it("returns a null-body Response for null-body status codes", async () => {
        const app = express();
        app.get("/nc", (_req, res) => res.status(204).send());

        const response = await dispatch(app, new Request("trilium-app://app/nc"));
        expect(response.status).toBe(204);
        expect(response.body).toBeNull();
    });

    it("drops hop-by-hop / transport headers from the response", async () => {
        const app = express();
        app.get("/stripped", (_req, res) => {
            res.setHeader("Connection", "keep-alive");
            res.send("ok");
        });

        const response = await dispatch(app, new Request("trilium-app://app/stripped"));
        expect(response.headers.has("connection")).toBe(false);
    });

    it("wraps a non-Error value forwarded to next()", async () => {
        const app = express();
        app.get("/weird", (_req, _res, next) => next("string failure"));

        await expect(dispatch(app, new Request("trilium-app://app/weird"))).rejects.toBeDefined();
    });

    it("returns an empty body when the buffered payload is null", async () => {
        type FakeRes = { statusCode: number; _getData: () => unknown; _getBuffer: () => null; end: () => void };
        const app = (_req: object, res: FakeRes) => {
            res.statusCode = 200;
            res._getData = () => null;
            res._getBuffer = () => null;
            res.end();
        };
        const response = await dispatch(app as never, new Request("trilium-app://app/empty"));
        expect(await response.text()).toBe("");
    });

    it("falls back to _getData when the buffer is present but empty", async () => {
        type FakeRes = { statusCode: number; _getData: () => unknown; _getBuffer: () => Buffer; end: () => void };
        const app = (_req: object, res: FakeRes) => {
            res.statusCode = 200;
            res._getData = () => "from-data";
            res._getBuffer = () => Buffer.alloc(0); // truthy buffer, zero length
            res.end();
        };
        const response = await dispatch(app as never, new Request("trilium-app://app/emptybuf"));
        expect(await response.text()).toBe("from-data");
    });

    it("tolerates upstream writes after a consumer abort tore the stream down", async () => {
        const app = express();
        let releaseTail: (() => void) | undefined;
        const tail = new Promise<void>((r) => { releaseTail = r; });

        app.get("/race", async (_req, res) => {
            res.setHeader("Content-Type", "text/event-stream");
            res.flushHeaders();
            res.write("a\n");
            await tail;
            // After the abort below has nulled the controller, these must be
            // inert no-ops rather than throwing.
            res.write("b\n");
            res.end();
        });

        const ac = new AbortController();
        const response = await dispatch(app, new Request("trilium-app://app/race", { signal: ac.signal }));
        const reader = response.body?.getReader();
        if (!reader) throw new Error("expected a streaming body");
        expect(new TextDecoder().decode((await reader.read()).value)).toBe("a\n");

        ac.abort();
        await expect(reader.read()).rejects.toThrow();

        releaseTail?.();
        await tail; // let the handler's post-abort writes run
    });

    it("serialises object and primitive response payloads to bytes", async () => {
        // Express always stringifies objects/primitives before they reach the
        // mock's buffer, so force the buffered branch to read a raw object /
        // number out of `res._getData()` to exercise toUint8Array's fallbacks.
        type FakeRes = { statusCode: number; _getData: () => unknown; _getBuffer: () => null; end: () => void };
        const appReturning = (payload: unknown) => (_req: object, res: FakeRes) => {
            res.statusCode = 200;
            res._getData = () => payload;
            res._getBuffer = () => null;
            res.end();
        };

        const objResponse = await dispatch(appReturning({ hello: "world" }) as never, new Request("trilium-app://app/obj"));
        expect(await objResponse.json()).toEqual({ hello: "world" });

        const numResponse = await dispatch(appReturning(42) as never, new Request("trilium-app://app/num"));
        expect(await numResponse.text()).toBe("42");
    });

    it("skips the request body for GET / HEAD and bodyless requests", async () => {
        const app = express();
        app.get("/get", (_req, res) => res.send("g"));
        app.head("/head", (_req, res) => res.end());

        expect(await (await dispatch(app, new Request("trilium-app://app/get"))).text()).toBe("g");
        expect((await dispatch(app, new Request("trilium-app://app/head", { method: "HEAD" }))).status).toBe(200);
    });

    it("registerTriliumAppScheme declares the privileged custom scheme", () => {
        registerTriliumAppScheme();
        expect(electronMock.registerSchemesAsPrivileged).toHaveBeenCalledWith([
            expect.objectContaining({
                scheme: "trilium-app",
                privileges: expect.objectContaining({ standard: true, secure: true, supportFetchAPI: true, corsEnabled: true })
            })
        ]);
    });

    it("does NOT tag plain Express requests with the internal-electron marker", () => {
        // Anything that didn't come through `dispatch()` — i.e. a real HTTP
        // request to the TCP listener, or an arbitrary attacker-controlled
        // payload — must register as untagged.
        const plainReq = {} as object;
        expect(isInternalElectronRequest(plainReq)).toBe(false);

        // An attacker can't forge the marker via HTTP headers / body fields
        // because the marker is keyed by a non-exported Symbol. Header maps
        // and JSON-decoded bodies that mention the string "trilium-electron-
        // internal-request" can't reach the Symbol-keyed slot.
        const headerForgery = { headers: { "trilium-electron-internal-request": "true" } };
        const bodyForgery = { body: { "trilium-electron-internal-request": true } };
        const stringKeyForgery: Record<string, unknown> = { "trilium-electron-internal-request": true };
        expect(isInternalElectronRequest(headerForgery)).toBe(false);
        expect(isInternalElectronRequest(bodyForgery)).toBe(false);
        expect(isInternalElectronRequest(stringKeyForgery)).toBe(false);
    });
});
