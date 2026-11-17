import { afterEach, describe, expect, it } from "vitest";

import { loadIconPackGlyphs, whenIconPackGlyphsLoaded } from "./icon_pack_glyphs";

describe("loadIconPackGlyphs", () => {
    afterEach(() => {
        for (const link of document.head.querySelectorAll("link[rel=stylesheet]")) {
            link.remove();
        }
    });

    it("appends the stylesheet, and settles once it loads or fails", async () => {
        const loading = loadIconPackGlyphs("api/icon-packs.css?v=1");
        expect(document.head.querySelector("link[rel=stylesheet]")?.getAttribute("href"))
            .toBe("api/icon-packs.css?v=1");
        expect(whenIconPackGlyphsLoaded()).toBe(loading);

        // happy-dom loads no stylesheet and reports an error, which the icons wait out like a load.
        await expect(whenIconPackGlyphsLoaded()).resolves.toBeUndefined();
    });
});
