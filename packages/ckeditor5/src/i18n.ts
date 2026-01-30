import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { EditorConfig, Translations } from "ckeditor5";

interface LocaleMapping {
    languageCode: string;
    coreTranslation: () => Promise<{ default: Translations }>;
    premiumFeaturesTranslation: () => Promise<{ default: Translations }>;
}

const LOCALE_MAPPINGS: Record<DISPLAYABLE_LOCALE_IDS, LocaleMapping | null> = {
    en: null,
    en_rtl: null,
    "en-GB": {
        languageCode: "en-GB",
        coreTranslation: () => import("ckeditor5/translations/en-gb.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/en-gb.js"),
    },
    ar: {
        languageCode: "ar",
        coreTranslation: () => import("ckeditor5/translations/ar.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/ar.js"),
    },
    cn: {
        languageCode: "zh",
        coreTranslation: () => import("ckeditor5/translations/zh-cn.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/zh-cn.js"),
    },
    de: {
        languageCode: "de",
        coreTranslation: () => import("ckeditor5/translations/de.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/de.js"),
    },
    es: {
        languageCode: "es",
        coreTranslation: () => import("ckeditor5/translations/es.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/es.js"),
    },
    fr: {
        languageCode: "fr",
        coreTranslation: () => import("ckeditor5/translations/fr.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/fr.js"),
    },
    it: {
        languageCode: "it",
        coreTranslation: () => import("ckeditor5/translations/it.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/it.js"),
    },
    ja: {
        languageCode: "ja",
        coreTranslation: () => import("ckeditor5/translations/ja.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/ja.js"),
    },
    pl: {
        languageCode: "pl",
        coreTranslation: () => import("ckeditor5/translations/pl.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/pl.js"),
    },
    pt: {
        languageCode: "pt",
        coreTranslation: () => import("ckeditor5/translations/pt.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/pt.js"),
    },
    pt_br: {
        languageCode: "pt-br",
        coreTranslation: () => import("ckeditor5/translations/pt-br.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/pt-br.js"),
    },
    ro: {
        languageCode: "ro",
        coreTranslation: () => import("ckeditor5/translations/ro.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/ro.js"),
    },
    tw: {
        languageCode: "zh-tw",
        coreTranslation: () => import("ckeditor5/translations/zh.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/zh.js"),
    },
    uk: {
        languageCode: "uk",
        coreTranslation: () => import("ckeditor5/translations/uk.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/uk.js"),
    },
    ru: {
        languageCode: "ru",
        coreTranslation: () => import("ckeditor5/translations/ru.js"),
        premiumFeaturesTranslation: () => import("ckeditor5-premium-features/translations/ru.js")
    },
};

export default async function getCkLocale(locale: DISPLAYABLE_LOCALE_IDS): Promise<Pick<EditorConfig, "language" | "translations">> {
    const mapping = LOCALE_MAPPINGS[locale];
    if (!mapping) return {};

    const coreTranslation = (await (mapping.coreTranslation())).default;
    const premiumFeaturesTranslation = (await (mapping.premiumFeaturesTranslation())).default;
    return {
        language: mapping.languageCode,
        translations: [ coreTranslation, premiumFeaturesTranslation ]
    };
}
