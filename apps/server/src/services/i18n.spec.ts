import { findDuplicateJsonKeys, LOCALES } from "@triliumnext/commons";
import { dayjs } from "@triliumnext/commons";
import { hidden_subtree, options } from "@triliumnext/core";
import { readFileSync } from "fs";
import i18next from "i18next";
import { join } from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { languages } = require("tesseract.js");
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    changeLanguage,
    getCurrentLocale,
    initializeTranslations,
    ordinal
} from "./i18n.js";
// i18n.ts uses the server-local sql_init wrapper (not core's), so the spy must
// target this same singleton for `isDbInitialized` to be intercepted.
import sqlInit from "./sql_init.js";

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

describe("i18n helpers", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("ordinal() formats a date as an ordinal day", () => {
        expect(ordinal(dayjs("2024-01-01"))).toBe("1st");
        expect(ordinal(dayjs("2024-01-22"))).toBe("22nd");
    });

    describe("getCurrentLocale()", () => {
        it("returns the locale matching the stored option", () => {
            vi.spyOn(options, "getOptionOrNull").mockReturnValue("en");
            expect(getCurrentLocale().id).toBe("en");
        });

        it("falls back to English when no option is set", () => {
            vi.spyOn(options, "getOptionOrNull").mockReturnValue(null);
            expect(getCurrentLocale().id).toBe("en");
        });

        it("falls back to English when the stored locale is unknown", () => {
            vi.spyOn(options, "getOptionOrNull").mockReturnValue("xx-unknown");
            expect(getCurrentLocale().id).toBe("en");
        });
    });

    describe("initializeTranslations() / getCurrentLanguage()", () => {
        // Stub i18next so the tests exercise only the language-resolution
        // branches, not the real fs-backend file loading (which hangs here).
        function stubI18next() {
            vi.spyOn(i18next, "use").mockReturnValue(i18next);
            return vi.spyOn(i18next, "init").mockResolvedValue((() => "") as never);
        }

        it("uses the DB locale option when the database is initialized", async () => {
            const initSpy = stubI18next();
            vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(true);
            const getOption = vi.spyOn(options, "getOptionOrNull").mockReturnValue("de");

            await initializeTranslations();

            expect(getOption).toHaveBeenCalledWith("locale");
            expect(initSpy).toHaveBeenCalledWith(expect.objectContaining({ lng: "de" }));
        });

        it("falls back to English when the DB is uninitialized", async () => {
            const initSpy = stubI18next();
            vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            vi.spyOn(console, "info").mockImplementation(() => {});

            await initializeTranslations();

            expect(initSpy).toHaveBeenCalledWith(expect.objectContaining({ lng: "en" }));
        });

        it("falls back to English when the locale option is empty", async () => {
            const initSpy = stubI18next();
            vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(true);
            vi.spyOn(options, "getOptionOrNull").mockReturnValue(null);
            vi.spyOn(console, "info").mockImplementation(() => {});

            await initializeTranslations();

            expect(initSpy).toHaveBeenCalledWith(expect.objectContaining({ lng: "en" }));
        });
    });

    it("changeLanguage() switches i18next and restores hidden subtree names", async () => {
        const changeSpy = vi.spyOn(i18next, "changeLanguage").mockResolvedValue((() => "") as never);
        const subtreeSpy = vi.spyOn(hidden_subtree, "checkHiddenSubtree").mockImplementation(() => {});

        await changeLanguage("en");

        expect(changeSpy).toHaveBeenCalledWith("en");
        expect(subtreeSpy).toHaveBeenCalledWith(true, { restoreNames: true });
    });
});
