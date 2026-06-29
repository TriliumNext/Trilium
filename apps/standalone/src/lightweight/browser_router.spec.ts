import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserRouter, createRouter } from "./browser_router.js";

const RAW_RESPONSE = Symbol.for("RAW_RESPONSE");
const encoder = new TextEncoder();

function decodeBody(body: ArrayBuffer | null): string {
    return body ? new TextDecoder().decode(body) : "";
}

function json(obj: unknown): ArrayBuffer {
    return encoder.encode(JSON.stringify(obj)).buffer as ArrayBuffer;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("BrowserRouter routing", () => {
    it("dispatches by method and exposes a convenience method per verb", async () => {
        const router = createRouter();
        const seen: string[] = [];
        for (const verb of ["get", "post", "put", "patch", "delete"] as const) {
            router[verb]("/r", () => { seen.push(verb); return { verb }; });
        }
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
            const res = await router.dispatch(method, "http://localhost/r");
            expect(res.status).toBe(200);
        }
        expect(seen).toEqual(["get", "post", "put", "patch", "delete"]);
    });

    it("extracts and decodes path parameters and parses the query string", async () => {
        const router = new BrowserRouter();
        let captured: { params: Record<string, string>; query: Record<string, string | undefined> } | undefined;
        router.get("/api/notes/:noteId/branches/:branchId", (req) => {
            captured = { params: req.params, query: req.query };
            return {};
        });
        await router.dispatch("GET", "http://localhost/api/notes/a%20b/branches/xyz?expand=true&depth=2");
        expect(captured?.params).toEqual({ noteId: "a b", branchId: "xyz" });
        expect(captured?.query).toEqual({ expand: "true", depth: "2" });
    });

    it("returns 404 text for an unmatched route", async () => {
        const router = new BrowserRouter();
        const res = await router.dispatch("GET", "http://localhost/missing");
        expect(res.status).toBe(404);
        expect(res.headers["content-type"]).toContain("text/plain");
        expect(decodeBody(res.body)).toBe("Not found: GET /missing");
    });
});

describe("BrowserRouter body parsing", () => {
    it("parses a JSON body from an ArrayBuffer", async () => {
        const router = new BrowserRouter();
        let body: unknown;
        router.post("/echo", (req) => { body = req.body; return {}; });
        await router.dispatch("POST", "http://localhost/echo", json({ a: 1 }), { "content-type": "application/json" });
        expect(body).toEqual({ a: 1 });
    });

    it("leaves an empty JSON body as the raw buffer", async () => {
        const router = new BrowserRouter();
        let body: unknown;
        router.post("/echo", (req) => { body = req.body; return {}; });
        const raw = encoder.encode("   ").buffer as ArrayBuffer;
        await router.dispatch("POST", "http://localhost/echo", raw, { "content-type": "application/json" });
        expect(body).toBe(raw);
    });

    it("warns and keeps the raw buffer on invalid JSON", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const router = new BrowserRouter();
        let body: unknown;
        router.post("/echo", (req) => { body = req.body; return {}; });
        const raw = encoder.encode("{not json").buffer as ArrayBuffer;
        await router.dispatch("POST", "http://localhost/echo", raw, { "Content-Type": "application/json" });
        expect(body).toBe(raw);
        expect(warn).toHaveBeenCalled();
    });

    it("passes through a non-ArrayBuffer body unchanged", async () => {
        const router = new BrowserRouter();
        let body: unknown;
        router.post("/echo", (req) => { body = req.body; return {}; });
        await router.dispatch("POST", "http://localhost/echo", { already: "parsed" });
        expect(body).toEqual({ already: "parsed" });
    });

    it("leaves an ArrayBuffer body untouched when no content-type is given", async () => {
        const router = new BrowserRouter();
        let body: unknown;
        router.post("/echo", (req) => { body = req.body; return {}; });
        const raw = encoder.encode("opaque").buffer as ArrayBuffer;
        await router.dispatch("POST", "http://localhost/echo", raw, { "x-other": "1" });
        expect(body).toBe(raw);
    });

    it("uses the declared part content-type, falling back to octet-stream otherwise", async () => {
        const router = new BrowserRouter();
        let file: { mimetype: string } | undefined;
        router.post("/u2", (r) => { file = r.file; return {}; });

        async function uploadMimetype(partContentType: string | null): Promise<string | undefined> {
            const boundary = "----triliumtest";
            const typeLine = partContentType ? `Content-Type: ${partContentType}\r\n` : "";
            const body =
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="upload"; filename="f.dat"\r\n` +
                typeLine +
                `\r\n` +
                `data\r\n` +
                `--${boundary}--\r\n`;
            const buffer = encoder.encode(body).buffer as ArrayBuffer;
            await router.dispatch("POST", "http://localhost/u2", buffer, { "content-type": `multipart/form-data; boundary=${boundary}` });
            return file?.mimetype;
        }

        // Declared content-type is used; absent type falls back to octet-stream.
        expect(await uploadMimetype("text/plain")).toBe("text/plain");
        expect(await uploadMimetype(null)).toBe("application/octet-stream");
    });

    it("parses multipart/form-data into fields and an uploaded file", async () => {
        const fd = new FormData();
        fd.append("title", "hello");
        fd.append("upload", new File([new Uint8Array([1, 2, 3])], "f.bin", { type: "application/octet-stream" }));
        const request = new Request("http://localhost/u", { method: "POST", body: fd });
        const contentType = request.headers.get("content-type") ?? "";
        const buffer = await request.arrayBuffer();

        const router = new BrowserRouter();
        let req: { body?: unknown; file?: { originalname: string; mimetype: string; buffer: Uint8Array } } | undefined;
        router.post("/u", (r) => { req = r; return {}; });
        await router.dispatch("POST", "http://localhost/u", buffer, { "content-type": contentType });

        expect(req?.body).toEqual({ title: "hello" });
        expect(typeof req?.file?.originalname).toBe("string");
        expect(req?.file && Array.from(req.file.buffer)).toEqual([1, 2, 3]);
    });

    it("warns when multipart parsing fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const router = new BrowserRouter();
        router.post("/u", () => ({}));
        // A multipart content-type with no boundary makes Response.formData() throw.
        const raw = encoder.encode("garbage").buffer as ArrayBuffer;
        await router.dispatch("POST", "http://localhost/u", raw, { "content-type": "multipart/form-data" });
        expect(warn).toHaveBeenCalled();
    });
});

describe("BrowserRouter result formatting", () => {
    it("returns 204 with no body for undefined results", async () => {
        const router = new BrowserRouter();
        router.get("/void", () => undefined);
        const res = await router.dispatch("GET", "http://localhost/void");
        expect(res.status).toBe(204);
        expect(res.body).toBeNull();
    });

    it("honors a [statusCode, response] tuple", async () => {
        const router = new BrowserRouter();
        router.get("/created", () => [201, { id: "x" }]);
        const res = await router.dispatch("GET", "http://localhost/created");
        expect(res.status).toBe(201);
        expect(JSON.parse(decodeBody(res.body))).toEqual({ id: "x" });
    });

    it("serializes a plain object as a 200 JSON response", async () => {
        const router = new BrowserRouter();
        router.get("/obj", () => ({ ok: true }));
        const res = await router.dispatch("GET", "http://localhost/obj");
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("application/json");
        expect(JSON.parse(decodeBody(res.body))).toEqual({ ok: true });
    });

    it("passes raw responses through, handling each body type", async () => {
        const router = new BrowserRouter();
        router.get("/raw-ab", () => ({ [RAW_RESPONSE]: true, status: 200, headers: { "x": "1" }, body: encoder.encode("ab").buffer }));
        router.get("/raw-u8", () => ({ [RAW_RESPONSE]: true, status: 200, headers: {}, body: new Uint8Array([65, 66]) }));
        router.get("/raw-str", () => ({ [RAW_RESPONSE]: true, status: 206, headers: {}, body: "hello" }));
        router.get("/raw-null", () => ({ [RAW_RESPONSE]: true, status: 304, headers: {}, body: null }));

        expect(decodeBody((await router.dispatch("GET", "http://localhost/raw-ab")).body)).toBe("ab");
        expect(decodeBody((await router.dispatch("GET", "http://localhost/raw-u8")).body)).toBe("AB");

        const strRes = await router.dispatch("GET", "http://localhost/raw-str");
        expect(strRes.status).toBe(206);
        expect(decodeBody(strRes.body)).toBe("hello");

        const nullRes = await router.dispatch("GET", "http://localhost/raw-null");
        expect(nullRes.status).toBe(304);
        expect(nullRes.body).toBeNull();
    });
});

describe("BrowserRouter error formatting", () => {
    class NotFoundError extends Error {}
    class ValidationError extends Error {}

    it("maps NotFoundError to 404", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const router = new BrowserRouter();
        router.get("/nf", () => { throw new NotFoundError("gone"); });
        const res = await router.dispatch("GET", "http://localhost/nf");
        expect(res.status).toBe(404);
        expect(JSON.parse(decodeBody(res.body))).toEqual({ message: "gone" });
    });

    it("maps ValidationError to 400", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const router = new BrowserRouter();
        router.get("/ve", () => { throw new ValidationError("bad"); });
        const res = await router.dispatch("GET", "http://localhost/ve");
        expect(res.status).toBe(400);
        expect(JSON.parse(decodeBody(res.body))).toEqual({ message: "bad" });
    });

    it("maps an unknown error to 500", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const router = new BrowserRouter();
        router.get("/boom", () => { throw new Error("kaput"); });
        const res = await router.dispatch("GET", "http://localhost/boom");
        expect(res.status).toBe(500);
        expect(JSON.parse(decodeBody(res.body))).toEqual({ message: "kaput" });
    });

    it("falls back to a default message for NotFoundError without a message", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const router = new BrowserRouter();
        router.get("/nf2", () => { throw new NotFoundError(); });
        const res = await router.dispatch("GET", "http://localhost/nf2");
        expect(JSON.parse(decodeBody(res.body))).toEqual({ message: "Not found" });
    });

    it("falls back to a default message for ValidationError without a message", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const router = new BrowserRouter();
        router.get("/ve2", () => { throw new ValidationError(); });
        const res = await router.dispatch("GET", "http://localhost/ve2");
        expect(JSON.parse(decodeBody(res.body))).toEqual({ message: "Validation error" });
    });

    it("stringifies a thrown non-Error value", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const router = new BrowserRouter();
        router.get("/str", () => { throw "plain string"; });
        const res = await router.dispatch("GET", "http://localhost/str");
        expect(res.status).toBe(500);
        expect(JSON.parse(decodeBody(res.body))).toEqual({ message: "plain string" });
    });
});
