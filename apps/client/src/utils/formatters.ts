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

    const locale = getFormattingLocale();
    const parsedDate = parseDate(date);

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

/**
 * Formats the given date with all-numeric components and a four-digit year, e.g. "31.01.2026" in
 * German or "01/31/2026" in US English. The locale still decides field order and separators.
 *
 * The `dateStyle` presets cannot express this. They map to each locale's CLDR patterns, which are
 * authored per locale: "short" drops to a two-digit year in some locales (`31.01.26` in German) but
 * not others (`31/01/2026` in French), and "medium" spells the month out in some (`Jan 31, 2026`)
 * while staying numeric in others. Prefer this where a compact, unambiguous and locale-consistent
 * date matters, such as a table column, and `formatDateTime()` for prose.
 *
 * @param withTime also renders the time, for values that carry one.
 */
export function formatDateNumeric(date: string | Date | number | null | undefined, withTime = false) {
    if (!date) {
        return "";
    }

    const locale = getFormattingLocale();
    const parsedDate = parseDate(date);
    const formatOptions: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
    if (withTime) {
        // Pad the hour the way the locale's own short time pattern does: a 24-hour locale writes
        // "02:05", a 12-hour one "2:05 AM". Either fixed choice is wrong somewhere, and `timeStyle`
        // -- which would get both right -- cannot be combined with explicit date components.
        formatOptions.hour = is12HourLocale(locale) ? "numeric" : "2-digit";
        formatOptions.minute = "2-digit";
    }

    try {
        return new Intl.DateTimeFormat(locale, formatOptions).format(parsedDate);
    } catch (e) {
        // An unusable locale (e.g. the dev-only "en_rtl", which normalizes to the invalid "en-rtl")
        // makes the constructor throw; fall back to the environment default.
        return new Intl.DateTimeFormat(undefined, formatOptions).format(parsedDate);
    }
}

function is12HourLocale(locale: string) {
    try {
        return isTwelveHourCycle(new Intl.DateTimeFormat(locale, { hour: "numeric" }));
    } catch (e) {
        // Same unusable-locale fallback as the caller, so both agree on which cycle is in play.
        return isTwelveHourCycle(new Intl.DateTimeFormat(undefined, { hour: "numeric" }));
    }
}

function isTwelveHourCycle(formatter: Intl.DateTimeFormat) {
    const { hourCycle } = formatter.resolvedOptions();
    return hourCycle === "h11" || hourCycle === "h12";
}

function getFormattingLocale() {
    return normalizeLocale(options.get("formattingLocale") || options.get("locale") || navigator.language);
}

function parseDate(date: string | Date | number): Date {
    if (typeof date === "string" || typeof date === "number") {
        const dateOnlyMatch = typeof date === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        if (dateOnlyMatch) {
            // A date-only string ("YYYY-MM-DD") is parsed as UTC midnight by the Date
            // constructor, so it rolls back to the previous day when displayed in a
            // negative UTC offset (e.g. the Recent Changes date headers). Treat it as a
            // local calendar date so the same day is shown regardless of timezone.
            const [ , year, month, day ] = dateOnlyMatch;
            return new Date(Number(year), Number(month) - 1, Number(day));
        }

        // Parse the given string as a date
        return new Date(date);
    } else if (date instanceof Date) {
        // The given date is already a Date instance or a number
        return date;
    }

    // Invalid type
    throw new TypeError(`Invalid type for the "date" argument.`);
}

export function normalizeLocale(locale: string) {
    locale = locale.replaceAll("_", "-");
    switch (locale) {
        case "cn": return "zh-CN";
        case "tw": return "zh-TW";
        default: return locale;
    }
}

/**
 * Whether distances should be shown in miles or in kilometres, for consumers such as the geo map's
 * scale bar.
 *
 * `Intl` exposes no measurement system (the locale-info proposal dropped it), so the locale's region
 * is matched against the short list of countries that still state road distances in miles. A locale
 * carrying no region is maximized first, which is what makes Trilium's plain `en` -- listed as
 * "English (United States)" -- resolve to `US`; `en-GB` is a separate entry and resolves to `GB`.
 */
export function getMeasurementSystem(): "metric" | "imperial" {
    // An explicitly chosen formatting locale wins. Failing that the browser's locale is preferred
    // over what getFormattingLocale() would settle on (the UI language), because the UI language
    // says nothing about where the user is -- an English UI is common well outside the US.
    for (const candidate of [ options.get("formattingLocale"), navigator.language, getFormattingLocale() ]) {
        const region = candidate && getRegion(candidate);
        if (region) {
            return IMPERIAL_REGIONS.has(region) ? "imperial" : "metric";
        }
    }

    return "metric";
}

/** Regions that state road distances in miles rather than kilometres. */
const IMPERIAL_REGIONS = new Set([ "US", "GB", "LR", "MM" ]);

function getRegion(locale: string) {
    try {
        return new Intl.Locale(normalizeLocale(locale)).maximize().region;
    } catch (e) {
        // An unusable locale (e.g. the dev-only "en_rtl") makes the constructor throw; the caller
        // then falls through to the browser's own locale.
        return undefined;
    }
}
