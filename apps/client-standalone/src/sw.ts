// public/sw.js
const VERSION = "localserver-v1.4";
const STATIC_CACHE = `static-${VERSION}`;

// Check if running in dev mode (passed via URL parameter)
const isDev = true;

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
        if (!isDev) {
            const cache = await caches.open(STATIC_CACHE);
            await cache.addAll(PRECACHE_URLS);
        }
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
}

async function networkFirst(request) {
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
}

async function forwardToClientLocalServer(request, clientId) {
    // Find a client to handle the request (prefer the initiating client if available)
    let client = clientId ? await self.clients.get(clientId) : null;

    if (!client) {
        const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        client = all[0] || null;
    }

    // If no page is available, fall back to network
    if (!client) return fetch(request);

    const reqUrl = request.url;
    const headersObj = {};
    for (const [k, v] of request.headers.entries()) headersObj[k] = v;

    const body = (request.method === "GET" || request.method === "HEAD")
        ? null
        : await request.arrayBuffer();

    const id = crypto.randomUUID();
    const channel = new MessageChannel();

    const responsePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("Local server timeout"));
        }, 30_000);

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

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Only handle same-origin
    if (url.origin !== self.location.origin) return;

    // HTML files: network-first to ensure updates are reflected immediately
    if (event.request.mode === "navigate" || url.pathname.endsWith(".html")) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // Static assets: cache-first for performance
    if (event.request.method === "GET" && !isLocalFirst(url)) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // API-ish: local-first via bridge
    if (isLocalFirst(url)) {
        event.respondWith(forwardToClientLocalServer(event.request, event.clientId));
        return;
    }

    // Default
    event.respondWith(fetch(event.request));
});
