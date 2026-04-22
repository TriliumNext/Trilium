import { findDuplicateJsonKeys, LOCALES } from "@triliumnext/commons";
import { readFileSync } from "fs";
import { join } from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { languages } = require("tesseract.js");
import { describe, expect, it } from "vitest";

describe("i18n", () => {
    it("translations are valid JSON with no duplicate keys", () => {
        for (const locale of LOCALES) {
            if (locale.contentOnly || locale.id === "en_rtl") {
                continue;
            }

            const translationPath = join(__dirname, "..", "assets", "translations", locale.id, "server.json");
            const translationFile = readFileSync(translationPath, { encoding: "utf-8" });
            expect(() => JSON.parse(translationFile), `JSON error while parsing locale '${locale.id}' at "${translationPath}"`)
                .not.toThrow();

            const duplicates = findDuplicateJsonKeys(translationFile);
            expect(
                duplicates,
                `Duplicate keys in locale '${locale.id}' at "${translationPath}":\n` +
                    duplicates.map((d) => `  - "${d.key}" (line ${d.line})`).join("\n")
            ).toEqual([]);
        }
    });

    it("all tesseractCode values are supported by Tesseract.js", () => {
        const supportedCodes = new Set(Object.keys(languages).map((k) => k.toLowerCase()));

        for (const locale of LOCALES) {
            if (!locale.tesseractCode) {
                continue;
            }

            expect(supportedCodes, `Locale '${locale.id}' has unsupported tesseractCode '${locale.tesseractCode}'`)
                .toContain(locale.tesseractCode);
        }
    });
});
