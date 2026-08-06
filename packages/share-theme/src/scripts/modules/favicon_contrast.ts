import { classifyFaviconContrast, faviconContrastClass, measureFaviconVisibility } from "@triliumnext/commons";

/**
 * Corrects link-preview favicons that would be invisible against the page.
 *
 * A site draws its icon for one background, usually its own: GitHub's is a black octocat on nothing,
 * which disappears on the dark theme, and a mark drawn white for a dark header disappears on the
 * light one. Each icon's own pixels are measured (the shared logic lives in commons, so the app and
 * the shared page reach the same verdict about the same picture) and the answer is left on the
 * element as a class for `link-embed.css` to act on — which is what lets the visitor's theme switch
 * correct the icons with nothing measured again.
 */
export default function setupFaviconContrast() {
    for (const favicon of document.querySelectorAll<HTMLImageElement>("img.link-embed-mention-favicon")) {
        // A picture already in the browser's cache is complete before this runs and will never fire
        // `load`; one still arriving has to be waited for.
        if (favicon.complete) {
            classify(favicon);
        } else {
            favicon.addEventListener("load", () => classify(favicon), { once: true });
        }
    }
}

function classify(favicon: HTMLImageElement) {
    const visibility = measureFaviconVisibility(favicon);
    if (!visibility) {
        return;
    }

    const contrastClass = faviconContrastClass(classifyFaviconContrast(visibility));
    if (contrastClass) {
        favicon.classList.add(contrastClass);
    }
}
