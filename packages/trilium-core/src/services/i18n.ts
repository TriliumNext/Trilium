import { dayjs, Dayjs, isDisplayableLocale, Locale, LOCALE_IDS, LOCALES, setDayjsLocale } from "@triliumnext/commons";
import sql_init from "./sql_init";
import options from "./options";
import i18next from "i18next";
import hidden_subtree from "./hidden_subtree";

export type TranslationProvider = (i18nextInstance: typeof i18next, locale: LOCALE_IDS) => Promise<void>;

export async function initTranslations(translationProvider: TranslationProvider) {
    const locale = getCurrentLanguage();

    await translationProvider(i18next, locale);

    // Initialize dayjs locale.
    await setDayjsLocale(locale);
}

export function ordinal(date: Dayjs) {
    return dayjs(date)
        .format("Do");
}

function getCurrentLanguage(): LOCALE_IDS {
    let language: string | null = null;
    if (sql_init.isDbInitialized()) {
        language = options.getOptionOrNull("locale");
        if (!language) {
            console.info("Language option not found, falling back to en.");
        }
    }

    return (language ?? "en") as LOCALE_IDS;
}

export async function changeLanguage(locale: string) {
    await i18next.changeLanguage(locale);
    hidden_subtree.checkHiddenSubtree(true, { restoreNames: true });

    // Virtual subtrees (e.g. the in-app help) build their titles with t() at injection time,
    // so a becca reload is needed to re-render them in the new language.
    const { reload } = await import("../becca/becca_loader.js");
    reload("locale changed");
}

/**
 * Re-syncs the active i18next (and dayjs) language with the document's stored `locale` option.
 *
 * `initTranslations` runs before `initSql` inside `initializeCore` (options_init needs translations), so
 * on the server/desktop boot path i18next is always initialized to the fallback "en" regardless of the
 * stored locale — it cannot read the option before the DB is open. Call this once the DB is initialized
 * and becca is loaded to bring i18next in line with the stored locale, so server-generated content (e.g.
 * the hidden-subtree titles rebuilt by the scheduler) is produced in the right language.
 *
 * This is language-only: it does not rebuild the hidden subtree, so user-renamed system notes are left
 * untouched (unlike {@link changeLanguage}). It is a no-op when the DB is uninitialized or the stored
 * locale already matches the active language.
 */
export async function reconcileLanguageAfterDbInit() {
    if (!sql_init.isDbInitialized()) {
        return;
    }

    const locale = options.getOptionOrNull("locale");
    if (!isDisplayableLocale(locale) || locale === i18next.language) {
        return;
    }

    await i18next.changeLanguage(locale);
    await setDayjsLocale(locale);
}

export function getCurrentLocale() {
    if (!sql_init.isDbInitialized()) {
        // If DB is not initialized, we cannot get the locale from options, so we return English as a default.
        return LOCALES.find(l => l.id === "en")!;
    }

    const localeId = options.getOptionOrNull("locale") ?? "en";
    const currentLocale = LOCALES.find(l => l.id === localeId);
    if (!currentLocale) return LOCALES.find(l => l.id === "en")!;
    return currentLocale;
}
