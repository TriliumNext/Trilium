import i18next from "i18next";
import options from "./options.js";
import sql_init from "./sql_init.js";
import { join } from "path";
import { getResourceDir } from "./utils.js";
import hidden_subtree from "./hidden_subtree.js";
import { dayjs, LOCALES, setDayjsLocale, type Dayjs, type Locale, type LOCALE_IDS } from "@triliumnext/commons";

export async function initializeTranslations() {
    const resourceDir = getResourceDir();
    const Backend = (await import("i18next-fs-backend/cjs")).default;
    const locale = getCurrentLanguage();

    // Initialize translations
    await i18next.use(Backend).init({
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
