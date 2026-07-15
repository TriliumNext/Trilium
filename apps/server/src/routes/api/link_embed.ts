import { extractYouTubeVideoId, type LinkEmbedMetadata } from "@triliumnext/commons";
import { getLog, ValidationError } from "@triliumnext/core";
import type { Request } from "express";
import isSvg from "is-svg";
import { Jimp } from "jimp";
import { parse } from "node-html-parser";

import { safeFetch, validateUrl } from "../../services/safe_fetch.js";

const MAX_RESPONSE_SIZE = 512 * 1024; // 512KB
const MAX_FAVICON_SIZE = 64 * 1024; // 64KB

/** Longest edge of the preview image kept in the note; larger images are scaled down to fit. */
const IMAGE_MAX_DIMENSION = 256;
/** Quality used when re-encoding an opaque preview image to JPEG. */
const IMAGE_JPEG_QUALITY = 75;
/** Refuse to even decode a preview image larger than this. */
const MAX_IMAGE_DOWNLOAD_SIZE = 5 * 1024 * 1024; // 5MB
/**
 * Cap for an image kept byte-for-byte instead of being re-encoded — an SVG (which scales natively,
 * so rasterising it would only lose quality) or a format Jimp cannot decode (WebP, AVIF).
 */
const MAX_VERBATIM_IMAGE_SIZE = 100 * 1024; // 100KB
/**
 * Smallest site icon accepted as a stand-in for a missing `og:image`. Above the usual 16/32/48/64
 * favicon sizes, so only a genuinely large icon qualifies — in practice the mobile home-screen one
 * (`apple-touch-icon`, typically 180x180, or a 192x192 web-manifest icon).
 */
const MIN_ICON_AS_IMAGE_DIMENSION = 96;
/** How many icon candidates to try before giving up, so a page full of <link rel="icon"> costs little. */
const MAX_ICON_CANDIDATES = 3;

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

    void reader.cancel();
    return result.slice(0, maxBytes);
}

/**
 * Downloads a binary resource, refusing anything over `maxBytes` — both up front, when the server
 * advertises the size, and while streaming, when it does not.
 * Returns undefined if the download fails or the resource is too large.
 */
async function downloadBinary(url: string, maxBytes: number, defaultContentType: string): Promise<{ buffer: Buffer; contentType: string } | undefined> {
    try {
        const response = await safeFetch(url);

        if (!response.ok) return undefined;

        // Bail early if the server advertises a size over the limit
        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > maxBytes) return undefined;

        const contentType = (response.headers.get("content-type") || defaultContentType).split(";")[0];

        // Stream the body and enforce the size limit during download
        const reader = response.body?.getReader();
        if (!reader) return undefined;

        const chunks: Uint8Array[] = [];
        let bytesRead = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            bytesRead += value.byteLength;
            if (bytesRead > maxBytes) {
                void reader.cancel();
                return undefined;
            }
            chunks.push(value);
        }

        return { buffer: Buffer.concat(chunks), contentType };
    } catch {
        return undefined;
    }
}

function toDataUri(contentType: string, buffer: Buffer): string {
    return `data:${contentType};base64,${buffer.toString("base64")}`;
}

/**
 * Downloads a favicon and returns it as a base64 data URI.
 * Returns undefined if the download fails or the image is too large.
 */
async function downloadFaviconAsDataUri(faviconUrl: string): Promise<string | undefined> {
    const downloaded = await downloadBinary(faviconUrl, MAX_FAVICON_SIZE, "image/x-icon");
    if (!downloaded) return undefined;

    return toDataUri(downloaded.contentType, downloaded.buffer);
}

/**
 * Downloads the preview image, scales it down to {@link IMAGE_MAX_DIMENSION} and returns it as a
 * base64 data URI, so the note carries the image itself instead of hotlinking the origin site (which
 * would leak every reader's IP to it, and break whenever the remote URL rots).
 *
 * Transparency is preserved by re-encoding to PNG only when the image actually has non-opaque
 * pixels; an opaque image becomes a JPEG, which is several times smaller — and this ends up inside
 * the note's HTML, so every byte is synced and stored forever.
 *
 * Returns undefined when the image cannot be had at a reasonable size, in which case the preview is
 * still shown without it — the title and description carry the value, not the picture.
 *
 * `minSourceDimension` rejects a source whose longest edge is below it, used when falling back to a
 * site icon: a 16x16 favicon blown up into a card thumbnail looks worse than no image at all.
 */
async function downloadImageAsDataUri(imageUrl: string, minSourceDimension = 0): Promise<string | undefined> {
    const downloaded = await downloadBinary(imageUrl, MAX_IMAGE_DOWNLOAD_SIZE, "image/jpeg");
    if (!downloaded) return undefined;

    const { buffer, contentType } = downloaded;
    const isSmallEnoughToKeepVerbatim = buffer.byteLength <= MAX_VERBATIM_IMAGE_SIZE;

    // An SVG scales natively, so it is kept as-is rather than rasterised (Jimp cannot read it anyway),
    // and it satisfies any minimum dimension by definition.
    // The isSvg() sniff only runs on a buffer we would be willing to keep, to avoid stringifying megabytes.
    if (contentType.includes("svg") || (isSmallEnoughToKeepVerbatim && isSvg(buffer.toString()))) {
        return isSmallEnoughToKeepVerbatim ? toDataUri("image/svg+xml", buffer) : undefined;
    }

    try {
        const image = await Jimp.read(buffer);

        if (Math.max(image.bitmap.width, image.bitmap.height) < minSourceDimension) {
            return undefined;
        }

        // Only ever scale down: scaleToFit() would happily enlarge a smaller image.
        if (image.bitmap.width > IMAGE_MAX_DIMENSION || image.bitmap.height > IMAGE_MAX_DIMENSION) {
            image.scaleToFit({ w: IMAGE_MAX_DIMENSION, h: IMAGE_MAX_DIMENSION });
        }

        // hasAlpha() inspects the pixels, not just the channel, so an opaque PNG still takes the
        // JPEG path. An animated GIF/WebP collapses to its first frame, which is fine for a thumbnail.
        return image.hasAlpha()
            ? toDataUri("image/png", Buffer.from(await image.getBuffer("image/png")))
            : toDataUri("image/jpeg", Buffer.from(await image.getBuffer("image/jpeg", { quality: IMAGE_JPEG_QUALITY })));
    } catch (e: unknown) {
        // Jimp bundles decoders for PNG/JPEG/GIF/BMP/TIFF only, so a WebP or AVIF lands here. Keep
        // the original bytes when they are small enough — unresized, but still not hotlinked. The
        // content type is checked so that an error page served in place of the image (an undecodable
        // response that is not an image at all) is dropped rather than embedded. A caller that
        // requires a minimum size gets nothing: undecodable means unverifiable.
        // The URL is deliberately left out of the log: it is the user's private browsing, and a
        // pasted link can carry a one-time token in its path or query. The timestamp is enough to
        // match a log line against the paste that caused it.
        getLog().info(`Could not decode a link preview image: ${e}`);
        return isSmallEnoughToKeepVerbatim && contentType.startsWith("image/") && !minSourceDimension
            ? toDataUri(contentType, buffer)
            : undefined;
    }
}

/**
 * Resolves a URL found in the page (`og:image` content, favicon `href`, …) against the page's own
 * address, so a root-relative or relative one — both legal and common — becomes absolute. Without
 * this the value would later be resolved against Trilium's origin instead of the site's.
 * Returns undefined when the value cannot form a URL at all.
 */
function toAbsoluteUrl(href: string | undefined, pageUrl: string): string | undefined {
    if (!href) return undefined;
    try {
        return new URL(href, pageUrl).toString();
    } catch {
        return undefined;
    }
}

/**
 * Falls back to the site's own icon when the page advertises no usable `og:image`. Sites routinely
 * ship a large home-screen icon (`apple-touch-icon`, usually 180x180) even when they carry no social
 * preview image, and that beats an empty card.
 *
 * Candidates are tried largest-first, and one is only accepted if the image really is at least
 * {@link MIN_ICON_AS_IMAGE_DIMENSION} across — the declared `sizes` attribute is a hint used for
 * ordering, never trusted as fact, since the actual bytes decide.
 */
async function resolveIconAsImage(document: ReturnType<typeof parse>, pageUrl: string): Promise<string | undefined> {
    for (const candidate of collectIconCandidates(document, pageUrl).slice(0, MAX_ICON_CANDIDATES)) {
        const image = await downloadImageAsDataUri(candidate, MIN_ICON_AS_IMAGE_DIMENSION);
        if (image) return image;
    }

    return undefined;
}

/**
 * The page's icon URLs, best-first. An icon whose declared `sizes` is below the threshold is dropped
 * outright (no point downloading a 32x32); an icon with no `sizes` is kept, ranked by convention —
 * `apple-touch-icon` is 180x180 by platform convention, a bare `icon` is usually tiny. The
 * conventional `/apple-touch-icon.png` path is tried last, since sites often serve it undeclared.
 */
function collectIconCandidates(document: ReturnType<typeof parse>, pageUrl: string): string[] {
    const candidates: { url: string; size: number }[] = [];

    for (const link of document.querySelectorAll("link")) {
        const rel = (link.getAttribute("rel") || "").toLowerCase();
        if (!rel.includes("icon")) continue;

        const url = toAbsoluteUrl(link.getAttribute("href"), pageUrl);
        if (!url) continue;

        const declared = largestDeclaredSize(link.getAttribute("sizes"));
        // Trust the declaration only when it rules a candidate *out*: it costs a download otherwise.
        if (declared > 0 && declared < MIN_ICON_AS_IMAGE_DIMENSION) continue;

        candidates.push({ url, size: declared || (rel.includes("apple-touch-icon") ? 180 : 0) });
    }

    candidates.sort((a, b) => b.size - a.size);

    const urls = candidates.map((candidate) => candidate.url);
    const conventional = toAbsoluteUrl("/apple-touch-icon.png", pageUrl);
    if (conventional && !urls.includes(conventional)) {
        urls.push(conventional);
    }

    return urls;
}

/** Largest edge in a `sizes` attribute ("16x16 32x32", "180x180", "any"), or 0 when unusable. */
function largestDeclaredSize(sizes: string | undefined): number {
    if (!sizes) return 0;
    // "any" means a scalable (SVG) icon — treat it as the best possible candidate.
    if (sizes.toLowerCase().includes("any")) return Number.MAX_SAFE_INTEGER;

    const edges = [...sizes.matchAll(/(\d+)x(\d+)/gi)]
        .flatMap((match) => [Number(match[1]), Number(match[2])]);

    return edges.length ? Math.max(...edges) : 0;
}

/**
 * Resolves a favicon URL from the parsed HTML, then downloads it as a data URI.
 */
async function resolveFavicon(document: ReturnType<typeof parse>, pageUrl: string): Promise<string | undefined> {
    const faviconEl = document.querySelector('link[rel="icon"]')
        || document.querySelector('link[rel="shortcut icon"]')
        || document.querySelector('link[rel="apple-touch-icon"]');

    let faviconUrl = toAbsoluteUrl(faviconEl?.getAttribute("href"), pageUrl);
    if (!faviconUrl) {
        faviconUrl = toAbsoluteUrl("/favicon.ico", pageUrl);
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
        siteName: "YouTube",
        embedType: "youtube"
    };

    // Download YouTube favicon as data URI
    metadata.favicon = await downloadFaviconAsDataUri("https://www.youtube.com/favicon.ico");

    let thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const response = await safeFetch(oembedUrl);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (data.title) metadata.title = data.title;
        if (data.author_name) metadata.description = data.author_name;
        if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
    } catch {
        metadata.title = "YouTube Video";
    }

    // The thumbnail is embedded like any other preview image: it is what Card display mode shows, and
    // hotlinking it would tell YouTube every time the note is opened.
    metadata.image = await downloadImageAsDataUri(thumbnailUrl);

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

    const imageUrl = toAbsoluteUrl(getMeta("og:image"), url);
    // A site with no og:image (or one that fails to download) still usually has a large home-screen
    // icon, which makes a far better card than an empty placeholder.
    const image = (imageUrl ? await downloadImageAsDataUri(imageUrl) : undefined)
        ?? await resolveIconAsImage(document, url);

    return {
        title: getMeta("og:title") || document.querySelector("title")?.textContent?.trim() || undefined,
        description: getMeta("og:description") || getMeta("description") || undefined,
        image,
        siteName: getMeta("og:site_name") || undefined,
        favicon
    };
}

async function getMetadata(req: Request) {
    // Taken from the body, not the query string: see the route registration for why.
    const urlParam = req.body?.url;

    if (!urlParam || typeof urlParam !== "string") {
        throw new ValidationError("'url' is required");
    }

    const validatedUrl = validateUrl(urlParam);
    const url = validatedUrl.toString();
    const videoId = extractYouTubeVideoId(url);

    // A YouTube link stays resolved even when oEmbed is unreachable: the player embeds from the
    // video ID alone, so the preview is worth showing with or without the title and channel.
    if (videoId) {
        return await fetchYouTubeMetadata(url, videoId);
    }

    try {
        const ogData = await fetchOpenGraphData(url);

        // A page that answered but names itself nowhere (no og:title, no <title>) leaves us with
        // the hostname we already had, which is no better than a failed fetch.
        if (!ogData.title) {
            return unresolvedMetadata(validatedUrl);
        }

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
        // No URL here either — see the note above the image-decode log.
        getLog().info(`Failed to fetch link preview metadata: ${e}`);
        return unresolvedMetadata(validatedUrl);
    }
}

/**
 * The degraded result for a URL whose page told us nothing: everything the caller gets back is
 * derived from the URL itself. Flagged so the caller can keep a plain link instead of rendering a
 * preview that would show less than the link did.
 */
function unresolvedMetadata(url: URL): LinkEmbedMetadata {
    return {
        url: url.toString(),
        title: url.hostname,
        embedType: "opengraph",
        unresolved: true
    };
}

export default { getMetadata };
