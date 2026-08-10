import { describe, expect, it } from "vitest";

import { PROVIDER_ICONS, providerIconUrl } from "./provider_icons.js";

describe("providerIconUrl", () => {
    it("resolves every provider type in the table to its own mark", () => {
        // Driven off the table rather than a hardcoded list, so a provider added
        // without a mark (or pointed at the wrong one) fails here.
        const urls = Object.entries(PROVIDER_ICONS);
        expect(urls.length).toBeGreaterThan(0);
        for (const [provider, url] of urls) {
            expect(providerIconUrl(provider)).toBe(url);
        }
    });

    it("falls back to the generic mark rather than returning nothing", () => {
        // A gap would misalign the row, so anything unrecognised still gets a glyph:
        // a provider added in a newer version, a config restored from one, or a
        // legacy config that never recorded a type at all.
        const generic = PROVIDER_ICONS["openai-compatible"];
        expect(providerIconUrl("some-provider-from-the-future")).toBe(generic);
        expect(providerIconUrl(undefined)).toBe(generic);
        expect(providerIconUrl("")).toBe(generic);
    });
});
