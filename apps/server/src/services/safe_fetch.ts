import dns from "node:dns";
import net from "node:net";

import { ValidationError } from "@triliumnext/core";
import { validateFetchableUrl } from "@triliumnext/core/src/services/request.js";
import ipaddr from "ipaddr.js";
import type { Agent, RequestInit as UndiciRequestInit, Response as UndiciResponse } from "undici";

const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;

const ALLOWED_IP_RANGES = new Set(["unicast"]);

/**
 * What the default set refuses, minus the ranges a self-hosted service is actually served on.
 *
 * For an address the user typed into their own settings — a local model server being the case
 * this exists for — a private address is the ordinary answer rather than a suspicious one:
 * Ollama and LM Studio both default to loopback, and putting either on another machine on the
 * LAN is common enough that refusing RFC1918 would break the feature for a large share of the
 * people who use it at all.
 *
 * Carrier-grade NAT is allowed because a Tailscale tailnet assigns its nodes addresses in it.
 * Link-local stays refused: nothing is served on it, and it carries a cloud instance's metadata
 * endpoint (169.254.169.254).
 */
const ALLOWED_IP_RANGES_INCLUDING_PRIVATE = new Set(["unicast", "loopback", "private", "uniqueLocal", "carrierGradeNat"]);

/** The ranges of private networks, which `LocalRanges.allowPrivate` allows. */
const PRIVATE_IP_RANGES = [ "private", "uniqueLocal", "carrierGradeNat" ];

/**
 * Cloud metadata endpoints inside an allowed range, refused under every policy: Alibaba Cloud's
 * in carrier-grade NAT and AWS's IPv6 one in unique-local. Listed in `ipaddr.js` `toString()`
 * form, which `isBlockedIP` compares against.
 */
const METADATA_ADDRESSES = new Set(["100.100.100.200", "fd00:ec2::254"]);

/** The local ranges that a destination the user configured can be in, each allowed on its own. */
export interface LocalRanges {
    /** RFC1918, unique-local and carrier-grade NAT addresses. */
    allowPrivate: boolean;
    /** Loopback addresses: this machine. */
    allowLoopback: boolean;
}

/** How hard an address is vetted, and how long the caller is prepared to wait for it. */
export interface SafeFetchPolicy {
    /**
     * Permit loopback, RFC1918, unique-local and carrier-grade NAT addresses. For a destination
     * the operator configured themselves; never for one that arrived in note content.
     */
    allowPrivateNetwork?: boolean;
    /** Allows private networks and loopback each on its own. Replaces `allowPrivateNetwork`. */
    localRanges?: LocalRanges;
    /**
     * Sends plain HTTP only when every pinned address lies in an allowed local range, so that no
     * URL or header crosses a public network in clear text.
     */
    isPlainHttpLocalOnly?: boolean;
    /**
     * Deadline imposed when the caller passes no signal of its own. `null` for a request that
     * must not have one — a chat completion runs for as long as the model takes.
     */
    timeoutMs?: number | null;
    /**
     * Redirects to follow. Zero makes a redirect an error, which is what a call carrying
     * credentials wants: the hop is re-vetted as an address, but the `Authorization` header
     * would be re-sent to whoever the destination named, and an API key is not something to
     * hand to a redirect target.
     */
    maxRedirects?: number;
}

/** A request that `safeFetch()` refused to send: for its destination, or for a redirect. */
export class SafeFetchRefusal extends ValidationError {

    constructor(readonly reason: "destination" | "redirect", message: string) {
        super(message);
        this.name = "SafeFetchRefusal";
    }

}

/**
 * Checks whether an IP address is private/reserved using ipaddr.js.
 * Returns true if the IP should be blocked.
 */
function isBlockedIP(ip: string, allowedRanges: ReadonlySet<string>): boolean {
    try {
        const parsed = parseAddress(ip);
        return METADATA_ADDRESSES.has(parsed.toString()) || !allowedRanges.has(parsed.range());
    } catch {
        return true; // unparseable → treat as blocked
    }
}

/** Parses an IP address, an IPv4-mapped IPv6 address as its IPv4 part. */
function parseAddress(ip: string) {
    const parsed = ipaddr.parse(ip);
    return parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
        ? (parsed as ipaddr.IPv6).toIPv4Address()
        : parsed;
}

/**
 * Resolves the hostname to IP addresses and verifies none are private/reserved.
 * Returns the validated addresses so they can be pinned for the actual connection.
 */
async function validateHostResolution(hostname: string, allowPrivateNetwork = false): Promise<dns.LookupAddress[]> {
    return resolveAllowedAddresses(hostname, getAllowedRanges({ allowPrivateNetwork }));
}

/** Resolves the hostname and refuses it unless every address lies in `allowedRanges`. */
async function resolveAllowedAddresses(
    hostname: string,
    allowedRanges: ReadonlySet<string>
): Promise<dns.LookupAddress[]> {
    // `URL.hostname` hands back an IPv6 literal still wrapped in its brackets ("[::1]"), which is
    // not a form either net.isIP or ipaddr.js recognises. Left as-is, such an address would be
    // taken for a name and looked up as one instead of being checked as the address it is.
    const host = hostname.replace(/^\[|\]$/g, "");

    // If the hostname is already an IP literal, check it directly
    if (net.isIP(host)) {
        if (isBlockedIP(host, allowedRanges)) {
            throw new SafeFetchRefusal("destination", blockedAddressMessage(allowedRanges));
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
        if (isBlockedIP(addr.address, allowedRanges)) {
            throw new SafeFetchRefusal("destination", blockedAddressMessage(allowedRanges));
        }
    }

    return addresses;
}

/** The ranges that a policy allows: public addresses, and the local ranges that it names. */
function getAllowedRanges(policy: SafeFetchPolicy): ReadonlySet<string> {
    const { allowPrivateNetwork, localRanges } = policy;
    if (!localRanges) {
        return allowPrivateNetwork ? ALLOWED_IP_RANGES_INCLUDING_PRIVATE : ALLOWED_IP_RANGES;
    }
    return new Set([
        ...ALLOWED_IP_RANGES,
        ...(localRanges.allowLoopback ? [ "loopback" ] : []),
        ...(localRanges.allowPrivate ? PRIVATE_IP_RANGES : [])
    ]);
}

/**
 * Why an address was refused, in the terms the caller's policy makes true. A caller that does
 * permit private addresses must not be told its address was refused for being one — for those
 * the only refusals left are the metadata ranges.
 */
function blockedAddressMessage(allowedRanges: ReadonlySet<string>): string {
    const isPrivateAllowed = [ ...ALLOWED_IP_RANGES_INCLUDING_PRIVATE ]
        .every((range) => allowedRanges.has(range));
    return isPrivateAllowed
        ? "URLs pointing to link-local addresses or a cloud metadata endpoint are not allowed"
        : "URLs pointing to private/internal networks are not allowed";
}

/** Whether a pinned address is a public one, which plain HTTP must not reach under the policy. */
function isPublicAddress({ address }: dns.LookupAddress) {
    return parseAddress(address).range() === "unicast";
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
            // Cancelling the body of an aborted request rejects, as the abort errored it.
            void reader.cancel().catch(() => {});
            cleanup();
        }
    });

    return new Response(wrappedBody, init);
}

/**
 * Fetches a URL with SSRF protection: resolves the hostname, validates
 * the resulting IP, and pins the connection to that IP to prevent DNS rebinding.
 *
 * The default policy is the strict one — every non-unicast range refused, five redirects
 * followed, five seconds allowed — since the callers that named no policy are the ones fetching
 * an address out of note content. See {@link SafeFetchPolicy} for what a caller relaxes and why.
 */
async function safeFetch(url: string, options: RequestInit = {}, policy: SafeFetchPolicy = {}): Promise<Response> {
    const { timeoutMs = FETCH_TIMEOUT_MS, maxRedirects = MAX_REDIRECTS } = policy;
    const allowedRanges = getAllowedRanges(policy);
    let currentUrl = url;

    // Imported here rather than at module scope so undici lands in a lazy chunk:
    // request.ts imports this module during startup, while an outbound request
    // happens only once a feature that makes one runs.
    //
    // undici is CommonJS, so a bundled ESM build can only expose it as `default`
    // — destructuring the namespace directly yields undefined for every name.
    // The fallback covers the shapes that do carry the names: CJS output's
    // interop wrapper, Node's own, and the spec's module mock.
    const undici = await import("undici");
    const { Agent: UndiciAgent, fetch: undiciFetch } = undici.default ?? undici;

    for (let i = 0; i <= maxRedirects; i++) {
        const parsed = validateUrl(currentUrl);
        const validatedAddresses = await resolveAllowedAddresses(parsed.hostname, allowedRanges);
        // Checks the addresses that the connection is pinned to, never those of a second lookup.
        if (policy.isPlainHttpLocalOnly && parsed.protocol === "http:"
            && validatedAddresses.some(isPublicAddress)) {
            throw new SafeFetchRefusal("destination",
                "Plain HTTP is allowed only to addresses on the local network");
        }

        // Use a custom dispatcher that pins DNS to the validated IPs,
        // preventing a second DNS lookup from resolving to a different (private) IP.
        const dispatcher = new UndiciAgent({
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
            signal: options.signal ?? (timeoutMs === null ? undefined : AbortSignal.timeout(timeoutMs)),
            dispatcher
        } as UndiciRequestInit;
        let response: UndiciResponse;
        try {
            response = await undiciFetch(currentUrl, fetchOptions); // codeql[js/request-forgery]
        } catch (e) {
            // Closes the connection of a request that failed or whose signal aborted it.
            void dispatcher.destroy();
            throw e;
        }

        if (response.status >= 300 && response.status < 400) {
            if (maxRedirects === 0) {
                // Closes the connection without reading the body of the redirect.
                void dispatcher.destroy();
                throw new SafeFetchRefusal("redirect",
                    `Refusing to follow a redirect from ${currentUrl}`);
            }
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
