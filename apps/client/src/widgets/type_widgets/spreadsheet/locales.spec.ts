import { LOCALES } from "@triliumnext/commons";
import { LocaleType } from "@univerjs/presets";
import { describe, expect, it } from "vitest";

import { loadUniverLocale, resolveUniverLocaleSource, SPREADSHEET_PRESET_PACKAGES, UNIVER_LOCALES } from "./locales";

describe("UNIVER_LOCALES", () => {
    it("maps every displayable Trilium UI language (fails when a new language is added)", () => {
        // A newly introduced Trilium UI language must get an explicit entry (a source or null),
        // rather than silently defaulting.
        for (const locale of LOCALES) {
            if (locale.contentOnly) continue;
            expect(UNIVER_LOCALES, `No Univer mapping for Trilium locale "${locale.id}"`).toHaveProperty(locale.id);
        }
    });

    it("only maps locales that still exist as displayable Trilium languages", () => {
        const displayableIds = LOCALES.filter((locale) => !locale.contentOnly).map((locale) => locale.id);
        for (const mappedId of Object.keys(UNIVER_LOCALES)) {
            expect(displayableIds, `Stale mapping for removed locale "${mappedId}"`).toContain(mappedId);
        }
    });

    it("can physically import every mapped locale (and the English fallback) across every preset", async () => {
        // The English fallback isn't referenced by any entry (English variants map to null), so load
        // it through a null-mapped locale to confirm it imports too.
        const english = await loadUniverLocale("en");
        expect(english.type).toBe(LocaleType.EN_US);
        expect(Object.keys(english.data).length).toBeGreaterThan(0);

        for (const [id, source] of Object.entries(UNIVER_LOCALES)) {
            if (source === null) continue;
            const modules = await source.load();

            // Every preset bundle must resolve to a non-empty translation object.
            expect(modules, id).toHaveLength(SPREADSHEET_PRESET_PACKAGES.length);
            for (const module of modules) {
                expect(Object.keys(module.default).length, id).toBeGreaterThan(0);
            }
        }
    });

    it("loads and merges the locale matching the Trilium language", async () => {
        // "fr" maps to fr-FR, exercising the resolve -> import -> merge path end to end.
        const { type, data } = await loadUniverLocale("fr");
        expect(type).toBe(LocaleType.FR_FR);
        expect(Object.keys(data).length).toBeGreaterThan(0);
    });
});

describe("resolveUniverLocaleSource", () => {
    it("falls back to the base language before defaulting to English", () => {
        // Region-suffixed variants resolve to their base language's mapping.
        expect(resolveUniverLocaleSource("fr-CA").type).toBe(LocaleType.FR_FR);
        expect(resolveUniverLocaleSource("es_419").type).toBe(LocaleType.ES_ES);
    });

    it("falls back to English for locales without a Univer translation", () => {
        // German and Romanian have no Univer bundle, so English is the closest available option.
        expect(resolveUniverLocaleSource("de").type).toBe(LocaleType.EN_US);
        expect(resolveUniverLocaleSource("ro").type).toBe(LocaleType.EN_US);
        expect(resolveUniverLocaleSource("").type).toBe(LocaleType.EN_US);
    });
});
