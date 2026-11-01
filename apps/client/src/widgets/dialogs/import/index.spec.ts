import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { importProviders } from "./index.js";

describe("importProviders", () => {
    it("names only marks the brand icon pack has a glyph for", () => {
        const manifestPath = path.join(__dirname,
            "../../../../../../packages/trilium-core/src/services/icon_pack_brands.json");
        const { icons } = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
            icons: Record<string, unknown>;
        };
        const brandClasses = importProviders
            .filter(({ icon }) => icon.startsWith("tn-brand "))
            .map(({ icon }) => icon.slice("tn-brand ".length));
        expect(brandClasses).toHaveLength(importProviders.length - 1);
        expect(brandClasses.filter((name) => !icons[name])).toStrictEqual([]);
    });
});
