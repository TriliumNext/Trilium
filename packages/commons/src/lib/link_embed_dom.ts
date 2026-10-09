import {
    classifyFaviconContrast, type FaviconContrast, faviconContrastClass, measureFaviconVisibility
} from "./favicon_contrast.js";
import { LINK_EMBED_CARD_IMAGE_PLACEHOLDER } from "./link_embed_markup.js";

/**
 * Makes the link previews in `container`, as `renderLinkEmbedHtml()` and `renderLinkMentionHtml()`
 * draw them, behave: a video facade loads the player on click, a picture that fails to load gives
 * way to what stands in for a missing one, and a favicon gets the class that lets the page correct
 * an icon drawn for the other background.
 */
export function enhanceLinkPreviews(container: ParentNode) {
    const facades = container.querySelectorAll<HTMLButtonElement>(
        "button.link-embed-video-facade[data-video-id]");
    for (const facade of facades) {
        facade.addEventListener("click", () => playVideo(facade), { once: true });
    }

    // An attachment can be erased under a preview that still references it, and a broken-image
    // glyph reads as a bug where an absence reads as an absence.
    for (const image of container.querySelectorAll<HTMLImageElement>("img.link-embed-card-image")) {
        image.addEventListener("error", () => {
            image.outerHTML = LINK_EMBED_CARD_IMAGE_PLACEHOLDER;
        }, { once: true });
    }

    const favicons = container.querySelectorAll<HTMLImageElement>("img.link-embed-mention-favicon");
    for (const favicon of favicons) {
        favicon.addEventListener("error", () => favicon.remove(), { once: true });
        void applyFaviconContrast(favicon);
    }
}

/**
 * Replaces a video facade with the YouTube player. The click was the play command, hence
 * `autoplay=1`. `origin` is valid only for a web origin: YouTube rejects the desktop app's
 * `trilium-app://` one.
 */
function playVideo(facade: HTMLButtonElement) {
    const videoId = encodeURIComponent(String(facade.dataset.videoId));
    const origin = location.protocol.startsWith("http")
        ? `&origin=${encodeURIComponent(location.origin)}`
        : "";

    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&autoplay=1${origin}`;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; "
        + "picture-in-picture; web-share";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allowFullscreen = true;
    iframe.setAttribute("frameborder", "0");
    facade.replaceWith(iframe);
}

/**
 * Measurements by icon URL, so a page that links one site twenty times measures its icon once.
 * Never invalidated: the verdict depends on the icon's pixels, not on the theme, which is why it
 * travels as a class the stylesheet acts on.
 */
const faviconContrasts = new Map<string, Promise<FaviconContrast>>();

async function applyFaviconContrast(favicon: HTMLImageElement) {
    let contrast = faviconContrasts.get(favicon.src);
    if (!contrast) {
        contrast = measureFaviconContrast(favicon.src);
        faviconContrasts.set(favicon.src, contrast);
    }

    const contrastClass = faviconContrastClass(await contrast);
    if (contrastClass) {
        favicon.classList.add(contrastClass);
    }
}

/**
 * Loads the icon into an image of its own and measures that, so the answer does not depend on when
 * the preview's `<img>` loads or whether it is on screen. The browser has the picture cached.
 * Never rejects: an icon that cannot be read is left alone.
 */
function measureFaviconContrast(src: string) {
    return new Promise<FaviconContrast>((resolve) => {
        const image = new Image();
        image.addEventListener("load", () => {
            const visibility = measureFaviconVisibility(image);
            resolve(visibility ? classifyFaviconContrast(visibility) : "neutral");
        }, { once: true });
        image.addEventListener("error", () => resolve("neutral"), { once: true });
        image.src = src;
    });
}
