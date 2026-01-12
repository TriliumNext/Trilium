export interface Locale {
    id: string;
    name: string;
    /** `true` if the language is a right-to-left one, or `false` if it's left-to-right. */
    rtl?: boolean;
    /** `true` if the language is not supported by the application as a display language, but it is selectable by the user for the content. */
    contentOnly?: boolean;
    /** `true` if the language should only be visible while in development mode, and not in production. */
    devOnly?: boolean;
    /** The value to pass to `--lang` for the Electron instance in order to set it as a locale. Not setting it will hide it from the list of supported locales. */
    electronLocale?: "en" | "de" | "es" | "fr" | "zh_CN" | "zh_TW" | "ro" | "af" | "am" | "ar" | "bg" | "bn" | "ca" | "cs" | "da" | "el" | "en_GB" | "es_419" | "et" | "fa" | "fi" | "fil" | "gu" | "he" | "hi" | "hr" | "hu" | "id" | "it" | "ja" | "kn" | "ko" | "lt" | "lv" | "ml" | "mr" | "ms" | "nb" | "nl" | "pl" | "pt_BR" | "pt_PT" | "ru" | "sk" | "sl" | "sr" | "sv" | "sw" | "ta" | "te" | "th" | "tr" | "uk" | "ur" | "vi";
}

// When adding a new locale, prefer the version with hyphen instead of underscore.
const UNSORTED_LOCALES = [
    { id: "cn", name: "简体中文", electronLocale: "zh_CN" },
    { id: "de", name: "Deutsch", electronLocale: "de" },
    { id: "en", name: "English (United States)", electronLocale: "en" },
    { id: "en-GB", name: "English (United Kingdom)", electronLocale: "en_GB" },
    { id: "es", name: "Español", electronLocale: "es" },
    { id: "fr", name: "Français", electronLocale: "fr" },
    { id: "it", name: "Italiano", electronLocale: "it" },
    { id: "ja", name: "日本語", electronLocale: "ja" },
    { id: "pt_br", name: "Português (Brasil)", electronLocale: "pt_BR" },
    { id: "pt", name: "Português (Portugal)", electronLocale: "pt_PT" },
    { id: "pl", name: "Polski", electronLocale: "pl" },
    { id: "ro", name: "Română", electronLocale: "ro" },
    { id: "ru", name: "Русский", electronLocale: "ru" },
    { id: "tw", name: "繁體中文", electronLocale: "zh_TW" },
    { id: "uk", name: "Українська", electronLocale: "uk" },

    /**
     * Development-only languages.
     *
     * These are only displayed while in dev mode, to test some language particularities (such as RTL) more easily.
     */
    {
        id: "en_rtl",
        name: "English RTL",
        electronLocale: "en",
        rtl: true,
        devOnly: true
    },

    /*
     * Right to left languages
     *
     * Currently they are only for setting the language of text notes.
     */
    { // Arabic
        id: "ar",
        name: "اَلْعَرَبِيَّةُ",
        rtl: true,
        electronLocale: "ar"
    },
    { // Hebrew
        id: "he",
        name: "עברית",
        rtl: true,
        contentOnly: true
    },
    { // Kurdish
        id: "ku",
        name: "کوردی",
        rtl: true,
        contentOnly: true
    },
    { // Persian
        id: "fa",
        name: "فارسی",
        rtl: true,
        contentOnly: true
    }
] as const;

export const LOCALES: Locale[] = Array.from(UNSORTED_LOCALES)
    .sort((a, b) => a.name.localeCompare(b.name));

/** A type containing a string union of all the supported locales, including those that are content-only. */
export type LOCALE_IDS = typeof UNSORTED_LOCALES[number]["id"];
/** A type containing a string union of all the supported locales that are not content-only (i.e. can be used as the UI language). */
export type DISPLAYABLE_LOCALE_IDS = Exclude<typeof UNSORTED_LOCALES[number], { contentOnly: true }>["id"];
