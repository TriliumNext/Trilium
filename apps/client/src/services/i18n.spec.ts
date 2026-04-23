import { findDuplicateJsonKeys, LOCALES } from "@triliumnext/commons";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("i18n", () => {
    it("translations are valid JSON with no duplicate keys", () => {
        for (const locale of LOCALES) {
            if (locale.contentOnly || locale.id === "en_rtl") {
                continue;
            }

            const translationPath = join(__dirname, "..", "translations", locale.id, "translation.json");
            const translationFile = readFileSync(translationPath, { encoding: "utf-8" });
            expect(() => JSON.parse(translationFile), `JSON error while parsing locale '${locale.id}' at "${translationPath}"`)
                .not.toThrow();

            const duplicates = findDuplicateJsonKeys(translationFile);
            expect(
                duplicates,
                `Duplicate keys in locale '${locale.id}' at "${translationPath}":\n${ 
                    duplicates.map((d) => `  - "${d.key}" (line ${d.line})`).join("\n")}`
            ).toEqual([]);
        }
    });
});
