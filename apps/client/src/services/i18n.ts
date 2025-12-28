import options from "./options.js";
import i18next from "i18next";
import i18nextHttpBackend from "i18next-http-backend";
import server from "./server.js";
import { LOCALE_IDS, setDayjsLocale, type Locale } from "@triliumnext/commons";
import { initReactI18next } from "react-i18next";

let locales: Locale[] | null;

/**
 * A deferred promise that resolves when translations are initialized.
 */
export let translationsInitializedPromise = $.Deferred();

export async function initLocale() {
    const locale = ((options.get("locale") as string) || "en") as LOCALE_IDS;

    locales = await server.get<Locale[]>("options/locales");

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
    if (!locales) {
        throw new Error("Tried to load list of locales, but localization is not yet initialized.")
    }

    return locales;
}

/**
 * Finds the given locale by ID.
 *
 * @param localeId the locale ID to search for.
 * @returns the corresponding {@link Locale} or `null` if it was not found.
 */
export function getLocaleById(localeId: string | null | undefined) {
    if (!localeId) return null;
    return locales?.find((l) => l.id === localeId) ?? null;
}

export const t = i18next.t;
export const getCurrentLanguage = () => i18next.language;
