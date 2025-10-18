import { LOCALES } from "@triliumnext/commons";
import { readFileSync } from "fs";
import { join } from "path";
import { DAYJS_LOADER } from "./i18n";

describe("i18n", () => {
    it("translations are valid JSON", () => {
        for (const locale of LOCALES) {
            if (locale.contentOnly || locale.id === "en_rtl") {
                continue;
            }

            const translationPath = join(__dirname, "..", "assets", "translations", locale.id, "server.json");
            const translationFile = readFileSync(translationPath, { encoding: "utf-8" });
            expect(() => JSON.parse(translationFile), `JSON error while parsing locale '${locale.id}' at "${translationPath}"`)
                .not.toThrow();
        }
    });

    it("all dayjs locales are valid", async () => {
        for (const locale of LOCALES) {
            const dayjsLoader = DAYJS_LOADER[locale.id];
            expect(dayjsLoader, `Locale ${locale.id} missing.`).toBeDefined();

            await dayjsLoader();
        }
    });
});
