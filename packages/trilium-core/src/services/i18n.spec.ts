import { dayjs, LOCALES } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as cls from "./context.js";
import hidden_subtree from "./hidden_subtree.js";
import { changeLanguage, getCurrentLocale, initTranslations, ordinal } from "./i18n.js";
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
