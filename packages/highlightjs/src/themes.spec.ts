import themeDefinitions, { getThemeVariant } from "./themes.js";
import { describe, expect, it } from "vitest";

describe("Themes", () => {
    it("all IDs don't contain spaces", () => {
        for (const id of Object.keys(themeDefinitions)) {
            expect(id).not.toMatch(/\s/);
        }
    });

    // Each entry lazily imports a stylesheet by path. Invoking every loader proves they all resolve
    // and hand back the `{ default }` shape loadTheme expects. Note the CSS text itself cannot be
    // asserted here: Vitest resolves `?raw` CSS to an empty string, so only the shape is checked.
    // A mistyped path is caught even earlier — Vite fails to transform themes.ts at all.
    it("every theme loader resolves to a stylesheet module", async () => {
        const entries = Object.entries(themeDefinitions);
        expect(entries.length).toBeGreaterThan(0);

        const loaded = await Promise.all(
            entries.map(async ([id, theme]) => [id, (await theme.load()).default] as const)
        );

        for (const [id, css] of loaded) {
            expect(typeof css, id).toBe("string");
        }
    });

    it("derives the variant from the display name", () => {
        // Stringly-typed on purpose: the name carries "(Dark)"/"(Light)" and nothing else does.
        expect(getThemeVariant({ name: "Atom One (Dark)", load: themeDefinitions["xt256"].load })).toBe("dark");
        expect(getThemeVariant({ name: "Xcode (Light)", load: themeDefinitions["xcode"].load })).toBe("light");
    });
});
