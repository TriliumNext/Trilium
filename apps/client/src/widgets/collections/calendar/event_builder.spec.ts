import { describe, expect, it } from "vitest";
import { buildNote, buildNotes } from "../../../test/easy-froca.js";
import { buildEvent, buildEvents } from "./event_builder.js";
import { LOCALE_MAPPINGS } from "./index.js";
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
        ])
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
