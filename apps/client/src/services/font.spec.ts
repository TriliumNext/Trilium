import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyFontsFromOptions, createFontStylesheetLink } from "./font.js";

function fontLinkHrefs() {
    return Array.from(document.head.querySelectorAll<HTMLLinkElement>("link[data-font-stylesheet]"))
        .map((link) => link.getAttribute("href"));
}

/** happy-dom does not fetch stylesheets, so emulate the pending links finishing loading. */
function fireLoadOnFontLinks() {
    for (const link of document.head.querySelectorAll<HTMLLinkElement>("link[data-font-stylesheet]")) {
        link.dispatchEvent(new Event("load"));
    }
}

// The fonts service keeps a monotonic cache-busting counter as module state, so the exact `?v=N`
// value carries across tests; assertions therefore check the shape and relative change, not the number.
const VERSIONED_HREF = /^api\/fonts\?v=\d+$/;

describe("font service", () => {
    beforeEach(() => {
        // Prevent happy-dom from actually fetching the stylesheet links (which would hit the network and
        // surface as an unhandled rejection); we only assert on the DOM, not on loaded styles.
        const happyDOM = (window as unknown as { happyDOM?: { settings: { disableCSSFileLoading: boolean } } }).happyDOM;
        if (happyDOM) {
            happyDOM.settings.disableCSSFileLoading = true;
        }
        document.head.innerHTML = "";
    });

    afterEach(() => {
        document.head.innerHTML = "";
    });

    it("creates a marked stylesheet link", () => {
        const link = createFontStylesheetLink();
        expect(link.rel).toBe("stylesheet");
        expect(link.hasAttribute("data-font-stylesheet")).toBe(true);
        expect(link.getAttribute("href")).toMatch(/^api\/fonts(\?v=\d+)?$/);
    });

    it("swaps in a fresh cache-busted stylesheet and removes the old one once it loads", () => {
        document.head.appendChild(createFontStylesheetLink());
        expect(fontLinkHrefs()).toHaveLength(1);

        applyFontsFromOptions();
        // New link added before the old one is removed.
        const afterApply = fontLinkHrefs();
        expect(afterApply).toHaveLength(2);
        expect(afterApply[1]).toMatch(VERSIONED_HREF);

        fireLoadOnFontLinks();
        expect(fontLinkHrefs()).toEqual([afterApply[1]]);
    });

    it("bumps the cache-busting param on every apply", () => {
        document.head.appendChild(createFontStylesheetLink());

        applyFontsFromOptions();
        fireLoadOnFontLinks();
        const first = fontLinkHrefs()[0];

        applyFontsFromOptions();
        fireLoadOnFontLinks();
        const second = fontLinkHrefs()[0];

        expect(first).toMatch(VERSIONED_HREF);
        expect(second).toMatch(VERSIONED_HREF);
        expect(second).not.toBe(first);
    });

    it("inserts the new link right after the previous one, preserving cascade position", () => {
        document.head.appendChild(createFontStylesheetLink());
        // A trailing stylesheet (e.g. style.css) must stay after the fonts stylesheet.
        const trailing = document.createElement("link");
        trailing.rel = "stylesheet";
        trailing.href = "style.css";
        document.head.appendChild(trailing);

        applyFontsFromOptions();
        fireLoadOnFontLinks();

        const hrefs = Array.from(document.head.querySelectorAll("link")).map((l) => l.getAttribute("href"));
        expect(hrefs).toHaveLength(2);
        expect(hrefs[0]).toMatch(VERSIONED_HREF);
        expect(hrefs[1]).toBe("style.css");
    });
});
