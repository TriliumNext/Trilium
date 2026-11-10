import { describe, expect, it, vi } from "vitest";

import { fakeRequestProvider } from "../test/request_provider.js";
import requestService, {
    type ExecOpts,
    type FetchedResource,
    getRequestProvider,
    initRequest,
    isRequestInitialized,
    readCappedResponse,
    type RequestProvider,
    validateFetchableUrl
} from "./request.js";

describe("request provider (core)", () => {
    // The core test bootstrap does not register a request provider, so the module
    // starts uninitialized. Fork-per-file isolation keeps the mutation local.
    it("throws and reports uninitialized until a provider is installed", () => {
        expect(isRequestInitialized()).toBe(false);
        expect(() => getRequestProvider()).toThrow(/not initialized/);
    });

    it("delegates exec/getImage/fetchResource to the installed provider", async () => {
        const image = new ArrayBuffer(8);
        const resource: FetchedResource = { status: 200, ok: true, contentType: "text/html", bytes: new Uint8Array([ 1 ]) };
        const execMock = vi.fn(async (_opts: ExecOpts) => ({ ok: true }));
        const fake: RequestProvider = fakeRequestProvider({
            exec: execMock as unknown as RequestProvider["exec"],
            getImage: vi.fn(async () => image),
            fetchResource: vi.fn(async () => resource)
        });

        initRequest(fake);
        expect(isRequestInitialized()).toBe(true);
        expect(getRequestProvider()).toBe(fake);

        const opts: ExecOpts = { proxy: null, method: "GET", url: "http://localhost/x", timeout: 1000 };
        await expect(requestService.exec(opts)).resolves.toEqual({ ok: true });
        expect(execMock).toHaveBeenCalledWith(opts);

        await expect(requestService.getImage("http://localhost/img.png")).resolves.toBe(image);
        expect(fake.getImage).toHaveBeenCalledWith("http://localhost/img.png");

        await expect(requestService.fetchResource("http://localhost/p", { maxBytes: 10 })).resolves.toBe(resource);
        expect(fake.fetchResource).toHaveBeenCalledWith("http://localhost/p", { maxBytes: 10 });

        const apiResponse = new Response("{}");
        const fetchApi = vi.fn(async () => apiResponse);
        initRequest(fakeRequestProvider({ fetchApi }));
        const init: RequestInit = { method: "POST" };
        await expect(requestService.fetchApi("https://api.example.com/v1", init, { allowPrivateNetwork: true }))
            .resolves.toBe(apiResponse);
        expect(fetchApi).toHaveBeenCalledWith("https://api.example.com/v1", init, { allowPrivateNetwork: true });
    });

    it("refuses an address before anything is sent to it", () => {
        expect(validateFetchableUrl("https://example.com/p").toString()).toBe("https://example.com/p");

        expect(() => validateFetchableUrl("not a url")).toThrow(/Invalid URL/);
        expect(() => validateFetchableUrl("file:///etc/passwd")).toThrow(/http and https/);
        expect(() => validateFetchableUrl("javascript:alert(1)")).toThrow(/http and https/);
        // Credentials would otherwise reach the wire, the stored URL and the log alike.
        expect(() => validateFetchableUrl("https://user:pw@example.com/")).toThrow(/credentials/);
        expect(() => validateFetchableUrl("https://user@example.com/")).toThrow(/credentials/);
    });
});

describe("readCappedResponse", () => {
    it("reads a body whole and normalises what it came under", async () => {
        const read = await readCappedResponse(
            new Response("hello", { headers: { "content-type": "Text/HTML; charset=UTF-8" } }),
            1000
        );

        expect(read).toEqual({
            status: 200,
            ok: true,
            contentType: "text/html",
            bytes: new TextEncoder().encode("hello")
        });
    });

    it("answers a non-2xx rather than throwing, so the caller can read what it was", async () => {
        const read = await readCappedResponse(new Response("nope", { status: 404 }), 1000);

        expect(read.status).toBe(404);
        expect(read.ok).toBe(false);
    });

    it("names no content type where the server named none", async () => {
        const read = await readCappedResponse(new Response(null, { headers: {} }), 1000);

        expect(read.contentType).toBe("");
        expect(read.bytes).toEqual(new Uint8Array());
    });

    it("refuses a size the server advertises over the ceiling, without reading it", async () => {
        const body = "x".repeat(100);
        const response = new Response(body, { headers: { "content-length": "100" } });

        await expect(readCappedResponse(response, 10)).rejects.toThrow(/100 bytes exceeds the 10 byte limit/);
    });

    /**
     * The case the advertised size cannot cover: a chunked response states no length at all, so the
     * only place to catch it is mid-stream. Written as a real stream of several chunks so that the
     * refusal has to happen partway rather than after the whole body has arrived.
     */
    it("abandons a stream that goes over the ceiling partway through", async () => {
        let pulled = 0;
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled++;
                controller.enqueue(new Uint8Array(40));
            }
        });

        await expect(readCappedResponse(new Response(stream), 100)).rejects.toThrow(/exceeds the 100 byte limit/);

        // Three chunks of 40 is the first total over 100 — a fourth would mean it read on regardless.
        expect(pulled).toBe(3);
    });

    it("keeps a body that fits exactly", async () => {
        const read = await readCappedResponse(new Response(new Uint8Array(100)), 100);

        expect(read.bytes.byteLength).toBe(100);
    });

    it("cuts a body of a type read by its prefix, whatever size it advertises", async () => {
        let pulled = 0;
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.enqueue(new Uint8Array(40).fill(++pulled));
            }
        });
        const response = new Response(stream, {
            headers: { "content-type": "video/mp4", "content-length": String(2 ** 40) }
        });
        const prefixLength = (contentType: string) => contentType === "video/mp4" ? 50 : undefined;

        const read = await readCappedResponse(response, 10, prefixLength);

        expect(read.bytes).toEqual(new Uint8Array([ ...Array(40).fill(1), ...Array(10).fill(2) ]));
        expect(pulled).toBe(2);
        await expect(readCappedResponse(new Response("x".repeat(20)), 10, prefixLength))
            .rejects.toThrow(/exceeds the 10 byte limit/);
    });
});
