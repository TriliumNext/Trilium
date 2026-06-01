import { DISPLAYABLE_LOCALE_IDS, LOCALES } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

vi.mock('../../../services/options.js', () => ({
    default: {
        get(name: string) {
            if (name === "allowedHtmlTags") return "[]";
            return undefined;
        },
        getJson: (name: string) => {
            if (name === "codeNotesMimeTypes") {
                return ["text/javascript", "application/javascript;env=frontend", "application/javascript;env=backend", "text/css"];
            }
            return [];
        }
    }
}));

// buildConfig reads the `_taskStates` hidden subtree via Froca; stub it out
// since this test only covers language mapping.
vi.mock('../../../services/task_states.js', () => ({
    getTaskStateDefinitions: async () => [],
    openCustomTaskStateConfig: () => {}
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

            if (locale.id !== "en" && locale.id !== "ga") {
                expect((config.language as any).ui).toMatch(new RegExp(`^${expectedLocale}`));
                expect(config.translations, locale.id).toBeDefined();
                expect(config.translations, locale.id).toHaveLength(2);
            }
        }
    }, 20_000);

    it("excludes Trilium frontend/backend script JS variants from code-block languages", async () => {
        const { buildConfig } = await import("./config.js");
        const config = await buildConfig({
            uiLanguage: "en",
            contentLanguage: "en",
            forceGplLicense: false,
            isClassicEditor: false,
            templates: []
        });

        const languages = (config.codeBlock?.languages ?? []).map((l) => l.language);
        // Plain JavaScript (and other code languages) remain selectable.
        expect(languages).toContain("text-javascript");
        expect(languages).toContain("text-css");
        // The script-environment variants are meaningless in a display-only code block.
        expect(languages).not.toContain("application-javascript-env-frontend");
        expect(languages).not.toContain("application-javascript-env-backend");
    });
});
