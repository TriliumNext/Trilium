import { DISPLAYABLE_LOCALE_IDS, LOCALES } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

vi.mock('../../../services/options.js', () => ({
    default: {
        get(name: string) {
            if (name === "allowedHtmlTags") return "[]";
            return undefined;
        },
        getJson: () => []
    }
}));

describe("CK config", () => {
    it("maps all languages correctly", async () => {
        const { buildConfig } = await import("./config.js");
        for (const locale of LOCALES) {
            if (locale.contentOnly || locale.devOnly) continue;

            const config = await buildConfig({
                uiLanguage: locale.id as DISPLAYABLE_LOCALE_IDS,
                contentLanguage: locale.id,
                forceGplLicense: false,
                isClassicEditor: false,
                templates: []
            });

            let expectedLocale = locale.id.substring(0, 2);
            if (expectedLocale === "cn") expectedLocale = "zh";
            if (expectedLocale === "tw") expectedLocale = "zh-tw";

            if (locale.id !== "en") {
                expect((config.language as any).ui).toMatch(new RegExp(`^${expectedLocale}`));
                expect(config.translations, locale.id).toBeDefined();
                expect(config.translations, locale.id).toHaveLength(2);
            }
        }
    }, 20_000);
});
