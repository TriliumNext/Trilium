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
    tesseractCode?: "eng" | "deu" | "spa" | "fra" | "gle" | "ita" | "hin" | "ind" | "jpn" | "por" | "pol" | "ron" | "rus" | "chi_sim" | "chi_tra" | "ukr" | "ara" | "heb" | "kur" | "fas" | "kor" | "ces" | "uig" | "tur";
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
    { id: "id", name: "Bahasa Indonesia", electronLocale: "id", tesseractCode: "ind" },
    { id: "it", name: "Italiano", electronLocale: "it", tesseractCode: "ita" },
    { id: "hi", name: "हिन्दी", electronLocale: "hi", tesseractCode: "hin" },
    { id: "ja", name: "日本語", electronLocale: "ja", tesseractCode: "jpn" },
    { id: "ko", name: "한국어", electronLocale: "ko", tesseractCode: "kor" },
    { id: "pt_br", name: "Português (Brasil)", electronLocale: "pt_BR", tesseractCode: "por" },
    { id: "pt", name: "Português (Portugal)", electronLocale: "pt_PT", tesseractCode: "por" },
    { id: "pl", name: "Polski", electronLocale: "pl", tesseractCode: "pol" },
    { id: "ro", name: "Română", electronLocale: "ro", tesseractCode: "ron" },
    { id: "ru", name: "Русский", electronLocale: "ru", tesseractCode: "rus" },
    { id: "tr", name: "Türkçe", electronLocale: "tr", tesseractCode: "tur" },
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

/**
 * Returns `true` if the given locale ID corresponds to a known locale that can be used as the
 * application's display language (i.e. it exists and is not content-only).
 */
export function isDisplayableLocale(localeId: string | null | undefined): localeId is DISPLAYABLE_LOCALE_IDS {
    if (!localeId) return false;
    return LOCALES.some((l) => l.id === localeId && !l.contentOnly);
}

/**
 * The English name of a locale, or `null` when there is none worth showing: the English entries are
 * named in English already, and anything `Intl` does not recognize has nothing to offer.
 *
 * Used both to annotate the locale list for a developer who cannot tell `한국어` from `हिन्दी`, and to
 * name a language to something other than the user — an instruction to a language model, say, which
 * would otherwise have to read its target out of the script that target is written in.
 *
 * @param englishNames a formatter to reuse, for a caller naming a whole list of locales at once.
 */
export function getEnglishName(
    localeId: string,
    englishNames = new Intl.DisplayNames([ "en" ], { type: "language" })
): string | null {
    const tag = ENGLISH_NAME_TAGS[localeId] ?? localeId.replaceAll("_", "-");

    // Covers `en_rtl` too, which is not even a well-formed tag — `Intl` would throw on it.
    if (tag === "en" || tag.startsWith("en-")) return null;

    try {
        return englishNames.of(tag) ?? null;
    } catch {
        // A malformed tag is a RangeError rather than an empty result.
        return null;
    }
}

/**
 * Locale ids that are not BCP-47 tags, mapped to one.
 *
 * The Chinese pair deliberately resolves through the script subtags rather than the regions
 * `normalizeLocale` (in the client's `utils/formatters`) maps them to: `zh-Hans` reads as
 * "Simplified Chinese", whereas `zh-CN` would say "Chinese (China)" — the wrong distinction for
 * entries differing by script.
 */
const ENGLISH_NAME_TAGS: Record<string, string> = {
    cn: "zh-Hans",
    tw: "zh-Hant"
};
