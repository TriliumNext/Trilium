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

function fetchEvent(url: string, init: { method?: string; mode?: string; headers?: [string, string][] } = {}): { request: unknown; clientId: string; respondWith(p: Promise<Response>): void; _response?: Promise<Response> } {
    const request = {
        url,
        method: init.method ?? "GET",
        mode: init.mode ?? "cors",
        headers: { entries: () => (init.headers ?? [])[Symbol.iterator]() },
        arrayBuffer: async () => new TextEncoder().encode("body").buffer
    };
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
});

describe("forwardToClientLocalServer", () => {
    function mainClient() {
        return { url: `${origin}/`, postMessage: vi.fn() };
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

        await vi.waitFor(() => expect(client.postMessage).toHaveBeenCalled());
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
        await vi.waitFor(() => expect(client.postMessage).toHaveBeenCalled());
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
        await vi.waitFor(() => expect(client.postMessage).toHaveBeenCalled());
        channels.at(-1)?.port1.onmessage?.({ data: { type: "WRONG", id: "uuid-1" } } as unknown);
        await event._response;
        expect(fetch).toHaveBeenCalled();
    });

    it("rejects on a message error", async () => {
        const client = mainClient();
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [client]) };
        const handlers = await loadSw();
        const event = await dispatchLocal(handlers, "GET");
        await vi.waitFor(() => expect(client.postMessage).toHaveBeenCalled());
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
        // Flushes the pending matchAll microtask, then fires the 30s timeout.
        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;
        vi.useRealTimers();
    });
});
