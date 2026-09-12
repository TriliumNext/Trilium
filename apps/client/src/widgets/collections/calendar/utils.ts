import { DateSelectInfo, EventApi } from "fullcalendar";

import FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import froca from "../../../services/froca";
import { AttributeRow, BranchRow } from "../../../services/load_results";

export function parseStartEndDateFromEvent(e: DateSelectInfo | EventApi) {
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

export function parseStartEndTimeFromEvent(e: DateSelectInfo | EventApi) {
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

/**
 * Whether an attribute change reaches any of the notes the calendar draws, and so asks for the
 * events to be built again.
 *
 * A label written on the note itself is the plain case, and the only one this used to answer. But
 * everything the event builder reads — the colour, the icon, the dates, the promoted attributes —
 * it reads through inheritance (`getLabelValue`), so the same value can just as well come from an
 * inheritable label on an ancestor or from a template, neither of which is one of the drawn notes.
 * A `#color` moved onto the collection note itself changed every chip's colouring and refreshed
 * nothing.
 *
 * Rows naming a drawn note outright are answered by a set lookup, and only the rest are put to
 * {@link attributes.isAffecting}, which walks the very inheritance the builder reads through.
 */
export function isAttributeChangeAffecting(attributeRows: AttributeRow[], noteIds: Iterable<string>) {
    const drawnNoteIds = new Set(noteIds);

    return attributeRows.some((row) => {
        if (row.noteId && drawnNoteIds.has(row.noteId)) {
            return true;
        }

        for (const noteId of drawnNoteIds) {
            if (attributes.isAffecting(row, froca.getNoteFromCache(noteId))) {
                return true;
            }
        }

        return false;
    });
}

/**
 * Whether a note has been filed somewhere a calendar root draws from, and so asks for the events to
 * be built again — a day note made by a click on an empty day, a note dropped under one afterwards,
 * or either of them taken away.
 *
 * Asked of the branches rather than of the ids because a root builds its events from the calendar
 * note and the range it is showing, not from a list: the day note just made is in no list yet, and
 * the list the collection keeps is a refresh behind at this point anyway. Anywhere within the
 * journal counts, a day note being reachable only through the year and month notes above it —
 * whichever of the three the reload happens to name, the branch of the outermost new one hangs off
 * something already known.
 */
export function isBranchChangeAffecting(branchRows: BranchRow[], rootNoteId: string, noteIds: Iterable<string>) {
    const drawnNoteIds = new Set(noteIds);

    return branchRows.some(({ parentNoteId }) =>
        parentNoteId === rootNoteId || (!!parentNoteId && drawnNoteIds.has(parentNoteId)));
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
