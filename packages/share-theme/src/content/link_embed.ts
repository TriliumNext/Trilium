import {
    classifyFaviconContrast,
    faviconContrastClass,
    measureFaviconVisibility
} from "@triliumnext/commons/src/lib/favicon_contrast.js";
import "./link_embed.css";

export default function setupLinkEmbeds() {
    setupVideoFacades();
    setupFaviconContrast();
}

/**
 * Click-to-play for the link-preview video embeds.
 *
 * The shared page ships only the thumbnail stored in the note (see the share content renderer), so
 * reading a page that contains a video does not tell YouTube that the visitor read it. The player is
 * loaded here, on the visitor's own click — which doubles as the play command, hence `autoplay=1`.
 */
function setupVideoFacades() {
    const facades = document.querySelectorAll<HTMLButtonElement>(".link-embed-video-facade[data-video-id]");

    for (const facade of facades) {
        facade.addEventListener("click", () => {
            const videoId = facade.dataset.videoId;
            const container = facade.parentElement;
            if (!videoId || !container) {
                return;
            }

            const iframe = document.createElement("iframe");
            iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0&autoplay=1`;
            iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
            iframe.referrerPolicy = "strict-origin-when-cross-origin";
            iframe.allowFullscreen = true;

            container.replaceChildren(iframe);
        });
    }
}

/**
 * Corrects link-preview favicons that would be invisible against the page.
 *
 * A site draws its icon for one background, usually its own: GitHub's is a black octocat on nothing,
 * which disappears on the dark theme, and a mark drawn white for a dark header disappears on the
 * light one. Each icon's own pixels are measured (the shared logic lives in commons, so the app and
 * the shared page reach the same verdict about the same picture) and the answer is left on the
 * element as a class for `link_embed.css` to act on — which is what lets the visitor's theme switch
 * correct the icons with nothing measured again.
 */
function setupFaviconContrast() {
    for (const favicon of document.querySelectorAll<HTMLImageElement>("img.link-embed-mention-favicon")) {
        // A picture already in the browser's cache is complete before this runs and will never fire
        // `load`; one still arriving has to be waited for.
        if (favicon.complete) {
            classifyFavicon(favicon);
        } else {
            favicon.addEventListener("load", () => classifyFavicon(favicon), { once: true });
        }
    }
}

function classifyFavicon(favicon: HTMLImageElement) {
    const visibility = measureFaviconVisibility(favicon);
    if (!visibility) {
        return;
    }

    const contrastClass = faviconContrastClass(classifyFaviconContrast(visibility));
    if (contrastClass) {
        favicon.classList.add(contrastClass);
    }
}
