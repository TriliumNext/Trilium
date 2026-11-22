import type { Locale, LOCALE_IDS } from "@triliumnext/commons";
import { getEnglishName, LOCALES } from "@triliumnext/commons/src/lib/i18n.js";
import i18next, { type BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";

import { type CatalogueScope, getNamespaces, takeCatalogue } from "./catalogue_requests.js";

/**
 * A deferred promise that resolves when translations are initialized.
 */
let resolveTranslationsInitialized = () => {};
export const translationsInitializedPromise = new Promise<void>((resolve) => {
    resolveTranslationsInitialized = resolve;
});

/**
 * The screens shown before the app itself — the setup wizard, the login page and the password
 * reset. Kept apart from the app catalogue because the wizard changes language on the spot, and
 * re-reading the whole thing to retitle one step costs seconds on a phone; these three pages need
 * about 11 KB of it between them.
 */
const ENTRY_NAMESPACE = "entry";

/** Reads each catalogue through `takeCatalogue()`, which hands over a request `index.ts` started. */
const catalogueBackend: BackendModule = {
    type: "backend",
    init() {},
    read(lng, ns, callback) {
        takeCatalogue(lng, ns).then(
            (catalogue) => callback(null, catalogue),
            (error: Error) => callback(error, false)
        );
    }
};

/**
 * @param scope which catalogue the page reads: `entry` for the pages shown before the app is
 *              available, `app` for the app itself — which reads both, since shared widgets such as
 *              the credentials form use `login.*` keys that live in the entry catalogue.
 */
export async function initLocale(locale: LOCALE_IDS = "en", scope: CatalogueScope = "app") {
    const namespaces = getNamespaces(scope);

    i18next.use(initReactI18next);
    await i18next.use(catalogueBackend).init({
        lng: locale,
        // Each catalogue arrives completed with the English strings its language lacks (see
        // translation-catalogues.mts), so neither English nor a base language such as `pt` for
        // `pt_br` is fetched as a fallback.
        fallbackLng: false,
        load: "currentOnly",
        ns: namespaces,
        defaultNS: namespaces[0],
        // Resolving through the entry catalogue on a miss keeps every call site writing
        // `t("login.password")` without having to know which of the two holds it.
        fallbackNS: ENTRY_NAMESPACE,
        // Interpolated values are not HTML-escaped: the client renders translated strings as text, where
        // escaping shows `&#x2F;` and `&#39;` to the reader. A string headed for a sink that takes HTML
        // escapes its own values: `Menu` titles and `highlightedNotePathTitle` callers use
        // `escapeHtml()`, and the confirm and info dialogs render through `SanitizedHtml`.
        interpolation: { escapeValue: false },
        returnEmptyString: false
    });

    resolveTranslationsInitialized();
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
    return LOCALES.map((locale) => {
        const englishName = getEnglishAnnotation(locale, englishNames);
        return { ...locale, name: englishName ? `${locale.name} (${englishName})` : locale.name };
    });
}

/**
 * The English name a development build shows after the native name of `locale`, or `null` in
 * production and where the English name would repeat the native one.
 *
 * @param englishNames a formatter to reuse, for a caller naming a whole list of locales at once.
 */
export function getEnglishAnnotation(locale: Locale, englishNames?: Intl.DisplayNames) {
    if (!window.glob.isDev) return null;

    const englishName = getEnglishName(locale.id, englishNames);
    return englishName && englishName !== locale.name ? englishName : null;
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

