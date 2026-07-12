import { isLocalApiRequest, localFetch } from "./local-bridge.js";

/**
 * iOS-only request interceptors.
 *
 * iOS Capacitor loads the app on the `capacitor://` scheme, and WebKit refuses
 * to register a service worker for a non-HTTP(S) origin. The standalone stack
 * normally routes the client's API/sync calls to the in-browser SQLite worker
 * through that service worker (this is what Android — served on `https://` via
 * `androidScheme` — and the web build both rely on). Since the SW can't exist
 * under `capacitor://`, these three interceptors stand in for it, each catching
 * a request path the SW would otherwise handle:
 *
 *   - {@link setupFetchInterceptor}      — `window.fetch` calls to the local API.
 *   - {@link setupXhrInterceptor}        — `XMLHttpRequest` (jQuery `$.ajax`), which
 *                                          does not go through `window.fetch`.
 *   - {@link setupImageInterceptor}      — `<img src="api/images/…">` loads, which
 *                                          the browser's internal image loader issues
 *                                          without touching fetch or XHR.
 *   - {@link setupStylesheetInterceptor} — CSS-initiated subresource loads: icon pack
 *                                          fonts referenced by `@font-face` `url()` in
 *                                          injected `<style>` tags and custom theme CSS
 *                                          loaded via `<link href="api/…">`.
 *
 * The caller gates this on `location.protocol === "capacitor:"`, so none of it
 * runs on Android or the web build.
 */
export function installIosInterceptors() {
    setupFetchInterceptor();
    setupXhrInterceptor();
    setupImageInterceptor();
    setupStylesheetInterceptor();
}

export function setupFetchInterceptor() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = typeof input === "string" ? input
            : input instanceof URL ? input.href
                : (input as Request).url;
        const url = new URL(urlStr, location.href);
        if (url.origin === location.origin && isLocalApiRequest(url)) {
            return localFetch(new Request(input, init));
        }
        return originalFetch(input, init);
    };
}

// <img src="api/images/..."> requests are issued by the browser's internal
// image loader — they don't go through window.fetch or XMLHttpRequest, so the
// other interceptors can't catch them. On the capacitor:// scheme there is
// also no Service Worker to fall back on (WebKit only registers SWs for
// http/https origins), so the request hits Capacitor's URL scheme handler,
// which has no idea about /api/images/... and silently 404s — that's the
// broken-image placeholder users see in the iOS app.
//
// Watch the DOM for <img> elements whose src points at a local API path and
// transparently swap the src to a blob: URL backed by the SQLite worker. This
// catches images added via HTML parsing (initial document, innerHTML), via
// setAttribute/attr (jQuery, content_renderer), and via the src property.
// Setting the same src again on the same element is deduplicated so we don't
// re-fetch on idempotent re-renders.
export function setupImageInterceptor() {
    const lastProcessedSrc = new WeakMap<HTMLImageElement, string>();
    // Object URLs are held by the browser until explicitly revoked (the SPA
    // document never unloads), so track the one currently assigned to each <img>
    // and revoke it whenever the image is repointed or removed — otherwise every
    // image swap leaks memory, which matters most on the constrained iOS WebView.
    const blobUrls = new WeakMap<HTMLImageElement, string>();

    function matchesLocalApi(value: string): URL | null {
        if (!value || value.startsWith("blob:") || value.startsWith("data:")) return null;
        let abs: URL;
        try {
            abs = new URL(value, location.href);
        } catch {
            return null;
        }
        return (abs.origin === location.origin && isLocalApiRequest(abs)) ? abs : null;
    }

    function releaseBlobUrl(img: HTMLImageElement) {
        const previous = blobUrls.get(img);
        if (previous) {
            URL.revokeObjectURL(previous);
            blobUrls.delete(img);
        }
    }

    async function swapToBlob(img: HTMLImageElement, originalSrc: string, absUrl: URL) {
        if (lastProcessedSrc.get(img) === originalSrc) return;
        lastProcessedSrc.set(img, originalSrc);

        try {
            const resp = await localFetch(new Request(absUrl.toString()));
            if (!resp.ok) {
                lastProcessedSrc.delete(img);
                return;
            }
            const blob = await resp.blob();
            // Free the URL from a prior swap on this same element before replacing it.
            releaseBlobUrl(img);
            const blobUrl = URL.createObjectURL(blob);
            blobUrls.set(img, blobUrl);
            img.setAttribute("src", blobUrl);
        } catch (err) {
            console.warn("[ImageInterceptor] Failed to load", absUrl.href, err);
            lastProcessedSrc.delete(img);
        }
    }

    function checkImage(img: HTMLImageElement) {
        const src = img.getAttribute("src");
        if (!src) return;
        const absUrl = matchesLocalApi(src);
        if (absUrl) void swapToBlob(img, src, absUrl);
    }

    const observer = new MutationObserver((records) => {
        for (const record of records) {
            if (record.type === "attributes" && record.attributeName === "src" && record.target instanceof HTMLImageElement) {
                checkImage(record.target);
            } else if (record.type === "childList") {
                for (const node of record.addedNodes) {
                    if (node instanceof HTMLImageElement) {
                        checkImage(node);
                    } else if (node instanceof Element) {
                        node.querySelectorAll("img").forEach((img) => checkImage(img as HTMLImageElement));
                    }
                }
                for (const node of record.removedNodes) {
                    if (node instanceof HTMLImageElement) {
                        releaseBlobUrl(node);
                    } else if (node instanceof Element) {
                        node.querySelectorAll("img").forEach((img) => releaseBlobUrl(img as HTMLImageElement));
                    }
                }
            }
        }
    });

    function start() {
        observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["src"]
        });
        document.querySelectorAll("img").forEach((img) => checkImage(img as HTMLImageElement));
    }

    if (document.documentElement) {
        start();
    } else {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    }
}

// jQuery $.ajax uses XMLHttpRequest, which window.fetch interception does not
// catch. On the capacitor:// scheme there is no Service Worker to route
// requests, so XHR-bound API calls would hit the native bridge and return
// something other than the expected JSON. Route them through the local worker.
export function setupXhrInterceptor() {
    const OriginalXHR = window.XMLHttpRequest;

    class PatchedXHR extends OriginalXHR {
        private _ti_method = "GET";
        private _ti_url = "";
        private _ti_intercept = false;
        private _ti_headers: Record<string, string> = {};
        private _ti_responseType: XMLHttpRequestResponseType = "";

        open(method: string, url: string | URL, async?: boolean, user?: string | null, password?: string | null) {
            const urlStr = typeof url === "string" ? url : url.href;
            const abs = new URL(urlStr, location.href);
            this._ti_method = method;
            this._ti_url = abs.href;
            this._ti_intercept = abs.origin === location.origin && isLocalApiRequest(abs);
            this._ti_headers = {};
            if (!this._ti_intercept) {
                return super.open(method, url as string, async ?? true, user ?? null, password ?? null);
            }
        }

        setRequestHeader(name: string, value: string) {
            if (!this._ti_intercept) return super.setRequestHeader(name, value);
            this._ti_headers[name] = value;
        }

        get responseType(): XMLHttpRequestResponseType {
            if (this._ti_intercept) return this._ti_responseType;
            return super.responseType;
        }

        set responseType(value: XMLHttpRequestResponseType) {
            if (this._ti_intercept) {
                this._ti_responseType = value;
                return;
            }
            super.responseType = value;
        }

        send(body?: Document | XMLHttpRequestBodyInit | null) {
            if (!this._ti_intercept) return super.send(body);

            const init: RequestInit = { method: this._ti_method, headers: this._ti_headers };
            if (body != null && this._ti_method !== "GET" && this._ti_method !== "HEAD") {
                init.body = body as BodyInit;
            }

            void (async () => {
                try {
                    const resp = await localFetch(new Request(this._ti_url, init));
                    const buffer = await resp.arrayBuffer();
                    const text = new TextDecoder().decode(buffer);

                    let parsedResponse: unknown = text;
                    if (this._ti_responseType === "json") {
                        try { parsedResponse = JSON.parse(text); } catch { parsedResponse = null; }
                    } else if (this._ti_responseType === "arraybuffer") {
                        parsedResponse = buffer;
                    } else if (this._ti_responseType === "blob") {
                        parsedResponse = new Blob([buffer], { type: resp.headers.get("content-type") ?? "" });
                    }

                    const headerLines = [...resp.headers.entries()]
                        .map(([k, v]) => `${k}: ${v}`).join("\r\n");

                    Object.defineProperty(this, "readyState", { value: 4, configurable: true });
                    Object.defineProperty(this, "status", { value: resp.status, configurable: true });
                    Object.defineProperty(this, "statusText", { value: resp.statusText, configurable: true });
                    Object.defineProperty(this, "responseURL", { value: this._ti_url, configurable: true });
                    Object.defineProperty(this, "responseText", {
                        get: () => {
                            if (this._ti_responseType && this._ti_responseType !== "text") {
                                throw new DOMException(
                                    "responseText is only available when responseType is '' or 'text'",
                                    "InvalidStateError"
                                );
                            }
                            return text;
                        },
                        configurable: true,
                    });
                    Object.defineProperty(this, "response", { value: parsedResponse, configurable: true });
                    Object.defineProperty(this, "getAllResponseHeaders", {
                        value: () => headerLines,
                        configurable: true,
                    });
                    Object.defineProperty(this, "getResponseHeader", {
                        value: (name: string) => resp.headers.get(name),
                        configurable: true,
                    });

                    this.dispatchEvent(new Event("readystatechange"));
                    this.dispatchEvent(new ProgressEvent("load"));
                    this.dispatchEvent(new ProgressEvent("loadend"));
                } catch {
                    Object.defineProperty(this, "readyState", { value: 4, configurable: true });
                    Object.defineProperty(this, "status", { value: 0, configurable: true });
                    this.dispatchEvent(new Event("readystatechange"));
                    this.dispatchEvent(new ProgressEvent("error"));
                    this.dispatchEvent(new ProgressEvent("loadend"));
                }
            })();
        }
    }

    window.XMLHttpRequest = PatchedXHR as unknown as typeof XMLHttpRequest;
}

// CSS-initiated subresource loads — @font-face src, background-image, etc. — are
// issued by the style engine, so neither the fetch/XHR interceptors nor the image
// interceptor see them. On capacitor:// they hit the native scheme handler, which
// answers unknown paths with the SPA fallback (index.html), so the load fails.
// Two shapes exist in practice:
//
//   - icon pack fonts: injected <style> tags containing
//     `src: url('api/attachments/download/<id>')`
//   - custom themes: <link rel="stylesheet" href="api/notes/download/<id>">
//
// Rewrite both to blob: URLs backed by the SQLite worker. For a <link>, the
// fetched CSS is itself rewritten (its api url() refs become blob: URLs and its
// other relative refs are absolutized, since relative paths would resolve
// against the blob: origin and break).
//
// Fetched assets are cached by absolute URL for the lifetime of the page and
// deliberately never revoked: unlike per-note images, fonts and theme assets are
// few, shared between stylesheets, and live as long as the app.
export function setupStylesheetInterceptor() {
    const CSS_URL_RE = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^"')][^)\s]*))\s*\)/g;

    // absolute URL of a fetched asset -> pending blob: URL (null = failed, retryable)
    const assetBlobUrls = new Map<string, Promise<string | null>>();
    // <link> elements get a fresh CSS blob per processed href; these are per-element,
    // so they are revoked when the link is repointed or removed.
    const linkBlobUrls = new WeakMap<HTMLLinkElement, string>();
    const lastProcessedHref = new WeakMap<HTMLLinkElement, string>();

    function toLocalApiUrl(ref: string, baseHref: string): URL | null {
        if (!ref || ref.startsWith("blob:") || ref.startsWith("data:") || ref.startsWith("#")) return null;
        let abs: URL;
        try {
            abs = new URL(ref, baseHref);
        } catch {
            return null;
        }
        return (abs.origin === location.origin && isLocalApiRequest(abs)) ? abs : null;
    }

    function fetchAssetAsBlobUrl(abs: URL): Promise<string | null> {
        let pending = assetBlobUrls.get(abs.href);
        if (!pending) {
            pending = (async () => {
                try {
                    const resp = await localFetch(new Request(abs.href));
                    if (!resp.ok) return null;
                    return URL.createObjectURL(await resp.blob());
                } catch (err) {
                    console.warn("[StylesheetInterceptor] Failed to load", abs.href, err);
                    return null;
                }
            })();
            assetBlobUrls.set(abs.href, pending);
            // Drop failures from the cache so a later mutation can retry them.
            void pending.then((url) => {
                if (!url) assetBlobUrls.delete(abs.href);
            });
        }
        return pending;
    }

    /**
     * Replaces local-API `url()` references with blob: URLs. When
     * `absolutizeRelative` is set (for CSS that will be served from a blob: URL),
     * the remaining relative references are resolved against `baseHref` instead.
     * Returns null when there is nothing to rewrite.
     */
    async function rewriteCssText(cssText: string, baseHref: string, absolutizeRelative = false): Promise<string | null> {
        const replacements = new Map<string, string>();
        for (const match of cssText.matchAll(CSS_URL_RE)) {
            const ref = match[1] ?? match[2] ?? match[3];
            if (replacements.has(ref)) continue;
            const abs = toLocalApiUrl(ref, baseHref);
            if (abs) {
                const blobUrl = await fetchAssetAsBlobUrl(abs);
                if (blobUrl) replacements.set(ref, blobUrl);
            } else if (absolutizeRelative && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) {
                try {
                    replacements.set(ref, new URL(ref, baseHref).href);
                } catch {
                    // leave unparseable refs alone
                }
            }
        }
        if (!replacements.size) return null;
        return cssText.replace(CSS_URL_RE, (full, dquoted, squoted, unquoted) => {
            const replacement = replacements.get(dquoted ?? squoted ?? unquoted);
            return replacement ? `url("${replacement}")` : full;
        });
    }

    async function processStyle(styleEl: HTMLStyleElement) {
        const css = styleEl.textContent;
        if (!css || !css.includes("url(")) return;
        const rewritten = await rewriteCssText(css, location.href);
        // Only apply if the text was not changed underneath us while fetching.
        if (rewritten !== null && styleEl.textContent === css) {
            styleEl.textContent = rewritten;
        }
    }

    async function processLink(link: HTMLLinkElement) {
        if ((link.getAttribute("rel") ?? "").toLowerCase() !== "stylesheet") return;
        const href = link.getAttribute("href");
        if (!href) return;
        const abs = toLocalApiUrl(href, location.href);
        if (!abs) return;
        if (lastProcessedHref.get(link) === href) return;
        lastProcessedHref.set(link, href);

        try {
            const resp = await localFetch(new Request(abs.href));
            if (!resp.ok) {
                lastProcessedHref.delete(link);
                return;
            }
            const css = await resp.text();
            const rewritten = (await rewriteCssText(css, abs.href, true)) ?? css;
            releaseLinkBlobUrl(link);
            const blobUrl = URL.createObjectURL(new Blob([rewritten], { type: "text/css" }));
            linkBlobUrls.set(link, blobUrl);
            link.setAttribute("href", blobUrl);
        } catch (err) {
            console.warn("[StylesheetInterceptor] Failed to load", abs.href, err);
            lastProcessedHref.delete(link);
        }
    }

    function releaseLinkBlobUrl(link: HTMLLinkElement) {
        const previous = linkBlobUrls.get(link);
        if (previous) {
            URL.revokeObjectURL(previous);
            linkBlobUrls.delete(link);
        }
    }

    function processElement(el: Element) {
        if (el instanceof HTMLStyleElement) void processStyle(el);
        else if (el instanceof HTMLLinkElement) void processLink(el);
    }

    const observer = new MutationObserver((records) => {
        for (const record of records) {
            if (record.type === "attributes" && record.attributeName === "href" && record.target instanceof HTMLLinkElement) {
                void processLink(record.target);
            } else if (record.type === "childList") {
                for (const node of record.addedNodes) {
                    if (node instanceof Element) {
                        processElement(node);
                        node.querySelectorAll("style, link").forEach(processElement);
                    } else if (node.parentElement instanceof HTMLStyleElement) {
                        // Replacing a style's textContent surfaces as an added Text node.
                        void processStyle(node.parentElement);
                    }
                }
                for (const node of record.removedNodes) {
                    if (node instanceof HTMLLinkElement) {
                        releaseLinkBlobUrl(node);
                    } else if (node instanceof Element) {
                        node.querySelectorAll("link").forEach((link) => releaseLinkBlobUrl(link as HTMLLinkElement));
                    }
                }
            }
        }
    });

    function start() {
        observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["href"]
        });
        document.querySelectorAll("style, link").forEach(processElement);
    }

    if (document.documentElement) {
        start();
    } else {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    }
}
