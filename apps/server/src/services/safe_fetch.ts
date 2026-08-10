import dns from "node:dns";
import net from "node:net";

import { ValidationError } from "@triliumnext/core";
import { validateFetchableUrl } from "@triliumnext/core/src/services/request.js";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit, type Response as UndiciResponse } from "undici";

const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;

const ALLOWED_IP_RANGES = new Set(["unicast"]);

/**
 * Checks whether an IP address is private/reserved using ipaddr.js.
 * Returns true if the IP should be blocked.
 */
function isBlockedIP(ip: string): boolean {
    try {
        let parsed = ipaddr.parse(ip);
        // For IPv4-mapped IPv6 addresses, extract and check the IPv4 part
        if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
            parsed = (parsed as ipaddr.IPv6).toIPv4Address();
        }
        return !ALLOWED_IP_RANGES.has(parsed.range());
    } catch {
        return true; // unparseable → treat as blocked
    }
}

/**
 * Resolves the hostname to IP addresses and verifies none are private/reserved.
 * Returns the validated addresses so they can be pinned for the actual connection.
 */
async function validateHostResolution(hostname: string): Promise<dns.LookupAddress[]> {
    // `URL.hostname` hands back an IPv6 literal still wrapped in its brackets ("[::1]"), which is
    // not a form either net.isIP or ipaddr.js recognises. Left as-is, such an address would be
    // taken for a name and looked up as one instead of being checked as the address it is.
    const host = hostname.replace(/^\[|\]$/g, "");

    // If the hostname is already an IP literal, check it directly
    if (net.isIP(host)) {
        if (isBlockedIP(host)) {
            throw new ValidationError("URLs pointing to private/internal networks are not allowed");
        }
        return [{ address: host, family: net.isIP(host) as 4 | 6 }];
    }

    let addresses: dns.LookupAddress[];
    try {
        addresses = await dns.promises.lookup(host, { all: true });
    } catch {
        throw new ValidationError("Could not resolve hostname");
    }

    for (const addr of addresses) {
        if (isBlockedIP(addr.address)) {
            throw new ValidationError("URLs pointing to private/internal networks are not allowed");
        }
    }

    return addresses;
}

/**
 * The address checks, which are core's — they are about the URL rather than about the network, so
 * every runtime makes them and only this one can follow them with a resolution.
 */
const validateUrl = validateFetchableUrl;

/**
 * Creates a custom DNS lookup function that only returns pre-validated IP addresses,
 * preventing DNS rebinding attacks by ensuring the TCP connection uses the same IPs
 * that were checked during SSRF validation.
 */
function createPinnedLookup(validatedAddresses: dns.LookupAddress[]) {
    // Node's net.connect calls lookup with { all: true, hints } and expects
    // the callback signature (err, addresses[]).  Handle both the all and
    // single-address forms so this works across Node versions.
    return (
        _hostname: string,
        options: { family?: number; all?: boolean } | number,
        callback: (...args: unknown[]) => void
    ) => {
        const opts = typeof options === "number" ? { family: options } : options;

        let filtered = validatedAddresses;
        if (opts.family === 4 || opts.family === 6) {
            filtered = validatedAddresses.filter((a) => a.family === opts.family);
        }

        if (filtered.length === 0) {
            callback(new Error("No validated addresses available for the requested address family"));
            return;
        }

        if (opts.all) {
            callback(null, filtered);
        } else {
            callback(null, filtered[0].address, filtered[0].family);
        }
    };
}

/**
 * Wraps a Response so that reading/cancelling the body automatically
 * closes the associated undici dispatcher afterwards. Re-emits undici's response
 * as a standard `Response` so callers stay decoupled from undici's own types.
 */
function withDispatcherCleanup(response: UndiciResponse, dispatcher: Agent): Response {
    const init: ResponseInit = {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers]
    };

    const originalBody = response.body;
    if (!originalBody) {
        void dispatcher.close();
        return new Response(null, init);
    }

    let closed = false;
    const cleanup = () => {
        if (!closed) {
            closed = true;
            void dispatcher.close();
        }
    };

    const reader = originalBody.getReader();
    const wrappedBody = new ReadableStream({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    controller.close();
                    cleanup();
                } else {
                    controller.enqueue(value);
                }
            } catch (err) {
                controller.error(err);
                cleanup();
            }
        },
        cancel() {
            void reader.cancel();
            cleanup();
        }
    });

    return new Response(wrappedBody, init);
}

/**
 * Fetches a URL with SSRF protection: resolves the hostname, validates
 * the resulting IP, and pins the connection to that IP to prevent DNS rebinding.
 */
async function safeFetch(url: string, options: RequestInit = {}): Promise<Response> {
    let currentUrl = url;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        const parsed = validateUrl(currentUrl);
        const validatedAddresses = await validateHostResolution(parsed.hostname);

        // Use a custom dispatcher that pins DNS to the validated IPs,
        // preventing a second DNS lookup from resolving to a different (private) IP.
        const dispatcher = new Agent({
            connect: {
                lookup: createPinnedLookup(validatedAddresses) as never
            }
        });

        // URL and resolved IPs are validated above and pinned via the custom dispatcher.
        // undici's own `fetch` is used rather than the global one: the dispatcher must come from the
        // same undici copy as the fetch consuming it. Node's built-in fetch is a *different*, newer
        // undici (8.x on Node 26) whose internal request handler the bundled 6.x `Agent` rejects
        // ("invalid onError method"), which would make every request here fail.
        const fetchOptions = {
            ...options,
            redirect: "manual" as const,
            signal: options.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
            dispatcher
        } as UndiciRequestInit;
        const response = await undiciFetch(currentUrl, fetchOptions); // codeql[js/request-forgery]

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) throw new Error("Redirect without Location header");
            // Resolve relative redirects against the current URL
            currentUrl = new URL(location, currentUrl).toString();
            void dispatcher.close();
            continue;
        }

        return withDispatcherCleanup(response, dispatcher);
    }

    throw new Error("Too many redirects");
}

export { createPinnedLookup, safeFetch, validateHostResolution, validateUrl };
