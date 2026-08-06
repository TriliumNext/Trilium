import * as rruleLib from "rrule";
import { describe, expect, it } from "vitest";

import { parseRecurrence, serializeRecurrence, SimpleRecurrence } from "./recurrence";

describe("parseRecurrence", () => {
    it("reads no label as no repetition", () => {
        expect(parseRecurrence(null)).toEqual({ kind: "none" });
        expect(parseRecurrence(undefined)).toEqual({ kind: "none" });
        expect(parseRecurrence("")).toEqual({ kind: "none" });
        expect(parseRecurrence("   ")).toEqual({ kind: "none" });
    });

    it("reads the everyday rules into the structured fields", () => {
        expect(parseRecurrence("RRULE:FREQ=DAILY")).toEqual({
            kind: "simple",
            rule: { frequency: "DAILY", interval: 1, weekdays: [], ends: { type: "never" } }
        });

        expect(parseRecurrence("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR")).toEqual({
            kind: "simple",
            rule: { frequency: "WEEKLY", interval: 2, weekdays: [ "MO", "FR" ], ends: { type: "never" } }
        });

        expect(parseRecurrence("RRULE:FREQ=MONTHLY;COUNT=10")).toEqual({
            kind: "simple",
            rule: { frequency: "MONTHLY", interval: 1, weekdays: [], ends: { type: "count", count: 10 } }
        });
    });

    it("is forgiving about case and surrounding whitespace, and reads UNTIL down to its day", () => {
        expect(parseRecurrence("  rrule:freq=yearly;until=20260605T235959Z  ")).toEqual({
            kind: "simple",
            rule: { frequency: "YEARLY", interval: 1, weekdays: [], ends: { type: "until", date: "2026-06-05" } }
        });

        // A bare date and a local (un-zoned) time are both valid RRULE spellings of UNTIL.
        expect(parseRecurrence("RRULE:FREQ=DAILY;UNTIL=20260605")).toEqual({
            kind: "simple",
            rule: { frequency: "DAILY", interval: 1, weekdays: [], ends: { type: "until", date: "2026-06-05" } }
        });
        expect(parseRecurrence("RRULE:FREQ=DAILY;UNTIL=20260605T120000")).toEqual({
            kind: "simple",
            rule: { frequency: "DAILY", interval: 1, weekdays: [], ends: { type: "until", date: "2026-06-05" } }
        });
    });

    it.each([
        // Anything the structured fields cannot say in full stays a raw string.
        [ "an unsupported parameter", "RRULE:FREQ=MONTHLY;BYMONTHDAY=15" ],
        [ "a week-start override", "RRULE:FREQ=WEEKLY;WKST=SU" ],
        [ "an nth-weekday BYDAY", "RRULE:FREQ=MONTHLY;BYDAY=2TU" ],
        [ "BYDAY outside a weekly rule", "RRULE:FREQ=MONTHLY;BYDAY=TU" ],
        [ "both UNTIL and COUNT", "RRULE:FREQ=DAILY;UNTIL=20260101;COUNT=3" ],
        [ "a repeated parameter", "RRULE:FREQ=DAILY;INTERVAL=2;INTERVAL=3" ],
        [ "a rule set of several lines", "RRULE:FREQ=DAILY\nEXDATE:20260101T000000" ],
        [ "a zero interval", "RRULE:FREQ=DAILY;INTERVAL=0" ],
        [ "a malformed UNTIL", "RRULE:FREQ=DAILY;UNTIL=2026-06-05" ],
        [ "an unknown frequency", "RRULE:FREQ=HOURLY" ],
        [ "something that is not an RRULE at all", "every second thursday" ],
        [ "a parameter that says nothing", "RRULE:FREQ=DAILY;JUSTAWORD" ],
        [ "a parameter with no name", "RRULE:=DAILY" ],
        [ "an unknown weekday", "RRULE:FREQ=WEEKLY;BYDAY=MO,XX" ],
        [ "an interval that is not a number", "RRULE:FREQ=DAILY;INTERVAL=often" ],
        [ "an interval left blank", "RRULE:FREQ=DAILY;INTERVAL=" ],
        [ "a count that is not a number", "RRULE:FREQ=DAILY;COUNT=many" ],
        [ "a zero count", "RRULE:FREQ=DAILY;COUNT=0" ]
    ])("steps aside for %s", (_description, value) => {
        expect(parseRecurrence(value)).toEqual({ kind: "custom", value });
    });
});

describe("serializeRecurrence", () => {
    it("writes nothing for no repetition or an emptied custom rule", () => {
        expect(serializeRecurrence({ kind: "none" })).toBeNull();
        expect(serializeRecurrence({ kind: "custom", value: "" })).toBeNull();
        expect(serializeRecurrence({ kind: "custom", value: "  " })).toBeNull();
    });

    it("hands a custom rule back as written", () => {
        expect(serializeRecurrence({ kind: "custom", value: "RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR" }))
            .toBe("RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR");
    });

    it("spells out only what differs from the defaults", () => {
        expect(serialize({ frequency: "DAILY" })).toBe("RRULE:FREQ=DAILY");
        expect(serialize({ frequency: "WEEKLY", interval: 3 })).toBe("RRULE:FREQ=WEEKLY;INTERVAL=3");
        expect(serialize({ frequency: "YEARLY", ends: { type: "count", count: 5 } }))
            .toBe("RRULE:FREQ=YEARLY;COUNT=5");
    });

    it("writes the picked days in the week's own order, and UNTIL as the end of its day", () => {
        expect(serialize({ frequency: "WEEKLY", weekdays: [ "FR", "MO" ] }))
            .toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,FR");
        expect(serialize({ frequency: "DAILY", ends: { type: "until", date: "2026-06-05" } }))
            .toBe("RRULE:FREQ=DAILY;UNTIL=20260605T235959Z");
    });

    it("holds an 'until' whose date has not been picked yet as never ending", () => {
        expect(serialize({ frequency: "DAILY", ends: { type: "until", date: "" } }))
            .toBe("RRULE:FREQ=DAILY");
    });

    it("round-trips through the parser, and through the library the event builder validates with", () => {
        const rules: SimpleRecurrence[] = [
            simple({ frequency: "DAILY" }),
            simple({ frequency: "WEEKLY", interval: 2, weekdays: [ "MO", "WE", "FR" ] }),
            simple({ frequency: "MONTHLY", ends: { type: "count", count: 12 } }),
            simple({ frequency: "YEARLY", interval: 4, ends: { type: "until", date: "2040-02-29" } })
        ];

        for (const rule of rules) {
            const serialized = serializeRecurrence({ kind: "simple", rule });
            expect(serialized).not.toBeNull();
            expect(parseRecurrence(serialized)).toEqual({ kind: "simple", rule });

            // As the event builder assembles it (see buildEvent), so what the editor writes is
            // exactly what FullCalendar will be asked to draw.
            expect(() => rruleLib.rrulestr(`DTSTART:20260101T090000\n${serialized}`, { forceset: true }))
                .not.toThrow();
        }
    });
});

function simple(overrides: Partial<SimpleRecurrence> & Pick<SimpleRecurrence, "frequency">): SimpleRecurrence {
    return { interval: 1, weekdays: [], ends: { type: "never" }, ...overrides };
}

function serialize(overrides: Partial<SimpleRecurrence> & Pick<SimpleRecurrence, "frequency">) {
    return serializeRecurrence({ kind: "simple", rule: simple(overrides) });
}
