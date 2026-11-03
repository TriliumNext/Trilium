import {
    extractYouTubeVideoId, safeHostname, safeLinkPreviewHref, safeLinkPreviewImageSrc
} from "./link_embed.js";
import { escapeHtml } from "./utils.js";

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
    /** The shape of a video, as its width and height in whole numbers, such as `9/16`. */
    aspectRatio?: string | null;
}

export interface LinkPreviewMarkupOptions {
    /** In the editor a link opens on a double click, so it carries no `target`. */
    editable?: boolean;
    /** The accessible name of a video's play button, translated by the caller. */
    playVideoLabel: string;
}

/** The `data-*` attribute that stores each field of a link preview. */
export const LINK_PREVIEW_DATA_ATTRIBUTES = {
    url: "data-url",
    embedType: "data-embed-type",
    title: "data-title",
    description: "data-description",
    image: "data-image",
    favicon: "data-favicon",
    siteName: "data-site-name",
    aspectRatio: "data-aspect-ratio"
} as const satisfies Record<keyof LinkPreviewData, string>;

/** The custom property that gives the player of a video, and its box, the shape of the video. */
export const VIDEO_ASPECT_RATIO_PROPERTY = "--video-aspect-ratio";

/**
 * The preview stored on a `section.link-embed` or `span.link-mention`, or `null` when it carries no
 * URL. A missing embed type reads as `opengraph`.
 */
export function readLinkPreviewData(getAttribute: (name: string) => string | null | undefined) {
    const attributes = LINK_PREVIEW_DATA_ATTRIBUTES;
    const url = getAttribute(attributes.url);
    if (!url) {
        return null;
    }

    return {
        url,
        embedType: getAttribute(attributes.embedType) || "opengraph",
        title: getAttribute(attributes.title),
        description: getAttribute(attributes.description),
        image: getAttribute(attributes.image),
        favicon: getAttribute(attributes.favicon),
        siteName: getAttribute(attributes.siteName),
        aspectRatio: getAttribute(attributes.aspectRatio)
    } satisfies LinkPreviewData;
}

/**
 * The width of the video of `preview` divided by its height, or `null` when the preview stores
 * no valid shape, as a video inserted before Trilium read the shape does. Its player is 16:9.
 */
export function getVideoAspectRatio({ aspectRatio }: Pick<LinkPreviewData, "aspectRatio">) {
    const [ width, height ] = aspectRatio?.match(/^(\d{1,4})\/(\d{1,4})$/)?.slice(1).map(Number)
        ?? [];
    return width && height ? width / height : null;
}

/** The box sizes of a video embed. */
export const VIDEO_EMBED_BOX_SIZES = [ "medium", "full" ] as const;

/**
 * The box size of a video saved as a link preview, and whether its title is hidden. A video saved
 * before videos were embeds has no box size: it is Full and untitled.
 */
export function readVideoEmbedBox(getAttribute: (name: string) => string | null | undefined) {
    const savedBoxSize = getAttribute("data-box-size");
    const boxSize = VIDEO_EMBED_BOX_SIZES.find((size) => size === savedBoxSize) ?? "full";
    return {
        boxSize,
        isTitleHidden: !savedBoxSize || getAttribute("data-hide-title") === "true"
    };
}

/** The YouTube ID of the video that a link preview plays, or `null` for a card. */
export function getLinkPreviewVideoId(
    { url, embedType }: Pick<LinkPreviewData, "url" | "embedType">
) {
    return embedType !== "opengraph" ? extractYouTubeVideoId(url) : null;
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
    const videoId = getLinkPreviewVideoId(data);
    if (videoId) {
        const label = escapeHtml(options.playVideoLabel);
        const aspectRatio = getVideoAspectRatio(data);
        const style = aspectRatio ? ` style="${VIDEO_ASPECT_RATIO_PROPERTY}:${aspectRatio}"` : "";
        return `<div class="link-embed-video"${style}>`
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
