import type { ExecOpts, FetchApiOpts, FetchedResource, FetchResourceOpts, RequestProvider } from "@triliumnext/core";
import { readCappedResponse, validateFetchableUrl } from "@triliumnext/core/src/services/request.js";

/**
 * Fetch-based implementation of RequestProvider for browser environments.
 *
 * Uses the Fetch API instead of Node's http/https modules.
 * Proxy support is not available in browsers, so the proxy option is ignored.
 */
export default class FetchRequestProvider implements RequestProvider {

    async exec<T>(opts: ExecOpts): Promise<T> {
        const paging = opts.paging || {
            pageCount: 1,
            pageIndex: 0,
            requestId: "n/a"
        };

        const headers: Record<string, string> = {
            "Content-Type": paging.pageCount === 1 ? "application/json" : "text/plain",
            "pageCount": String(paging.pageCount),
            "pageIndex": String(paging.pageIndex),
            "requestId": paging.requestId
        };

        // Note: the Cookie header is a forbidden header in fetch —
        // the browser manages cookies automatically via credentials: 'include'.

        if (opts.auth?.password) {
            headers["trilium-cred"] = btoa(`dummy:${opts.auth.password}`);
        }

        let body: string | undefined;
        if (opts.body) {
            body = typeof opts.body === "object" ? JSON.stringify(opts.body) : opts.body;
        }

        const controller = new AbortController();
        const timeoutId = opts.timeout
            ? setTimeout(() => controller.abort(), opts.timeout)
            : undefined;

        try {
            const response = await fetch(opts.url, {
                method: opts.method,
                headers,
                body,
                signal: controller.signal,
                credentials: "include"
            });

            if ([200, 201, 204].includes(response.status)) {
                const text = await response.text();
                return text.trim() ? JSON.parse(text) : null;
            }
            const text = await response.text();
            let errorMessage: string;
            try {
                const json = JSON.parse(text);
                errorMessage = json?.message || "";
            } catch {
                errorMessage = text.substring(0, 100);
            }
            throw new Error(`${response.status} ${opts.method} ${opts.url}: ${errorMessage}`);

        } catch (e: any) {
            if (e.name === "AbortError") {
                throw new Error(`${opts.method} ${opts.url} failed, error: timeout after ${opts.timeout}ms`);
            }
            if (e instanceof TypeError && e.message === "Failed to fetch") {
                const isCrossOrigin = !opts.url.startsWith(location.origin);
                if (isCrossOrigin) {
                    throw new Error(`Request to ${opts.url} was blocked. The server may not allow requests from this origin (CORS), or it may be unreachable.`);
                }
                throw new Error(`Request to ${opts.url} failed. The server may be unreachable.`);
            }
            throw e;
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    async getImage(imageUrl: string): Promise<ArrayBuffer> {
        const response = await fetch(imageUrl);

        if (!response.ok) {
            throw new Error(`${response.status} GET ${imageUrl} failed`);
        }

        return await response.arrayBuffer();
    }

    /**
     * Fetches a third-party resource with the page's own `fetch`, which means the same-origin
     * policy decides whether the answer can be read at all.
     *
     * A great many sites do not send `Access-Control-Allow-Origin`, and for those this throws
     * however healthy the response was — the request goes out, the browser refuses to hand back
     * what came of it. That is not a fault to work around here: it is what running with no server
     * costs, and the caller is expected to degrade rather than to retry.
     *
     * Notably it is not universal. Static and documentation hosting frequently sends `*`, and the
     * oEmbed endpoints of the large video and audio providers all do, so a good deal is readable
     * this way. Where it is not, the native transport in the sibling provider is the way through.
     *
     * `credentials` stays at its default of `same-origin`: nothing here should carry the user's
     * cookies to a third party just because a link to it was pasted into a note.
     */
    async fetchResource(resourceUrl: string, opts: FetchResourceOpts): Promise<FetchedResource> {
        const validated = validateFetchableUrl(resourceUrl).toString();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_RESOURCE_TIMEOUT_MS);

        try {
            const response = await fetch(validated, {
                headers: opts.headers,
                signal: controller.signal
            });

            return await readCappedResponse(response, opts.maxBytes);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Calls a configured API endpoint with the page's own `fetch`, which is as far as this runtime
     * can go and as far as it needs to.
     *
     * The private-address rule the server keeps has no counterpart here, and `allowPrivateNetwork`
     * is accordingly unread: there is no resolver to ask what a name points at, and nothing to be
     * protected if there were. The request leaves the user's own browser, over the user's own
     * network, to a destination that same user configured — the server's rule exists because a
     * server's network is not the network of everyone who can reach it, which is not this.
     *
     * What remains is {@link validateFetchableUrl}, and the same-origin policy behind it.
     */
    async fetchApi(url: string, init: RequestInit, _opts: FetchApiOpts): Promise<Response> {
        return await fetch(validateFetchableUrl(url).toString(), init);
    }
}

/** Matches the server's own fetch timeout, a preview not being worth waiting on for longer. */
const FETCH_RESOURCE_TIMEOUT_MS = 5000;
