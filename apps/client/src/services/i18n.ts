import { getEnglishName, type Locale, LOCALE_IDS, LOCALES, setDayjsLocale } from "@triliumnext/commons";
import i18next from "i18next";
import i18nextHttpBackend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";

/**
 * A deferred promise that resolves when translations are initialized.
 */
export const translationsInitializedPromise = $.Deferred();

/** Every string in the app proper: 200-300 KB depending on the language. */
const APP_NAMESPACE = "translation";

/**
 * The screens shown before the app itself — the setup wizard, the login page and the password
 * reset. Kept apart from the app catalogue because the wizard changes language on the spot, and
 * re-reading the whole thing to retitle one step costs seconds on a phone; these three pages need
 * about 11 KB of it between them.
 */
const ENTRY_NAMESPACE = "entry";

/**
 * @param scope which catalogue the page reads: `entry` for the pages shown before the app is
 *              available, `app` for the app itself — which reads both, since shared widgets such as
 *              the credentials form use `login.*` keys that live in the entry catalogue.
 */
export async function initLocale(locale: LOCALE_IDS = "en", scope: "app" | "entry" = "app") {
    const entryOnly = scope === "entry";

    i18next.use(initReactI18next);
    await i18next.use(i18nextHttpBackend).init({
        lng: locale,
        fallbackLng: "en",
        ns: entryOnly ? [ ENTRY_NAMESPACE ] : [ APP_NAMESPACE, ENTRY_NAMESPACE ],
        defaultNS: entryOnly ? ENTRY_NAMESPACE : APP_NAMESPACE,
        // Resolving through the entry catalogue on a miss keeps every call site writing
        // `t("login.password")` without having to know which of the two holds it.
        fallbackNS: ENTRY_NAMESPACE,
        backend: {
            loadPath: `${window.glob.assetPath}/translations/{{lng}}/{{ns}}.json`
        },
        // Interpolated values are not HTML-escaped. Almost every translated string is rendered as text
        // — a Preact text node, a toast message, a menu entry — where escaping shows `&#x2F;` and
        // `&#39;` to the reader, and Preact escapes what it renders anyway. The sinks that do render a
        // translated string as markup guard themselves: `SanitizedHtml` in the confirm and info
        // dialogs, a text node in context_menu.ts, `escapeHtml()` in note_autocomplete.ts.
        interpolation: { escapeValue: false },
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

