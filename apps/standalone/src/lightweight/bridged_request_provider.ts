import type { ExecOpts, FetchApiOpts, FetchedResource, FetchResourceOpts, RequestProvider } from "@triliumnext/core";
import { validateFetchableUrl } from "@triliumnext/core/src/services/request.js";

/**
 * A RequestProvider that delegates HTTP requests to the main thread via postMessage.
 *
 * This is used when the host environment (e.g. a Capacitor mobile app) provides
 * a native HTTP layer that bypasses browser CORS and cookie restrictions.
 * The worker sends HTTP_REQUEST messages and waits for HTTP_RESPONSE replies.
 */
export default class BridgedRequestProvider implements RequestProvider {

    private pending = new Map<string, {
        resolve: (value: unknown) => void;
        reject: (reason: Error) => void;
    }>();
    private nextId = 0;

    constructor() {
        self.addEventListener("message", (event: MessageEvent) => {
            const msg = event.data;
            if (!msg || msg.type !== "HTTP_RESPONSE") return;

            const entry = this.pending.get(msg.id);
            if (!entry) return;
            this.pending.delete(msg.id);

            if (msg.error) {
                entry.reject(new Error(msg.error));
            } else {
                entry.resolve(msg);
            }
        });
    }

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

        if (opts.cookieJar?.header) {
            headers["Cookie"] = opts.cookieJar.header;
        }

        if (opts.auth?.password) {
            headers["trilium-cred"] = btoa(`dummy:${opts.auth.password}`);
        }

        let body: string | undefined;
        if (opts.body) {
            body = typeof opts.body === "object" ? JSON.stringify(opts.body) : opts.body;
        }

        const id = String(this.nextId++);
        const msg = await new Promise<any>((resolve, reject) => {
            const timeoutId = opts.timeout
                ? setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error(`${opts.method} ${opts.url} failed, error: timeout after ${opts.timeout}ms`));
                }, opts.timeout)
                : undefined;

            // Wrap resolve/reject to clear timeout
            const originalResolve = resolve;
            const originalReject = reject;
            this.pending.set(id, {
                resolve: (value) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    originalResolve(value);
                },
                reject: (reason) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    originalReject(reason);
                }
            });

            (self as unknown as Worker).postMessage({
                type: "HTTP_REQUEST",
                id,
                request: {
                    method: opts.method,
                    url: opts.url,
                    headers,
                    body
                }
            });
        });

        // Capture cookies from the response for the sync cookie jar
        if (opts.cookieJar && msg.headers?.["set-cookie"]) {
            opts.cookieJar.header = msg.headers["set-cookie"];
        }

        if ([200, 201, 204].includes(msg.status)) {
            // Fast path: main thread sent the already-parsed JSON object via
            // structured clone. Use it directly — no second JSON.parse, no
            // intermediate string allocation. Critical for large blob batches
            // on memory-constrained clients (iOS Capacitor WebView worker).
            if (msg.data !== undefined) {
                return msg.data;
            }
            const text = msg.body || "";
            return text.trim() ? JSON.parse(text) : null;
        }

        let errorMessage: string;
        if (msg.data && typeof msg.data === "object") {
            errorMessage = (msg.data as { message?: string }).message ?? "";
        } else {
            try {
                const json = JSON.parse(msg.body || "");
                errorMessage = json?.message || "";
            } catch {
                errorMessage = (msg.body || "").substring(0, 100);
            }
        }
        throw new Error(`${msg.status} ${opts.method} ${opts.url}: ${errorMessage}`);
    }

    async getImage(imageUrl: string): Promise<ArrayBuffer> {
        const id = String(this.nextId++);
        const msg = await new Promise<any>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });

            (self as unknown as Worker).postMessage({
                type: "HTTP_REQUEST",
                id,
                request: {
                    method: "GET",
                    url: imageUrl,
                    headers: {},
                    responseType: "arraybuffer"
                }
            });
        });

        if (msg.status < 200 || msg.status >= 300) {
            throw new Error(`${msg.status} GET ${imageUrl} failed`);
        }

        // The main thread should send back a base64-encoded body for binary responses
        const binary = atob(msg.body);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        return bytes.buffer;
    }

    /**
     * Fetches a third-party resource over the native transport, which is the whole reason this
     * provider exists: the cross-origin hop happens outside the WebView, so a page that sends no
     * CORS headers — which is nearly every page worth previewing — can still be read.
     *
     * Two things the server's implementation has are missing here, and neither can be had in full:
     *
     * - The body arrives whole, so there is no stream to abandon partway. `maxBytes` is checked
     *   against the encoded length the moment the reply lands and before anything is decoded from
     *   it, which is the earliest point this side of the bridge can see a size at all — see
     *   {@link decodedLengthOf}. What that spares is the decoding, which is where the cost
     *   multiplies: `atob` yields a binary string and `Uint8Array.from` yields a copy of that, so a
     *   body checked afterwards has already been held three times over.
     *   It does not spare what the native side and the bridge already spent to deliver it. Bounding
     *   *that* means giving the ceiling to the transport, which the plugin cannot honour — it
     *   answers only once the whole response is in hand. The Android streaming proxy could, and
     *   binding these two together is the fix worth making; it is not this change.
     * - Nothing resolves the hostname, so the private-address check cannot be made and DNS
     *   rebinding has no meaning here anyway. What is left is {@link validateFetchableUrl}, and
     *   the reason that is enough: this transport runs on the user's own device, reaching the
     *   network that user is already on, at the address that user just pasted. The server's rule —
     *   that note content is not entitled to the network its host can see — is about a host reached
     *   by people who are not its owner, which is not this.
     */
    async fetchResource(resourceUrl: string, opts: FetchResourceOpts): Promise<FetchedResource> {
        const validated = validateFetchableUrl(resourceUrl).toString();
        const id = String(this.nextId++);

        const msg = await new Promise<BridgedResponse>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });

            (self as unknown as Worker).postMessage({
                type: "HTTP_REQUEST",
                id,
                request: {
                    method: "GET",
                    url: validated,
                    headers: opts.headers ?? {},
                    responseType: "arraybuffer"
                }
            });
        });

        const encoded = msg.body ?? "";

        if (decodedLengthOf(encoded) > opts.maxBytes) {
            throw new Error(`Response exceeds the ${opts.maxBytes} byte limit`);
        }

        const binary = atob(encoded);

        return {
            status: msg.status,
            ok: msg.status >= 200 && msg.status < 300,
            contentType: (msg.headers?.["content-type"] ?? "").split(";")[0].trim().toLowerCase(),
            bytes: Uint8Array.from(binary, (c) => c.charCodeAt(0))
        };
    }

    /**
     * Calls a configured API endpoint with the WebView's own `fetch`, deliberately going around
     * the bridge this provider exists to offer.
     *
     * The bridge answers once, with the whole body in hand, and a chat completion is a stream that
     * is read as it arrives — put through here it would surface all at once, at the end, which for
     * the one caller of this is the difference between a chat and a long silence. Where CORS is the
     * problem the bridge solves, that is not the problem here either: the LLM endpoints are called
     * from browsers by design and answer accordingly.
     *
     * `allowPrivateNetwork` is unread for the same reason as in the sibling provider — see the note
     * there.
     */
    async fetchApi(url: string, init: RequestInit, _opts: FetchApiOpts): Promise<Response> {
        return await fetch(validateFetchableUrl(url).toString(), init);
    }
}

/**
 * How many bytes a base64 string will decode to, counted without decoding it.
 *
 * Four characters carry three bytes, less whatever the trailing `=` padding stands in for. Exact
 * for well-formed input, which is what the bridge produces; a malformed body only ever makes this
 * an over-estimate, and over-estimating is the safe direction for a ceiling.
 */
function decodedLengthOf(base64: string): number {
    if (!base64) {
        return 0;
    }

    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;

    return Math.floor(base64.length / 4) * 3 - padding;
}

/** What the main thread answers an HTTP_REQUEST with, for the binary shape of the exchange. */
interface BridgedResponse {
    status: number;
    headers?: Record<string, string>;
    /** Base64 for a binary response; the raw text otherwise. */
    body?: string;
}
