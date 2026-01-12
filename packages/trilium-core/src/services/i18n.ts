import { dayjs, Dayjs, Locale, LOCALE_IDS, LOCALES, setDayjsLocale } from "@triliumnext/commons";
import sql_init from "./sql_init";
import options from "./options";
import i18next from "i18next";
import hidden_subtree from "./hidden_subtree";

export type TranslationProvider = (locale: LOCALE_IDS) => Promise<void>;

export async function initTranslations(translationProvider: TranslationProvider) {
    const locale = getCurrentLanguage();

    await translationProvider(locale);

    // Initialize dayjs locale.
    await setDayjsLocale(locale);
}

export function ordinal(date: Dayjs) {
    return dayjs(date)
        .format("Do");
}

export function getLocales(): Locale[] {
    return LOCALES;
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
