import { describe, expect, it } from "vitest";

import { formatDateToLocalISO, formatTimeToLocalISO, getMonthsInDateRange, offsetDate, parseStartEndDateFromEvent, parseStartEndTimeFromEvent } from "./utils";

/**
 * A moment built in the machine's own zone, which is what the calendar hands these functions: a
 * click on the grid names a wall-clock time, not an instant in UTC. Built this way the expectations
 * below hold in any zone the suite happens to run in — the functions answer with the local reading,
 * and that is the reading these arguments were written in.
 */
function localDate(year: number, month: number, day: number, hours = 0, minutes = 0) {
    return new Date(year, month - 1, day, hours, minutes);
}

/** What the calendar hands over for a selection or an event: the two ends and whether it is all-day. */
function span(start: Date | null, end: Date | null, allDay: boolean) {
    return { start, end, allDay } as unknown as Parameters<typeof parseStartEndDateFromEvent>[0];
}

describe("formatDateToLocalISO", () => {
    it("says the day as it reads on the local clock, whatever the time of day", () => {
        expect(formatDateToLocalISO(localDate(2026, 6, 5))).toBe("2026-06-05");
        // Either side of midnight, where a UTC reading would slip to a neighbouring day in most zones.
        expect(formatDateToLocalISO(localDate(2026, 6, 5, 23, 59))).toBe("2026-06-05");
        expect(formatDateToLocalISO(localDate(2026, 1, 1, 0, 30))).toBe("2026-01-01");
    });

    it("has nothing to say for a moment that was never given", () => {
        expect(formatDateToLocalISO(null)).toBeUndefined();
        expect(formatDateToLocalISO(undefined)).toBeUndefined();
    });
});

describe("formatTimeToLocalISO", () => {
    it("says the hour and minute on the local clock, dropping the seconds", () => {
        expect(formatTimeToLocalISO(localDate(2026, 6, 5, 13, 30))).toBe("13:30");
        expect(formatTimeToLocalISO(localDate(2026, 6, 5, 0, 0))).toBe("00:00");
        expect(formatTimeToLocalISO(localDate(2026, 6, 5, 23, 59))).toBe("23:59");
    });

    it("has nothing to say for a moment that was never given", () => {
        expect(formatTimeToLocalISO(null)).toBeUndefined();
        expect(formatTimeToLocalISO(undefined)).toBeUndefined();
    });
});

describe("offsetDate", () => {
    it("walks a date by whole days, over the end of a month and of a year", () => {
        expect(formatDateToLocalISO(offsetDate(localDate(2026, 6, 5), 1))).toBe("2026-06-06");
        expect(formatDateToLocalISO(offsetDate(localDate(2026, 6, 5), -1))).toBe("2026-06-04");
        expect(formatDateToLocalISO(offsetDate(localDate(2026, 6, 30), 1))).toBe("2026-07-01");
        expect(formatDateToLocalISO(offsetDate(localDate(2026, 1, 1), -1))).toBe("2025-12-31");
    });

    it("takes a date written out as well as one already built", () => {
        expect(formatDateToLocalISO(offsetDate("2026-06-05T00:00:00", 2))).toBe("2026-06-07");
    });

    it("has nothing to walk where no date was given", () => {
        expect(offsetDate(null, 1)).toBeUndefined();
        expect(offsetDate(undefined, 1)).toBeUndefined();
        // The empty string is no date either, and is what an unfilled label reads as.
        expect(offsetDate("", 1)).toBeUndefined();
    });
});

describe("parseStartEndDateFromEvent", () => {
    it("takes the end of an all-day span back a day, the calendar's own end being exclusive", () => {
        // FullCalendar says a span covering the 5th and the 6th as ending on the 7th.
        expect(parseStartEndDateFromEvent(span(localDate(2026, 6, 5), localDate(2026, 6, 7), true)))
            .toEqual({ startDate: "2026-06-05", endDate: "2026-06-06" });
    });

    it("keeps the end of a timed span as it stands, that one naming the day it falls on", () => {
        expect(parseStartEndDateFromEvent(span(localDate(2026, 6, 5, 13, 0), localDate(2026, 6, 5, 14, 0), false)))
            .toEqual({ startDate: "2026-06-05", endDate: "2026-06-05" });
    });

    it("answers with neither date where there is no start to read", () => {
        expect(parseStartEndDateFromEvent(span(null, localDate(2026, 6, 7), true)))
            .toEqual({ startDate: null, endDate: null });
    });

    it("leaves the end unsaid where the calendar names none", () => {
        expect(parseStartEndDateFromEvent(span(localDate(2026, 6, 5), null, true)))
            .toEqual({ startDate: "2026-06-05", endDate: undefined });
        expect(parseStartEndDateFromEvent(span(localDate(2026, 6, 5, 13, 0), null, false)))
            .toEqual({ startDate: "2026-06-05", endDate: undefined });
    });
});

describe("parseStartEndTimeFromEvent", () => {
    it("reads the hours of a timed span", () => {
        expect(parseStartEndTimeFromEvent(span(localDate(2026, 6, 5, 13, 0), localDate(2026, 6, 5, 14, 30), false)))
            .toEqual({ startTime: "13:00", endTime: "14:30" });
    });

    it("says no hours at all for an all-day span, which has none to give", () => {
        expect(parseStartEndTimeFromEvent(span(localDate(2026, 6, 5), localDate(2026, 6, 7), true)))
            .toEqual({ startTime: null, endTime: null });
    });
});

describe("getMonthsInDateRange", () => {
    it("names every month a range touches within one year", () => {
        expect(getMonthsInDateRange("2026-03-14", "2026-06-02"))
            .toEqual([ "2026-03", "2026-04", "2026-05", "2026-06" ]);
    });

    it("names a single month where both ends fall in it", () => {
        expect(getMonthsInDateRange("2026-06-01", "2026-06-30")).toEqual([ "2026-06" ]);
    });

    it("runs a range spanning years out to the end of each one and in from the start of the next", () => {
        expect(getMonthsInDateRange("2025-11-20", "2026-02-03"))
            .toEqual([ "2025-11", "2025-12", "2026-01", "2026-02" ]);
    });

    it("pads the single-digit months, the names being what a lookup is keyed by", () => {
        const months = getMonthsInDateRange("2026-01-01", "2026-12-31");
        expect(months).toHaveLength(12);
        expect(months[0]).toBe("2026-01");
        expect(months[8]).toBe("2026-09");
        expect(months[9]).toBe("2026-10");
    });
});
