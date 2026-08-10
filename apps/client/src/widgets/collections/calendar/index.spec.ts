import { EventDisplayInfo } from "fullcalendar";
import { describe, expect, it } from "vitest";

import { eventInnerClass, roomForAttributes } from "./index.js";

/** As much of a chip as the question is asked of: which view it is drawn in, and how it sits there. */
function chip({ view, allDay = false, isShort = false, isNarrow = false }: {
    view: string, allDay?: boolean, isShort?: boolean, isNarrow?: boolean
}) {
    return { view: { type: view }, event: { allDay }, isShort, isNarrow } as EventDisplayInfo;
}

describe("roomForAttributes", () => {
    it("wraps a row chip, be it a month cell's or the all-day band's above a time grid", () => {
        expect(roomForAttributes(chip({ view: "dayGridMonth" }))).toBe("wrapped");
        expect(roomForAttributes(chip({ view: "dayGridMonth", allDay: true }))).toBe("wrapped");
        expect(roomForAttributes(chip({ view: "timeGridWeek", allDay: true }))).toBe("wrapped");
        expect(roomForAttributes(chip({ view: "timeGridDay", allDay: true }))).toBe("wrapped");
        // Narrow as well — a phone's seven columns, where a few characters to the line is still
        // more than the nothing they used to say.
        expect(roomForAttributes(chip({ view: "dayGridMonth", isNarrow: true }))).toBe("wrapped");
        expect(roomForAttributes(chip({ view: "timeGridWeek", allDay: true, isNarrow: true }))).toBe("wrapped");
    });

    it("lets a timed event on a time grid stack them, its content being a column already", () => {
        expect(roomForAttributes(chip({ view: "timeGridWeek" }))).toBe("stacked");
        expect(roomForAttributes(chip({ view: "timeGridDay" }))).toBe("stacked");
        // Too short to say anything beneath its title.
        expect(roomForAttributes(chip({ view: "timeGridWeek", isShort: true }))).toBe(null);
    });

    it("has nowhere to put them on a year's chips or in a list", () => {
        expect(roomForAttributes(chip({ view: "multiMonthYear" }))).toBe(null);
        expect(roomForAttributes(chip({ view: "listMonth" }))).toBe(null);
    });
});

describe("eventInnerClass", () => {
    /** A chip as the class is asked of it: where it is drawn, and whether it has anything to say. */
    function chipWithAttributes(view: string, promotedAttributes?: [string, string][]) {
        return {
            ...chip({ view }),
            event: { allDay: false, extendedProps: { promotedAttributes } }
        } as unknown as EventDisplayInfo;
    }

    it("makes a row that wraps of a chip whose attributes must fall beneath it", () => {
        expect(eventInnerClass(chipWithAttributes("dayGridMonth", [[ "mood", "happy" ]])))
            .toBe("calendar-event-inner-wrapped");
    });

    it("leaves the inner alone where the attributes stack, or where there are none to place", () => {
        // A timed chip on a time grid is a column already, so its attributes need no line of their own.
        expect(eventInnerClass(chipWithAttributes("timeGridWeek", [[ "mood", "happy" ]]))).toBe("");
        expect(eventInnerClass(chipWithAttributes("dayGridMonth", []))).toBe("");
        expect(eventInnerClass(chipWithAttributes("dayGridMonth"))).toBe("");
    });
});
