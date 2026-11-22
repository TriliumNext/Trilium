/**
 * The stylesheet that places the character of every icon, about a megabyte with many icon packs.
 * `index.ts` loads it without blocking the first render: the fonts and the rule that draws each
 * pack's prefix come inline with `/bootstrap`, so the layout lays out its icons at their size and
 * the characters fill in as the stylesheet applies.
 *
 * Kept free of imports: `index.ts` loads it before `setupGlob()` populates `window.glob`.
 */

let loaded: Promise<void> = Promise.resolve();

/**
 * Appends the glyph stylesheet at `href`. A stylesheet inserted by a script does not block
 * rendering, so the page draws without waiting for it.
 */
export function loadIconPackGlyphs(href: string) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    loaded = new Promise((resolve) => {
        // A failed load leaves the icons empty, which is no reason to hold anything up.
        link.addEventListener("load", () => resolve(), { once: true });
        link.addEventListener("error", () => resolve(), { once: true });
    });
    document.head.appendChild(link);
    return loaded;
}

/**
 * Resolves once the icons have their characters, for code that reads them from the computed style
 * rather than drawing them through the stylesheet.
 */
export function whenIconPackGlyphsLoaded() {
    return loaded;
}
