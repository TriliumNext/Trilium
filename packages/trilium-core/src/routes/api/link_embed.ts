import {
    extractYouTubeVideoId,
    type ImageAttachmentRole,
    type LinkEmbedMetadata,
    linkPreviewImageName,
    safeHostname
} from "@triliumnext/commons";
import type { Request } from "express";
import { parse } from "node-html-parser";

import { ValidationError } from "../../errors.js";
import { trimIcoToSmallestEntry } from "../../services/ico.js";
import imageService from "../../services/image.js";
import { storePictureBytes } from "../../services/image_download.js";
import { type InspectedImage, inspectImage, UNKNOWN_FORMAT } from "../../services/image_inspect.js";
import { getImageProvider } from "../../services/image_provider.js";
import { getLog } from "../../services/log.js";
import { findPageDescription } from "../../services/page_description.js";
import request, { type FetchedResource, validateFetchableUrl } from "../../services/request.js";
import { decodeUtf8 } from "../../services/utils/binary.js";

const MAX_RESPONSE_SIZE = 512 * 1024; // 512KB
/** An oEmbed answer is a handful of fields; anything approaching this is not one. */
const MAX_OEMBED_SIZE = 64 * 1024; // 64KB

/**
 * How much of a favicon to fetch.
 *
 * Deliberately far above what is kept. A site's icon is often a directory of several pictures where
 * only the smallest is ever drawn — Trilium's own is 114KB, of which the rendered entry is 1.1KB —
 * and the whole file has to arrive before the rest can be dropped. Enforcing the storage ceiling
 * here instead is what left such a site with no icon at all.
 */
const MAX_FAVICON_DOWNLOAD_SIZE = 256 * 1024; // 256KB
/** How large a favicon may be once trimmed. Icons that are one picture already measure a few KB. */
const MAX_FAVICON_SIZE = 64 * 1024; // 64KB
/**
 * The size of icon to keep out of a file offering several, in pixels.
 *
 * A preview draws its icon at 16 CSS pixels, so 16 is only enough for a display that has one device
 * pixel per CSS pixel. Everything above that upscales it, visibly so on the 2x and 3x screens that
 * are now ordinary — and the note is one document shown on whichever screen opens it, so the size
 * cannot be chosen per viewer. 48 covers up to 3x and downscales cleanly below it, at a few KB
 * against an attachment already kept once per site rather than once per link.
 *
 * A file that offers nothing this large gives its largest, which is the best it has.
 */
const FAVICON_TARGET_EDGE = 48;

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
 * The same cap for the favicon, which then always tries `/favicon.ico` besides. A page declaring
 * more icons than this has already had its best three refuse to be downloaded, and the fourth is
 * not where the icon was going to come from.
 */
const MAX_FAVICON_CANDIDATES = 3;

/**
 * A fetched resource read as text.
 *
 * Decoded as UTF-8 without exception, which is what the previous streaming read did as well. A page
 * declaring some other encoding comes out mangled in its non-ASCII characters — but the tags this
 * reads are ASCII, so it still finds them, and the alternative is carrying a charset decoder for the
 * sake of a title that is occasionally accented.
 */
function asText({ bytes }: FetchedResource): string {
    return decodeUtf8(bytes);
}

/**
 * Downloads a binary resource, or nothing where it could not be had.
 *
 * The ceiling, the streaming and the vetting of the address all belong to the request provider now,
 * which is what lets this run on a runtime with no Node in it. What is left here is the one decision
 * that is this route's rather than the transport's: a preview would rather go without a picture than
 * fail, so every way of not getting one collapses to the same absence.
 *
 * `defaultContentType` stands in where a server named none — an `.ico` is routinely served as
 * `application/octet-stream`, or as nothing at all.
 */
async function downloadBinary(url: string, maxBytes: number, defaultContentType: string): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
    try {
        const response = await request.fetchResource(url, { maxBytes });

        if (!response.ok) return undefined;

        return { bytes: response.bytes, contentType: response.contentType || defaultContentType };
    } catch {
        return undefined;
    }
}

/** A picture that has been fetched and identified, but not yet stored anywhere. */
interface DownloadedPicture {
    bytes: Uint8Array;
}

/**
 * A preview as it comes back from the site: everything the note will carry as text, and the
 * pictures still holding their bytes.
 *
 * They are kept apart until the very end so that storing them happens once, in one place, rather
 * than at each of the several points a picture can be found. The note only ever receives the
 * `api/attachments/...` URLs.
 */
interface FetchedPreview {
    metadata: LinkEmbedMetadata;
    favicon?: DownloadedPicture;
    image?: DownloadedPicture;
}

/**
 * Stores one of a preview's pictures on the note the preview is going into, and answers with the
 * URL the note will reference it by.
 *
 * `shrink` is off: {@link downloadPreviewImage} has already scaled and re-encoded what it fetched,
 * and a favicon arrives at the size the site published it. The generic compression pass would only
 * decode a picture that has nothing left to give, and it holds a slot sized for the user's own
 * photographs while it does.
 */
async function storePicture(
    noteId: string,
    picture: DownloadedPicture | undefined,
    role: ImageAttachmentRole,
    baseName: string
): Promise<string | undefined> {
    if (!picture) {
        return undefined;
    }

    const stored = storePictureBytes(noteId, picture.bytes, { role, title: baseName, shrink: false });

    if (!stored) {
        return undefined;
    }

    // The client renders the preview the moment this answers, so the URL it is handed has to be
    // fetchable by then; otherwise the picture draws broken and stays that way until a reload.
    await imageService.awaitImageWrite(stored.attachmentId);

    return stored.url;
}

/**
 * Stores both of a preview's pictures, naming each after the thing it is of — the favicon by its
 * site, the cover by its page — which is what lets a note that links one site many times keep a
 * single icon, and the same URL pasted twice keep a single cover.
 */
async function storePictures(noteId: string, url: string, fetched: FetchedPreview): Promise<LinkEmbedMetadata> {
    const [ favicon, image ] = await Promise.all([
        storePicture(noteId, fetched.favicon, "favicon", safeHostname(url)),
        storePicture(noteId, fetched.image, "coverImage", linkPreviewImageName(url))
    ]);

    return { ...fetched.metadata, favicon, image };
}

/**
 * Bytes that really are a picture, or nothing.
 *
 * The response header cannot answer this. `favicon.ico` is routinely served as
 * `application/octet-stream` or `text/plain`, and the answer is not decoration: what a picture is
 * decides the extension its attachment is titled with and the type it is later served under, which
 * is why {@link storePictureBytes} reads it off the bytes again at the moment it stores them.
 *
 * Asking here as well is what lets a candidate be rejected while there are still others to try: an
 * HTML error page served where an icon should be has to fail now, so the next `<link rel="icon">`
 * gets its turn, rather than at store time when the search is already over.
 */
function asPicture(bytes: Uint8Array): DownloadedPicture | undefined {
    return inspectImage(bytes).format === UNKNOWN_FORMAT ? undefined : { bytes };
}

/**
 * Downloads a favicon, keeping only the size of it a preview will draw.
 * Returns undefined if the download fails, it is not an image, or too much of it is left.
 */
async function downloadFavicon(faviconUrl: string): Promise<DownloadedPicture | undefined> {
    const downloaded = await downloadBinary(faviconUrl, MAX_FAVICON_DOWNLOAD_SIZE, "image/x-icon");

    if (!downloaded) {
        return undefined;
    }

    // An icon directory gives up the sizes nothing will look at; anything else is kept as it came.
    const bytes = trimIcoToSmallestEntry(downloaded.bytes, FAVICON_TARGET_EDGE) ?? downloaded.bytes;

    // The ceiling is on what is kept, not on what arrived: a file that is one large picture has
    // nothing to give up, and is the case this refuses.
    return bytes.byteLength <= MAX_FAVICON_SIZE ? asPicture(bytes) : undefined;
}

/**
 * Downloads the preview image and scales it down to {@link IMAGE_MAX_DIMENSION}, so the note holds
 * the picture itself instead of hotlinking the origin site (which would leak every reader's IP to
 * it, and break whenever the remote URL rots).
 *
 * Sized here rather than left to the generic image pipeline because these bytes make a round trip:
 * they are downloaded here and stored here, and a 5MB `og:image` has no business being carried
 * through that as a card thumbnail nobody will see above 256 pixels.
 *
 * Transparency is preserved by re-encoding to PNG only when the image actually has non-opaque
 * pixels; an opaque image becomes a JPEG, which is several times smaller.
 *
 * Returns undefined when the image cannot be had at a reasonable size, in which case the preview is
 * still shown without it — the title and description carry the value, not the picture.
 *
 * `minSourceDimension` rejects a source whose longest edge is below it, used when falling back to a
 * site icon: a 16x16 favicon blown up into a card thumbnail looks worse than no image at all.
 */
async function downloadPreviewImage(imageUrl: string, minSourceDimension = 0): Promise<DownloadedPicture | undefined> {
    const downloaded = await downloadBinary(imageUrl, MAX_IMAGE_DOWNLOAD_SIZE, "image/jpeg");
    if (!downloaded) return undefined;

    const { bytes, contentType } = downloaded;
    const inspected = inspectImage(bytes);
    const isSmallEnoughToKeepVerbatim = bytes.byteLength <= MAX_VERBATIM_IMAGE_SIZE;

    // An SVG scales natively, so it is kept as-is rather than rasterised, and it satisfies any
    // minimum dimension by definition. The sniff reads the opening bytes only, so it costs the same
    // whatever the file weighs.
    if (contentType.includes("svg") || inspected.format === "svg") {
        return isSmallEnoughToKeepVerbatim ? { bytes } : undefined;
    }

    if (minSourceDimension && !isAtLeast(inspected, minSourceDimension)) {
        return undefined;
    }

    const resized = await getImageProvider().resizeForPreview(bytes, {
        maxEdge: IMAGE_MAX_DIMENSION,
        jpegQuality: IMAGE_JPEG_QUALITY
    });

    if (resized.resized) {
        return { bytes: resized.bytes };
    }

    // Nothing scaled it — an undecodable format (WebP, AVIF) where there is a decoder, anything at
    // all where there is not. Keep the original bytes if they are small enough: unresized, but
    // still stored rather than hotlinked, which is the property that matters. They are asked what
    // they are on the way past, so an error page served in place of a picture is dropped rather
    // than embedded.
    return isSmallEnoughToKeepVerbatim ? asPicture(bytes) : undefined;
}

/**
 * Whether a picture is at least `minEdge` across, read from its header.
 *
 * Header rather than decode, so the answer costs nothing and is available on a runtime that has no
 * decoder at all — which is the point: the alternative was to decode purely to measure, and to
 * treat every picture that would not decode as too small. A header that does not say is treated as
 * too small, since unverified is not the same as large enough.
 */
function isAtLeast({ width, height }: InspectedImage, minEdge: number): boolean {
    return width !== null && height !== null && Math.max(width, height) >= minEdge;
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
async function resolveIconAsImage(document: ReturnType<typeof parse>, pageUrl: string): Promise<DownloadedPicture | undefined> {
    for (const candidate of collectIconCandidates(document, pageUrl).slice(0, MAX_ICON_CANDIDATES)) {
        const image = await downloadPreviewImage(candidate, MIN_ICON_AS_IMAGE_DIMENSION);
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
    // `pageUrl` already passed validateFetchableUrl, so resolving the conventional path against it cannot fail.
    const conventional = new URL("/apple-touch-icon.png", pageUrl).toString();
    if (!urls.includes(conventional)) {
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
 * The site's icon: the first candidate that yields one, or nothing.
 *
 * Trying more than one is the whole point. A declared `<link rel="icon">` is a promise, not a
 * delivery — it 404s, it serves an error page under an image content type, it is one picture too
 * large to keep — and taking only the first one and giving up left the preview with no icon at all
 * in every one of those cases, including when the page also declared a perfectly good second icon.
 */
async function resolveFavicon(document: ReturnType<typeof parse>, pageUrl: string): Promise<DownloadedPicture | undefined> {
    for (const candidate of collectFaviconCandidates(document, pageUrl)) {
        const favicon = await downloadFavicon(candidate);
        if (favicon) return favicon;
    }

    return undefined;
}

/**
 * The page's icon URLs, ranked for an icon drawn at {@link FAVICON_TARGET_EDGE} and ending at the
 * conventional `/favicon.ico`.
 *
 * Every `rel` naming an icon is collected, rather than the three exact spellings this used to ask
 * for: `rel="shortcut icon"`, `rel="icon shortcut"` and `rel="apple-touch-icon-precomposed"` all
 * mean the same thing to a browser, and a site writing any of them was read as declaring no icon.
 *
 * What a candidate is stored in comes before what size it is, because an `.ico` holds its pictures
 * as uncompressed bitmaps and the same picture as a PNG is a fraction of the bytes — python.org's
 * icon is 9.7KB as an icon file against 3.3KB, GitHub's 5.2KB against 1KB — where the difference
 * between two sizes of the same mark, drawn at 16 CSS pixels, is one nobody will see. Scalable
 * icons come first, being both the smallest and the only ones that owe nothing to a size at all.
 *
 * Size then ranks the way {@link collectIconCandidates} inverts: a card wants the largest picture
 * on offer, a favicon the smallest that still covers a 3x display.
 *
 * A Safari `mask-icon` is the one thing no format saves — a monochrome silhouette meant to be
 * tinted, which draws as a black blob wherever a real icon was expected — so it stays last.
 */
function collectFaviconCandidates(document: ReturnType<typeof parse>, pageUrl: string): string[] {
    const candidates: { url: string; mask: number; format: number; fit: number; size: number }[] = [];

    for (const link of document.querySelectorAll("link")) {
        const rel = (link.getAttribute("rel") || "").toLowerCase();
        if (!rel.includes("icon")) continue;

        const href = link.getAttribute("href") || "";
        const url = toAbsoluteUrl(href, pageUrl);
        if (!url) continue;

        const type = link.getAttribute("type");
        candidates.push({ url, ...rankFavicon(rel, href, type, link.getAttribute("sizes")) });
    }

    // Ties keep the order the page declared them in, sort() being stable.
    candidates.sort((a, b) => a.mask - b.mask
        || a.format - b.format
        || a.fit - b.fit
        || (a.fit === FIT_TOO_SMALL ? b.size - a.size : a.size - b.size));

    const urls = [ ...new Set(candidates.map((candidate) => candidate.url)) ].slice(0, MAX_FAVICON_CANDIDATES);

    // Every site is entitled to serve this whether it declares it or not, so it is the last resort
    // rather than one of the ranked candidates. `pageUrl` already passed validateFetchableUrl, so it forms a
    // URL. Appended after the cap, never dropped by it.
    const conventional = new URL("/favicon.ico", pageUrl).toString();
    if (!urls.includes(conventional)) {
        urls.push(conventional);
    }

    return urls;
}

/** What a candidate is stored in: scalable, compressed, or an uncompressed icon file. */
const FORMAT_SCALABLE = 0;
const FORMAT_COMPRESSED = 1;
const FORMAT_ICO = 2;

/** How well a size suits an icon drawn at {@link FAVICON_TARGET_EDGE}. */
const FIT_BIG_ENOUGH = 0;
const FIT_UNDECLARED = 1;
const FIT_TOO_SMALL = 2;

/**
 * By what an icon link is worth ranking, in the order {@link collectFaviconCandidates} applies it.
 *
 * Every field is read off what the page says, never off the bytes, which have not been fetched yet.
 * The page can be wrong — a PNG served from a path ending `.ico` is legal and happens — and being
 * wrong costs an ordering rather than a download, so nothing here needs to be more certain than the
 * declaration it came from.
 *
 * An undeclared size sits between the two declared cases rather than being guessed at: it is what a
 * plain `favicon.ico` carries, and that is usually an icon directory of several sizes, out of which
 * {@link downloadFavicon} keeps the right one. A home-screen icon that declares no size is read at
 * the 180 its platform asks for, the same convention {@link collectIconCandidates} uses.
 */
function rankFavicon(rel: string, href: string, type: string | undefined, sizes: string | undefined) {
    const declared = largestDeclaredSize(sizes) || (rel.includes("apple-touch-icon") ? 180 : 0);
    const scalable = declared === Number.MAX_SAFE_INTEGER
        || (type || "").toLowerCase().includes("svg")
        || /\.svg([?#]|$)/i.test(href);
    const ico = /\.ico([?#]|$)/i.test(href) || /icon$/i.test((type || "").trim());

    // A scalable icon has no size to weigh: it is drawn at whatever is asked of it, so it is ranked
    // as the exact fit it is rather than by whatever the page happened to declare.
    if (scalable) {
        return {
            mask: rel.includes("mask-icon") ? 1 : 0,
            format: FORMAT_SCALABLE,
            fit: FIT_BIG_ENOUGH,
            size: FAVICON_TARGET_EDGE
        };
    }

    return {
        mask: rel.includes("mask-icon") ? 1 : 0,
        format: ico ? FORMAT_ICO : FORMAT_COMPRESSED,
        fit: declared === 0 ? FIT_UNDECLARED : declared >= FAVICON_TARGET_EDGE ? FIT_BIG_ENOUGH : FIT_TOO_SMALL,
        size: declared
    };
}

/**
 * Fetches YouTube metadata via the public oEmbed endpoint.
 * This works reliably unlike scraping youtube.com (which blocks bots).
 */
async function fetchYouTubeMetadata(url: string, videoId: string): Promise<FetchedPreview> {
    const metadata: LinkEmbedMetadata = {
        url,
        siteName: "YouTube",
        embedType: "youtube"
    };

    const favicon = await downloadFavicon("https://www.youtube.com/favicon.ico");

    let thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const response = await request.fetchResource(oembedUrl, { maxBytes: MAX_OEMBED_SIZE });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = JSON.parse(asText(response));
        if (data.title) metadata.title = data.title;
        if (data.author_name) metadata.description = data.author_name;
        if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
    } catch {
        metadata.title = "YouTube Video";
    }

    // The thumbnail is stored like any other preview image: it is what Card display mode shows, and
    // hotlinking it would tell YouTube every time the note is opened.
    return { metadata, favicon, image: await downloadPreviewImage(thumbnailUrl) };
}

async function fetchOpenGraphData(url: string) {
    const response = await request.fetchResource(url, {
        maxBytes: MAX_RESPONSE_SIZE,
        headers: {
            "User-Agent": "TriliumNotes/1.0 (Link Preview; +https://triliumnotes.org/)",
            "Accept": "text/html"
        }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const { contentType } = response;
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        throw new Error(`Unexpected Content-Type: ${contentType}`);
    }

    const document = parse(asText(response));

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
    const image = (imageUrl ? await downloadPreviewImage(imageUrl) : undefined)
        ?? await resolveIconAsImage(document, url);

    return {
        title: getMeta("og:title") || document.querySelector("title")?.textContent?.trim() || undefined,
        // A Twitter card's description before the generic one: both of the first two are written to
        // be read on a card, which is what this is, whereas `name="description"` is written for a
        // search result and is often keyword-stuffed or cut off mid-sentence. Sites that ship only
        // Twitter tags are common enough to be worth the extra look. `getMeta` tries `property=`
        // and `name=` in turn, so it finds the tag under either spelling — the card spec says
        // `name`, and plenty of sites write `property` regardless.
        // ...and the page's own opening sentence where it publishes no description at all, which a
        // Wikipedia article does not. See findPageDescription: only ever reached when the site has
        // said nothing, a description written for the purpose being what it wants shown.
        description: getMeta("og:description") || getMeta("twitter:description") || getMeta("description")
            || findPageDescription(document),
        siteName: getMeta("og:site_name") || undefined,
        image,
        favicon
    };
}

async function getMetadata(req: Request) {
    // Taken from the body, not the query string: see the route registration for why.
    const urlParam = req.body?.url;
    const noteIdParam = req.body?.noteId;

    if (!urlParam || typeof urlParam !== "string") {
        throw new ValidationError("'url' is required");
    }

    // The note the preview is going into. Required, because the pictures are stored as its
    // attachments and there is nowhere else for them to live — a preview that belongs to no note
    // is a preview nothing will ever render.
    if (!noteIdParam || typeof noteIdParam !== "string") {
        throw new ValidationError("'noteId' is required");
    }

    const validatedUrl = validateFetchableUrl(urlParam);
    const url = validatedUrl.toString();
    const videoId = extractYouTubeVideoId(url);

    // A YouTube link stays resolved even when oEmbed is unreachable: the player embeds from the
    // video ID alone, so the preview is worth showing with or without the title and channel.
    if (videoId) {
        return await storePictures(noteIdParam, url, await fetchYouTubeMetadata(url, videoId));
    }

    try {
        const ogData = await fetchOpenGraphData(url);

        // A page that answered but names itself nowhere (no og:title, no <title>) leaves us with
        // the hostname we already had, which is no better than a failed fetch. Nothing is stored
        // for it: the pictures are dropped along with the preview they would have belonged to.
        if (!ogData.title) {
            return unresolvedMetadata(validatedUrl);
        }

        return await storePictures(noteIdParam, url, {
            metadata: {
                url,
                title: ogData.title,
                description: ogData.description,
                siteName: ogData.siteName,
                embedType: "opengraph"
            },
            favicon: ogData.favicon,
            image: ogData.image
        });
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
