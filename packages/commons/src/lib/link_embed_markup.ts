import { readBoxSize } from "./content_embeds.js";
import {
    extractYouTubeVideoId, getMediaFileTitle, isHttpUrl, isMediaFileEmbedType,
    type MediaFileEmbedType, safeHostname, safeLinkPreviewHref, safeLinkPreviewImageSrc
} from "./link_embed.js";
import { escapeHtml } from "./utils.js";

/** A link preview as the note stores it, in the `data-*` attributes of its element. */
export interface LinkPreviewData {
    url: string;
    /**
     * `opengraph` draws a card, `video` and `audio` a player of the file at the URL, and anything
     * else a YouTube player when the URL is a YouTube video.
     */
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
    /** The accessible name of an audio file's play button, translated by the caller. */
    playAudioLabel: string;
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

/** What a link preview plays: a YouTube video, or the video or audio file at its URL. */
export type LinkPreviewPlayer = { type: "youtube"; videoId: string } | { type: MediaFileEmbedType };

/** The box sizes of a media embed that plays a video: Compact is its title row alone. */
export const VIDEO_EMBED_BOX_SIZES = [ "compact", "resizable", "full" ] as const;

/** The box sizes of a media embed that plays an audio file: Compact is a row of controls. */
export const AUDIO_EMBED_BOX_SIZES = [ "compact", "resizable" ] as const;

/** A box size that a media embed takes. */
export type MediaBoxSize =
    typeof VIDEO_EMBED_BOX_SIZES[number] | typeof AUDIO_EMBED_BOX_SIZES[number];

/** The box sizes of a media embed that `player` plays in. */
export function getMediaEmbedBoxSizes(player: LinkPreviewPlayer): readonly MediaBoxSize[] {
    return player.type === "audio" ? AUDIO_EMBED_BOX_SIZES : VIDEO_EMBED_BOX_SIZES;
}

/**
 * The box size of media saved as a link preview, and whether its title is hidden. A YouTube video
 * saved before videos were embeds has no box size: it is Full and untitled. An audio file saved
 * before 0.107 was Small, the row of controls that Compact is now.
 */
export function readMediaEmbedBox(
    getAttribute: (name: string) => string | null | undefined, player: LinkPreviewPlayer
): { boxSize: MediaBoxSize; isTitleHidden: boolean } {
    const savedBoxSize = getAttribute("data-box-size");
    const isAudio = player.type === "audio";
    const sizes = getMediaEmbedBoxSizes(player);
    const boxSize = isAudio && savedBoxSize === "small"
        ? "compact"
        : readBoxSize(savedBoxSize, sizes, isAudio ? "compact" : "full").boxSize as MediaBoxSize;
    return {
        boxSize,
        isTitleHidden: !savedBoxSize || getAttribute("data-hide-title") === "true"
    };
}

/** The YouTube ID of the video that a link preview plays, or `null`. */
export function getLinkPreviewVideoId(
    { url, embedType }: Pick<LinkPreviewData, "url" | "embedType">
) {
    return embedType !== "opengraph" && !isMediaFileEmbedType(embedType)
        ? extractYouTubeVideoId(url)
        : null;
}

/** What a link preview plays, or `null` for a card. */
export function getLinkPreviewPlayer(
    { url, embedType }: Pick<LinkPreviewData, "url" | "embedType">
): LinkPreviewPlayer | null {
    if (isMediaFileEmbedType(embedType)) {
        return isHttpUrl(url) ? { type: embedType } : null;
    }

    const videoId = getLinkPreviewVideoId({ url, embedType });
    return videoId ? { type: "youtube", videoId } : null;
}

/**
 * The markup inside the box of a link preview that an embed box renders outside the editor: a
 * video at Compact shows its title row alone, as a mention, and anything else its preview.
 */
export function renderLinkEmbedBoxHtml(
    data: LinkPreviewData,
    getAttribute: (name: string) => string | null | undefined,
    options: LinkPreviewMarkupOptions
) {
    const player = getLinkPreviewPlayer(data);
    const isTitleRow = !!player && player.type !== "audio"
        && readMediaEmbedBox(getAttribute, player).boxSize === "compact";
    return isTitleRow ? renderLinkMentionHtml(data, options) : renderLinkEmbedHtml(data, options);
}

/**
 * The markup of an icon & text link: the site's favicon and the page title, or the host when
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
 * The markup of a block link preview: a player for a URL that a preview plays, a card otherwise.
 *
 * The player starts as a facade showing the thumbnail stored in the note, so reading a note or a
 * shared page that holds a video or an audio file does not contact its host;
 * `enhanceLinkPreviews()` swaps in the player on the reader's click.
 */
export function renderLinkEmbedHtml(data: LinkPreviewData, options: LinkPreviewMarkupOptions) {
    const player = getLinkPreviewPlayer(data);
    if (player?.type === "audio") {
        const label = escapeHtml(options.playAudioLabel);
        return `<div class="link-embed-audio">`
            + `<button type="button" class="link-embed-audio-facade"`
            + ` data-media-url="${escapeHtml(data.url)}" aria-label="${label}" title="${label}">`
            + `<span class="link-embed-audio-play" aria-hidden="true"></span>`
            + `<span class="link-embed-audio-title">`
            + `${escapeHtml(data.title || getMediaFileTitle(data.url))}</span>`
            + `</button></div>`;
    }
    if (player) {
        const label = escapeHtml(options.playVideoLabel);
        const aspectRatio = getVideoAspectRatio(data);
        const style = aspectRatio ? ` style="${VIDEO_ASPECT_RATIO_PROPERTY}:${aspectRatio}"` : "";
        const isYouTube = player.type === "youtube";
        const source = isYouTube
            ? ` data-video-id="${escapeHtml(player.videoId)}"`
            : ` data-media-url="${escapeHtml(data.url)}"`;
        const playClass = isYouTube
            ? "link-embed-video-play"
            : "link-embed-video-file-play bx bx-play";
        return `<div class="link-embed-video"${style}>`
            + `<button type="button" class="link-embed-video-facade"${source}`
            + ` aria-label="${label}" title="${label}">`
            + renderPicture(data.image, "link-embed-video-thumbnail")
            + `<span class="${playClass}" aria-hidden="true"></span>`
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
