import {
    classifyFaviconContrast, type FaviconContrast, faviconContrastClass, measureFaviconVisibility
} from "./favicon_contrast.js";
import { isHttpUrl } from "./link_embed.js";
import { LINK_EMBED_CARD_IMAGE_PLACEHOLDER } from "./link_embed_markup.js";

/**
 * Makes the link previews in `container`, as `renderLinkEmbedHtml()` and `renderLinkMentionHtml()`
 * draw them, behave: a video or audio facade loads the player on click, a low-resolution YouTube
 * thumbnail is marked for blurring, a picture that fails to load is replaced by a placeholder or
 * removed, and a favicon gets the class that lets the page correct an icon drawn for the other
 * background.
 */
export function enhanceLinkPreviews(container: ParentNode) {
    const facades = container.querySelectorAll<HTMLButtonElement>(
        "button.link-embed-video-facade[data-video-id]");
    for (const facade of facades) {
        facade.addEventListener("click", () => playVideo(facade), { once: true });
    }

    const mediaFacades = container.querySelectorAll<HTMLButtonElement>(
        ":is(button.link-embed-video-facade, button.link-embed-audio-facade)[data-media-url]");
    for (const facade of mediaFacades) {
        facade.addEventListener("click", () => playMediaFile(facade), { once: true });
    }

    const thumbnails = container.querySelectorAll<HTMLImageElement>(
        "button[data-video-id] img.link-embed-video-thumbnail");
    for (const thumbnail of thumbnails) {
        // Checked now for a picture that is already loaded, and again on every load.
        markLowResThumbnail(thumbnail);
        thumbnail.addEventListener("load", () => markLowResThumbnail(thumbnail));
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
 * Loads the YouTube player under a video facade, which fades out once the player has loaded. The
 * player takes the focus of the facade. The click was the play command, hence `autoplay=1`.
 * `origin` is valid only for a web origin: YouTube rejects the desktop app's `trilium-app://` one.
 */
function playVideo(facade: HTMLButtonElement) {
    // Safari and Firefox on macOS leave a clicked button unfocused.
    facade.focus({ preventScroll: true });
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
    iframe.addEventListener("load", () => {
        // Keeps the focus in the player, as removing the focused facade drops it to the page.
        if (facade.matches(":focus")) {
            iframe.focus();
        }
        revealPlayer(facade);
    }, { once: true });
    facade.classList.add("link-embed-video-facade-loading");
    facade.before(iframe);
}

/**
 * Replaces the facade of a video or audio file with a `<video>` or `<audio>` that plays it, with the
 * thumbnail of the facade as its poster. The click was the play command, hence `autoplay`.
 */
function playMediaFile(facade: HTMLButtonElement) {
    const url = facade.dataset.mediaUrl;
    if (!url || !isHttpUrl(url)) {
        return;
    }

    const isAudio = facade.classList.contains("link-embed-audio-facade");
    const player = document.createElement(isAudio ? "audio" : "video");
    player.className = isAudio ? "link-embed-audio-player" : "link-embed-video-player";
    player.controls = true;
    player.autoplay = true;
    if (player instanceof HTMLVideoElement) {
        player.playsInline = true;
        const poster = facade.querySelector<HTMLImageElement>("img.link-embed-video-thumbnail");
        if (poster) {
            player.poster = poster.src;
        }
    }
    player.src = url;
    const hasFocus = facade.matches(":focus");
    facade.replaceWith(player);
    if (hasFocus) {
        player.focus({ preventScroll: true });
    }
}

/** How long a video facade takes to fade out over the player, in milliseconds. */
const FACADE_FADE_DURATION = 300;

/** Fades out `facade` over the player loaded under it, then removes it. */
function revealPlayer(facade: HTMLButtonElement) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        facade.remove();
        return;
    }

    const fade = facade.animate(
        { opacity: [ 1, 0 ] },
        { duration: FACADE_FADE_DURATION, easing: "ease-out", fill: "forwards" }
    );
    fade.addEventListener("finish", () => facade.remove(), { once: true });
}

/**
 * Video thumbnails narrower than this are blurred. It matches YouTube's `hqdefault`, the smallest
 * thumbnail `downloadYouTubeThumbnail()` in core keeps.
 */
const MIN_VIDEO_THUMBNAIL_WIDTH = 480;

/** Sets the class the stylesheets blur a video thumbnail with, from its loaded width. */
function markLowResThumbnail(thumbnail: HTMLImageElement) {
    const width = thumbnail.naturalWidth;
    thumbnail.classList.toggle("link-embed-video-thumbnail-lowres",
        width > 0 && width < MIN_VIDEO_THUMBNAIL_WIDTH);
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
