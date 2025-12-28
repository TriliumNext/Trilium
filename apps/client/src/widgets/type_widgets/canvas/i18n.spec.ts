import { LOCALES } from "@triliumnext/commons";
import { readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { LANGUAGE_MAPPINGS } from "./i18n.js";

const localeDir = join(__dirname, "../../../../../../node_modules/@excalidraw/excalidraw/dist/prod/locales");

describe("Canvas i18n", () => {
    it("all languages are mapped correctly", () => {
        // Read the node_modules dir to obtain all the supported locales.
        const supportedLanguageCodes = new Set<string>();
        for (const file of readdirSync(localeDir)) {
            if (file.startsWith("percentages")) continue;
            const match = file.match("^[a-z]{2,3}(?:-[A-Z]{2,3})?");
            if (!match) continue;
            supportedLanguageCodes.add(match[0]);
        }

        // Cross-check the locales.
        for (const locale of LOCALES) {
            if (locale.contentOnly || locale.devOnly) continue;
            const languageCode = LANGUAGE_MAPPINGS[locale.id];
            if (!supportedLanguageCodes.has(languageCode)) {
                console.log("Supported locales:", Array.from(supportedLanguageCodes.values()).join(", "));
                expect.fail(`Unable to find locale for ${locale.id} -> ${languageCode}.`)
            }
        }
    });
});
