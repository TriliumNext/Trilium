import dns from "node:dns";
import net from "node:net";

import { ValidationError } from "@triliumnext/core";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

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
    // If the hostname is already an IP literal, check it directly
    if (net.isIP(hostname)) {
        if (isBlockedIP(hostname)) {
            throw new ValidationError("URLs pointing to private/internal networks are not allowed");
        }
        return [{ address: hostname, family: net.isIP(hostname) as 4 | 6 }];
    }

    let addresses: dns.LookupAddress[];
    try {
        addresses = await dns.promises.lookup(hostname, { all: true });
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

function validateUrl(urlString: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(urlString);
    } catch {
        throw new ValidationError("Invalid URL");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ValidationError("Only http and https URLs are supported");
    }

    return parsed;
}

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
 * closes the associated undici dispatcher afterwards.
 */
function withDispatcherCleanup(response: Response, dispatcher: Agent): Response {
    const originalBody = response.body;
    if (!originalBody) {
        void dispatcher.close();
        return response;
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

    return new Response(wrappedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });
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
        // Node.js fetch supports `dispatcher` at runtime (undici), but the type isn't in RequestInit.
        const fetchOptions = {
            ...options,
            redirect: "manual" as const,
            signal: options.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
            dispatcher
        };
        const response = await fetch(currentUrl, fetchOptions as RequestInit); // codeql[js/request-forgery]

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

export { safeFetch, validateHostResolution, validateUrl };
