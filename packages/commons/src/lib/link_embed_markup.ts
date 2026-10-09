import {
    extractYouTubeVideoId, safeHostname, safeLinkPreviewHref, safeLinkPreviewImageSrc
} from "./link_embed.js";

/** A link preview as the note stores it, in the `data-*` attributes of its element. */
export interface LinkPreviewData {
    url: string;
    /** `opengraph` draws a card; anything else draws a video player when the URL is a video. */
    embedType?: string | null;
    title?: string | null;
    description?: string | null;
    image?: string | null;
    favicon?: string | null;
    siteName?: string | null;
}

export interface LinkPreviewMarkupOptions {
    /** In the editor a link opens on a double click, so it carries no `target`. */
    editable?: boolean;
    /** The accessible name of a video's play button, translated by the caller. */
    playVideoLabel: string;
}

/**
 * The preview stored on a `section.link-embed` or `span.link-mention`, or `null` when it carries no
 * URL. A missing embed type reads as `opengraph`.
 */
export function readLinkPreviewData(getAttribute: (name: string) => string | null | undefined) {
    const url = getAttribute("data-url");
    if (!url) {
        return null;
    }

    return {
        url,
        embedType: getAttribute("data-embed-type") || "opengraph",
        title: getAttribute("data-title"),
        description: getAttribute("data-description"),
        image: getAttribute("data-image"),
        favicon: getAttribute("data-favicon"),
        siteName: getAttribute("data-site-name")
    } satisfies LinkPreviewData;
}

/**
 * The markup of an inline link mention: the site's favicon and the page title, or the host when
 * the note stores no title.
 */
export function renderLinkMentionHtml(data: LinkPreviewData, options: LinkPreviewMarkupOptions) {
    return `<a class="link-embed-mention" href="${escapeHtml(safeLinkPreviewHref(data.url))}"`
        + `${targetAttribute(options)} rel="noopener noreferrer">`
        + renderFavicon(data.favicon)
        + `<span class="link-embed-mention-title">`
        + `${escapeHtml(data.title || safeHostname(data.url))}</span>`
        + `</a>`;
}

/**
 * The markup of a block link preview: a video player for a video URL, a card otherwise.
 *
 * The player starts as a facade showing the thumbnail stored in the note, so reading a note or a
 * shared page that holds a video does not contact YouTube; `enhanceLinkPreviews()` swaps in the
 * player on the reader's click.
 */
export function renderLinkEmbedHtml(data: LinkPreviewData, options: LinkPreviewMarkupOptions) {
    const videoId = data.embedType !== "opengraph" ? extractYouTubeVideoId(data.url) : null;
    if (videoId) {
        const label = escapeHtml(options.playVideoLabel);
        return `<div class="link-embed-video">`
            + `<button type="button" class="link-embed-video-facade"`
            + ` data-video-id="${escapeHtml(videoId)}"`
            + ` aria-label="${label}" title="${label}">`
            + renderPicture(data.image, "link-embed-video-thumbnail")
            + `<span class="link-embed-video-play" aria-hidden="true"></span>`
            + `</button></div>`;
    }

    const cardImage = renderPicture(data.image, "link-embed-card-image")
        || LINK_EMBED_CARD_IMAGE_PLACEHOLDER;
    const title = data.title
        ? `<div class="link-embed-card-title">${escapeHtml(data.title)}</div>`
        : "";
    const description = data.description
        ? `<div class="link-embed-card-description">${escapeHtml(data.description)}</div>`
        : "";

    return `<a class="link-embed-card" href="${escapeHtml(safeLinkPreviewHref(data.url))}"`
        + `${targetAttribute(options)} rel="noopener noreferrer">`
        // The wrapper gives the card's left column its size, so a card without a picture keeps
        // the shape of one with it.
        + `<div class="link-embed-card-image-wrapper">${cardImage}</div>`
        + `<div class="link-embed-card-content">${title}${description}`
        + `<div class="link-embed-card-url">${renderFavicon(data.favicon)}`
        + `<span>${escapeHtml(data.siteName || safeHostname(data.url))}</span></div>`
        + `</div></a>`;
}

/** What stands in for a card's missing or broken cover image. */
export const LINK_EMBED_CARD_IMAGE_PLACEHOLDER =
    `<div class="link-embed-card-image-placeholder">&#128279;</div>`;

function targetAttribute({ editable }: LinkPreviewMarkupOptions) {
    return editable ? "" : ` target="_blank"`;
}

/**
 * A missing favicon draws nothing: unlike a card's cover there is no hole to fill, and anything
 * drawn in its place reads as a mark of its own.
 */
function renderFavicon(src: string | null | undefined) {
    return renderPicture(src, "link-embed-mention-favicon", 16);
}

/**
 * One of a preview's pictures, or an empty string when the note stores none the page may load.
 * `safeLinkPreviewImageSrc()` allows only an inline image or an attachment of this instance, so
 * opening a note never makes a request to a third party.
 */
function renderPicture(src: string | null | undefined, className: string, size?: number) {
    const safeSrc = safeLinkPreviewImageSrc(src);
    if (!safeSrc) {
        return "";
    }

    const sizeAttributes = size ? ` width="${size}" height="${size}"` : "";
    return `<img class="${className}" src="${escapeHtml(safeSrc)}" alt="" loading="lazy"`
        + ` draggable="false"${sizeAttributes}>`;
}

function escapeHtml(value: string) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}
