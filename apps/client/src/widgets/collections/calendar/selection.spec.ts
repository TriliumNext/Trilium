import { afterEach, describe, expect, it } from "vitest";

import { narrowAnchorRect, normalizeEventDates, withAllDay, withStart } from "./selection";

describe("narrowAnchorRect", () => {
    afterEach(() => {
        window.glob.isRtl = false;
    });

    /** A chip of a day or two: narrow enough for a card to stand beside it as it is. */
    const chip = new DOMRect(700, 200, 150, 20);
    /** An event running the length of the week, drawn the width of a grid that fills the window. */
    const span = new DOMRect(20, 200, 1560, 20);

    it("leaves a piece that can be stood beside as it stands", () => {
        expect(narrowAnchorRect(chip, { x: 720, y: 205 })).toBe(chip);
        // Right up to the width of the widest card, which still leaves the grid's own room.
        expect(narrowAnchorRect(new DOMRect(700, 200, 480, 20), { x: 720, y: 205 })).toEqual(new DOMRect(700, 200, 480, 20));
        // A hair over it is narrowed, the card no longer having room to stand beside the piece.
        expect(narrowAnchorRect(new DOMRect(700, 200, 481, 20), { x: 720, y: 205 })).toEqual(new DOMRect(720, 200, 0, 20));
    });

    it("narrows a piece too wide to be stood beside to the press within it", () => {
        // The card lands beside the press rather than at the far end of the month, and has the
        // grid's own room on either side of it — which is what keeps it on the screen at all.
        expect(narrowAnchorRect(span, { x: 540, y: 205 })).toEqual(new DOMRect(540, 200, 0, 20));
    });

    it("keeps the press within the piece it belongs to", () => {
        // A press that named a piece other than the one drawn — the popover re-anchored to the
        // first chip of an event crossing rows, say — would otherwise carry the card off it.
        expect(narrowAnchorRect(span, { x: 5, y: 205 })).toEqual(new DOMRect(20, 200, 0, 20));
        expect(narrowAnchorRect(span, { x: 3000, y: 205 })).toEqual(new DOMRect(1580, 200, 0, 20));
    });

    it("stands at the start of a span nothing pressed on, whichever way the app reads", () => {
        expect(narrowAnchorRect(span, null)).toEqual(new DOMRect(20, 200, 0, 20));

        window.glob.isRtl = true;
        expect(narrowAnchorRect(span, null)).toEqual(new DOMRect(1580, 200, 0, 20));
    });
});

describe("withAllDay", () => {
    it("drops the hours of a timed draft and keeps its days", () => {
        expect(withAllDay({ startDate: "2026-06-05", endDate: "2026-06-06", startTime: "23:00", endTime: "01:00" }, true))
            .toEqual({ startDate: "2026-06-05", endDate: "2026-06-06", startTime: null, endTime: null });
    });

    it("gives a whole-day draft default hours and keeps its days", () => {
        expect(withAllDay({ startDate: "2026-06-05", endDate: "2026-06-07" }, false))
            .toEqual({ startDate: "2026-06-05", endDate: "2026-06-07", startTime: "09:00", endTime: "10:00" });
    });

    it("keeps an end time the event already holds when hours are added", () => {
        expect(withAllDay({ startDate: "2026-06-05", endTime: "11:30" }, false))
            .toEqual({ startDate: "2026-06-05", startTime: "09:00", endTime: "11:30" });
    });
});

describe("normalizeEventDates", () => {
    it("moves the end date of a timed event to the day it actually ends on", () => {
        // 08:00 on the start day is before 09:00, so the event ends on the next day.
        expect(normalizeEventDates({ startDate: "2026-10-16", endDate: "2026-10-16", startTime: "09:00", endTime: "08:00" }))
            .toEqual({ startDate: "2026-10-16", endDate: "2026-10-17", startTime: "09:00", endTime: "08:00" });
        expect(normalizeEventDates({ startDate: "2026-10-31", startTime: "22:00", endTime: "01:00" }))
            .toEqual({ startDate: "2026-10-31", endDate: "2026-11-01", startTime: "22:00", endTime: "01:00" });
        // An end date before the start day is moved up to where the times fall after the start.
        expect(normalizeEventDates({ startDate: "2026-10-16", endDate: "2026-10-14", startTime: "09:00", endTime: "10:00" }))
            .toEqual({ startDate: "2026-10-16", endDate: null, startTime: "09:00", endTime: "10:00" });
    });

    it("empties an end date that is the start date, which is what an empty one means", () => {
        expect(normalizeEventDates({ startDate: "2026-10-16", endDate: "2026-10-16", startTime: "09:00", endTime: "10:00" }))
            .toEqual({ startDate: "2026-10-16", endDate: null, startTime: "09:00", endTime: "10:00" });
        expect(normalizeEventDates({ startDate: "2026-10-16", endDate: "2026-10-16", startTime: "09:00", endTime: "09:00" }))
            .toEqual({ startDate: "2026-10-16", endDate: null, startTime: "09:00", endTime: "09:00" });
        expect(normalizeEventDates({ startDate: "2026-10-16", endDate: "2026-10-16" }))
            .toEqual({ startDate: "2026-10-16", endDate: null });
    });

    it("lets an all-day end date before the start go, and leaves consistent events alone", () => {
        expect(normalizeEventDates({ startDate: "2026-10-16", endDate: "2026-10-12" }))
            .toEqual({ startDate: "2026-10-16", endDate: null });

        const allDaySpan = { startDate: "2026-10-16", endDate: "2026-10-18" };
        expect(normalizeEventDates(allDaySpan)).toEqual(allDaySpan);
        const timedSpan = { startDate: "2026-10-16", endDate: "2026-10-17", startTime: "22:00", endTime: "01:00" };
        expect(normalizeEventDates(timedSpan)).toEqual(timedSpan);
        const sameDay = { startDate: "2026-10-16", startTime: "09:00", endTime: "10:00" };
        expect(normalizeEventDates(sameDay)).toEqual(sameDay);
    });
});

describe("withStart", () => {
    it("moves the end of a timed event with its start time, keeping the duration", () => {
        expect(withStart({ startDate: "2026-10-16", startTime: "09:00", endTime: "10:00" }, { startTime: "14:00" }))
            .toEqual({ startDate: "2026-10-16", startTime: "14:00", endTime: "15:00" });
        // Pushed past midnight, the end moves to the next day.
        expect(withStart({ startDate: "2026-10-16", startTime: "21:00", endTime: "23:00" }, { startTime: "23:30" }))
            .toEqual({ startDate: "2026-10-16", endDate: "2026-10-17", startTime: "23:30", endTime: "01:30" });
        // Pulled back before midnight, it comes back to the start day.
        expect(withStart({ startDate: "2026-10-16", endDate: "2026-10-17", startTime: "22:00", endTime: "01:00" }, { startTime: "20:00" }))
            .toEqual({ startDate: "2026-10-16", endDate: null, startTime: "20:00", endTime: "23:00" });
    });

    it("moves the end date with the start date, keeping the span of days", () => {
        expect(withStart({ startDate: "2026-10-16", endDate: "2026-10-17", startTime: "22:00", endTime: "01:00" }, { startDate: "2026-10-30" }))
            .toEqual({ startDate: "2026-10-30", endDate: "2026-10-31", startTime: "22:00", endTime: "01:00" });
        expect(withStart({ startDate: "2026-10-16", endDate: "2026-10-18" }, { startDate: "2026-10-30" }))
            .toEqual({ startDate: "2026-10-30", endDate: "2026-11-01" });
        expect(withStart({ startDate: "2026-10-16" }, { startDate: "2026-10-30" }))
            .toEqual({ startDate: "2026-10-30" });
    });
});
