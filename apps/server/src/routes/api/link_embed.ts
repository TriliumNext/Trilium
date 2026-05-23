import dns from "node:dns";
import net from "node:net";

import { type LinkEmbedMetadata, extractYouTubeVideoId } from "@triliumnext/commons";
import { ValidationError } from "@triliumnext/core";
import type { Request } from "express";
import { parse } from "node-html-parser";
import ipaddr from "ipaddr.js";

import log from "../../services/log.js";

const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_SIZE = 512 * 1024; // 512KB
const MAX_FAVICON_SIZE = 64 * 1024; // 64KB
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
 */
async function validateHostResolution(hostname: string): Promise<void> {
    // If the hostname is already an IP literal, check it directly
    if (net.isIP(hostname)) {
        if (isBlockedIP(hostname)) {
            throw new ValidationError("URLs pointing to private/internal networks are not allowed");
        }
        return;
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
 * Reads the response body as text, stopping after maxBytes to avoid
 * buffering arbitrarily large responses into memory.
 */
async function readResponseText(response: Response, maxBytes: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return "";

    const decoder = new TextDecoder();
    let result = "";
    let bytesRead = 0;

    while (bytesRead < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;

        bytesRead += value.byteLength;
        result += decoder.decode(value, { stream: true });
    }

    reader.cancel();
    return result.slice(0, maxBytes);
}

/**
 * Fetches a URL with SSRF protection: resolves the hostname and validates
 * the resulting IP before each request, including on redirects.
 */
async function safeFetch(url: string, options: RequestInit = {}): Promise<Response> {
    let currentUrl = url;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        const parsed = validateUrl(currentUrl);
        await validateHostResolution(parsed.hostname);

        // URL and resolved IPs are validated above by validateUrl() and
        // validateHostResolution() before every request, including redirects.
        const response = await fetch(currentUrl, { // codeql[js/request-forgery]
            ...options,
            redirect: "manual",
            signal: options.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) throw new Error("Redirect without Location header");
            // Resolve relative redirects against the current URL
            currentUrl = new URL(location, currentUrl).toString();
            continue;
        }

        return response;
    }

    throw new Error("Too many redirects");
}

/**
 * Downloads a favicon and returns it as a base64 data URI.
 * Returns undefined if the download fails or the image is too large.
 */
async function downloadFaviconAsDataUri(faviconUrl: string): Promise<string | undefined> {
    try {
        const response = await safeFetch(faviconUrl);

        if (!response.ok) return undefined;

        // Bail early if the server advertises a size over the limit
        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_FAVICON_SIZE) return undefined;

        const contentType = response.headers.get("content-type") || "image/x-icon";

        // Stream the body and enforce the size limit during download
        const reader = response.body?.getReader();
        if (!reader) return undefined;

        const chunks: Uint8Array[] = [];
        let bytesRead = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            bytesRead += value.byteLength;
            if (bytesRead > MAX_FAVICON_SIZE) {
                reader.cancel();
                return undefined;
            }
            chunks.push(value);
        }

        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString("base64");
        return `data:${contentType.split(";")[0]};base64,${base64}`;
    } catch {
        return undefined;
    }
}

/**
 * Resolves a favicon URL from the parsed HTML, then downloads it as a data URI.
 */
async function resolveFavicon(document: ReturnType<typeof parse>, pageUrl: string): Promise<string | undefined> {
    const faviconEl = document.querySelector('link[rel="icon"]')
        || document.querySelector('link[rel="shortcut icon"]')
        || document.querySelector('link[rel="apple-touch-icon"]');

    let faviconUrl: string | undefined;
    if (faviconEl) {
        const href = faviconEl.getAttribute("href");
        if (href) {
            try { faviconUrl = new URL(href, pageUrl).toString(); } catch { /* ignore */ }
        }
    }
    if (!faviconUrl) {
        try { faviconUrl = `${new URL(pageUrl).origin}/favicon.ico`; } catch { /* ignore */ }
    }

    if (!faviconUrl) return undefined;
    return await downloadFaviconAsDataUri(faviconUrl);
}

/**
 * Fetches YouTube metadata via the public oEmbed endpoint.
 * This works reliably unlike scraping youtube.com (which blocks bots).
 */
async function fetchYouTubeMetadata(url: string, videoId: string): Promise<LinkEmbedMetadata> {
    const metadata: LinkEmbedMetadata = {
        url,
        image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        siteName: "YouTube",
        embedType: "youtube"
    };

    // Download YouTube favicon as data URI
    metadata.favicon = await downloadFaviconAsDataUri("https://www.youtube.com/favicon.ico");

    try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const response = await safeFetch(oembedUrl);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (data.title) metadata.title = data.title;
        if (data.author_name) metadata.description = data.author_name;
        if (data.thumbnail_url) metadata.image = data.thumbnail_url;
    } catch {
        metadata.title = "YouTube Video";
    }

    return metadata;
}

async function fetchOpenGraphData(url: string) {
    const response = await safeFetch(url, {
        headers: {
            "User-Agent": "TriliumNotes/1.0 (Link Preview; +https://triliumnotes.org/)",
            "Accept": "text/html"
        }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        throw new Error(`Unexpected Content-Type: ${contentType}`);
    }

    const html = await readResponseText(response, MAX_RESPONSE_SIZE);
    const document = parse(html);

    const getMeta = (property: string): string | undefined => {
        const ogEl = document.querySelector(`meta[property="${property}"]`);
        if (ogEl) return ogEl.getAttribute("content") || undefined;

        const nameEl = document.querySelector(`meta[name="${property}"]`);
        if (nameEl) return nameEl.getAttribute("content") || undefined;

        return undefined;
    };

    const favicon = await resolveFavicon(document, url);

    return {
        title: getMeta("og:title") || document.querySelector("title")?.textContent?.trim() || undefined,
        description: getMeta("og:description") || getMeta("description") || undefined,
        image: getMeta("og:image") || undefined,
        siteName: getMeta("og:site_name") || undefined,
        favicon
    };
}

async function getMetadata(req: Request) {
    const urlParam = req.query.url;

    if (!urlParam || typeof urlParam !== "string") {
        throw new ValidationError("'url' query parameter is required");
    }

    const validatedUrl = validateUrl(urlParam);
    const url = validatedUrl.toString();
    const videoId = extractYouTubeVideoId(url);

    if (videoId) {
        return await fetchYouTubeMetadata(url, videoId);
    }

    try {
        const ogData = await fetchOpenGraphData(url);
        return {
            url,
            title: ogData.title,
            description: ogData.description,
            image: ogData.image,
            favicon: ogData.favicon,
            siteName: ogData.siteName,
            embedType: "opengraph"
        } satisfies LinkEmbedMetadata;
    } catch (e: unknown) {
        log.info(`Failed to fetch metadata for ${url}: ${e}`);
        return {
            url,
            title: validatedUrl.hostname,
            embedType: "opengraph"
        } satisfies LinkEmbedMetadata;
    }
}

export default { getMetadata };
export { validateHostResolution, validateUrl };
