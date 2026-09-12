export interface Locale {
    id: string;
    name: string;
    rtl?: boolean;
}

/**
 * The languages offered by the language selector, in their own script.
 *
 * `scripts/translation/check-translation-coverage.ts` fails the build when Weblate
 * reports a language above the coverage threshold that is missing here. A locale
 * carrying a region (`pt-BR`, `nb-NO`) also needs `mapLocale()` to resolve it, which
 * it does by matching this list.
 */
export const LOCALES: Locale[] = [
    { id: "ar", name: "اَلْعَرَبِيَّةُ", rtl: true },
    { id: "cs", name: "Čeština" },
    { id: "de", name: "Deutsch" },
    { id: "el", name: "Ελληνικά" },
    { id: "en", name: "English (United States)" },
    { id: "en-GB", name: "English (United Kingdom)" },
    { id: "es", name: "Español" },
    { id: "fr", name: "Français" },
    { id: "ga", name: "Gaeilge" },
    { id: "hi", name: "हिन्दी" },
    { id: "id", name: "Bahasa Indonesia" },
    { id: "it", name: "Italiano" },
    { id: "ja", name: "日本語" },
    { id: "ko", name: "한국어" },
    { id: "nb-NO", name: "Norsk bokmål" },
    { id: "pl", name: "Polski" },
    { id: "pt-BR", name: "Português (Brasil)" },
    { id: "ro", name: "Română" },
    { id: "ru", name: "Русский" },
    { id: "ug", name: "ئۇيغۇرچە", rtl: true },
    { id: "uk", name: "Українська" },
    { id: "zh-Hans", name: "简体中文" },
    { id: "zh-Hant", name: "繁體中文" }
].toSorted((a, b) => a.name.localeCompare(b.name));
