import "../widgets/type_widgets/text/LinkEmbed.css";

import { extractYouTubeVideoId, type LinkEmbedMetadata, safeHostname, safeLinkPreviewHref, safeLinkPreviewImageSrc, YOUTUBE_REGEX } from "@triliumnext/commons";
import { render, type VNode } from "preact";
import { useState } from "preact/hooks";

import { useFaviconContrastClass } from "./favicon_contrast.js";
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

// ---------------------------------------------------------------------------
// Preact components — render previews from stored metadata, no network requests.
// Used by the CKEditor editing downcast (via component interface), the
// read-only text renderer, and postProcessRichContent (tooltips, included
// notes, markdown preview).
// ---------------------------------------------------------------------------

/**
 * One of a preview's pictures, or what stands in for it.
 *
 * Both pictures make the same two decisions, so they make them in one place: load only what
 * {@link safeLinkPreviewImageSrc} allows — an inline image or an attachment of this instance, so
 * that opening a note never announces the reader to a third party — and fall back both when there
 * is nothing to load and when loading fails. The failure half matters as much as the check: an
 * attachment can be erased out from under a preview that still references it, and a broken-image
 * glyph reads as a bug where an absence reads as an absence.
 *
 * `placeholder` is what a card's missing cover image gets, having a hole to fill; a missing favicon
 * omits it, since nothing drawn in its place says as much as the title already does.
 */
function PreviewPicture({ src, className, placeholder, size }: {
    src?: string | null;
    className: string;
    placeholder?: VNode;
    /** For a picture drawn at a fixed size; the card image is sized by CSS instead. */
    size?: number;
}) {
    const [ failed, setFailed ] = useState(false);
    const safeSrc = safeLinkPreviewImageSrc(src);

    if (!safeSrc || failed) {
        return placeholder ?? null;
    }

    return (
        <img
            className={className}
            src={safeSrc}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            draggable={false}
            onError={() => setFailed(true)}
        />
    );
}

function ImagePlaceholder() {
    return <div className="link-embed-card-image-placeholder">&#128279;</div>;
}

function Favicon({ src }: { src?: string }) {
    // A site draws its icon for one background, and ours is not always that one — see
    // favicon_contrast.ts. The verdict travels as a class so that switching theme corrects the icon
    // without anything being measured again.
    const contrastClass = useFaviconContrastClass(src);

    return (
        <PreviewPicture
            src={src}
            className={contrastClass ? `link-embed-mention-favicon ${contrastClass}` : "link-embed-mention-favicon"}
            size={16}
        />
    );
}

function CardImage({ src }: { src?: string }) {
    return <PreviewPicture src={src} className="link-embed-card-image" placeholder={<ImagePlaceholder />} />;
}

/**
 * A YouTube player that only contacts YouTube once the user asks it to.
 *
 * Until then it shows the thumbnail already stored in the note, so merely opening a note with an
 * embedded video does not tell Google that the reader opened it — the note stays free of
 * third-party requests, which is the whole point of embedding the metadata server-side.
 */
function VideoEmbed({ meta, videoId }: { meta: EmbedMetadata; videoId: string }) {
    const [playing, setPlaying] = useState(false);
    const thumbnail = safeLinkPreviewImageSrc(meta.image);

    if (!playing) {
        return (
            <div className="link-embed-video">
                <button
                    type="button"
                    className="link-embed-video-facade"
                    aria-label={t("link_embed.play_video")}
                    title={t("link_embed.play_video")}
                    onClick={() => setPlaying(true)}
                >
                    {thumbnail && <img className="link-embed-video-thumbnail" src={thumbnail} alt="" draggable={false} />}
                    <span className="link-embed-video-play" aria-hidden="true" />
                </button>
            </div>
        );
    }

    // The `origin` param is only valid for a real web origin. On desktop the
    // renderer is served from `trilium-app://app`, which YouTube's player
    // rejects ("video player configuration error"), so omit it there.
    const webOrigin = window.location.protocol.startsWith("http") ? window.location.origin : null;
    // autoplay: the click on the facade *was* the play command; without it the user would have to
    // press play a second time, inside YouTube's own player.
    const embedSrc = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&autoplay=1${webOrigin ? `&origin=${encodeURIComponent(webOrigin)}` : ""}`;

    return (
        <div className="link-embed-video">
            <iframe
                src={embedSrc}
                frameBorder="0"
                allowFullScreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
            />
        </div>
    );
}

function EmbedPreview({ meta, editable }: { meta: EmbedMetadata; editable?: boolean }) {
    // Only show the YouTube player when embedType is not explicitly
    // set to 'opengraph' (Card mode). This lets the user choose between
    // an embedded player and a static card preview for YouTube links.
    const videoId = meta.embedType !== "opengraph"
        ? extractYouTubeVideoId(meta.url)
        : null;

    if (videoId) {
        return <VideoEmbed meta={meta} videoId={videoId} />;
    }

    // In editing mode, omit target="_blank" so Trilium's global link handler
    // (link.ts goToLinkExt) treats the <a> as inside [contenteditable] and
    // only opens it on double-click or Ctrl+click.
    const target = editable ? undefined : "_blank";

    return (
        <a className="link-embed-card" href={safeLinkPreviewHref(meta.url)} target={target} rel="noopener noreferrer">
            <div className="link-embed-card-image-wrapper">
                <CardImage src={meta.image} />
            </div>
            <div className="link-embed-card-content">
                {meta.title && <div className="link-embed-card-title">{meta.title}</div>}
                {meta.description && <div className="link-embed-card-description">{meta.description}</div>}
                <div className="link-embed-card-url">
                    {/* The same favicon the inline mention shows, read from the metadata already
                        stored on the element. */}
                    <Favicon src={meta.favicon} />
                    <span>{meta.siteName || safeHostname(meta.url)}</span>
                </div>
            </div>
        </a>
    );
}

function MentionPreview({ meta, editable }: { meta: { url: string; title?: string; favicon?: string }; editable?: boolean }) {
    const target = editable ? undefined : "_blank";

    return (
        <a className="link-embed-mention" href={safeLinkPreviewHref(meta.url)} target={target} rel="noopener noreferrer">
            <Favicon src={meta.favicon} />
            <span className="link-embed-mention-title">{meta.title || safeHostname(meta.url)}</span>
        </a>
    );
}

// ---------------------------------------------------------------------------
// Imperative API — renders Preact components into DOM containers.
// ---------------------------------------------------------------------------

export function renderEmbedPreview(container: HTMLElement, meta: EmbedMetadata, editable?: boolean) {
    render(<EmbedPreview meta={meta} editable={editable} />, container);
}

export function renderMentionPreview(container: HTMLElement, meta: { url: string; title?: string; favicon?: string }, editable?: boolean) {
    render(<MentionPreview meta={meta} editable={editable} />, container);
}

/**
 * Processes all link embed and mention elements in a container, rendering
 * previews from their stored data attributes. Analogous to how
 * `link.loadReferenceLinkTitle` works for reference links.
 */
export function applyLinkEmbeds(container: HTMLElement) {
    for (const embed of container.querySelectorAll<HTMLElement>("section.link-embed")) {
        const url = embed.dataset.url;
        if (!url) continue;
        embed.innerHTML = "";
        renderEmbedPreview(embed, {
            url,
            embedType: embed.dataset.embedType || "opengraph",
            title: embed.dataset.title,
            description: embed.dataset.description,
            favicon: embed.dataset.favicon,
            siteName: embed.dataset.siteName,
            image: embed.dataset.image
        });
    }

    for (const mention of container.querySelectorAll<HTMLElement>("span.link-mention")) {
        const url = mention.dataset.url;
        if (!url) continue;
        mention.innerHTML = "";
        renderMentionPreview(mention, {
            url,
            title: mention.dataset.title,
            favicon: mention.dataset.favicon
        });
    }
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
