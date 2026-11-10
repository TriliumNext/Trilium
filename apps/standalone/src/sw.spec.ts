import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (event: unknown) => void;

interface SwGlobals {
    skipWaiting?: () => void;
    clients?: { claim: ReturnType<typeof vi.fn>; matchAll: ReturnType<typeof vi.fn> };
}

const origin = self.location.origin;

let channels: MockMessageChannel[] = [];

class MockMessageChannel {
    port1: {
        onmessage: EventHandler | null;
        onmessageerror: (() => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
    } = { onmessage: null, onmessageerror: null, postMessage: vi.fn() };
    port2 = { tag: "port2" };
    constructor() { channels.push(this); }
}

async function loadSw(): Promise<Record<string, EventHandler>> {
    vi.resetModules();
    const handlers: Record<string, EventHandler> = {};
    vi.spyOn(self, "addEventListener").mockImplementation((type: string, handler: EventListenerOrEventListenerObject) => {
        handlers[type] = handler as EventHandler;
    });
    // Importing sw.ts runs its addEventListener registrations, which the spy above captures.
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

        // `/custom/` carries custom request handlers and resource providers. Left off this list it
        // would be fetched as a static asset, over a network this build does not have.
        const custom = fetchEvent(`${origin}/custom/my-handler`);
        handlers.fetch(custom);
        expect(custom._response).toBeDefined();
    });

    it("routes shared-note pages to the client bridge but serves the share theme's assets statically", async () => {
        const handlers = await loadSw();

        for (const path of [ "/share", "/share/", "/share/my-alias", "/share/api/notes/abc123" ]) {
            const event = fetchEvent(`${origin}${path}`, { mode: "navigate" });
            handlers.fetch(event);
            expect(event._response, path).toBeDefined();
        }

        // The theme's own files ship with the build, so they take the ordinary static path.
        vi.mocked(fetch).mockClear();
        const asset = fetchEvent(`${origin}/share/assets/styles.css`);
        handlers.fetch(asset);
        await awaitResponse(asset);
        expect(fetch).toHaveBeenCalled();
    });

    it("explains that Trilium must be open when a share page finds no app window", async () => {
        // A lone pdfjs frame is not an app window: it carries no local bridge to render the page.
        (self as unknown as SwGlobals).clients = {
            claim: vi.fn(),
            matchAll: vi.fn(async () => [{ url: `${origin}/pdfjs/viewer.html`, postMessage: vi.fn() }])
        };
        const handlers = await loadSw();
        const event = fetchEvent(`${origin}/share/my-alias`, { mode: "navigate" });
        handlers.fetch(event);

        const res = await awaitResponse(event);
        expect(res.status).toBe(503);
        expect(await res.text()).toContain("Open Trilium in this browser");
        // Nothing to forward to, and no server behind it either.
        expect(fetch).not.toHaveBeenCalled();
    });

    it("forwards a shared-note page to the leader when an app window is open", async () => {
        const client = {
            id: "c1",
            url: `${origin}/`,
            postMessage: vi.fn((msg: { type?: string }) => {
                if (msg?.type === "WHO_IS_LEADER") {
                    channels.at(-1)?.port1.onmessage?.({ data: { isLeader: true } });
                }
            })
        };
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [client]) };
        const handlers = await loadSw();
        const event = fetchEvent(`${origin}/share/my-alias`, { mode: "navigate" });
        handlers.fetch(event);

        await vi.waitFor(() => expect(client.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "LOCAL_FETCH", request: expect.objectContaining({ url: `${origin}/share/my-alias` }) }),
            expect.anything()
        ));
        channels.at(-1)?.port1.onmessage?.({ data: { type: "LOCAL_FETCH_RESPONSE", id: "uuid-1", response: { status: 200, headers: {}, body: "<p>shared</p>" } } });
        expect(await (await awaitResponse(event)).text()).toBe("<p>shared</p>");
    });

    it("answers the backup keepalive ping with an empty 204", async () => {
        const handlers = await loadSw();
        const event = fetchEvent(`${origin}/local-backup-ping`);
        handlers.fetch(event);
        const res = await awaitResponse(event);
        expect(res.status).toBe(204);
        expect(fetch).not.toHaveBeenCalled();
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

    it("answers 503 rather than asking the static host when there are no clients", async () => {
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => []) };
        const handlers = await loadSw();
        const event = await dispatchLocal(handlers, "GET");
        const res = await awaitResponse(event);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ message: expect.stringContaining("No Trilium tab") });
        expect(fetch).not.toHaveBeenCalled();
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

    it("answers 503 rather than asking the static host on a protocol mismatch", async () => {
        const client = mainClient();
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [client]) };
        const handlers = await loadSw();
        const event = await dispatchLocal(handlers, "GET");
        await vi.waitFor(() => expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));
        channels.at(-1)?.port1.onmessage?.({ data: { type: "WRONG", id: "uuid-1" } } as unknown);
        expect((await awaitResponse(event)).status).toBe(503);
        expect(fetch).not.toHaveBeenCalled();
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

    it("falls back to the first app window when no tab answers the leader probe in time", async () => {
        const silent = { id: "c-silent", url: `${origin}/`, postMessage: vi.fn() };
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [silent]) };
        const handlers = await loadSw();
        vi.useFakeTimers();
        try {
            const event = await dispatchLocal(handlers, "GET");
            await vi.advanceTimersByTimeAsync(999);
            expect(silent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything());
            await vi.advanceTimersByTimeAsync(1);
            expect(silent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything());

            channels.at(-1)?.port1.onmessage?.({ data: { type: "LOCAL_FETCH_RESPONSE", id: "uuid-1", response: { status: 200, headers: {}, body: null } } });
            expect((await awaitResponse(event)).status).toBe(200);
        } finally {
            vi.useRealTimers();
        }
    });

    it("caches the leader only from a LEADER_ANNOUNCE that names its source", async () => {
        const follower = mainClient("c-follower", false);
        const leader = mainClient("c-leader", true);
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [follower, leader]) };
        const handlers = await loadSw();
        handlers.message({ data: { type: "LEADER_ANNOUNCE" } });
        handlers.message({ data: { type: "OTHER" }, source: { id: "c-follower" } });

        const event = await dispatchLocal(handlers, "GET");
        // Neither message cached a leader, so the follower is probed and never served the request.
        await vi.waitFor(() => expect(leader.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything()));
        expect(follower.postMessage).toHaveBeenCalledWith({ type: "WHO_IS_LEADER" }, expect.anything());
        expect(follower.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH" }), expect.anything());

        channels.at(-1)?.port1.onmessage?.({ data: { type: "LOCAL_FETCH_RESPONSE", id: "uuid-1", response: { status: 200, headers: {}, body: null } } });
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
        const forwarded = leader.postMessage.mock.calls.find(([msg]) => msg?.type === "LOCAL_FETCH")?.[0] as
            { request?: { body?: ArrayBuffer } } | undefined;
        expect(new TextDecoder().decode(forwarded?.request?.body)).toBe("body");

        channels.at(-1)?.port1.onmessage?.({ data: { type: "LOCAL_FETCH_RESPONSE", id: "uuid-1", response: { status: 200, headers: {}, body: null } } } as unknown);
        expect((await awaitResponse(event)).status).toBe(200);
    });

    it("waits for a reloaded tab that is promoted to leader after its request went out", async () => {
        // The reloaded page requests /bootstrap while the previous page still holds the Web Lock.
        let promoted = false;
        const page = {
            id: "c-page",
            url: `${origin}/`,
            postMessage: vi.fn((msg: { type?: string; id?: string }) => {
                const port = channels.at(-1)?.port1;
                if (msg?.type === "WHO_IS_LEADER") {
                    port?.onmessage?.({ data: { type: "LEADER_REPLY", isLeader: promoted } } as unknown);
                } else if (msg?.type === "LOCAL_FETCH") {
                    port?.onmessage?.({
                        data: promoted
                            ? { type: "LOCAL_FETCH_RESPONSE", id: msg.id, response: { status: 200, headers: {}, body: null } }
                            : { type: "NOT_LEADER", id: msg.id }
                    } as unknown);
                }
            })
        };
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [page]) };
        const handlers = await loadSw();
        vi.useFakeTimers();

        const event = await dispatchLocal(handlers, "GET");
        await vi.advanceTimersByTimeAsync(1_000);
        expect(event._response).toBeDefined();
        promoted = true;
        await vi.advanceTimersByTimeAsync(1_000);

        expect((await awaitResponse(event)).status).toBe(200);
        expect(fetch).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it("answers 503 once no tab has become leader by the deadline", async () => {
        // Both tabs claim leadership when probed but refuse when asked to serve.
        const refuse = (id: string) => ({
            id,
            url: `${origin}/`,
            postMessage: vi.fn((msg: { type?: string; id?: string }) => {
                const port = channels.at(-1)?.port1;
                port?.onmessage?.({
                    data: msg?.type === "WHO_IS_LEADER"
                        ? { type: "LEADER_REPLY", isLeader: true }
                        : { type: "NOT_LEADER", id: msg.id }
                } as unknown);
            })
        });
        (self as unknown as SwGlobals).clients = {
            claim: vi.fn(),
            matchAll: vi.fn(async () => [refuse("c-a"), refuse("c-b")])
        };
        const handlers = await loadSw();
        vi.useFakeTimers();

        const event = await dispatchLocal(handlers, "PUT");
        let settled = false;
        void event._response?.then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(29_000);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(2_000);

        const res = await awaitResponse(event);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ message: expect.stringContaining("in time") });
        expect(fetch).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});

describe("backup download", () => {
    /** A leader tab, which answers the probe so the backup channel goes to it. */
    function useLeaderTab() {
        const tab = {
            id: "c-leader",
            url: `${origin}/`,
            postMessage: vi.fn((msg: { type?: string }) => {
                if (msg?.type === "WHO_IS_LEADER") {
                    channels.at(-1)?.port1.onmessage?.({ data: { isLeader: true } });
                }
            })
        };
        (self as unknown as SwGlobals).clients = { claim: vi.fn(), matchAll: vi.fn(async () => [tab]) };
        return tab;
    }

    async function startDownload(query = "") {
        const tab = useLeaderTab();
        const handlers = await loadSw();
        const event = fetchEvent(`${origin}/local-backup-download${query}`, { mode: "navigate" });
        handlers.fetch(event);
        await vi.waitFor(() => expect(tab.postMessage).toHaveBeenCalledWith({ type: "LOCAL_BACKUP_STREAM" }, [ { tag: "port2" } ]));
        const port = channels.at(-1)?.port1;
        if (!port) throw new Error("no backup channel");
        await vi.waitFor(() => expect(port.onmessage).not.toBeNull());
        return { event, port, send: (data: unknown) => port.onmessage?.({ data }) };
    }

    it("streams the worker's chunks as an attachment of the announced size", async () => {
        const { event, port, send } = await startDownload("?fileName=my%22back%5Cup%0A.db");
        send({ type: "begin", byteSize: 6 });
        const res = await awaitResponse(event);

        expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(res.headers.get("Content-Disposition")).toBe("attachment; filename=\"my-back-up-.db\"");
        expect(res.headers.get("Content-Length")).toBe("6");
        // Several chunks are requested at once rather than one round trip at a time.
        const pulls = () => port.postMessage.mock.calls.filter(([ m ]) => m?.type === "pull").length;
        expect(pulls()).toBe(8);

        send({ type: "chunk", data: new TextEncoder().encode("abc").buffer });
        expect(pulls()).toBe(9);
        send({ type: "chunk", data: new TextEncoder().encode("def").buffer });
        send({ type: "end" });
        expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("abcdef");
    });

    it("names the file backup.db by default and tells the worker when the download is canceled", async () => {
        const { event, port, send } = await startDownload();
        send({ type: "begin", byteSize: 1 });
        const res = await awaitResponse(event);
        expect(res.headers.get("Content-Disposition")).toBe("attachment; filename=\"backup.db\"");

        await res.body?.cancel();
        expect(port.postMessage).toHaveBeenCalledWith({ type: "cancel" });
    });

    it("fails the download with the worker's error, or a generic one when it gives none", async () => {
        const first = await startDownload();
        first.send({ type: "begin", byteSize: 1 });
        const failed = await awaitResponse(first.event);
        first.send({ type: "error", message: "disk full" });
        await expect(failed.arrayBuffer()).rejects.toThrow("disk full");

        const second = await startDownload();
        second.send({ type: "begin", byteSize: 1 });
        const garbled = await awaitResponse(second.event);
        second.send(null);
        await expect(garbled.arrayBuffer()).rejects.toThrow("The backup failed.");
    });

    it("answers 503 and cancels when the stream does not begin", async () => {
        const refused = await startDownload();
        refused.send({ type: "error", message: "not the leader" });
        const refusedRes = await awaitResponse(refused.event);
        expect(refusedRes.status).toBe(503);
        expect(await refusedRes.text()).toBe("not the leader");
        expect(refused.port.postMessage).toHaveBeenCalledWith({ type: "cancel" });

        const odd = await startDownload();
        odd.send({ type: "chunk" });
        expect(await (await awaitResponse(odd.event)).text()).toBe("The backup stream did not start.");
    });

    it("answers 503 when the worker does not reply within 30 seconds", async () => {
        const tab = useLeaderTab();
        const handlers = await loadSw();
        vi.useFakeTimers();
        try {
            const event = fetchEvent(`${origin}/local-backup-download`, { mode: "navigate" });
            handlers.fetch(event);
            await vi.advanceTimersByTimeAsync(29_000);
            expect(tab.postMessage).toHaveBeenCalledWith({ type: "LOCAL_BACKUP_STREAM" }, expect.anything());
            await vi.advanceTimersByTimeAsync(1_000);

            const res = await awaitResponse(event);
            expect(res.status).toBe(503);
            expect(await res.text()).toBe("The backup stream did not start.");
        } finally {
            vi.useRealTimers();
        }
    });

    it("answers 503 when no tab is open", async () => {
        const handlers = await loadSw();
        const event = fetchEvent(`${origin}/local-backup-download`, { mode: "navigate" });
        handlers.fetch(event);
        const res = await awaitResponse(event);
        expect(res.status).toBe(503);
        expect(await res.text()).toBe("The application page is not available.");
    });
});
