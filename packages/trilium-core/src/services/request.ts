import { ValidationError } from "../errors.js";

export interface CookieJar {
    header?: string;
}

export interface ExecOpts {
    proxy: string | null;
    method: string;
    url: string;
    paging?: {
        pageCount: number;
        pageIndex: number;
        requestId: string;
    };
    cookieJar?: CookieJar;
    auth?: {
        password?: string;
    };
    timeout: number;
    body?: string | {};
}

/** What a resource fetch is allowed to cost, and what it asks for. */
export interface FetchResourceOpts {
    /**
     * Refuse a body larger than this — both up front, where the server advertises a size, and while
     * it streams, where it does not.
     *
     * Required rather than defaulted, because the ceiling is the whole point: what arrives is a
     * third party's answer, held whole in memory, and on the runtime where that memory is a browser
     * tab there is no second line of defence behind it.
     */
    maxBytes: number;
    headers?: Record<string, string>;
}

/** A resource that arrived whole, within its ceiling. */
export interface FetchedResource {
    status: number;
    ok: boolean;
    /** The media type alone, parameters stripped; empty where the server named none. */
    contentType: string;
    bytes: Uint8Array;
}

export interface RequestProvider {
    exec<T>(opts: ExecOpts): Promise<T>;
    getImage(imageUrl: string): Promise<ArrayBuffer>;
    /**
     * Fetches a third-party resource named by note content or by the user, capped at
     * {@link FetchResourceOpts.maxBytes}.
     *
     * Distinct from {@link getImage} in the two things a caller reading a page needs and a caller
     * downloading a picture never did: a ceiling on what it will hold, and the media type it came
     * under. Distinct from {@link exec} in that it is neither JSON nor Trilium's own protocol — the
     * body is handed back as bytes, and what they mean is the caller's business.
     *
     * Throws rather than answering when the resource cannot be had at all: the URL is refused, the
     * transport fails, or the body exceeds its ceiling. A non-2xx *answer* is not that — it comes
     * back with its status, since a caller may well want to read an error page's content type.
     *
     * How hard the address is vetted is the implementation's to decide, and differs by runtime by
     * necessity — see the note on each.
     */
    fetchResource(url: string, opts: FetchResourceOpts): Promise<FetchedResource>;
}

let requestProvider: RequestProvider | null = null;

export function initRequest(provider: RequestProvider): void {
    requestProvider = provider;
}

export function getRequestProvider(): RequestProvider {
    if (!requestProvider) {
        throw new Error("Request provider not initialized. Call initRequest() first.");
    }
    return requestProvider;
}

export function isRequestInitialized(): boolean {
    return requestProvider !== null;
}

export default {
    exec<T>(opts: ExecOpts): Promise<T> {
        return getRequestProvider().exec(opts);
    },
    getImage(imageUrl: string): Promise<ArrayBuffer> {
        return getRequestProvider().getImage(imageUrl);
    },
    fetchResource(url: string, opts: FetchResourceOpts): Promise<FetchedResource> {
        return getRequestProvider().fetchResource(url, opts);
    }
};

/**
 * The checks on an outbound address that hold on every runtime, being about the address itself
 * rather than about what it resolves to.
 *
 * Resolving the name and refusing the private addresses behind it is the other half of this, and it
 * cannot live here: it needs a resolver, which is a Node module on one runtime and does not exist
 * at all on another. So an implementation that has one does that too — see the server's safeFetch —
 * and one that does not still gets these, which are the checks that need no network to make.
 */
export function validateFetchableUrl(urlString: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(urlString);
    } catch {
        throw new ValidationError("Invalid URL");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ValidationError("Only http and https URLs are supported");
    }

    // `https://user:pass@host/` would put the credentials on the wire, and — for a link preview —
    // into the note's stored URL and the log along with them. Nothing here needs to authenticate,
    // so refuse the URL rather than carry a secret around.
    if (parsed.username || parsed.password) {
        throw new ValidationError("URLs containing credentials are not supported");
    }

    return parsed;
}

/**
 * Reads a `Response` into a {@link FetchedResource}, refusing a body over `maxBytes`.
 *
 * Shared by every implementation that has a real `Response` to read — the server's, which gets one
 * from its SSRF-hardened fetch, and the browser's, which gets one from `fetch` itself. Only the
 * getting of it differs between those two; the counting does not, and counting is the part with the
 * edge cases: a size advertised and a size not, a body that lies about the first, a stream that has
 * to be abandoned mid-flight rather than read to the end just to discover it was too long.
 */
export async function readCappedResponse(response: Response, maxBytes: number): Promise<FetchedResource> {
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const base = { status: response.status, ok: response.ok, contentType };

    // Bail before reading a byte where the server says how many there will be.
    const advertised = response.headers.get("content-length");
    if (advertised && Number(advertised) > maxBytes) {
        void response.body?.cancel();
        throw new Error(`Response of ${advertised} bytes exceeds the ${maxBytes} byte limit`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        return { ...base, bytes: new Uint8Array() };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        total += value.byteLength;

        // Checked as it streams, because content-length is a claim and a chunked response makes no
        // claim at all. Abandoned at the moment it goes over rather than read to the end.
        if (total > maxBytes) {
            void reader.cancel();
            throw new Error(`Response exceeds the ${maxBytes} byte limit`);
        }

        chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return { ...base, bytes };
}
