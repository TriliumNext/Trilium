import { DateSelectArg } from "@fullcalendar/core/index.js";
import { EventImpl } from "@fullcalendar/core/internal";
import FNote from "../../../entities/fnote";

export function parseStartEndDateFromEvent(e: DateSelectArg | EventImpl) {
    const startDate = formatDateToLocalISO(e.start);
    if (!startDate) {
        return { startDate: null, endDate: null };
    }
    let endDate;
    if (e.allDay) {
        endDate = formatDateToLocalISO(offsetDate(e.end, -1));
    } else {
        endDate = formatDateToLocalISO(e.end);
    }
    return { startDate, endDate };
}

export function parseStartEndTimeFromEvent(e: DateSelectArg | EventImpl) {
    let startTime: string | undefined | null = null;
    let endTime: string | undefined | null = null;
    if (!e.allDay) {
        startTime = formatTimeToLocalISO(e.start);
        endTime = formatTimeToLocalISO(e.end);
    }

    return { startTime, endTime };
}

export function formatDateToLocalISO(date: Date | null | undefined) {
    if (!date) {
        return undefined;
    }

    // Use local date methods directly - no timezone conversion needed
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function offsetDate(date: Date | string | null | undefined, offset: number) {
    if (!date) {
        return undefined;
    }

    // When given a date string (YYYY-MM-DD), parse as local time rather than UTC
    // to avoid timezone-related off-by-one errors
    if (typeof date === 'string') {
        const [year, month, day] = date.split('-').map(Number);
        const newDate = new Date(year, month - 1, day);
        newDate.setDate(newDate.getDate() + offset);
        return newDate;
    }

    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + offset);
    return newDate;
}

export function formatTimeToLocalISO(date: Date | null | undefined) {
    if (!date) {
        return undefined;
    }

    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - offset * 60 * 1000);
    return localDate.toISOString()
        .split("T")[1]
        .substring(0, 5);
}

/**
 * Allows the user to customize the attribute from which to obtain a particular value. For example, if `customLabelNameAttribute` is `calendar:startDate`
 * and `defaultLabelName` is `startDate` and the note at hand has `#calendar:startDate=myStartDate #myStartDate=2025-02-26` then the value returned will
 * be `2025-02-26`. If there is no custom attribute value, then the value of the default attribute is returned instead (e.g. `#startDate`).
 *
 * @param note the note from which to read the values.
 * @param defaultLabelName the name of the label in case a custom value is not found.
 * @param customLabelNameAttribute the name of the label to look for a custom value.
 * @returns the value of either the custom label or the default label.
 */
export function getCustomisableLabel(note: FNote, defaultLabelName: string, customLabelNameAttribute: string) {
    const customAttributeName = note.getLabelValue(customLabelNameAttribute);
    if (customAttributeName) {
        const customValue = note.getLabelValue(customAttributeName);
        if (customValue) {
            return customValue;
        }
    }

    return note.getLabelValue(defaultLabelName);
}

// Source: https://stackoverflow.com/a/30465299/4898894
export function getMonthsInDateRange(startDate: string, endDate: string) {
    const start = startDate.split("-");
    const end = endDate.split("-");
    const startYear = parseInt(start[0]);
    const endYear = parseInt(end[0]);
    const dates: string[] = [];

    for (let i = startYear; i <= endYear; i++) {
        const endMonth = i != endYear ? 11 : parseInt(end[1]) - 1;
        const startMon = i === startYear ? parseInt(start[1]) - 1 : 0;

        for (let j = startMon; j <= endMonth; j = j > 12 ? j % 12 || 11 : j + 1) {
            const month = j + 1;
            const displayMonth = month < 10 ? "0" + month : month;
            dates.push([i, displayMonth].join("-"));
        }
    }
    return dates;
}
