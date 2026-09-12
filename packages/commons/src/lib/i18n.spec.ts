import { describe, expect, it } from "vitest";

import { getEnglishName, getTesseractCode, isDisplayableLocale, LOCALES } from "./i18n.js";

describe("getTesseractCode", () => {
    it("returns the Tesseract code for a mapped locale", () => {
        expect(getTesseractCode("en")).toBe("eng");
        expect(getTesseractCode("de")).toBe("deu");
    });

    it("returns null for a found locale without a tesseractCode", () => {
        expect(getTesseractCode("en_rtl")).toBe(null);
    });

    it("returns null for an unknown locale", () => {
        expect(getTesseractCode("nonexistent-locale")).toBe(null);
    });
});

describe("LOCALES", () => {
    it("is a non-empty array sorted by name", () => {
        expect(Array.isArray(LOCALES)).toBe(true);
        expect(LOCALES.length).toBeGreaterThan(0);

        const names = LOCALES.map((l) => l.name);
        const sorted = [...names].sort((a, b) => a.localeCompare(b));
        expect(names).toEqual(sorted);
    });

    it("contains an entry with id \"en\"", () => {
        const en = LOCALES.find((l) => l.id === "en");
        expect(en).toBeDefined();
        expect(en?.name).toBe("English (United States)");
    });
});

describe("isDisplayableLocale", () => {
    it("accepts known display locales", () => {
        expect(isDisplayableLocale("en")).toBe(true);
        expect(isDisplayableLocale("de")).toBe(true);
    });

    it("rejects empty, null or undefined values", () => {
        expect(isDisplayableLocale("")).toBe(false);
        expect(isDisplayableLocale(null)).toBe(false);
        expect(isDisplayableLocale(undefined)).toBe(false);
    });

    it("rejects unknown locales", () => {
        expect(isDisplayableLocale("nonexistent-locale")).toBe(false);
    });

    it("rejects content-only locales (selectable for content, not as a UI language)", () => {
        const contentOnly = LOCALES.find((l) => l.contentOnly);
        expect(contentOnly).toBeDefined();
        if (contentOnly) {
            expect(isDisplayableLocale(contentOnly.id)).toBe(false);
        }
    });
});

describe("getEnglishName", () => {
    it("names a locale in English, underscores and all", () => {
        expect(getEnglishName("de")).toBe("German");
        // Our ids separate the subtags with an underscore where BCP-47 wants a hyphen.
        expect(getEnglishName("pt_br")).toBe("Brazilian Portuguese");
    });

    // Through the script subtags rather than the regions, which is the distinction these two
    // entries actually differ by: "Chinese (China)" would name the wrong thing.
    it("resolves the Chinese pair by script", () => {
        expect(getEnglishName("cn")).toBe("Simplified Chinese");
        expect(getEnglishName("tw")).toBe("Traditional Chinese");
    });

    it("offers nothing for the English entries, which are named in English already", () => {
        expect(getEnglishName("en")).toBeNull();
        expect(getEnglishName("en_gb")).toBeNull();
        // Not a well-formed tag at all — the prefix check is what keeps `Intl` from throwing on it.
        expect(getEnglishName("en_rtl")).toBeNull();
    });

    it("offers nothing for a tag Intl cannot read", () => {
        // A malformed tag raises a RangeError rather than returning an empty result.
        expect(getEnglishName("nonexistent-locale")).toBeNull();
    });

    it("offers nothing when the formatter has no name to give", () => {
        // The default formatter falls back to echoing the code; one built to say nothing instead
        // is what leaves `of()` empty for a well-formed tag it does not know.
        const silent = new Intl.DisplayNames([ "en" ], { type: "language", fallback: "none" });

        expect(getEnglishName("zz", silent)).toBeNull();
        // The same formatter still names what it does know, so this is not just a broken one.
        expect(getEnglishName("ro", silent)).toBe("Romanian");
    });
});
