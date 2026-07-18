import { dayjs, findDuplicateJsonKeys, LOCALES } from "@triliumnext/commons";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

// Mock the http backend so i18next.init() never hits the network. The real
// backend would try to fetch translation JSON over HTTP and the awaited init()
// would hang until the connection fails. Our fake backend resolves read()
// synchronously with an empty resource bundle.
vi.mock("i18next-http-backend", () => {
    class FakeBackend {
        static type = "backend" as const;
        type = "backend" as const;
        init() {
            // No configuration needed.
        }
        read(_language: string, _namespace: string, callback: (err: unknown, data: unknown) => void) {
            callback(null, {});
        }
    }
    return { default: FakeBackend };
});

const { getAvailableLocales, getCurrentLanguage, getLocaleById, initLocale, translationsInitializedPromise } = await import("./i18n");

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

    describe("getAvailableLocales", () => {
        it("returns the full LOCALES list", () => {
            expect(getAvailableLocales()).toBe(LOCALES);
        });
    });

    describe("getLocaleById", () => {
        it("returns null for falsy locale ids", () => {
            expect(getLocaleById(null)).toBeNull();
            expect(getLocaleById(undefined)).toBeNull();
            expect(getLocaleById("")).toBeNull();
        });

        it("returns the matching locale for a known id", () => {
            const locale = getLocaleById("en");
            expect(locale).not.toBeNull();
            expect(locale?.id).toBe("en");
        });

        it("returns null for an unknown id", () => {
            expect(getLocaleById("does-not-exist")).toBeNull();
        });
    });

    describe("initLocale", () => {
        it("initializes i18next with an explicit locale, sets dayjs and resolves the deferred", async () => {
            (window as any).glob = { ...(window as any).glob, assetPath: "/assets" };

            await initLocale("de");

            expect(getCurrentLanguage()).toBe("de");
            // The second responsibility of initLocale is `await setDayjsLocale(locale)`, which
            // switches the global dayjs locale. Assert the observable side effect so removing or
            // mis-passing the locale to setDayjsLocale would be caught.
            expect(dayjs.locale()).toBe("de");
            // The deferred resolves once translations are ready.
            await expect(translationsInitializedPromise).resolves.toBeUndefined();
        });

        it("uses the default 'en' locale when called without arguments", async () => {
            await initLocale();
            expect(getCurrentLanguage()).toBe("en");
        });
    });

    describe("getCurrentLanguage", () => {
        it("reflects the language i18next was last initialized with", async () => {
            await initLocale("en");
            expect(getCurrentLanguage()).toBe("en");
        });
    });
});
