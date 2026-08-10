// public/sw.js
const VERSION = "localserver-v1.4";
const STATIC_CACHE = `static-${VERSION}`;

// Check if running in dev mode (passed via URL parameter)
const isDev = true;

/* v8 ignore next 3 -- @preserve: isDev is hardcoded true, so the dev-mode log always runs and has no testable alternate branch. */
if (isDev) {
    console.log('[Service Worker] Running in DEV mode - caching disabled');
}

// Adjust these to your routes:
const LOCAL_FIRST_PREFIXES = [
    "/bootstrap",
    "/api/",
    "/sync/",
    "/search/"
];

// Optional: basic precache list (keep small; you can expand later)
const PRECACHE_URLS = [
    // "/",
    // "/index.html",
    // "/manifest.webmanifest",
    // "/favicon.ico",
];

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        // Skip precaching in dev mode
        /* v8 ignore start -- @preserve: isDev is hardcoded true, so precaching never runs. */
        if (!isDev) {
            const cache = await caches.open(STATIC_CACHE);
            await cache.addAll(PRECACHE_URLS);
        }
        /* v8 ignore stop */
        self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
    // Cleanup old caches
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => (k === STATIC_CACHE ? Promise.resolve() : caches.delete(k))));
        await self.clients.claim();
    })());
});

function isLocalFirst(url) {
    return LOCAL_FIRST_PREFIXES.some((p) => url.pathname.startsWith(p));
}

async function cacheFirst(request) {
    /* v8 ignore start -- @preserve: isDev is hardcoded true, so only the dev bypass executes; the cache implementation is dead code. */
    // In dev mode, always bypass cache
    if (isDev) {
        return fetch(request);
    }

    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;

    const fresh = await fetch(request);
    // Cache only successful GETs
    if (request.method === "GET" && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
    /* v8 ignore stop */
}

async function networkFirst(request) {
    /* v8 ignore start -- @preserve: isDev is hardcoded true, so only the dev bypass executes; the cache implementation is dead code. */
    // In dev mode, always bypass cache
    if (isDev) {
        return fetch(request);
    }

    const cache = await caches.open(STATIC_CACHE);
    try {
        const fresh = await fetch(request);
        // Cache only successful GETs
        if (request.method === "GET" && fresh.ok) cache.put(request, fresh.clone());
        return fresh;
    } catch (error) {
        // Fallback to cache if network fails
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
    }
    /* v8 ignore stop */
}

// Only one tab owns the database (it holds the Web Lock and is the only one with
// a worker), so every tab's API traffic has to reach that specific tab. This is
// a cache: the service worker is evicted when idle and loses it, so a miss falls
// back to probing the open tabs.
let leaderClientId = null;

self.addEventListener("message", (event) => {
    if (event.data?.type === "LEADER_ANNOUNCE" && event.source) {
        leaderClientId = event.source.id;
    }
});

function isMainAppWindow(client) {
    const url = new URL(client.url);
    // Main app is at root or index.html, not in /pdfjs/ or other iframe paths,
    // which have no local bridge of their own.
    return !url.pathname.startsWith("/pdfjs/");
}

/**
 * Ask each candidate tab whether it is the leader. Used when the cached id is
 * missing or stale; the answer is cached again for subsequent requests.
 */
async function findLeader(candidates) {
    for (const candidate of candidates) {
        const channel = new MessageChannel();
        const replied = new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 1_000);
            channel.port1.onmessage = (event) => {
                clearTimeout(timeout);
                resolve(event.data);
            };
        });

        candidate.postMessage({ type: "WHO_IS_LEADER" }, [channel.port2]);
        const answer = await replied;
        if (answer?.isLeader) {
            leaderClientId = candidate.id;
            return candidate;
        }
    }
    return null;
}

/**
 * The tab that owns the database, which is the only one that can answer for it: the cached leader
 * while it is still open, otherwise whichever tab answers the probe, and failing both the first app
 * window — which replies NOT_LEADER if it is not the one, leaving the caller to retry.
 */
async function findLeaderClient() {
    // @ts-expect-error - self.clients is valid in service worker context
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const candidates = all.filter(isMainAppWindow);

    let client = candidates.find((c) => c.id === leaderClientId) || null;
    if (!client) {
        client = await findLeader(candidates);
    }

    // No leader answered (e.g. the old one is closing and the next has not been
    // promoted yet). Fall back to the first app window rather than dropping the
    // request; if it is not the leader it replies NOT_LEADER and we retry below.
    if (!client) {
        client = candidates[0] || all[0] || null;
    }

    return { client, candidates };
}

async function forwardToClientLocalServer(request, _clientId, retried = false) {
    const { client, candidates } = await findLeaderClient();

    // If no page is available, fall back to network
    if (!client) return fetch(request);

    const reqUrl = request.url;
    const headersObj = {};
    for (const [k, v] of request.headers.entries()) headersObj[k] = v;

    // Read from a clone: `request` itself must stay unconsumed so the NOT_LEADER
    // path below can forward it again (or hand it to fetch()). Reading it
    // directly makes any body-bearing retry fail with "Body has already been
    // read".
    const body = (request.method === "GET" || request.method === "HEAD")
        ? null
        : await request.clone().arrayBuffer();

    const id = crypto.randomUUID();
    const channel = new MessageChannel();

    const responsePromise = new Promise((resolve, reject) => {
        // Long enough for a request the worker answers late because it is deep inside one
        // synchronous stretch of work (a VACUUM of a multi-gigabyte database blocks it for well
        // over a minute), and just short of the ~5 minutes Chromium gives a fetch event before
        // reclaiming it regardless. Anything legitimately longer must not ride a single request:
        // the setup backup starts with one request and is followed over a status poll.
        const timeout = setTimeout(() => {
            reject(new Error("Local server timeout"));
        }, 270_000);

        channel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            resolve(event.data);
        };
        channel.port1.onmessageerror = () => {
            clearTimeout(timeout);
            reject(new Error("Local server message error"));
        };
    });

    // Send to the client with a reply port
    client.postMessage({
        type: "LOCAL_FETCH",
        id,
        request: {
            url: reqUrl,
            method: request.method,
            headers: headersObj,
            body // ArrayBuffer or null
        }
    }, [channel.port2]);

    const localResp = await responsePromise;

    // We picked a follower. It refused to open a second database; re-resolve the
    // leader and try once more. Only once: leadership can flip between a tab
    // answering WHO_IS_LEADER and that same tab serving the fetch, so an
    // unbounded retry could ping-pong between two tabs indefinitely.
    if (localResp?.type === "NOT_LEADER") {
        leaderClientId = null;
        if (retried) return fetch(request);

        const leader = await findLeader(candidates.filter((c) => c.id !== client.id));
        if (!leader) return fetch(request);
        return forwardToClientLocalServer(request, _clientId, true);
    }

    if (!localResp || localResp.type !== "LOCAL_FETCH_RESPONSE" || localResp.id !== id) {
    // Protocol mismatch; fall back
        return fetch(request);
    }

    // localResp.response: { status, headers, body }
    const { status, headers, body: respBody } = localResp.response;

    const respHeaders = new Headers();
    if (headers) {
        for (const [k, v] of Object.entries(headers)) respHeaders.set(k, String(v));
    }

    return new Response(respBody ? respBody : null, {
        status: status || 200,
        headers: respHeaders
    });
}

/**
 * Answers a backup download with the database streamed straight out of the local worker.
 *
 * The response body is fed through a message channel: this end asks for one chunk each time the
 * download can take more, the page relays the channel to the worker, and the worker reads the
 * database a batch of pages at a time. The download's backpressure is the only flow control, so
 * nothing is ever buffered beyond a chunk or two, whatever the database weighs.
 *
 * The channel goes to the leader tab, since that is the one holding the database; a follower that
 * receives it anyway says so on the port, and this answers 503 rather than a truncated file.
 */
async function streamBackupDownload(url) {
    const { client } = await findLeaderClient();
    if (!client) {
        return new Response("The application page is not available.", { status: 503 });
    }

    const channel = new MessageChannel();
    const port = channel.port1;
    client.postMessage({ type: "LOCAL_BACKUP_STREAM" }, [channel.port2]);

    // The worker opens with the exact size, which is what lets the download show a percentage.
    const begin = await new Promise<{ type?: string; byteSize?: number; message?: unknown } | null>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 30_000);
        port.onmessage = (event) => {
            clearTimeout(timeout);
            resolve(event.data);
        };
    });
    if (!begin || begin.type !== "begin") {
        port.postMessage({ type: "cancel" });
        return new Response(
            begin && begin.type === "error" ? String(begin.message) : "The backup stream did not start.",
            { status: 503 }
        );
    }

    // Several chunks travel at once: each pull round-trips through the page to the worker, and
    // one-at-a-time would make that latency the download's speed limit.
    const MAX_CHUNKS_IN_FLIGHT = 8;
    let outstanding = 0;
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const requestMore = () => {
        while (streamController && outstanding < MAX_CHUNKS_IN_FLIGHT
            && (streamController.desiredSize ?? 0) > 0) {
            outstanding++;
            port.postMessage({ type: "pull" });
        }
    };

    const stream = new ReadableStream({
        start(controller) {
            streamController = controller;
            port.onmessage = (event) => {
                const msg = event.data;
                if (msg && msg.type === "chunk") {
                    outstanding--;
                    controller.enqueue(new Uint8Array(msg.data));
                    requestMore();
                } else if (msg && msg.type === "end") {
                    controller.close();
                } else {
                    controller.error(new Error(msg && msg.message ? String(msg.message) : "The backup failed."));
                }
            };
            requestMore();
        },
        pull() {
            requestMore();
        },
        cancel() {
            port.postMessage({ type: "cancel" });
        }
    }, new CountQueuingStrategy({ highWaterMark: MAX_CHUNKS_IN_FLIGHT }));

    const fileName = (url.searchParams.get("fileName") || "backup.db").replace(/["\\\r\n]/g, "-");
    return new Response(stream, {
        headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${fileName}"`,
            "Content-Length": String(begin.byteSize)
        }
    });
}

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Only handle same-origin
    if (url.origin !== self.location.origin) return;

    // Native streaming HTTP proxy (Capacitor Android): these must reach the WebView's
    // network stack untouched so WebViewClient.shouldInterceptRequest can answer them —
    // a respondWith() (even a fetch() pass-through) would re-issue them from the service
    // worker, which the interceptor never sees. See capacitor_http_handler.ts.
    if (url.pathname.startsWith("/_trilium_native_http/")) return;

    // The keepalive the page sends while a backup download streams: a streaming response body
    // generates no events of its own, and a service worker with no events is one the browser
    // reclaims mid-download. Answering a fetch is what resets that clock.
    if (url.pathname === "/local-backup-ping") {
        event.respondWith(new Response(null, { status: 204 }));
        return;
    }

    // A backup download: streamed straight from the local worker, before navigate handling for
    // the same reason as the API routes — the download arrives as a navigation.
    if (url.pathname === "/local-backup-download") {
        event.respondWith(streamBackupDownload(url));
        return;
    }

    // API-ish: local-first via bridge (must be checked before navigate handling,
    // because export triggers a navigation to an /api/ URL)
    if (isLocalFirst(url)) {
        event.respondWith(forwardToClientLocalServer(event.request, event.clientId));
        return;
    }

    // On the Capacitor custom URL scheme (capacitor://) the WebView serves app assets
    // through its native URLSchemeHandler, which a service worker cannot reach via fetch() —
    // let those requests fall through to the WebView's own loader. In practice the SW is only
    // registered on http/https origins (main.ts uses a fetch/XHR interceptor instead of a SW
    // on capacitor://), so this is a defensive guard rather than a hot path.
    if (self.location.protocol === "capacitor:") {
        return;
    }

    // HTML files: network-first to ensure updates are reflected immediately
    if (event.request.mode === "navigate" || url.pathname.endsWith(".html")) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // Static assets: cache-first for performance
    if (event.request.method === "GET") {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // Default
    event.respondWith(fetch(event.request));
});
