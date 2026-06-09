import { describe, expect, it } from "vitest";

import { getTesseractCode, isDisplayableLocale, LOCALES } from "./i18n.js";

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
