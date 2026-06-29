import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { LocaleType, mergeLocales } from '@univerjs/presets';

import { getCurrentLanguage } from "../../../services/i18n";

export interface UniverLocale {
    /** The Univer {@link LocaleType} used both as the active locale and as the key of the locale data map. */
    type: LocaleType;
    /** The merged locale data, gathering the translations of every spreadsheet preset we load. */
    data: object;
}

interface UniverLocaleSource {
    /** The Univer {@link LocaleType} enum value (e.g. `enUS`), distinct from the on-disk code (`en-US`). */
    type: LocaleType;
    /** Lazily imports and returns the locale bundle of every preset in {@link SPREADSHEET_PRESET_PACKAGES}. */
    load: () => Promise<{ default: object }[]>;
}

/**
 * The spreadsheet presets used in {@link Spreadsheet}, each of which ships its own per-locale
 * translation bundle. Exposed so tests can assert each {@link UNIVER_LOCALES} source loads a bundle
 * for every preset. Keep this in sync with the preset list passed to `createUniver`.
 */
export const SPREADSHEET_PRESET_PACKAGES = [
    "@univerjs/preset-sheets-core",
    "@univerjs/preset-sheets-drawing",
    "@univerjs/preset-sheets-find-replace",
    "@univerjs/preset-sheets-note",
    "@univerjs/preset-sheets-filter",
    "@univerjs/preset-sheets-sort",
    "@univerjs/preset-sheets-data-validation",
    "@univerjs/preset-sheets-conditional-formatting",
    "@univerjs/preset-sheets-hyper-link"
] as const;

/**
 * English (`en-US`) is Univer's built-in default and the fallback for every UI language without a
 * dedicated translation. Kept standalone because no {@link UNIVER_LOCALES} entry references it
 * directly — the English variants map to `null` rather than to a bundle.
 */
const ENGLISH_LOCALE: UniverLocaleSource = {
    type: LocaleType.EN_US,
    load: () => Promise.all([
        import('@univerjs/preset-sheets-core/locales/en-US'),
        import('@univerjs/preset-sheets-drawing/locales/en-US'),
        import('@univerjs/preset-sheets-find-replace/locales/en-US'),
        import('@univerjs/preset-sheets-note/locales/en-US'),
        import('@univerjs/preset-sheets-filter/locales/en-US'),
        import('@univerjs/preset-sheets-sort/locales/en-US'),
        import('@univerjs/preset-sheets-data-validation/locales/en-US'),
        import('@univerjs/preset-sheets-conditional-formatting/locales/en-US'),
        import('@univerjs/preset-sheets-hyper-link/locales/en-US')
    ])
};

/**
 * Maps every Trilium UI language to the Univer locale that best matches it — the {@link LocaleType}
 * enum plus a lazy loader that merges the matching bundle of every preset — or `null` to use
 * Univer's built-in English ({@link ENGLISH_LOCALE}) default. `null` covers both the English
 * variants (English is the default, so there is nothing to switch to) and languages Univer does not
 * translate (German, Romanian, Arabic, …). So the non-null entries are exactly the languages for
 * which Univer ships a non-English UI; spelling out `null` keeps each fallback an explicit decision.
 * The bundles load lazily, so a user only pays for the locale they actually use.
 *
 * Keyed by {@link DISPLAYABLE_LOCALE_IDS}, so introducing a new Trilium UI language fails to compile
 * (and trips the `locales.spec.ts` guard) until its Univer mapping — a source or `null` — is decided
 * here.
 */
export const UNIVER_LOCALES: Record<DISPLAYABLE_LOCALE_IDS, UniverLocaleSource | null> = {
    cn: {
        type: LocaleType.ZH_CN,
        load: () => Promise.all([
            import('@univerjs/preset-sheets-core/locales/zh-CN'),
            import('@univerjs/preset-sheets-drawing/locales/zh-CN'),
            import('@univerjs/preset-sheets-find-replace/locales/zh-CN'),
            import('@univerjs/preset-sheets-note/locales/zh-CN'),
            import('@univerjs/preset-sheets-filter/locales/zh-CN'),
            import('@univerjs/preset-sheets-sort/locales/zh-CN'),
            import('@univerjs/preset-sheets-data-validation/locales/zh-CN'),
            import('@univerjs/preset-sheets-conditional-formatting/locales/zh-CN'),
            import('@univerjs/preset-sheets-hyper-link/locales/zh-CN')
        ])
    },
    cs: null,
    de: null,
    en: null,
    "en-GB": null,
    en_rtl: null,
    ar: null,
    es: {
        type: LocaleType.ES_ES,
        load: () => Promise.all([
            import('@univerjs/preset-sheets-core/locales/es-ES'),
            import('@univerjs/preset-sheets-drawing/locales/es-ES'),
            import('@univerjs/preset-sheets-find-replace/locales/es-ES'),
            import('@univerjs/preset-sheets-note/locales/es-ES'),
            import('@univerjs/preset-sheets-filter/locales/es-ES'),
            import('@univerjs/preset-sheets-sort/locales/es-ES'),
            import('@univerjs/preset-sheets-data-validation/locales/es-ES'),
            import('@univerjs/preset-sheets-conditional-formatting/locales/es-ES'),
            import('@univerjs/preset-sheets-hyper-link/locales/es-ES')
        ])
    },
    fr: {
        type: LocaleType.FR_FR,
        load: () => Promise.all([
            import('@univerjs/preset-sheets-core/locales/fr-FR'),
            import('@univerjs/preset-sheets-drawing/locales/fr-FR'),
            import('@univerjs/preset-sheets-find-replace/locales/fr-FR'),
            import('@univerjs/preset-sheets-note/locales/fr-FR'),
            import('@univerjs/preset-sheets-filter/locales/fr-FR'),
            import('@univerjs/preset-sheets-sort/locales/fr-FR'),
            import('@univerjs/preset-sheets-data-validation/locales/fr-FR'),
            import('@univerjs/preset-sheets-conditional-formatting/locales/fr-FR'),
            import('@univerjs/preset-sheets-hyper-link/locales/fr-FR')
        ])
    },
    ga: null,
    id: null,
    it: null,
    hi: null,
    ja: {
        type: LocaleType.JA_JP,
        load: () => Promise.all([
            import('@univerjs/preset-sheets-core/locales/ja-JP'),
            import('@univerjs/preset-sheets-drawing/locales/ja-JP'),
            import('@univerjs/preset-sheets-find-replace/locales/ja-JP'),
            import('@univerjs/preset-sheets-note/locales/ja-JP'),
            import('@univerjs/preset-sheets-filter/locales/ja-JP'),
            import('@univerjs/preset-sheets-sort/locales/ja-JP'),
            import('@univerjs/preset-sheets-data-validation/locales/ja-JP'),
            import('@univerjs/preset-sheets-conditional-formatting/locales/ja-JP'),
            import('@univerjs/preset-sheets-hyper-link/locales/ja-JP')
        ])
    },
    pt_br: null,
    pt: null,
    pl: null,
    ro: null,
    ru: {
        type: LocaleType.RU_RU,
        load: () => Promise.all([
            import('@univerjs/preset-sheets-core/locales/ru-RU'),
            import('@univerjs/preset-sheets-drawing/locales/ru-RU'),
            import('@univerjs/preset-sheets-find-replace/locales/ru-RU'),
            import('@univerjs/preset-sheets-note/locales/ru-RU'),
            import('@univerjs/preset-sheets-filter/locales/ru-RU'),
            import('@univerjs/preset-sheets-sort/locales/ru-RU'),
            import('@univerjs/preset-sheets-data-validation/locales/ru-RU'),
            import('@univerjs/preset-sheets-conditional-formatting/locales/ru-RU'),
            import('@univerjs/preset-sheets-hyper-link/locales/ru-RU')
        ])
    },
    tw: {
        type: LocaleType.ZH_TW,
        load: () => Promise.all([
            import('@univerjs/preset-sheets-core/locales/zh-TW'),
            import('@univerjs/preset-sheets-drawing/locales/zh-TW'),
            import('@univerjs/preset-sheets-find-replace/locales/zh-TW'),
            import('@univerjs/preset-sheets-note/locales/zh-TW'),
            import('@univerjs/preset-sheets-filter/locales/zh-TW'),
            import('@univerjs/preset-sheets-sort/locales/zh-TW'),
            import('@univerjs/preset-sheets-data-validation/locales/zh-TW'),
            import('@univerjs/preset-sheets-conditional-formatting/locales/zh-TW'),
            import('@univerjs/preset-sheets-hyper-link/locales/zh-TW')
        ])
    },
    uk: null
};

/** Resolves the Univer locale source for a Trilium UI language, falling back to {@link ENGLISH_LOCALE}. */
export function resolveUniverLocaleSource(triliumLocale = getCurrentLanguage()): UniverLocaleSource {
    const locales: Record<string, UniverLocaleSource | null | undefined> = UNIVER_LOCALES;
    // Fall back to the base language (e.g. an unexpected "de-DE" -> "de") before giving up on English.
    const baseLanguage = triliumLocale.split(/[-_]/)[0];
    return locales[triliumLocale] ?? locales[baseLanguage] ?? ENGLISH_LOCALE;
}

/**
 * Loads and merges the Univer locale bundles matching the user's Trilium language. The resulting
 * {@link UniverLocale.type} also drives Univer's locale-dependent defaults, most notably the
 * currency symbol applied by the toolbar (e.g. € for euro-zone locales).
 */
export async function loadUniverLocale(triliumLocale = getCurrentLanguage()): Promise<UniverLocale> {
    const { type, load } = resolveUniverLocaleSource(triliumLocale);
    const modules = await load();
    return {
        type,
        data: mergeLocales(...modules.map((module) => module.default))
    };
}
