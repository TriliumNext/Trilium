import express from "express";
import multer from "multer";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
    default: {
        app: { whenReady: () => Promise.resolve() },
        protocol: { handle: () => {} }
    }
}));

const { dispatch } = await import("./protocol.js");
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
