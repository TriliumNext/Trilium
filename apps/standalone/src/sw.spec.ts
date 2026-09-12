import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (event: unknown) => void;

interface SwGlobals {
    skipWaiting?: () => void;
    clients?: { claim: ReturnType<typeof vi.fn>; matchAll: ReturnType<typeof vi.fn> };
}

const origin = self.location.origin;

let channels: MockMessageChannel[] = [];

class MockMessageChannel {
    port1: { onmessage: EventHandler | null; onmessageerror: (() => void) | null } = { onmessage: null, onmessageerror: null };
    port2 = { tag: "port2" };
    constructor() { channels.push(this); }
}

async function loadSw(): Promise<Record<string, EventHandler>> {
    vi.resetModules();
    const handlers: Record<string, EventHandler> = {};
    vi.spyOn(self, "addEventListener").mockImplementation((type: string, handler: EventListenerOrEventListenerObject) => {
        handlers[type] = handler as EventHandler;
    });
    // sw.ts is a side-effect-only service worker script (no exports); importing it
    // runs its addEventListener registrations, which the spy above captures.
    // @ts-expect-error - sw.ts has no module exports
    await import("./sw.js");
    return handlers;
}

async function awaitResponse(event: { _response?: Promise<Response> }): Promise<Response> {
    const res = await event._response;
    if (!res) {
        throw new Error("respondWith was not called");
    }
    return res;
}

type RequestInit = { method?: string; mode?: string; headers?: [string, string][] };

/**
 * Models the real `Request` body semantics: a body can be read once, and a
 * consumed request can neither be cloned nor re-read. Without this the mock
 * silently permits double reads, which hides retry bugs.
 */
function mockRequest(url: string, init: RequestInit = {}) {
    let bodyUsed = false;
    return {
        url,
        method: init.method ?? "GET",
        mode: init.mode ?? "cors",
        headers: { entries: () => (init.headers ?? [])[Symbol.iterator]() },
        arrayBuffer: async () => {
            if (bodyUsed) throw new TypeError("Body is unusable: Body has already been read");
            bodyUsed = true;
            return new TextEncoder().encode("body").buffer;
        },
        clone: () => {
            if (bodyUsed) throw new TypeError("Failed to clone: body already used");
            return mockRequest(url, init);
        }
    };
}

function fetchEvent(url: string, init: RequestInit = {}): { request: unknown; clientId: string; respondWith(p: Promise<Response>): void; _response?: Promise<Response> } {
    const request = mockRequest(url, init);
    const event = { request, clientId: "c1" } as ReturnType<typeof fetchEvent>;
    event.respondWith = (p: Promise<Response>) => { event._response = p; };
    return event;
}

beforeEach(() => {
    channels = [];
    (self as unknown as SwGlobals).skipWaiting = vi.fn();
    (self as unknown as SwGlobals).clients = { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => []) };
    vi.stubGlobal("caches", {
        open: vi.fn(async () => ({ addAll: vi.fn(), match: vi.fn(), put: vi.fn() })),
        keys: vi.fn(async () => ["static-old", "static-localserver-v1.4"]),
        delete: vi.fn(async () => true)
    });
    vi.stubGlobal("MessageChannel", MockMessageChannel);
    vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "uuid-1" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("network")));
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (self as unknown as SwGlobals).skipWaiting;
    delete (self as unknown as SwGlobals).clients;
});

describe("service worker lifecycle", () => {
    it("skips waiting on install", async () => {
        const handlers = await loadSw();
        let waited: Promise<unknown> | undefined;
        handlers.install({ waitUntil: (p: Promise<unknown>) => { waited = p; } } as unknown);
        await waited;
        expect((self as unknown as SwGlobals).skipWaiting).toHaveBeenCalled();
    });

    it("clears stale caches and claims clients on activate", async () => {
        const handlers = await loadSw();
        let waited: Promise<unknown> | undefined;
        handlers.activate({ waitUntil: (p: Promise<unknown>) => { waited = p; } } as unknown);
        await waited;
        const caches = (globalThis as unknown as { caches: { delete: ReturnType<typeof vi.fn> } }).caches;
        expect(caches.delete).toHaveBeenCalledWith("static-old");
        expect(caches.delete).not.toHaveBeenCalledWith("static-localserver-v1.4");
        expect((self as unknown as SwGlobals).clients?.claim).toHaveBeenCalled();
    });
});

describe("fetch routing", () => {
    it("ignores cross-origin requests", async () => {
        const handlers = await loadSw();
        const event = fetchEvent("https://elsewhere.example.com/api/x");
        handlers.fetch(event);
        expect(event._response).toBeUndefined();
    });

    it("lets native-proxy requests fall through to the network stack untouched", async () => {
        const handlers = await loadSw();
        const event = fetchEvent(`${origin}/_trilium_native_http/ping`);
        handlers.fetch(event);
        // No respondWith: only the WebView's own network path reaches shouldInterceptRequest.
        expect(event._response).toBeUndefined();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("routes local-first prefixes to the client bridge", async () => {
        const handlers = await loadSw();
        const event = fetchEvent(`${origin}/api/notes`);
        handlers.fetch(event);
        expect(event._response).toBeDefined();
    });

    it("serves navigations and .html network-first (which bypasses cache in dev)", async () => {
        const handlers = await loadSw();
        const navEvent = fetchEvent(`${origin}/index.html`, { mode: "navigate" });
        handlers.fetch(navEvent);
        await navEvent._response;
        const htmlEvent = fetchEvent(`${origin}/page.html`);
        handlers.fetch(htmlEvent);
        await htmlEvent._response;
        expect(fetch).toHaveBeenCalled();
    });

    it("serves other GETs cache-first (which bypasses cache in dev)", async () => {
        const handlers = await loadSw();
        const event = fetchEvent(`${origin}/app.js`);
        handlers.fetch(event);
        const res = await awaitResponse(event);
        expect(res).toBeInstanceOf(Response);
    });

    it("passes non-GET, non-local requests straight to the network", async () => {
        const handlers = await loadSw();
        const event = fetchEvent(`${origin}/app.js`, { method: "POST" });
        handlers.fetch(event);
        await event._response;
        expect(fetch).toHaveBeenCalled();
    });

    it("bypasses SW routing on the capacitor:// scheme (assets load via the WebView)", async () => {
        // On a Capacitor custom scheme the WebView serves assets natively and the SW cannot
        // fetch() them, so it must not intercept — no respondWith, no SW-issued fetch.
        vi.stubGlobal("location", { origin, protocol: "capacitor:" });
        const handlers = await loadSw();
        const event = fetchEvent(`${origin}/app.js`);
        handlers.fetch(event);
        expect(event._response).toBeUndefined();
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe("forwardToClientLocalServer", () => {
    /**
     * A main app window. Real tabs answer the service worker's WHO_IS_LEADER
     * probe, so the stand-in does too — otherwise every lookup would sit out the
     * probe timeout before falling back.
     */
    function mainClient(id = "c1", leader = true) {
        const client = {
            id,
            url: `${origin}/`,
            postMessage: vi.fn((msg: { type?: string }) => {
                if (msg?.type === "WHO_IS_LEADER") {
                    channels.at(-1)?.port1.onmessage?.({ data: { type: "LEADER_REPLY", isLeader: leader } } as unknown);
                }
            })
        };
        return client;
    }

    async function dispatchLocal(handlers: Record<string, EventHandler>, method = "POST") {
        const event = fetchEvent(`${origin}/api/notes`, { method, headers: [["x-test", "1"]] });
        handlers.fetch(event);
        return event;
    }

    it("forwards to the main app window and returns its response", async () => {
        const client = mainClient();
        (self as unknown as SwGlobals).clients = {
            claim: vi.fn(),
            matchAll: vi.fn(async () => [{ url: `${origin}/pdfjs/viewer.html`, postMessage: vi.fn() }, client])
        };
        const handlers = await loadSw();
        const event = await dispatchLocal(handlers);

        await vi.waitFor(() => expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));
        const channel = channels.at(-1);
        channel?.port1.onmessage?.({ data: { type: "LOCAL_FETCH_RESPONSE", id: "uuid-1", response: { status: 201, headers: { "content-type": "application/json" }, body: new TextEncoder().encode("ok").buffer } } } as unknown);

        const res = await awaitResponse(event);
        expect(res.status).toBe(201);
        expect(await res.text()).toBe("ok");
    });

    it("falls back to any client when no main window is found", async () => {
        const onlyPdf = { url: `${origin}/pdfjs/viewer.html`, postMessage: vi.fn() };
        // Both candidates are pdfjs; find() yields none, so it falls back to all[0].
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [onlyPdf]) };
        // Make the only client pdfjs so the main-window filter rejects it.
        onlyPdf.url = `${origin}/pdfjs/web/viewer.html`;
        const handlers = await loadSw();
        const event = await dispatchLocal(handlers, "GET");
        await vi.waitFor(() => expect(onlyPdf.postMessage).toHaveBeenCalled());
        const channel = channels.at(-1);
        channel?.port1.onmessage?.({ data: { type: "LOCAL_FETCH_RESPONSE", id: "uuid-1", response: { status: 200, headers: {}, body: null } } } as unknown);
        const res = await awaitResponse(event);
        expect(res.status).toBe(200);
    });

    it("falls back to the network when there are no clients", async () => {
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => []) };
        const handlers = await loadSw();
        const event = await dispatchLocal(handlers, "GET");
        await event._response;
        expect(fetch).toHaveBeenCalled();
    });

    it("defaults status and omits headers when the response is sparse", async () => {
        const client = mainClient();
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [client]) };
        const handlers = await loadSw();
        const event = await dispatchLocal(handlers, "GET");
        await vi.waitFor(() => expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));
        // No status, no headers, no body → status falls back to 200, headers stay empty.
        channels.at(-1)?.port1.onmessage?.({ data: { type: "LOCAL_FETCH_RESPONSE", id: "uuid-1", response: {} } } as unknown);
        const res = await awaitResponse(event);
        expect(res.status).toBe(200);
    });

    it("falls back to the network on a protocol mismatch", async () => {
        const client = mainClient();
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [client]) };
        const handlers = await loadSw();
        const event = await dispatchLocal(handlers, "GET");
        await vi.waitFor(() => expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));
        channels.at(-1)?.port1.onmessage?.({ data: { type: "WRONG", id: "uuid-1" } } as unknown);
        await event._response;
        expect(fetch).toHaveBeenCalled();
    });

    it("rejects on a message error", async () => {
        const client = mainClient();
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [client]) };
        const handlers = await loadSw();
        const event = await dispatchLocal(handlers, "GET");
        await vi.waitFor(() => expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));
        channels.at(-1)?.port1.onmessageerror?.();
        await expect(event._response).rejects.toThrow("Local server message error");
    });

    it("times out when the client never responds", async () => {
        const client = mainClient();
        const handlers = await loadSw();
        vi.useFakeTimers();
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [client]) };
        const event = await dispatchLocal(handlers, "GET");
        const rejection = expect(event._response).rejects.toThrow("Local server timeout");
        // Flushes the pending matchAll microtask, then fires the timeout, which sits just under
        // the ~5 minutes the browser gives a fetch event.
        await vi.advanceTimersByTimeAsync(270_000);
        await rejection;
        vi.useRealTimers();
    });

    it("routes to the tab that announced itself as leader", async () => {
        const follower = mainClient("c-follower", false);
        const leader = mainClient("c-leader", true);
        // Leader deliberately last: picking the first window (the old behaviour)
        // would send every tab's traffic to a tab with no worker.
        (self as unknown as SwGlobals).clients = {
            claim: vi.fn(),
            matchAll: vi.fn(async () => [follower, leader])
        };
        const handlers = await loadSw();
        handlers.message({ data: { type: "LEADER_ANNOUNCE" }, source: { id: "c-leader" } });

        const event = await dispatchLocal(handlers, "GET");
        await vi.waitFor(() => expect(leader.postMessage).toHaveBeenCalled());
        // Announced leader is used directly, with no probe round.
        expect(follower.postMessage).not.toHaveBeenCalled();

        channels.at(-1)?.port1.onmessage?.({ data: { type: "LOCAL_FETCH_RESPONSE", id: "uuid-1", response: { status: 200, headers: {}, body: null } } } as unknown);
        expect((await awaitResponse(event)).status).toBe(200);
    });

    it("probes for the leader when it has not been told who it is", async () => {
        const follower = mainClient("c-follower", false);
        const leader = mainClient("c-leader", true);
        (self as unknown as SwGlobals).clients = {
            claim: vi.fn(),
            matchAll: vi.fn(async () => [follower, leader])
        };
        const handlers = await loadSw();

        const event = await dispatchLocal(handlers, "GET");
        // Both are asked; only the leader claims it, and the request goes there.
        await vi.waitFor(() => expect(follower.postMessage).toHaveBeenCalledWith({ type: "WHO_IS_LEADER" }, expect.anything()));
        await vi.waitFor(() => expect(leader.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));

        channels.at(-1)?.port1.onmessage?.({ data: { type: "LOCAL_FETCH_RESPONSE", id: "uuid-1", response: { status: 200, headers: {}, body: null } } } as unknown);
        expect((await awaitResponse(event)).status).toBe(200);
    });

    it("re-resolves the leader when a tab replies NOT_LEADER", async () => {
        // Stale cached leader: the tab was demoted since it announced.
        const stale = mainClient("c-stale", false);
        const leader = mainClient("c-leader", true);
        (self as unknown as SwGlobals).clients = {
            claim: vi.fn(),
            matchAll: vi.fn(async () => [stale, leader])
        };
        const handlers = await loadSw();
        handlers.message({ data: { type: "LEADER_ANNOUNCE" }, source: { id: "c-stale" } });

        const event = await dispatchLocal(handlers, "GET");
        await vi.waitFor(() => expect(stale.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));

        // The demoted tab refuses rather than opening a second database.
        channels.at(-1)?.port1.onmessage?.({ data: { type: "NOT_LEADER", id: "uuid-1" } } as unknown);

        await vi.waitFor(() => expect(leader.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));
        channels.at(-1)?.port1.onmessage?.({ data: { type: "LOCAL_FETCH_RESPONSE", id: "uuid-1", response: { status: 200, headers: {}, body: null } } } as unknown);
        expect((await awaitResponse(event)).status).toBe(200);
    });

    it("re-sends the body when a body-bearing mutation hits a stale leader", async () => {
        const stale = mainClient("c-stale", false);
        const leader = mainClient("c-leader", true);
        (self as unknown as SwGlobals).clients = {
            claim: vi.fn(),
            matchAll: vi.fn(async () => [stale, leader])
        };
        const handlers = await loadSw();
        handlers.message({ data: { type: "LEADER_ANNOUNCE" }, source: { id: "c-stale" } });

        const event = await dispatchLocal(handlers, "PUT");
        await vi.waitFor(() => expect(stale.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));
        channels.at(-1)?.port1.onmessage?.({ data: { type: "NOT_LEADER", id: "uuid-1" } } as unknown);

        // The retry must carry the body, not fail on an already-consumed request.
        await vi.waitFor(() => expect(leader.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));
        const forwarded = leader.postMessage.mock.calls.find(([msg]) => msg?.type === "LOCAL_FETCH")?.[0];
        expect(new TextDecoder().decode(forwarded?.request?.body)).toBe("body");

        channels.at(-1)?.port1.onmessage?.({ data: { type: "LOCAL_FETCH_RESPONSE", id: "uuid-1", response: { status: 200, headers: {}, body: null } } } as unknown);
        expect((await awaitResponse(event)).status).toBe(200);
    });

    it("gives up to the network rather than looping when the retry also refuses", async () => {
        // Both tabs claim leadership when probed but refuse when asked to serve.
        const a = mainClient("c-a", true);
        const b = mainClient("c-b", true);
        (self as unknown as SwGlobals).clients = {
            claim: vi.fn(),
            matchAll: vi.fn(async () => [a, b])
        };
        const fetchMock = vi.fn(async () => new Response("network", { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        const handlers = await loadSw();
        const event = await dispatchLocal(handlers, "PUT");

        await vi.waitFor(() => expect(a.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));
        channels.at(-1)?.port1.onmessage?.({ data: { type: "NOT_LEADER", id: "uuid-1" } } as unknown);

        await vi.waitFor(() => expect(b.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));
        channels.at(-1)?.port1.onmessage?.({ data: { type: "NOT_LEADER", id: "uuid-1" } } as unknown);

        expect((await awaitResponse(event)).status).toBe(200);
        expect(fetchMock).toHaveBeenCalled();
    });
});
