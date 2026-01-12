import { default as dayjs, type Dayjs } from "dayjs";

import "dayjs/plugin/advancedFormat";
import "dayjs/plugin/duration";
import "dayjs/plugin/isBetween";
import "dayjs/plugin/isoWeek";
import "dayjs/plugin/isSameOrAfter";
import "dayjs/plugin/isSameOrBefore";
import "dayjs/plugin/quarterOfYear";
import "dayjs/plugin/utc";

//#region Plugins
import advancedFormat from "dayjs/plugin/advancedFormat.js";
import duration from "dayjs/plugin/duration.js";
import isBetween from "dayjs/plugin/isBetween.js";
import isoWeek from "dayjs/plugin/isoWeek.js";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter.js";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore.js";
import quarterOfYear from "dayjs/plugin/quarterOfYear.js";
import utc from "dayjs/plugin/utc.js";
import { LOCALE_IDS } from "./i18n.js";

dayjs.extend(advancedFormat);
dayjs.extend(duration);
dayjs.extend(isBetween);
dayjs.extend(isoWeek);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);
dayjs.extend(quarterOfYear);
dayjs.extend(utc);
//#endregion

//#region Locales
export const DAYJS_LOADER: Record<LOCALE_IDS, () => Promise<typeof import("dayjs/locale/en.js")>> = {
    "ar": () => import("dayjs/locale/ar.js"),
    "cn": () => import("dayjs/locale/zh-cn.js"),
    "de": () => import("dayjs/locale/de.js"),
    "en": () => import("dayjs/locale/en.js"),
    "en-GB": () => import("dayjs/locale/en-gb.js"),
    "en_rtl": () => import("dayjs/locale/en.js"),
    "es": () => import("dayjs/locale/es.js"),
    "fa": () => import("dayjs/locale/fa.js"),
    "fr": () => import("dayjs/locale/fr.js"),
    "it": () => import("dayjs/locale/it.js"),
    "he": () => import("dayjs/locale/he.js"),
    "ja": () => import("dayjs/locale/ja.js"),
    "ku": () => import("dayjs/locale/ku.js"),
    "pt_br": () => import("dayjs/locale/pt-br.js"),
    "pt": () => import("dayjs/locale/pt.js"),
    "pl": () => import("dayjs/locale/pl.js"),
    "ro": () => import("dayjs/locale/ro.js"),
    "ru": () => import("dayjs/locale/ru.js"),
    "tw": () => import("dayjs/locale/zh-tw.js"),
    "uk": () => import("dayjs/locale/uk.js"),
}

async function setDayjsLocale(locale: LOCALE_IDS) {
    const dayjsLocale = DAYJS_LOADER[locale];
    if (dayjsLocale) {
        dayjs.locale(await dayjsLocale());
    }
}
//#endregion

export {
    dayjs,
    Dayjs,
    setDayjsLocale
};
