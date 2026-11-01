import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { PROVIDER_ICONS, providerIcon } from "./provider_icons.js";

describe("providerIcon", () => {
    it("resolves every provider type in the table to its own mark", () => {
        // Driven off the table rather than a hardcoded list, so a provider added
        // without a mark (or pointed at the wrong one) fails here.
        const icons = Object.entries(PROVIDER_ICONS);
        expect(icons.length).toBeGreaterThan(0);
        for (const [ provider, icon ] of icons) {
            expect(providerIcon(provider)).toBe(icon);
        }
    });

    it("names only marks the brand icon pack has a glyph for", () => {
        const manifestPath = path.join(__dirname,
            "../../../../../../../packages/trilium-core/src/services/icon_pack_brands.json");
        const { icons } = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
            icons: Record<string, unknown>;
        };
        const brandClasses = Object.values(PROVIDER_ICONS)
            .filter((icon) => icon.startsWith("tn-brand "))
            .map((icon) => icon.slice("tn-brand ".length));
        expect(brandClasses.length).toBeGreaterThan(0);
        expect(brandClasses.filter((name) => !icons[name])).toStrictEqual([]);
    });

    it("falls back to the generic mark rather than returning nothing", () => {
        // A gap would misalign the row, so anything unrecognised still gets a glyph:
        // a provider added in a newer version, a config restored from one, or a
        // legacy config that never recorded a type at all.
        const generic = PROVIDER_ICONS["openai-compatible"];
        expect(providerIcon("some-provider-from-the-future")).toBe(generic);
        expect(providerIcon(undefined)).toBe(generic);
        expect(providerIcon("")).toBe(generic);
    });
});
