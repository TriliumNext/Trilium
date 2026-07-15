import { t } from "../services/i18n";
import options from "../services/options";

type DateTimeStyle = "full" | "long" | "medium" | "short" | "none" | undefined;

/** Seconds-per-unit multipliers offered by the settings time-scale dropdowns. */
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/**
 * Formats a duration held as a settings pair — a total in `seconds` plus the seconds-per-unit
 * `timeScale` the user picked (1 / 60 / 3600 / 86400) — into a localized, pluralized phrase such as
 * "7 days" or "12 hours".
 *
 * The value is reported in the unit the user actually chose rather than being re-derived from the
 * raw seconds, so it always matches what the settings page shows. A fuzzy humanizer would instead
 * collapse distinct windows (both 30 and 45 days become "a month") — misleading for a setting that
 * governs when data is destroyed.
 *
 * @returns `null` when the duration is unknown. Options load asynchronously, so `useTriliumOptionInt`
 *          yields `NaN` until the fetch resolves; returning `null` (rather than a string) makes callers
 *          drop the whole phrase instead of rendering "NaN days" — or an empty gap — inside a sentence.
 */
export function formatDuration(seconds: number, timeScale: number): string | null {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return null;
    }

    // A NaN/absent scale fails this comparison and falls back to days.
    const scale = timeScale > 0 ? timeScale : SECONDS_PER_DAY;
    const count = Math.round(seconds / scale);

    switch (scale) {
        case 1:
            return t("time_interval.seconds", { count });
        case SECONDS_PER_MINUTE:
            return t("time_interval.minutes", { count });
        case SECONDS_PER_HOUR:
            return t("time_interval.hours", { count });
        case SECONDS_PER_DAY:
            return t("time_interval.days", { count });
        default:
            // An unrecognized scale can't name a unit, so report the window in days.
            return t("time_interval.days", { count: Math.round(seconds / SECONDS_PER_DAY) });
    }
}

/**
 * Formats the given date and time to a string based on the current locale.
 */
export function formatDateTime(date: string | Date | number | null | undefined, dateStyle: DateTimeStyle = "medium", timeStyle: DateTimeStyle = "medium") {
    if (!date) {
        return "";
    }

    const locale = normalizeLocale(options.get("formattingLocale") || options.get("locale") || navigator.language);

    let parsedDate: Date;
    if (typeof date === "string" || typeof date === "number") {
        const dateOnlyMatch = typeof date === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        if (dateOnlyMatch) {
            // A date-only string ("YYYY-MM-DD") is parsed as UTC midnight by the Date
            // constructor, so it rolls back to the previous day when displayed in a
            // negative UTC offset (e.g. the Recent Changes date headers). Treat it as a
            // local calendar date so the same day is shown regardless of timezone.
            const [ , year, month, day ] = dateOnlyMatch;
            parsedDate = new Date(Number(year), Number(month) - 1, Number(day));
        } else {
            // Parse the given string as a date
            parsedDate = new Date(date);
        }
    } else if (date instanceof Date) {
        // The given date is already a Date instance or a number
        parsedDate = date;
    } else {
        // Invalid type
        throw new TypeError(`Invalid type for the "date" argument.`);
    }

    if (timeStyle !== "none" && dateStyle !== "none") {
        // Format the date and time
        try {
            const formatter = new Intl.DateTimeFormat(locale, { dateStyle, timeStyle });
            return formatter.format(parsedDate);
        } catch (e) {
            const formatter = new Intl.DateTimeFormat(undefined, { dateStyle, timeStyle });
            return formatter.format(parsedDate);
        }
    } else if (timeStyle === "none" && dateStyle !== "none") {
        // Format only the date
        try {
            return parsedDate.toLocaleDateString(locale, { dateStyle });
        } catch (e) {
            return parsedDate.toLocaleDateString(undefined, { dateStyle });
        }
    } else if (dateStyle === "none" && timeStyle !== "none") {
        // Format only the time
        try {
            return parsedDate.toLocaleTimeString(locale, { timeStyle });
        } catch (e) {
            return parsedDate.toLocaleTimeString(undefined, { timeStyle });
        }
    }

    throw new Error("Incorrect state.");
}

export function normalizeLocale(locale: string) {
    locale = locale.replaceAll("_", "-");
    switch (locale) {
        case "cn": return "zh-CN";
        case "tw": return "zh-TW";
        default: return locale;
    }
}
