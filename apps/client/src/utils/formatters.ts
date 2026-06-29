import options from "../services/options";

type DateTimeStyle = "full" | "long" | "medium" | "short" | "none" | undefined;

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
