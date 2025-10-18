import i18next from "i18next";
import options from "./options.js";
import sql_init from "./sql_init.js";
import { join } from "path";
import { getResourceDir } from "./utils.js";
import hidden_subtree from "./hidden_subtree.js";
import { LOCALES, type Locale, type LOCALE_IDS } from "@triliumnext/commons";
import dayjs, { Dayjs } from "dayjs";

export const DAYJS_LOADER: Record<LOCALE_IDS, () => Promise<typeof import("dayjs/locale/en.js")>> = {
    "ar": () => import("dayjs/locale/ar.js"),
    "cn": () => import("dayjs/locale/zh-cn.js"),
    "de": () => import("dayjs/locale/de.js"),
    "en": () => import("dayjs/locale/en.js"),
    "en_rtl": () => import("dayjs/locale/en.js"),
    "es": () => import("dayjs/locale/es.js"),
    "fa": () => import("dayjs/locale/fa.js"),
    "fr": () => import("dayjs/locale/fr.js"),
    "he": () => import("dayjs/locale/he.js"),
    "ja": () => import("dayjs/locale/ja.js"),
    "ku": () => import("dayjs/locale/ku.js"),
    "pt_br": () => import("dayjs/locale/pt-br.js"),
    "pt": () => import("dayjs/locale/pt.js"),
    "ro": () => import("dayjs/locale/ro.js"),
    "ru": () => import("dayjs/locale/ru.js"),
    "tw": () => import("dayjs/locale/zh-tw.js"),
    "uk": () => import("dayjs/locale/uk.js"),
}

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
    const dayjsLocale = DAYJS_LOADER[locale];
    if (dayjsLocale) {
        dayjs.locale(await dayjsLocale());
    }
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
