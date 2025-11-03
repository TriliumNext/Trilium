import { describe, expect, it } from "vitest";
import { extractLocaleFromUrl, mapLocale, swapLocaleInUrl } from "./i18n";

describe("mapLocale", () => {
    it("maps Chinese", () => {
        expect(mapLocale("zh-TW")).toStrictEqual("zh-Hant");
        expect(mapLocale("zh-CN")).toStrictEqual("zh-Hans");
    });

    it("maps languages without countries", () => {
        expect(mapLocale("ro-RO")).toStrictEqual("ro");
        expect(mapLocale("ro")).toStrictEqual("ro");
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
