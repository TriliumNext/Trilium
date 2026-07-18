import { describe, expect, it, vi } from "vitest";
import { buildNote, buildNotes } from "../../../test/easy-froca.js";
import { buildEvent, buildEvents } from "./event_builder.js";
import { LOCALE_MAPPINGS } from "./index.js";
import { isValidDuration } from "./utils.js";
import { LOCALES } from "@triliumnext/commons";

describe("Building events", () => {
    it("supports start date", async () => {
        const noteIds = buildNotes([
            { title: "Note 1", "#startDate": "2025-05-05" },
            { title: "Note 2", "#startDate": "2025-05-07" },
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({ title: "Note 1", start: "2025-05-05", end: "2025-05-06" });
        expect(events[1]).toMatchObject({ title: "Note 2", start: "2025-05-07", end: "2025-05-08" });
    });

    it("ignores notes with only end date", async () => {
        const noteIds = buildNotes([
            { title: "Note 1", "#endDate": "2025-05-05" },
            { title: "Note 2", "#endDateDate": "2025-05-07" }
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(0);
    });

    it("supports both start date and end date", async () => {
        const noteIds = buildNotes([
            { title: "Note 1", "#startDate": "2025-05-05", "#endDate": "2025-05-05" },
            { title: "Note 2", "#startDate": "2025-05-07", "#endDate": "2025-05-08" },
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({ title: "Note 1", start: "2025-05-05", end: "2025-05-06" });
        expect(events[1]).toMatchObject({ title: "Note 2", start: "2025-05-07", end: "2025-05-09" });
    });

    it("supports custom start date", async () => {
        const noteIds = buildNotes([
            { title: "Note 1", "#myStartDate": "2025-05-05", "#calendar:startDate": "myStartDate" },
            { title: "Note 2", "#startDate": "2025-05-07", "#calendar:startDate": "myStartDate" },
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
            title: "Note 1",
            start: "2025-05-05",
            end: "2025-05-06"
        });
        expect(events[1]).toMatchObject({
            title: "Note 2",
            start: "2025-05-07",
            end: "2025-05-08"
        });
    });

    it("supports custom start date and end date", async () => {
        const noteIds = buildNotes([
            { title: "Note 1", "#myStartDate": "2025-05-05", "#myEndDate": "2025-05-05", "#calendar:startDate": "myStartDate", "#calendar:endDate": "myEndDate" },
            { title: "Note 2", "#myStartDate": "2025-05-07", "#endDate": "2025-05-08", "#calendar:startDate": "myStartDate", "#calendar:endDate": "myEndDate" },
            { title: "Note 3", "#startDate": "2025-05-05", "#myEndDate": "2025-05-05", "#calendar:startDate": "myStartDate", "#calendar:endDate": "myEndDate" },
            { title: "Note 4", "#startDate": "2025-05-07", "#myEndDate": "2025-05-08", "#calendar:startDate": "myStartDate", "#calendar:endDate": "myEndDate" },
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(4);
        expect(events[0]).toMatchObject({ title: "Note 1", start: "2025-05-05", end: "2025-05-06" });
        expect(events[1]).toMatchObject({ title: "Note 2", start: "2025-05-07", end: "2025-05-09" });
        expect(events[2]).toMatchObject({ title: "Note 3", start: "2025-05-05", end: "2025-05-06" });
        expect(events[3]).toMatchObject({ title: "Note 4", start: "2025-05-07", end: "2025-05-09" });
    });

    it("supports label as custom title", async () => {
        const noteIds = buildNotes([
            { title: "Note 1", "#myTitle": "My Custom Title 1", "#startDate": "2025-05-05", "#calendar:title": "myTitle" },
            { title: "Note 2", "#startDate": "2025-05-07", "#calendar:title": "myTitle" },
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({ title: "My Custom Title 1", start: "2025-05-05" });
        expect(events[1]).toMatchObject({ title: "Note 2", start: "2025-05-07" });
    });

    it("supports relation as custom title", async () => {
        const noteIds = buildNotes([
            { id: "mySharedTitle", title: "My shared title" },
            { title: "Note 1", "~myTitle": "mySharedTitle", "#startDate": "2025-05-05", "#calendar:title": "myTitle" },
            { title: "Note 2", "#startDate": "2025-05-07", "#calendar:title": "myTitle" },
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({ title: "My shared title", start: "2025-05-05" });
        expect(events[1]).toMatchObject({ title: "Note 2", start: "2025-05-07" });
    });

    it("supports relation as custom title with custom label", async () => {
        const noteIds = buildNotes([
            { id: "mySharedTitle", title: "My custom title", "#myTitle": "My shared custom title", "#calendar:title": "myTitle" },
            { title: "Note 1", "~myTitle": "mySharedTitle", "#startDate": "2025-05-05", "#calendar:title": "myTitle" },
            { title: "Note 2", "#startDate": "2025-05-07", "#calendar:title": "myTitle" },
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({ title: "My shared custom title", start: "2025-05-05" });
        expect(events[1]).toMatchObject({ title: "Note 2", start: "2025-05-07" });
    });

    it("supports events without an end time", async () => {
        const noteIds = buildNotes([
            { title: "Note 1", "#startDate": "2025-05-05", "#endDate": "2025-05-05", "#startTime": "13:30" },
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            title: "Note 1",
            start: "2025-05-05T13:30:00",
            end: "2025-05-05"
        });
    });
});

describe("Promoted attributes", () => {
    it("supports labels", async () => {
        const note = buildNote({
            "title": "Hello",
            "#weight": "75",
            "#mood": "happy",
            "#label:weight": "promoted,number,single,precision=1",
            "#label:mood": "promoted,alias=Mood,single,text",
            "#calendar:displayedAttributes": "weight,mood"
        });

        const event = await buildEvent(note, { startDate: "2025-04-04" });
        expect(event).toHaveLength(1);
        expect(event[0]?.promotedAttributes).toMatchObject([
            [ "weight", "75" ],
            [ "mood", "happy" ]
        ]);
    });

    it("supports relations", async () => {
        const note = buildNote({
            "title": "Hello",
            "~assignee": buildNote({
                "title": "Target note"
            }).noteId,
            "#calendar:displayedAttributes": "assignee",
            "#relation:assignee": "promoted,alias=Assignee,single,text",
        });

        const event = await buildEvent(note, { startDate: "2025-04-04" });
        expect(event).toHaveLength(1);
        expect(event[0]?.promotedAttributes).toMatchObject([
            [ "assignee", "Target note" ]
        ]);
    });

    it("supports start time and end time", async () => {
        const noteIds = buildNotes([
            { title: "Note 1", "#startDate": "2025-05-05", "#startTime": "13:36", "#endTime": "14:56" },
            { title: "Note 2", "#startDate": "2025-05-07", "#endDate": "2025-05-08", "#startTime": "13:36", "#endTime": "14:56" },
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({ title: "Note 1", start: "2025-05-05T13:36:00", end: "2025-05-05T14:56:00" });
        expect(events[1]).toMatchObject({ title: "Note 2", start: "2025-05-07T13:36:00", end: "2025-05-08T14:56:00" });
    });

    it("handles start time with missing end time", async () => {
        const noteIds = buildNotes([
            { title: "Note 1", "#startDate": "2025-05-05", "#startTime": "13:30" },
            { title: "Note 2", "#startDate": "2025-05-07", "#endDate": "2025-05-08", "#startTime": "13:36" },
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({ title: "Note 1", start: "2025-05-05T13:30:00" });
        expect(events[1]).toMatchObject({ title: "Note 2", start: "2025-05-07T13:36:00", end: "2025-05-08" });
    });

});


describe("Recurrence", () => {
    it("supports valid recurrence without end date", async () => {
        const noteIds = buildNotes([
            {
                title: "Recurring Event",
                "#startDate": "2025-05-05",
                "#recurrence": "FREQ=DAILY;COUNT=5"
            }
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            title: "Recurring Event",
            start: "2025-05-05",
        });
        expect(events[0].rrule).toContain("DTSTART:20250505");
        expect(events[0].rrule).toContain("FREQ=DAILY;COUNT=5");
        expect(events[0].end).toBeUndefined();
    });

    it("supports recurrence spanning day boundary", async () => {
        const noteIds = buildNotes([
            {
                title: "Recurring Event Spanning Day Boundary",
                "#startDate": "2025-05-05",
                "#startTime": "23:00",
                "#endTime": "1:00",
                "#recurrence": "FREQ=DAILY;COUNT=3"
            }
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            title: "Recurring Event Spanning Day Boundary",
            start: "2025-05-05T23:00:00",
            duration: "02:00"
        });
        expect(events[0].rrule).toContain("DTSTART:20250505T230000");
        expect(events[0].end).toBeUndefined();
    });

    it("supports recurrence with start and end time (duration calculated)", async () => {
        const noteIds = buildNotes([
            {
                title: "Timed Recurring Event",
                "#startDate": "2025-05-05",
                "#startTime": "13:00",
                "#endTime": "15:30",
                "#recurrence": "FREQ=WEEKLY;COUNT=3"
            }
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            title: "Timed Recurring Event",
            start: "2025-05-05T13:00:00",
            duration: "02:30"
        });
        expect(events[0].rrule).toContain("DTSTART:20250505T130000");
        expect(events[0].end).toBeUndefined();
    });

    it("removes end date when recurrence is valid", async () => {
        const noteIds = buildNotes([
            {
                title: "Recurring With End",
                "#startDate": "2025-05-05",
                "#endDate": "2025-05-07",
                "#recurrence": "FREQ=DAILY;COUNT=2"
            }
        ]);
        const events = await buildEvents(noteIds);

        expect(events).toHaveLength(1);
        expect(events[0].rrule).toBeDefined();
        expect(events[0].end).toBeUndefined();
    });

    it("writes to console on invalid recurrence rule", async () => {
        const noteIds = buildNotes([
            {
                title: "Invalid Recurrence",
                "#startDate": "2025-05-05",
                "#recurrence": "RRULE:FREQ=INVALID"
            }
        ]);

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await buildEvents(noteIds);
        const calledWithInvalid = consoleSpy.mock.calls.some(call =>
            call[0].includes("has an invalid #recurrence string")
        );
        expect(calledWithInvalid).toBe(true);
        consoleSpy.mockRestore();
    });
});


describe("isValidDuration", () => {
    it("accepts valid durations", () => {
        expect(isValidDuration("00:01:00")).toBe(true);  // minimum: 1 minute
        expect(isValidDuration("00:15:00")).toBe(true);
        expect(isValidDuration("00:30:00")).toBe(true);
        expect(isValidDuration("01:00:00")).toBe(true);
        expect(isValidDuration("24:00:00")).toBe(true);  // maximum: 24 hours
    });

    it("rejects durations below 1 minute", () => {
        expect(isValidDuration("00:00:00")).toBe(false);
        expect(isValidDuration("00:00:30")).toBe(false);
        expect(isValidDuration("00:00:59")).toBe(false);
    });

    it("rejects durations above 24 hours", () => {
        expect(isValidDuration("25:00:00")).toBe(false);
        expect(isValidDuration("24:01:00")).toBe(false);
    });

    it("rejects invalid formats", () => {
        expect(isValidDuration("00:aa:00")).toBe(false);
        expect(isValidDuration("abc")).toBe(false);
        expect(isValidDuration("1:0:0")).toBe(false);
        expect(isValidDuration("")).toBe(false);
        expect(isValidDuration(null)).toBe(false);
        expect(isValidDuration(undefined)).toBe(false);
    });

    it("rejects out-of-range minute/second values", () => {
        expect(isValidDuration("00:60:00")).toBe(false);
        expect(isValidDuration("00:00:60")).toBe(false);
    });
});

describe("Building locales", () => {
    it("every language has a locale defined", async () => {
        for (const { id, contentOnly } of LOCALES) {
            if (contentOnly) {
                continue;
            }

            const fullCalendarLocale = LOCALE_MAPPINGS[id];

            if (id !== "en") {
                expect(fullCalendarLocale, `For locale ${id}`).toBeDefined();
            } else {
                expect(fullCalendarLocale).toBeNull();
            }
        }
    });
});
