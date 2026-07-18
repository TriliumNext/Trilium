/** Marks the server-generated fonts stylesheet so it can be replaced when a font option changes. */
const FONT_STYLESHEET_ATTR = "data-font-stylesheet";

let version = 0;

/** Creates the (marked) fonts stylesheet link. Used both at boot and when re-applying fonts live. */
export function createFontStylesheetLink(): HTMLLinkElement {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    // A bumped query param busts the browser cache so the server regenerates the CSS from the latest options.
    link.href = version === 0 ? "api/fonts" : `api/fonts?v=${version}`;
    link.setAttribute(FONT_STYLESHEET_ATTR, "true");
    return link;
}

/**
 * Re-fetches the server-generated fonts stylesheet and swaps it in without reloading. The server returns an empty
 * stylesheet when font overrides are disabled, so this also correctly reverts to the theme defaults. The previous
 * stylesheet is removed only once the new one has loaded, keeping the swap free of a flash of unstyled content.
 */
export function applyFontsFromOptions() {
    version++;

    const oldLinks = Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[${FONT_STYLESHEET_ATTR}]`));
    const newLink = createFontStylesheetLink();

    const anchor = oldLinks.at(-1);
    if (anchor) {
        anchor.after(newLink);
    } else {
        document.head.appendChild(newLink);
    }

    newLink.addEventListener("load", () => {
        for (const oldLink of oldLinks) {
            oldLink.remove();
        }
    }, { once: true });
    // If the new stylesheet fails to load, keep the previous one rather than dropping fonts entirely.
    newLink.addEventListener("error", () => newLink.remove(), { once: true });
}
