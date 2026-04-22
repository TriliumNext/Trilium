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
    /** The Tesseract OCR language code for this locale (e.g. "eng", "fra", "deu"). See https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html */
    tesseractCode?: "eng" | "deu" | "spa" | "fra" | "gle" | "ita" | "hin" | "jpn" | "por" | "pol" | "ron" | "rus" | "chi_sim" | "chi_tra" | "ukr" | "ara" | "heb" | "kur" | "fas" | "kor" | "ces" | "uig";
}

// When adding a new locale, prefer the version with hyphen instead of underscore.
const UNSORTED_LOCALES = [
    { id: "cn", name: "简体中文", electronLocale: "zh_CN", tesseractCode: "chi_sim" },
    { id: "cs", name: "Čeština", electronLocale: "cs", tesseractCode: "ces" },
    { id: "de", name: "Deutsch", electronLocale: "de", tesseractCode: "deu" },
    { id: "en", name: "English (United States)", electronLocale: "en", tesseractCode: "eng" },
    { id: "en-GB", name: "English (United Kingdom)", electronLocale: "en_GB", tesseractCode: "eng" },
    { id: "es", name: "Español", electronLocale: "es", tesseractCode: "spa" },
    { id: "fr", name: "Français", electronLocale: "fr", tesseractCode: "fra" },
    { id: "ga", name: "Gaeilge", electronLocale: "en", tesseractCode: "gle" },
    { id: "it", name: "Italiano", electronLocale: "it", tesseractCode: "ita" },
    { id: "hi", name: "हिन्दी", electronLocale: "hi", tesseractCode: "hin" },
    { id: "ja", name: "日本語", electronLocale: "ja", tesseractCode: "jpn" },
    { id: "pt_br", name: "Português (Brasil)", electronLocale: "pt_BR", tesseractCode: "por" },
    { id: "pt", name: "Português (Portugal)", electronLocale: "pt_PT", tesseractCode: "por" },
    { id: "pl", name: "Polski", electronLocale: "pl", tesseractCode: "pol" },
    { id: "ro", name: "Română", electronLocale: "ro", tesseractCode: "ron" },
    { id: "ru", name: "Русский", electronLocale: "ru", tesseractCode: "rus" },
    { id: "tw", name: "繁體中文", electronLocale: "zh_TW", tesseractCode: "chi_tra" },
    { id: "uk", name: "Українська", electronLocale: "uk", tesseractCode: "ukr" },

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
        electronLocale: "ar",
        tesseractCode: "ara"
    },
    { // Hebrew
        id: "he",
        name: "עברית",
        rtl: true,
        contentOnly: true,
        tesseractCode: "heb"
    },
    { // Kurdish
        id: "ku",
        name: "کوردی",
        rtl: true,
        contentOnly: true,
        tesseractCode: "kur"
    },
    { // Persian
        id: "fa",
        name: "فارسی",
        rtl: true,
        contentOnly: true,
        tesseractCode: "fas"
    },
    { // Uyghur
        id: "ug",
        name: "ئۇيغۇرچە",
        rtl: true,
        contentOnly: true,
        tesseractCode: "uig"
    }
] as const;

export const LOCALES: Locale[] = Array.from(UNSORTED_LOCALES)
    .sort((a, b) => a.name.localeCompare(b.name));

/** A type containing a string union of all the supported locales, including those that are content-only. */
export type LOCALE_IDS = typeof UNSORTED_LOCALES[number]["id"];
/** A type containing a string union of all the supported locales that are not content-only (i.e. can be used as the UI language). */
export type DISPLAYABLE_LOCALE_IDS = Exclude<typeof UNSORTED_LOCALES[number], { contentOnly: true }>["id"];

/**
 * Returns the Tesseract OCR language code for the given locale ID, or `null` if not mapped.
 */
export function getTesseractCode(localeId: string): string | null {
    return LOCALES.find((l) => l.id === localeId)?.tesseractCode ?? null;
}
