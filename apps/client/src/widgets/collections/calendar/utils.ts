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

    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - offset * 60 * 1000);
    return localDate.toISOString().split("T")[0];
}

export function offsetDate(date: Date | string | null | undefined, offset: number) {
    if (!date) {
        return undefined;
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

/** The labels the calendar draws an event by, each of which a note may rename for itself via the
 *  matching `#calendar:` label (see {@link getCustomisableLabel}). */
export type EventLabelName = "startDate" | "endDate" | "startTime" | "endTime" | "recurrence";

export const EVENT_LABELS: EventLabelName[] = [ "startDate", "endDate", "startTime", "endTime", "recurrence" ];

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

// Bounds for a FullCalendar slot duration / label interval, in seconds.
const MIN_DURATION_SECONDS = 60; // 1 minute
const MAX_DURATION_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * How long a `HH:MM:SS` duration lasts, in seconds, or `null` for anything not written that way.
 * Says nothing about whether the length is one a calendar will take (see {@link isValidDuration});
 * a caller that has already asked that can read the answer here.
 */
export function parseDurationSeconds(str: string | null | undefined): number | null {
    const match = str?.match(/^(\d{2}):([0-5]\d):([0-5]\d)$/);
    if (!match) return null;

    const [, hours, minutes, seconds] = match;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** Whether a duration is written as `HH:MM:SS` and lasts a length a calendar will take. Answers
 *  as a narrowing, a duration that passes being a string a caller can go on to use. */
export function isValidDuration(str: string | null | undefined): str is string {
    // The regex already constrains minutes/seconds to 00–59, so only the total needs bounding.
    const totalSeconds = parseDurationSeconds(str);
    if (totalSeconds === null) return false;

    return totalSeconds >= MIN_DURATION_SECONDS && totalSeconds <= MAX_DURATION_SECONDS;
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
