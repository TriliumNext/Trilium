export interface Locale {
    id: string;
    name: string;
    /** `true` if the language is a right-to-left one, or `false` if it's left-to-right. */
    rtl?: boolean;
    /** `true` if the language is not supported by the application as a display language, but it is selectable by the user for the content. */
    contentOnly?: boolean;
    /** The value to pass to `--lang` for the Electron instance in order to set it as a locale. Not setting it will hide it from the list of supported locales. */
    electronLocale?: "en" | "de" | "es" | "fr" | "zh_CN" | "zh_TW" | "ro" | "af" | "am" | "ar" | "bg" | "bn" | "ca" | "cs" | "da" | "el" | "en_GB" | "es_419" | "et" | "fa" | "fi" | "fil" | "gu" | "he" | "hi" | "hr" | "hu" | "id" | "it" | "ja" | "kn" | "ko" | "lt" | "lv" | "ml" | "mr" | "ms" | "nb" | "nl" | "pl" | "pt_BR" | "pt_PT" | "ru" | "sk" | "sl" | "sr" | "sv" | "sw" | "ta" | "te" | "th" | "tr" | "uk" | "ur" | "vi";
}

const UNSORTED_LOCALES: Locale[] = [
    { id: "cn", name: "简体中文", electronLocale: "zh_CN" },
    { id: "de", name: "Deutsch", electronLocale: "de" },
    { id: "en", name: "English", electronLocale: "en" },
    { id: "es", name: "Español", electronLocale: "es" },
    { id: "fr", name: "Français", electronLocale: "fr" },
    { id: "ja", name: "日本語", electronLocale: "ja" },
    { id: "pt_br", name: "Português (Brasil)", electronLocale: "pt_BR" },
    { id: "pt", name: "Português (Portugal)", electronLocale: "pt_PT" },
    { id: "ro", name: "Română", electronLocale: "ro" },
    { id: "ru", name: "Русский", electronLocale: "ru" },
    { id: "tw", name: "繁體中文", electronLocale: "zh_TW" },
    { id: "uk", name: "Українська", electronLocale: "uk" },

    /*
     * Right to left languages
     *
     * Currently they are only for setting the language of text notes.
     */
    { // Arabic
        id: "ar",
        name: "اَلْعَرَبِيَّةُ",
        rtl: true,
        contentOnly: true
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

export type LOCALE_IDS = typeof UNSORTED_LOCALES[number]["id"];
