import "../widgets/type_widgets/text/LinkEmbed.css";

import {
    enhanceLinkPreviews, type LinkEmbedMetadata, type LinkPreviewData, readLinkPreviewData,
    renderLinkEmbedHtml, renderLinkMentionHtml, safeHostname, YOUTUBE_REGEX
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
    /** See {@link LinkEmbedMetadata.unresolved}. Not persisted into the note's HTML. */
    unresolved?: boolean;
}


export function detectEmbedType(url: string): "youtube" | "opengraph" {
    return YOUTUBE_REGEX.test(url) ? "youtube" : "opengraph";
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

        return {
            url: metadata.url,
            embedType: metadata.embedType,
            title: metadata.title,
            description: metadata.description,
            favicon: metadata.favicon,
            siteName: metadata.siteName,
            image: metadata.image,
            unresolved: metadata.unresolved
        };
    } catch {
        return unresolvedMetadata(url);
    }
}

/**
 * What a URL is worth when nothing could be learned about it: the hostname, and a flag saying so.
 *
 * The caller keeps it as a plain link rather than rendering a preview that shows less than the URL
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
 * Used by the editor for its link embed widget, with `editable` set.
 */
export function renderEmbedPreview(container: HTMLElement, meta: EmbedMetadata, editable?: boolean) {
    container.innerHTML = renderLinkEmbedHtml(meta, markupOptions(editable));
    enhanceLinkPreviews(container);
}

/** Draws an inline link mention into `container`, like {@link renderEmbedPreview}. */
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
    return { editable, playVideoLabel: t("link_embed.play_video") };
}

export default {
    fetchMetadata,
    unresolvedMetadata,
    detectEmbedType,
    safeHostname,
    renderEmbedPreview,
    renderMentionPreview,
    applyLinkEmbeds
};
