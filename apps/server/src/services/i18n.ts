import { dayjs, LOCALES, LOCALE_IDS, setDayjsLocale, type Dayjs } from "@triliumnext/commons";
import i18next from "i18next";
import { join } from "path";

import { getResourceDir } from "./utils";
import options from "./options.js";
import sql_init from "./sql_init.js";
import hidden_subtree from "./hidden_subtree.js";

/**
 * Initialize translations with explicit i18next instance and locale.
 * Used as a TranslationProvider callback for initializeCore().
 */
export async function initializeTranslationsWithParams(i18nextInstance: typeof i18next, locale: LOCALE_IDS) {
    const resourceDir = getResourceDir();
    const Backend = (await import("i18next-fs-backend/cjs")).default;

    // Initialize translations
    await i18nextInstance.use(Backend).init({
        lng: locale,
        fallbackLng: "en",
        ns: "server",
        backend: {
            loadPath: join(resourceDir, "assets/translations/{{lng}}/{{ns}}.json")
        }
    });

    // Initialize dayjs locale.
    await setDayjsLocale(locale);
}

/**
 * Initialize translations using the global i18next instance and locale from options.
 * Convenience function for scripts that don't use initializeCore().
 */
export async function initializeTranslations() {
    const locale = getCurrentLanguage();
    await initializeTranslationsWithParams(i18next, locale);
}

export function ordinal(date: Dayjs) {
    return dayjs(date).format("Do");
}

function getCurrentLanguage(): LOCALE_IDS {
    let language: string | null = null;
    if (sql_init.isDbInitialized()) {
        language = options.getOptionOrNull("locale");
    }

    if (!language) {
        console.info("Language option not found, falling back to en.");
        language = "en";
    }

    return language as LOCALE_IDS;
}

export async function changeLanguage(locale: string) {
    await i18next.changeLanguage(locale);
    hidden_subtree.checkHiddenSubtree(true, { restoreNames: true });
}

export function getCurrentLocale() {
    const localeId = options.getOptionOrNull("locale") ?? "en";
    const currentLocale = LOCALES.find(l => l.id === localeId);
    if (!currentLocale) return LOCALES.find(l => l.id === "en")!;
    return currentLocale;
}
