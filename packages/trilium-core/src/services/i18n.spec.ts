import { dayjs, LOCALES } from "@triliumnext/commons";
import i18next from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as cls from "./context.js";
import hidden_subtree from "./hidden_subtree.js";
import { changeLanguage, getCurrentLocale, initTranslations, ordinal, reconcileLanguageAfterDbInit } from "./i18n.js";
import options from "./options.js";
import sql_init from "./sql_init.js";

describe("i18n service (core)", () => {
    afterEach(() => vi.restoreAllMocks());

    it("ordinal formats a date with its ordinal day", () => {
        expect(typeof ordinal(dayjs("2024-03-21"))).toBe("string");
    });

    it("changeLanguage switches i18next and restores the hidden subtree names", async () => {
        const checkSpy = vi.spyOn(hidden_subtree, "checkHiddenSubtree").mockImplementation(() => {});

        await changeLanguage("en");

        expect(checkSpy).toHaveBeenCalledWith(true, { restoreNames: true });
    });

    it("getCurrentLocale resolves the option, falling back to English", () => {
        const valid = getCurrentLocale();
        expect(valid.id).toBeTruthy();
        expect(LOCALES).toContainEqual(valid);

        // Unknown locale id -> English fallback.
        const previous = options.getOption("locale");
        try {
            cls.init(() => options.setOption("locale", "zz-nonexistent"));
            expect(getCurrentLocale().id).toBe("en");
        } finally {
            cls.init(() => options.setOption("locale", previous));
        }
    });

    it("getCurrentLocale returns English when the DB is not initialized", () => {
        vi.spyOn(sql_init, "isDbInitialized").mockReturnValue(false);
        expect(getCurrentLocale().id).toBe("en");
    });

    describe("reconcileLanguageAfterDbInit", () => {
        it("restores i18next to the stored locale once the DB is initialized", async () => {
            const prevOpt = options.getOption("locale");
            const prevLang = i18next.language;
            try {
                // Simulate the boot state: `initTranslations` ran before `initSql`, so i18next is on "en"
                // even though the document's stored locale is German.
                await i18next.changeLanguage("en");
                cls.init(() => options.setOption("locale", "de"));

                await reconcileLanguageAfterDbInit();

                expect(i18next.language).toBe("de");
            } finally {
                cls.init(() => options.setOption("locale", prevOpt));
                await i18next.changeLanguage(prevLang);
            }
        });

        it("does not switch the language when the DB is not initialized", async () => {
            vi.spyOn(sql_init, "isDbInitialized").mockReturnValue(false);
            const changeSpy = vi.spyOn(i18next, "changeLanguage");

            await reconcileLanguageAfterDbInit();

            expect(changeSpy).not.toHaveBeenCalled();
        });

        it("does not switch the language when the stored locale already matches the active one", async () => {
            const prevOpt = options.getOption("locale");
            const prevLang = i18next.language;
            try {
                await i18next.changeLanguage("en");
                cls.init(() => options.setOption("locale", "en"));
                const changeSpy = vi.spyOn(i18next, "changeLanguage");

                await reconcileLanguageAfterDbInit();

                expect(changeSpy).not.toHaveBeenCalled();
            } finally {
                cls.init(() => options.setOption("locale", prevOpt));
                await i18next.changeLanguage(prevLang);
            }
        });

        it("does not switch the language when the stored locale is invalid or non-displayable", async () => {
            const prevOpt = options.getOption("locale");
            const prevLang = i18next.language;
            try {
                await i18next.changeLanguage("en");
                cls.init(() => options.setOption("locale", "zz-invalid"));
                const changeSpy = vi.spyOn(i18next, "changeLanguage");

                await reconcileLanguageAfterDbInit();

                expect(changeSpy).not.toHaveBeenCalled();
            } finally {
                cls.init(() => options.setOption("locale", prevOpt));
                await i18next.changeLanguage(prevLang);
            }
        });
    });

    it("initTranslations logs a fallback when the locale option is empty", async () => {
        const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
        const previous = options.getOption("locale");
        try {
            cls.init(() => options.setOption("locale", ""));
            await initTranslations(async () => {});
            expect(infoSpy).toHaveBeenCalled();
        } finally {
            cls.init(() => options.setOption("locale", previous));
        }
    });
});
