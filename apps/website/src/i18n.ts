import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import { LOCALES } from "./locales";

export { type Locale, LOCALES } from "./locales";

i18next.use(initReactI18next);
const localeFiles = import.meta.glob("./translations/*/translation.json", { eager: true });
const resources: Record<string, Record<string, Record<string, string>>> = {};
for (const [ path, module ] of Object.entries(localeFiles)) {
    const id = path.split("/").at(-2);
    if (!id) continue;

    const translations = (module as any).default ?? module;
    resources[id] = { translation: translations };
}

export function initTranslations(lng: string) {
    i18next.init({
        fallbackLng: "en",
        lng,
        returnEmptyString: false,
        resources,
        initAsync: false,
        react: {
            useSuspense: false
        }
    });
}

/**
 * Resolves a language tag, either a URL segment or `navigator.language`, to a locale
 * from {@link LOCALES}, falling back to `en` for languages the website does not offer.
 */
export function mapLocale(locale: string) {
    if (!locale) return "en";
    const lower = locale.toLowerCase();

    // Chinese is offered by script, which browsers report only through the region.
    if (lower.startsWith("zh")) {
        const traditional = [ "tw", "hk", "mo", "hant" ].some(marker => lower.includes(marker));
        return traditional ? "zh-Hant" : "zh-Hans";
    }

    const exact = LOCALES.find(l => l.id.toLowerCase() === lower);
    if (exact) return exact.id;

    // "de-AT" falls back to "de". The region-less entry wins over a regional one sharing
    // the language, so "en-US" reaches "en" rather than whichever of "en"/"en-GB" sorts first.
    const language = lower.split("-")[0];
    const regionless = LOCALES.find(l => l.id.toLowerCase() === language);
    if (regionless) return regionless.id;

    // A bare "nb" reaches "nb-NO", the only region offered for it.
    const sameLanguage = LOCALES.find(l => l.id.toLowerCase().split("-")[0] === language);
    return sameLanguage?.id ?? "en";
}

export function swapLocaleInUrl(url: string, newLocale: string) {
    const components = url.split("/");
    if (components.length === 2) {
        const potentialLocale = components[1];
        const correspondingLocale = LOCALES.find(l => l.id === potentialLocale);
        if (correspondingLocale) {
            return `/${newLocale}`;
        } else {
            return `/${newLocale}${url}`;
        }
    } else {
        components[1] = newLocale;
        return components.join("/");
    }
}

export function extractLocaleFromUrl(url: string) {
    const localeId = url.split("/")[1];
    const correspondingLocale = LOCALES.find(l => l.id === localeId);
    if (!correspondingLocale) return undefined;
    return localeId;
}
