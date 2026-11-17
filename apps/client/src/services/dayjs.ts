import type { LOCALE_IDS } from "@triliumnext/commons";
import { dayjs, type Dayjs, setDayjsLocale } from "@triliumnext/commons/src/lib/dayjs.js";
import i18next from "i18next";

import { formatDateTime } from "./utils.js";

/*
 * The client's dayjs, in the language of the app. Client code imports it from here rather than from
 * `@triliumnext/commons`, so dayjs loads with the first module that shows or parses a date.
 *
 * The locale is applied without a top-level `await`: the bundle puts dayjs in this module's chunk,
 * and a dayjs locale chunk imports dayjs, so it cannot evaluate until this module has.
 */
i18next.on("languageChanged", (language) => void setDayjsLocale(language as LOCALE_IDS));
if (i18next.language) {
    void setDayjsLocale(i18next.language as LOCALE_IDS);
}

/** Formats `date` with the user's custom date and time format, or as ISO date and time without one. */
export function formatCustomDateTime(date: Date, format: string | null | undefined) {
    return format?.trim() ? dayjs(date).format(format) : formatDateTime(date);
}

export { dayjs, type Dayjs };
