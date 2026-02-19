/**
 * URL validation utilities to prevent SSRF (Server-Side Request Forgery) attacks.
 *
 * These checks enforce scheme allowlists and optionally block requests to
 * private/internal IP ranges so that user-controlled URLs cannot be used to
 * reach local files or internal network services.
 */

import { URL } from "url";
import log from "./log.js";

/**
 * IPv4 private and reserved ranges that should not be reachable from
 * server-side HTTP requests initiated by user-supplied URLs.
 */
const PRIVATE_IPV4_RANGES: Array<{ prefix: number; mask: number }> = [
    { prefix: 0x7F000000, mask: 0xFF000000 }, // 127.0.0.0/8       (loopback)
    { prefix: 0x0A000000, mask: 0xFF000000 }, // 10.0.0.0/8        (private)
    { prefix: 0xAC100000, mask: 0xFFF00000 }, // 172.16.0.0/12     (private)
    { prefix: 0xC0A80000, mask: 0xFFFF0000 }, // 192.168.0.0/16    (private)
    { prefix: 0xA9FE0000, mask: 0xFFFF0000 }, // 169.254.0.0/16    (link-local)
    { prefix: 0x00000000, mask: 0xFF000000 }, // 0.0.0.0/8         (current network)
];

/**
 * Parse a dotted-decimal IPv4 address into a 32-bit integer, or return null
 * if the string is not a valid IPv4 literal.
 */
function parseIPv4(ip: string): number | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;

    let result = 0;
    for (const part of parts) {
        const octet = Number(part);
        if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
        result = (result << 8) | octet;
    }
    // Convert to unsigned 32-bit
    return result >>> 0;
}

/**
 * Returns true when the hostname is a private/internal IPv4 address, an IPv6
 * loopback (::1), or an IPv6 unique-local address (fc00::/7).
 *
 * DNS resolution is NOT performed here; the check only applies when the
 * hostname is already an IP literal.  For full SSRF protection against DNS
 * rebinding you would need an additional check after resolution, but
 * blocking IP literals covers the most common attack vectors.
 */
function isPrivateIP(hostname: string): boolean {
    // Strip IPv6 bracket notation that URL may retain.
    const cleanHost = hostname.replace(/^\[|\]$/g, "");

    // IPv6 checks
    if (cleanHost === "::1") return true;
    if (cleanHost.toLowerCase().startsWith("fc") || cleanHost.toLowerCase().startsWith("fd")) {
        // fc00::/7 covers fc00:: through fdff::
        return true;
    }

    // IPv4 check
    const ipNum = parseIPv4(cleanHost);
    if (ipNum !== null) {
        for (const range of PRIVATE_IPV4_RANGES) {
            if ((ipNum & range.mask) === (range.prefix >>> 0)) {
                return true;
            }
        }
    }

    // "localhost" as a hostname (not an IP literal)
    if (cleanHost.toLowerCase() === "localhost") {
        return true;
    }

    return false;
}

/** Schemes that are safe for outbound HTTP(S) image downloads. */
const ALLOWED_HTTP_SCHEMES = new Set(["http:", "https:"]);

/**
 * Validate that a URL is safe for server-side fetching (e.g. image downloads).
 *
 * Rules:
 *  1. Only http: and https: schemes are permitted.
 *  2. The hostname must not resolve to a private/internal IP range.
 *
 * Returns `true` when the URL passes all checks, `false` otherwise.
 * Invalid / unparseable URLs also return `false`.
 */
export function isSafeUrlForFetch(urlStr: string): boolean {
    try {
        const parsed = new URL(urlStr);

        if (!ALLOWED_HTTP_SCHEMES.has(parsed.protocol)) {
            log.info(`URL rejected - disallowed scheme '${parsed.protocol}': ${urlStr}`);
            return false;
        }

        if (isPrivateIP(parsed.hostname)) {
            log.info(`URL rejected - private/internal IP '${parsed.hostname}': ${urlStr}`);
            return false;
        }

        return true;
    } catch {
        log.info(`URL rejected - failed to parse: ${urlStr}`);
        return false;
    }
}

/**
 * Validate that a base URL intended for an LLM provider API is using a safe
 * scheme (http or https only).
 *
 * This is a lighter check than `isSafeUrlForFetch` because LLM base URLs are
 * configured by authenticated administrators, so we only enforce the scheme
 * restriction without blocking private IPs (which are legitimate for
 * self-hosted services like Ollama).
 *
 * Returns `true` when the URL passes the check, `false` otherwise.
 */
export function isSafeProviderBaseUrl(urlStr: string): boolean {
    try {
        const parsed = new URL(urlStr);

        if (!ALLOWED_HTTP_SCHEMES.has(parsed.protocol)) {
            log.info(`LLM provider base URL rejected - disallowed scheme '${parsed.protocol}': ${urlStr}`);
            return false;
        }

        return true;
    } catch {
        log.info(`LLM provider base URL rejected - failed to parse: ${urlStr}`);
        return false;
    }
}
