type DateTimeStyle = "full" | "long" | "medium" | "short" | "none" | undefined;

/**
 * Formats the given date and time to a string based on the current locale.
 */
export function formatDateTime(date: string | Date | number | null | undefined, dateStyle: DateTimeStyle = "medium", timeStyle: DateTimeStyle = "medium") {
    if (!date) {
        return "";
    }

    const locale = navigator.language;

    let parsedDate;
    if (typeof date === "string" || typeof date === "number") {
        // Parse the given string as a date
        parsedDate = new Date(date);
    } else if (date instanceof Date) {
        // The given date is already a Date instance or a number
        parsedDate = date;
    } else {
        // Invalid type
        throw new TypeError(`Invalid type for the "date" argument.`);
    }

    if (timeStyle !== "none" && dateStyle !== "none") {
        // Format the date and time
        const formatter = new Intl.DateTimeFormat(navigator.language, { dateStyle, timeStyle });
        return formatter.format(parsedDate);
    } else if (timeStyle === "none" && dateStyle !== "none") {
        // Format only the date
        return parsedDate.toLocaleDateString(locale, { dateStyle });
    } else if (dateStyle === "none" && timeStyle !== "none") {
        // Format only the time
        return parsedDate.toLocaleTimeString(locale, { timeStyle });
    }

    throw new Error("Incorrect state.");
}
