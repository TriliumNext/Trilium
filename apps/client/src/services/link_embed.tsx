import "../widgets/type_widgets/text/LinkEmbed.css";

import { type LinkEmbedMetadata, YOUTUBE_REGEX, extractYouTubeVideoId, safeLinkPreviewHref } from "@triliumnext/commons";
import { render } from "preact";
import { useState } from "preact/hooks";

import { t } from "./i18n.js";
import server from "./server.js";

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

export function safeHostname(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
}

/**
 * Fetches link metadata from the server. Called once at link creation time.
 * The returned metadata is then stored in the note's HTML as data attributes.
 */
export async function fetchMetadata(url: string): Promise<EmbedMetadata> {
    try {
        // POSTed rather than passed in the query string: a URL can carry a one-time token or a
        // signed signature, and a query string ends up in every access log along the way.
        const metadata = await server.post<LinkEmbedMetadata>("link-embed/metadata", { url });
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
        return {
            url,
            embedType: detectEmbedType(url),
            title: safeHostname(url),
            unresolved: true
        };
    }
}

// ---------------------------------------------------------------------------
// Preact components — render previews from stored metadata, no network requests.
// Used by the CKEditor editing downcast (via component interface), the
// read-only text renderer, and postProcessRichContent (tooltips, included
// notes, markdown preview).
// ---------------------------------------------------------------------------

function Favicon({ src }: { src?: string }) {
    const [failed, setFailed] = useState(false);

    if (!src || failed) {
        return <span className="link-embed-mention-dot" />;
    }

    return (
        <img
            className="link-embed-mention-favicon"
            src={src}
            width={16}
            height={16}
            onError={() => setFailed(true)}
        />
    );
}

function ImagePlaceholder() {
    return <div className="link-embed-card-image-placeholder">&#128279;</div>;
}

function CardImage({ src }: { src?: string }) {
    const [failed, setFailed] = useState(false);

    if (!src || failed) {
        return <ImagePlaceholder />;
    }

    return (
        <img
            className="link-embed-card-image"
            src={src}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
        />
    );
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
                    {meta.image && <img className="link-embed-video-thumbnail" src={meta.image} alt="" />}
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
                    {/* The same favicon the inline mention shows, read from the metadata already stored
                        on the element — the data URI is not duplicated. */}
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
    detectEmbedType,
    safeHostname,
    renderEmbedPreview,
    renderMentionPreview,
    applyLinkEmbeds
};
