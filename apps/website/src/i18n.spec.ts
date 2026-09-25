import { describe, expect, it } from "vitest";
import { extractLocaleFromUrl, LOCALES, mapLocale, swapLocaleInUrl } from "./i18n";

describe("mapLocale", () => {
    it("maps Chinese", () => {
        expect(mapLocale("zh-TW")).toStrictEqual("zh-Hant");
        expect(mapLocale("zh-CN")).toStrictEqual("zh-Hans");
        expect(mapLocale("zh-Hant")).toStrictEqual("zh-Hant");
        expect(mapLocale("zh-Hans")).toStrictEqual("zh-Hans");
    });

    it("maps languages without countries", () => {
        expect(mapLocale("ro-RO")).toStrictEqual("ro");
        expect(mapLocale("ro")).toStrictEqual("ro");
    });

    it("keeps the region of locales offered per region", () => {
        expect(mapLocale("en-GB")).toStrictEqual("en-GB");
        expect(mapLocale("pt-BR")).toStrictEqual("pt-BR");
        expect(mapLocale("nb-NO")).toStrictEqual("nb-NO");
    });

    it("resolves a bare language to the only region offered for it", () => {
        expect(mapLocale("nb")).toStrictEqual("nb-NO");
        expect(mapLocale("pt")).toStrictEqual("pt-BR");
    });

    it("prefers the exact match over a region sharing the language", () => {
        expect(mapLocale("en")).toStrictEqual("en");
        expect(mapLocale("en-US")).toStrictEqual("en");
        expect(mapLocale("de-AT")).toStrictEqual("de");
    });

    it("falls back to English for languages that are not offered", () => {
        expect(mapLocale("sv")).toStrictEqual("en");
        expect(mapLocale("hu-HU")).toStrictEqual("en");
        expect(mapLocale("")).toStrictEqual("en");
    });

    it("only ever returns a locale the website offers", () => {
        const ids = LOCALES.map(l => l.id);
        const tags = [ "ro-RO", "zh-HK", "pt", "nb", "sv", "en-AU", "ug", "ar-EG" ];
        for (const tag of tags) {
            expect(ids).toContain(mapLocale(tag));
        }
    });
});

describe("swapLocale", () => {
    it("swap locale in URL", () => {
        expect(swapLocaleInUrl("/get-started", "ro")).toStrictEqual("/ro/get-started");
        expect(swapLocaleInUrl("/ro/get-started", "ro")).toStrictEqual("/ro/get-started");
        expect(swapLocaleInUrl("/en/get-started", "ro")).toStrictEqual("/ro/get-started");
        expect(swapLocaleInUrl("/ro/", "en")).toStrictEqual("/en/");
        expect(swapLocaleInUrl("/ro", "en")).toStrictEqual("/en");
    });
});

describe("extractLocaleFromUrl", () => {
    it("properly extracts locale", () => {
        expect(extractLocaleFromUrl("/en/get-started")).toStrictEqual("en");
        expect(extractLocaleFromUrl("/get-started")).toStrictEqual(undefined);
        expect(extractLocaleFromUrl("/")).toStrictEqual(undefined);
    });
});
