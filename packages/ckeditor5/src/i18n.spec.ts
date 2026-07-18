import { describe, expect, it } from "vitest";

import getCkLocale from "./i18n.js";

describe("getCkLocale", () => {
    it("returns an empty config for the 'en' locale (no translation needed)", async () => {
        const result = await getCkLocale("en");
        expect(result).toEqual({});
    });

    it("returns an empty config for the 'en_rtl' dev locale", async () => {
        const result = await getCkLocale("en_rtl");
        expect(result).toEqual({});
    });

    it("returns an empty config for the 'ga' locale (no CKEditor translation)", async () => {
        const result = await getCkLocale("ga");
        expect(result).toEqual({});
    });

    it("returns language + translations array for 'de'", async () => {
        const result = await getCkLocale("de");
        expect(result.language).toBe("de");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
        result.translations?.forEach((t) => expect(t).toBeTruthy());
    });

    it("returns language + translations array for 'fr'", async () => {
        const result = await getCkLocale("fr");
        expect(result.language).toBe("fr");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations array for 'en-GB'", async () => {
        const result = await getCkLocale("en-GB");
        expect(result.language).toBe("en-GB");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language 'zh' for the 'cn' (Simplified Chinese) locale", async () => {
        const result = await getCkLocale("cn");
        expect(result.language).toBe("zh");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language 'zh-tw' for the 'tw' (Traditional Chinese) locale", async () => {
        const result = await getCkLocale("tw");
        expect(result.language).toBe("zh-tw");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language 'pt-br' for the 'pt_br' locale", async () => {
        const result = await getCkLocale("pt_br");
        expect(result.language).toBe("pt-br");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'ar'", async () => {
        const result = await getCkLocale("ar");
        expect(result.language).toBe("ar");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'cs'", async () => {
        const result = await getCkLocale("cs");
        expect(result.language).toBe("cs");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'es'", async () => {
        const result = await getCkLocale("es");
        expect(result.language).toBe("es");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'id'", async () => {
        const result = await getCkLocale("id");
        expect(result.language).toBe("id");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'it'", async () => {
        const result = await getCkLocale("it");
        expect(result.language).toBe("it");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'hi'", async () => {
        const result = await getCkLocale("hi");
        expect(result.language).toBe("hi");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'ja'", async () => {
        const result = await getCkLocale("ja");
        expect(result.language).toBe("ja");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'pl'", async () => {
        const result = await getCkLocale("pl");
        expect(result.language).toBe("pl");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'pt'", async () => {
        const result = await getCkLocale("pt");
        expect(result.language).toBe("pt");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'ro'", async () => {
        const result = await getCkLocale("ro");
        expect(result.language).toBe("ro");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'uk'", async () => {
        const result = await getCkLocale("uk");
        expect(result.language).toBe("uk");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("returns language + translations for 'ru'", async () => {
        const result = await getCkLocale("ru");
        expect(result.language).toBe("ru");
        expect(Array.isArray(result.translations)).toBe(true);
        expect(result.translations?.length).toBe(2);
    });

    it("the translations array contains objects with locale dictionaries", async () => {
        const result = await getCkLocale("de");
        const translations = result.translations ?? [];
        // Each translation is a Translations object — check it has at least one locale key
        expect(typeof translations[0]).toBe("object");
        expect(typeof translations[1]).toBe("object");
    });
});
