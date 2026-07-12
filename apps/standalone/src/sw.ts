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

async function forwardToClientLocalServer(request, _clientId) {
    // Find the main app window to handle the request
    // We must route to the main app (which has the local bridge), not iframes like PDF.js viewer
    // @ts-expect-error - self.clients is valid in service worker context
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

    // Find the main app window - it's the one NOT serving pdfjs or other embedded content
    // The main app has the local bridge handler for LOCAL_FETCH messages
    let client = all.find((c: { url: string }) => {
        const url = new URL(c.url);
        // Main app is at root or index.html, not in /pdfjs/ or other iframe paths
        return !url.pathname.startsWith("/pdfjs/");
    }) || null;

    // If no main app window found, fall back to any available client
    if (!client) {
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

    // Native streaming HTTP proxy (Capacitor Android): these must reach the WebView's
    // network stack untouched so WebViewClient.shouldInterceptRequest can answer them —
    // a respondWith() (even a fetch() pass-through) would re-issue them from the service
    // worker, which the interceptor never sees. See capacitor_http_handler.ts.
    if (url.pathname.startsWith("/_trilium_native_http/")) return;

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
