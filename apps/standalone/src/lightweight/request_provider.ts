import type { ExecOpts, RequestProvider } from "@triliumnext/core";

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
}
