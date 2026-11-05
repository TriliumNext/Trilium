import "../widgets/type_widgets/text/LinkEmbed.css";

import {
    enhanceLinkPreviews, getMediaFileTitle, getMediaFileTypeOfUrl, type LinkEmbedMetadata,
    type LinkPreviewData, readLinkPreviewData, renderLinkEmbedHtml, renderLinkMentionHtml,
    safeHostname, YOUTUBE_REGEX
} from "@triliumnext/commons";

import { t } from "./i18n.js";
import server from "./server.js";

export { safeHostname };

export interface EmbedMetadata {
    url: string;
    embedType: string;
    title?: string;
    description?: string;
    favicon?: string;
    siteName?: string;
    image?: string;
    aspectRatio?: string;
    /** See {@link LinkEmbedMetadata.unresolved}. Not persisted into the note's HTML. */
    unresolved?: boolean;
}


/**
 * The kind of preview that `url` supports, as its address tells: a YouTube player, a player of the
 * video or audio file it names by its extension, or a card.
 */
export function detectEmbedType(url: string): EmbedMetadata["embedType"] {
    if (YOUTUBE_REGEX.test(url)) {
        return "youtube";
    }
    return getMediaFileTypeOfUrl(url) ?? "opengraph";
}

/**
 * Fetches link metadata from the server. Called once at link creation time.
 * The returned metadata is then stored in the note's HTML as data attributes.
 *
 * Both pictures a preview carries — the cover image and the favicon — are stored by the server as
 * attachments of `ownerNoteId`, and only their `api/attachments/...` URLs come back. That is why
 * the note id is required rather than optional: the pictures have nowhere else to live, and
 * carrying them in the note's HTML instead would be 10–140KB of content for a cover and 1–10KB for
 * a favicon, synced and revisioned like anything else the note holds. A single card is enough to
 * push a note past the `autoReadonlySizeText` threshold (32KB by default) and flip it read-only;
 * favicons get there by repetition, a note that links a site once usually linking it many times.
 */
export async function fetchMetadata(url: string, ownerNoteId: string): Promise<EmbedMetadata> {
    try {
        // POSTed rather than passed in the query string: a URL can carry a one-time token or a
        // signed signature, and a query string ends up in every access log along the way.
        const metadata = await server.post<LinkEmbedMetadata>("link-embed/metadata", { url, noteId: ownerNoteId });
        const mediaFile = metadata.unresolved ? getMediaFileMetadata(url) : null;
        if (mediaFile) {
            return mediaFile;
        }

        return {
            url: metadata.url,
            embedType: metadata.embedType,
            title: metadata.title,
            description: metadata.description,
            favicon: metadata.favicon,
            siteName: metadata.siteName,
            image: metadata.image,
            aspectRatio: metadata.aspectRatio,
            unresolved: metadata.unresolved
        };
    } catch {
        return getMediaFileMetadata(url) ?? unresolvedMetadata(url);
    }
}

/**
 * The metadata of a player of the audio or video file that `url` names by its extension, or
 * `null`. Used where the server cannot read the file: the server refuses an address on a private
 * network, and standalone reads only a host that sends CORS headers. The `<video>` or `<audio>`
 * of the reader can still play it.
 */
function getMediaFileMetadata(url: string): EmbedMetadata | null {
    const embedType = getMediaFileTypeOfUrl(url);
    return embedType ? { url, embedType, title: getMediaFileTitle(url) } : null;
}

/** The title and description of a web page, as {@link fetchPageDetails} reads them. */
export type PageDetails = Pick<EmbedMetadata, "title" | "description">;

/**
 * Reads the title and description of the web page at `url`, without its pictures, so nothing is
 * stored on a note. `null` when the page could not be read or has no title.
 */
export async function fetchPageDetails(url: string): Promise<PageDetails | null> {
    try {
        const details = await server.post<LinkEmbedMetadata>("link-embed/details", { url });
        return details.unresolved
            ? null
            : { title: details.title, description: details.description };
    } catch {
        return null;
    }
}

/**
 * What a URL is worth when nothing could be learned about it: the hostname, and a flag saying so.
 *
 * The caller keeps it as a text link rather than rendering a preview that shows less than the URL
 * did. Reached when the metadata request fails, and when there is no note yet to store the
 * preview's pictures on.
 */
export function unresolvedMetadata(url: string): EmbedMetadata {
    return {
        url,
        embedType: detectEmbedType(url),
        title: safeHostname(url),
        unresolved: true
    };
}

/**
 * Draws a block link preview into `container` from stored metadata, making no network request.
 * Used by the editor for its link embed widget and video embeds, with `editable` set.
 */
export function renderEmbedPreview(
    container: HTMLElement, meta: LinkPreviewData, editable?: boolean
) {
    container.innerHTML = renderLinkEmbedHtml(meta, markupOptions(editable));
    enhanceLinkPreviews(container);
}

/** Draws an icon & text link into `container`, like {@link renderEmbedPreview}. */
export function renderMentionPreview(container: HTMLElement, meta: LinkPreviewData, editable?: boolean) {
    container.innerHTML = renderLinkMentionHtml(meta, markupOptions(editable));
    enhanceLinkPreviews(container);
}

/**
 * Draws every link embed and mention in `container` from the metadata stored in its `data-*`
 * attributes, as `link.loadReferenceLinkTitle` does for reference links.
 */
export function applyLinkEmbeds(container: HTMLElement) {
    for (const embed of container.querySelectorAll<HTMLElement>("section.link-embed")) {
        const data = readLinkPreviewData((name) => embed.getAttribute(name));
        if (data) {
            embed.innerHTML = renderLinkEmbedHtml(data, markupOptions(false));
        }
    }

    for (const mention of container.querySelectorAll<HTMLElement>("span.link-mention")) {
        const data = readLinkPreviewData((name) => mention.getAttribute(name));
        if (data) {
            mention.innerHTML = renderLinkMentionHtml(data, markupOptions(false));
        }
    }

    enhanceLinkPreviews(container);
}

function markupOptions(editable: boolean | undefined) {
    return {
        editable,
        playVideoLabel: t("link_embed.play_video"),
        playAudioLabel: t("link_embed.play_audio")
    };
}

export default {
    fetchMetadata,
    fetchPageDetails,
    unresolvedMetadata,
    detectEmbedType,
    safeHostname,
    renderEmbedPreview,
    renderMentionPreview,
    applyLinkEmbeds
};
