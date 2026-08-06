import { type Locale, LOCALE_IDS, LOCALES, setDayjsLocale } from "@triliumnext/commons";
import i18next from "i18next";
import i18nextHttpBackend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";

/**
 * A deferred promise that resolves when translations are initialized.
 */
export const translationsInitializedPromise = $.Deferred();

export async function initLocale(locale: LOCALE_IDS = "en") {

    i18next.use(initReactI18next);
    await i18next.use(i18nextHttpBackend).init({
        lng: locale,
        fallbackLng: "en",
        backend: {
            loadPath: `${window.glob.assetPath}/translations/{{lng}}/{{ns}}.json`
        },
        returnEmptyString: false
    });

    await setDayjsLocale(locale);
    translationsInitializedPromise.resolve();
}

/**
 * The locales offered everywhere a language is picked: the display and formatting language, the
 * enabled content languages and a note's own language.
 *
 * A development build annotates each name with its English equivalent — `Deutsch (German)` — because
 * the list is written in each language's own script, and a developer checking how the app behaves in
 * one of them cannot otherwise tell `한국어` from `हिन्दी`. Production keeps the native names alone,
 * which is what a speaker looking for their own language expects to find.
 */
export function getAvailableLocales(): Locale[] {
    if (!window.glob.isDev) return LOCALES;

    const englishNames = new Intl.DisplayNames([ "en" ], { type: "language" });
    return LOCALES.map((locale) => ({ ...locale, name: withEnglishName(locale, englishNames) }));
}

/**
 * Finds the given locale by ID.
 *
 * @param localeId the locale ID to search for.
 * @returns the corresponding {@link Locale} or `null` if it was not found.
 */
export function getLocaleById(localeId: string | null | undefined) {
    if (!localeId) return null;
    return LOCALES.find((l) => l.id === localeId) ?? null;
}

export const t = i18next.t;
export const getCurrentLanguage = () => i18next.language;

/** `Deutsch (German)`, or the native name alone where an English equivalent would add nothing. */
function withEnglishName(locale: Locale, englishNames: Intl.DisplayNames): string {
    const englishName = getEnglishName(locale.id, englishNames);
    return englishName && englishName !== locale.name
        ? `${locale.name} (${englishName})`
        : locale.name;
}

/**
 * The English name of a locale, or `null` when there is none worth showing: the English entries are
 * named in English already, and anything `Intl` does not recognize has nothing to offer.
 */
function getEnglishName(localeId: string, englishNames: Intl.DisplayNames): string | null {
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
 * `normalizeLocale` (in `utils/formatters`) maps them to: `zh-Hans` reads as "Simplified Chinese",
 * whereas `zh-CN` would say "Chinese (China)" — the wrong distinction for entries differing by
 * script.
 */
const ENGLISH_NAME_TAGS: Record<string, string> = {
    cn: "zh-Hans",
    tw: "zh-Hant"
};
