import "../widgets/type_widgets/text/LinkEmbed.css";

import { type LinkEmbedMetadata, YOUTUBE_REGEX, extractYouTubeVideoId } from "@triliumnext/commons";
import { render } from "preact";
import { useState } from "preact/hooks";

import server from "./server.js";

/** Paste mode chosen by user from the floating popup. */
export type LinkPasteMode = "mention" | "url" | "embed";

export interface EmbedMetadata {
    url: string;
    embedType: string;
    title?: string;
    description?: string;
    favicon?: string;
    siteName?: string;
    image?: string;
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
        const metadata = await server.get<LinkEmbedMetadata>(`link-embed/metadata?url=${encodeURIComponent(url)}`);
        return {
            url: metadata.url,
            embedType: metadata.embedType,
            title: metadata.title,
            description: metadata.description,
            favicon: metadata.favicon,
            siteName: metadata.siteName,
            image: metadata.image
        };
    } catch {
        return {
            url,
            embedType: detectEmbedType(url),
            title: safeHostname(url)
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

function EmbedPreview({ meta, editable }: { meta: EmbedMetadata; editable?: boolean }) {
    // Only show the YouTube iframe embed when embedType is not explicitly
    // set to 'opengraph' (Card mode). This lets the user choose between
    // an embedded player and a static card preview for YouTube links.
    const videoId = meta.embedType !== "opengraph"
        ? extractYouTubeVideoId(meta.url)
        : null;

    if (videoId) {
        // The `origin` param is only valid for a real web origin. On desktop the
        // renderer is served from `trilium-app://app`, which YouTube's player
        // rejects ("video player configuration error"), so omit it there.
        const webOrigin = window.location.protocol.startsWith("http") ? window.location.origin : null;
        const embedSrc = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0${webOrigin ? `&origin=${encodeURIComponent(webOrigin)}` : ""}`;
        return (
            <div className="link-embed-video">
                <iframe
                    src={embedSrc}
                    frameBorder="0"
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    loading="lazy"
                />
            </div>
        );
    }

    // In editing mode, omit target="_blank" so Trilium's global link handler
    // (link.ts goToLinkExt) treats the <a> as inside [contenteditable] and
    // only opens it on double-click or Ctrl+click.
    const target = editable ? undefined : "_blank";

    return (
        <a className="link-embed-card" href={meta.url} target={target} rel="noopener noreferrer">
            <div className="link-embed-card-image-wrapper">
                <CardImage src={meta.image} />
            </div>
            <div className="link-embed-card-content">
                {meta.title && <div className="link-embed-card-title">{meta.title}</div>}
                {meta.description && <div className="link-embed-card-description">{meta.description}</div>}
                <div className="link-embed-card-url">{meta.siteName || safeHostname(meta.url)}</div>
            </div>
        </a>
    );
}

function MentionPreview({ meta, editable }: { meta: { url: string; title?: string; favicon?: string }; editable?: boolean }) {
    const target = editable ? undefined : "_blank";

    return (
        <a className="link-embed-mention" href={meta.url} target={target} rel="noopener noreferrer">
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
