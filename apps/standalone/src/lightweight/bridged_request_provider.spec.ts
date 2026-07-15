import type { ExecOpts } from "@triliumnext/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BridgedRequestProvider from "./bridged_request_provider.js";

interface PostedMessage {
    type: string;
    id: string;
    request: {
        method: string;
        url: string;
        headers: Record<string, string>;
        body?: string;
        responseType?: string;
    };
}

let postSpy: ReturnType<typeof vi.spyOn>;

function lastPosted(): PostedMessage {
    return postSpy.mock.calls.at(-1)?.[0] as PostedMessage;
}

/** Deliver a worker HTTP_RESPONSE for the most recently posted request id. */
function respond(fields: Record<string, unknown>) {
    const id = lastPosted().id;
    self.dispatchEvent(new MessageEvent("message", { data: { type: "HTTP_RESPONSE", id, ...fields } }));
}

beforeEach(() => {
    postSpy = vi.spyOn(self, "postMessage").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("BridgedRequestProvider.exec", () => {
    it("posts an HTTP_REQUEST and resolves with the parsed JSON body", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec<{ ok: boolean }>({ method: "GET", url: "http://x/api" } as ExecOpts);

        const posted = lastPosted();
        expect(posted.type).toBe("HTTP_REQUEST");
        expect(posted.request.method).toBe("GET");
        expect(posted.request.headers["Content-Type"]).toBe("application/json");

        respond({ status: 200, body: JSON.stringify({ ok: true }), headers: {} });
        await expect(promise).resolves.toEqual({ ok: true });
    });

    it("returns null for an empty 204 body", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({ method: "GET", url: "http://x" } as ExecOpts);
        respond({ status: 204, body: "" });
        await expect(promise).resolves.toBeNull();
    });

    it("forwards the cookie jar header and captures set-cookie from the response", async () => {
        const provider = new BridgedRequestProvider();
        const cookieJar = { header: "session=abc" };
        const promise = provider.exec({ method: "GET", url: "http://x", cookieJar } as unknown as ExecOpts);

        expect(lastPosted().request.headers["Cookie"]).toBe("session=abc");

        respond({ status: 200, body: "{}", headers: { "set-cookie": "session=def" } });
        await promise;
        expect(cookieJar.header).toBe("session=def");
    });

    it("adds auth, multi-page and serialized-body fields", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({
            method: "POST",
            url: "http://x",
            auth: { password: "pw" },
            body: { a: 1 },
            paging: { pageCount: 2, pageIndex: 0, requestId: "r" }
        } as ExecOpts);

        const posted = lastPosted();
        expect(posted.request.headers["trilium-cred"]).toBe(btoa("dummy:pw"));
        expect(posted.request.headers["Content-Type"]).toBe("text/plain");
        expect(posted.request.body).toBe(JSON.stringify({ a: 1 }));

        respond({ status: 200, body: "{}" });
        await promise;
    });

    it("throws with the error message from a non-2xx JSON body", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({ method: "GET", url: "http://x" } as ExecOpts);
        respond({ status: 500, body: JSON.stringify({ message: "server boom" }) });
        await expect(promise).rejects.toThrow("server boom");
    });

    it("throws with truncated raw text when the error body is not JSON", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({ method: "GET", url: "http://x" } as ExecOpts);
        respond({ status: 400, body: "not json" });
        await expect(promise).rejects.toThrow("400 GET http://x: not json");
    });

    it("passes a string body through unchanged", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({ method: "POST", url: "http://x", body: "raw-string" } as ExecOpts);
        expect(lastPosted().request.body).toBe("raw-string");
        respond({ status: 200, body: "{}" });
        await promise;
    });

    it("clears the timeout when a response resolves in time", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec<{ ok: boolean }>({ method: "GET", url: "http://x", timeout: 1000 } as ExecOpts);
        respond({ status: 200, body: JSON.stringify({ ok: true }) });
        await expect(promise).resolves.toEqual({ ok: true });
    });

    it("clears the timeout when the response carries an error", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({ method: "GET", url: "http://x", timeout: 1000 } as ExecOpts);
        respond({ error: "worker failed" });
        await expect(promise).rejects.toThrow("worker failed");
    });

    it("throws with an empty message when the error body has no message field", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({ method: "GET", url: "http://x" } as ExecOpts);
        respond({ status: 500, body: JSON.stringify({ code: "X" }) });
        await expect(promise).rejects.toThrow("500 GET");
    });

    it("handles a non-2xx response that has no body", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({ method: "GET", url: "http://x" } as ExecOpts);
        respond({ status: 500 });
        await expect(promise).rejects.toThrow("500 GET");
    });

    it("rejects when the worker reports an error", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({ method: "GET", url: "http://x" } as ExecOpts);
        respond({ error: "worker failed" });
        await expect(promise).rejects.toThrow("worker failed");
    });

    it("rejects with a timeout when no response arrives", async () => {
        vi.useFakeTimers();
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({ method: "GET", url: "http://x", timeout: 100 } as ExecOpts);
        const rejection = expect(promise).rejects.toThrow("timeout after 100ms");
        vi.advanceTimersByTime(100);
        await rejection;
    });

    it("ignores irrelevant or unknown-id messages", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec<{ ok: boolean }>({ method: "GET", url: "http://x" } as ExecOpts);

        self.dispatchEvent(new MessageEvent("message", { data: null }));
        self.dispatchEvent(new MessageEvent("message", { data: { type: "OTHER" } }));
        self.dispatchEvent(new MessageEvent("message", { data: { type: "HTTP_RESPONSE", id: "does-not-exist" } }));

        respond({ status: 200, body: JSON.stringify({ ok: true }) });
        await expect(promise).resolves.toEqual({ ok: true });
    });

    it("resolves via the structured-clone data field without re-parsing a body", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec<{ ok: boolean }>({ method: "GET", url: "http://x" } as ExecOpts);
        // Main thread delivers the already-parsed object as `data` (no `body`) — the worker
        // must use it directly rather than JSON.parse-ing a string.
        respond({ status: 201, data: { ok: true } });
        await expect(promise).resolves.toEqual({ ok: true });
    });

    it("reads the error message from a structured-clone data object on a non-2xx response", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({ method: "GET", url: "http://x" } as ExecOpts);
        respond({ status: 500, data: { message: "boom via data" } });
        await expect(promise).rejects.toThrow("500 GET http://x: boom via data");
    });

    it("falls back to an empty message when the structured-clone error data has no message field", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.exec({ method: "GET", url: "http://x" } as ExecOpts);
        respond({ status: 500, data: { code: "X" } });
        await expect(promise).rejects.toThrow("500 GET http://x:");
    });
});

describe("BridgedRequestProvider.getImage", () => {
    it("decodes a base64 body into an ArrayBuffer", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.getImage("http://x/img.png");

        expect(lastPosted().request.responseType).toBe("arraybuffer");

        respond({ status: 200, body: btoa("ABC") });
        const buffer = await promise;
        expect(Array.from(new Uint8Array(buffer))).toEqual([65, 66, 67]);
    });

    it("throws for a non-2xx image response", async () => {
        const provider = new BridgedRequestProvider();
        const promise = provider.getImage("http://x/missing.png");
        respond({ status: 404, body: "" });
        await expect(promise).rejects.toThrow("404 GET");
    });
});
