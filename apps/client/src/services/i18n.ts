import { LOCALE_IDS, LOCALES, setDayjsLocale } from "@triliumnext/commons";
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

export function getAvailableLocales() {
    return LOCALES;
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
