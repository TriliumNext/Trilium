import { dayjs, Dayjs } from "./dayjs.js";

/**
 * Week settings for calculating week numbers.
 */
export interface WeekSettings {
    /** First day of the week (1=Monday to 7=Sunday) */
    firstDayOfWeek: number;
    /**
     * How to determine the first week of the year:
     * - 0: First week contains first day of the year
     * - 1: First week contains first Thursday (ISO 8601 standard)
     * - 2: First week has minimum days
     */
    firstWeekOfYear: number;
    /** Minimum days in first week (used when firstWeekOfYear=2) */
    minDaysInFirstWeek: number;
}

/**
 * Default week settings (first week contains first day of year, week starts on Monday).
 */
export const DEFAULT_WEEK_SETTINGS: WeekSettings = {
    firstDayOfWeek: 1,
    firstWeekOfYear: 0,
    minDaysInFirstWeek: 4
};

/**
 * Gets the first day of week 1 for a given year, based on user settings.
 *
 * @param year The year to calculate for
 * @param settings Week calculation settings
 * @returns The first day of week 1
 */
export function getFirstDayOfWeek1(year: number, settings: WeekSettings = DEFAULT_WEEK_SETTINGS): Dayjs {
    const { firstDayOfWeek, firstWeekOfYear, minDaysInFirstWeek } = settings;

    const jan1 = dayjs(`${year}-01-01`);
    const jan1Weekday = jan1.isoWeekday(); // 1=Monday, 7=Sunday

    // Calculate the first day of the week containing Jan 1
    const daysToSubtract = (jan1Weekday - firstDayOfWeek + 7) % 7;
    const weekContainingJan1Start = jan1.subtract(daysToSubtract, "day");

    if (firstWeekOfYear === 0) {
        // First week contains first day of the year
        return weekContainingJan1Start;
    } else if (firstWeekOfYear === 1) {
        // First week contains first Thursday (ISO 8601 standard)
        const jan4 = dayjs(`${year}-01-04`);
        const jan4Weekday = jan4.isoWeekday();
        const daysToSubtractFromJan4 = (jan4Weekday - firstDayOfWeek + 7) % 7;
        return jan4.subtract(daysToSubtractFromJan4, "day");
    } else {
        // First week has minimum days
        const daysInFirstWeek = 7 - daysToSubtract;
        if (daysInFirstWeek >= minDaysInFirstWeek) {
            return weekContainingJan1Start;
        } else {
            return weekContainingJan1Start.add(1, "week");
        }
    }
}

/**
 * Gets the week year and week number for a given date based on user settings.
 *
 * @param date The date to calculate week info for
 * @param settings Week calculation settings
 * @returns Object with weekYear and weekNumber
 */
export function getWeekInfo(date: Dayjs, settings: WeekSettings = DEFAULT_WEEK_SETTINGS): { weekYear: number; weekNumber: number } {
    const { firstDayOfWeek } = settings;

    // Get the start of the week containing this date
    const dateWeekday = date.isoWeekday();
    const daysToSubtract = (dateWeekday - firstDayOfWeek + 7) % 7;
    const weekStart = date.subtract(daysToSubtract, "day");

    // Try current year first
    let year = date.year();
    let firstDayOfWeek1 = getFirstDayOfWeek1(year, settings);

    // If the week start is before week 1 of current year, it belongs to previous year
    if (weekStart.isBefore(firstDayOfWeek1)) {
        year--;
        firstDayOfWeek1 = getFirstDayOfWeek1(year, settings);
    } else {
        // Check if this might belong to next year's week 1
        const nextYearFirstDayOfWeek1 = getFirstDayOfWeek1(year + 1, settings);
        if (!weekStart.isBefore(nextYearFirstDayOfWeek1)) {
            year++;
            firstDayOfWeek1 = nextYearFirstDayOfWeek1;
        }
    }

    // Calculate week number
    const weekNumber = weekStart.diff(firstDayOfWeek1, "week") + 1;

    return { weekYear: year, weekNumber };
}

/**
 * Generates a week string in the format "YYYY-Www" (e.g., "2026-W01").
 *
 * @param date The date to generate the week string for
 * @param settings Week calculation settings
 * @returns Week string in format "YYYY-Www"
 */
export function getWeekString(date: Dayjs, settings: WeekSettings = DEFAULT_WEEK_SETTINGS): string {
    const { weekYear, weekNumber } = getWeekInfo(date, settings);
    return `${weekYear}-W${weekNumber.toString().padStart(2, "0")}`;
}

/**
 * Gets the start date of the week containing the given date.
 *
 * @param date The date to find the week start for
 * @param firstDayOfWeek First day of the week (1=Monday to 7=Sunday)
 * @returns The start of the week
 */
export function getWeekStartDate(date: Dayjs, firstDayOfWeek: number = 1): Dayjs {
    const dateWeekday = date.isoWeekday();
    const diff = (dateWeekday - firstDayOfWeek + 7) % 7;
    return date.clone().subtract(diff, "day").startOf("day");
}

/**
 * Parses a week string and returns the start date of that week.
 *
 * @param weekStr Week string in format "YYYY-Www" (e.g., "2026-W01")
 * @param settings Week calculation settings
 * @returns The start date of the week
 */
export function parseWeekString(weekStr: string, settings: WeekSettings = DEFAULT_WEEK_SETTINGS): Dayjs {
    const [yearStr, weekNumStr] = weekStr.trim().split("-W");
    const weekNumber = parseInt(weekNumStr);
    const weekYear = parseInt(yearStr);

    const firstDayOfWeek1 = getFirstDayOfWeek1(weekYear, settings);
    return firstDayOfWeek1.add(weekNumber - 1, "week");
}
