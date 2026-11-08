import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import froca from "../../../services/froca";
import noteAttributeCache from "../../../services/note_attribute_cache";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import EventDatesEditor from "./EventDatesEditor";

// i18next is never initialized under test, so t() renders the key with the interpolated values
// appended, e.g. "calendar_view.duration_hours_minutes|1|30".
vi.mock("../../../services/i18n", () => ({
    t: (key: string, opts?: Record<string, unknown>) => [ key, ...Object.values(opts ?? {}) ].join("|")
}));

describe("EventDatesEditor", () => {
    let container: HTMLElement;
    const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
    const removeLabel = vi.spyOn(attributes, "removeOwnedLabelByName").mockResolvedValue(true);

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        setLabel.mockClear();
        removeLabel.mockClear();
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    function mount(note: FNote) {
        act(() => render(
            <ParentComponent.Provider value={new Component()}>
                <EventDatesEditor note={note} />
            </ParentComponent.Provider>,
            container));
    }

    const addTimeButton = () => container.querySelector<HTMLButtonElement>(".calendar-event-add-time");
    const removeTimeButton = () => container.querySelector<HTMLElement>(".calendar-event-remove-time");
    const dateInputs = () => container.querySelectorAll<HTMLInputElement>("input[type='date']");
    const timeInputs = () => container.querySelectorAll<HTMLInputElement>("input[type='time']");
    const duration = () => container.querySelector(".calendar-event-duration")?.textContent;

    /** Commits a field as leaving it does — the inputs commit on blur, bound as focusout (see
     *  the preact/compat note in label_value_input.tsx). */
    function commitValue(input: HTMLInputElement, value: string) {
        input.value = value;
        act(() => { input.dispatchEvent(new Event("focusout")); });
    }

    it("shows a whole-day event as a span of days, and a timed one as a day and its hours", () => {
        mount(buildNote({ title: "Fair", "#startDate": "2026-06-05", "#endDate": "2026-06-07" }));
        expect(dateInputs()).toHaveLength(2);
        // An all-day event has no hours, only the way to add them, on the time row.
        expect(timeInputs()).toHaveLength(0);
        expect(removeTimeButton()).toBeNull();
        expect(addTimeButton()?.closest(".calendar-event-row")?.querySelector(".bx-time-five")).not.toBeNull();
        expect(duration()).toBeUndefined();
        expect(dateInputs()[0].value).toBe("2026-06-05");
        expect(dateInputs()[1].value).toBe("2026-06-07");

        mount(buildNote({ title: "Meeting", "#startDate": "2026-06-05", "#startTime": "13:00", "#endTime": "14:30" }));
        expect(addTimeButton()).toBeNull();
        // A timed event has an end date too; empty, it ends on the day it starts.
        expect([ ...dateInputs() ].map((input) => input.value)).toEqual([ "2026-06-05", "" ]);
        expect(timeInputs()).toHaveLength(2);
        expect(timeInputs()[0].closest(".calendar-event-row")?.contains(removeTimeButton())).toBe(true);
        expect(timeInputs()[0].value).toBe("13:00");
        expect(timeInputs()[1].value).toBe("14:30");
        expect(duration()).toBe("calendar_view.duration_hours_minutes|1|30");
        expect(timeInputs()[0].closest(".calendar-event-row")?.querySelector(".calendar-event-duration")).not.toBeNull();
    });

    it("adding a time gives the days hours to edit and keeps the span of days", () => {
        const note = buildNote({ title: "Fair", "#startDate": "2026-06-05", "#endDate": "2026-06-07" });
        mount(note);

        act(() => addTimeButton()?.click());

        expect(setLabel).toHaveBeenCalledWith(note.noteId, "startTime", "09:00");
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "endTime", "10:00");
        expect(removeLabel).not.toHaveBeenCalled();
        // The fields answer the press at once, ahead of the labels echoing back.
        expect(timeInputs()).toHaveLength(2);
        expect(document.activeElement).toBe(timeInputs()[0]);
        expect(dateInputs()).toHaveLength(2);

        // Removed again before the labels echo back, the hours still come off.
        act(() => removeTimeButton()?.click());
        expect(removeLabel).toHaveBeenCalledWith(note, "startTime");
        expect(removeLabel).toHaveBeenCalledWith(note, "endTime");
        expect(addTimeButton()).not.toBeNull();
    });

    it("edits the hours as last entered while the earlier edit has not echoed back", () => {
        const note = buildNote({ title: "Meeting", "#startDate": "2026-06-05", "#startTime": "13:00", "#endTime": "14:30" });
        mount(note);

        commitValue(timeInputs()[1], "15:00");
        expect(timeInputs()[1].value).toBe("15:00");
        commitValue(timeInputs()[0], "16:00");

        expect(setLabel).toHaveBeenLastCalledWith(note.noteId, "endTime", "18:00");
    });

    it("drops a pending edit when it shows another event with the same hours", () => {
        mount(buildNote({ title: "First", "#startDate": "2026-06-05", "#startTime": "13:00", "#endTime": "14:30" }));
        commitValue(timeInputs()[1], "15:00");

        const second = buildNote({ title: "Second", "#startDate": "2026-06-05", "#startTime": "13:00", "#endTime": "14:30" });
        mount(second);
        expect(timeInputs()[1].value).toBe("14:30");

        commitValue(timeInputs()[0], "16:00");
        expect(setLabel).toHaveBeenLastCalledWith(second.noteId, "endTime", "17:30");
    });

    it("shows the stored hours again after a failed write, so the edit can be retried", async () => {
        const note = buildNote({ title: "Meeting", "#startDate": "2026-06-05", "#startTime": "13:00", "#endTime": "14:30" });
        mount(note);
        setLabel.mockRejectedValueOnce(new Error("offline"));

        commitValue(timeInputs()[1], "15:00");
        await act(() => new Promise((resolve) => setTimeout(resolve)));
        expect(timeInputs()[1].value).toBe("14:30");

        commitValue(timeInputs()[1], "15:00");
        expect(setLabel).toHaveBeenCalledTimes(2);
        expect(setLabel).toHaveBeenLastCalledWith(note.noteId, "endTime", "15:00");
    });

    it("shows the day an event actually ends on, and writes it once an edit is made", () => {
        // Stored as ending at 08:00 on its own start day, which the calendar draws as the next day.
        const note = buildNote({
            title: "Shift", "#startDate": "2026-10-16", "#endDate": "2026-10-16",
            "#startTime": "09:00", "#endTime": "08:00"
        });
        mount(note);

        expect([ ...dateInputs() ].map((input) => input.value)).toEqual([ "2026-10-16", "2026-10-17" ]);
        expect(setLabel).not.toHaveBeenCalled();

        commitValue(timeInputs()[1], "07:00");
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "endTime", "07:00");
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "endDate", "2026-10-17");
    });

    it("moves the end time with the start time, keeping the duration", () => {
        const note = buildNote({ title: "Meeting", "#startDate": "2026-06-05", "#startTime": "13:00", "#endTime": "14:30" });
        mount(note);

        commitValue(timeInputs()[0], "16:00");

        expect(setLabel).toHaveBeenCalledWith(note.noteId, "startTime", "16:00");
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "endTime", "17:30");
        expect(setLabel).not.toHaveBeenCalledWith(note.noteId, "endDate", expect.anything());
    });

    it("shows and edits the end date of a timed event that spans several days", () => {
        const note = buildNote({
            title: "Night shift", "#startDate": "2026-06-05", "#endDate": "2026-06-06",
            "#startTime": "22:00", "#endTime": "01:00"
        });
        mount(note);

        expect([ ...dateInputs() ].map((input) => input.value)).toEqual([ "2026-06-05", "2026-06-06" ]);
        expect(duration()).toBe("calendar_view.duration_hours|3");

        commitValue(dateInputs()[1], "2026-06-07");
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "endDate", "2026-06-07");
    });

    it("removing the time takes the hours off and keeps the dates", () => {
        const note = buildNote({ title: "Meeting", "#startDate": "2026-06-05", "#startTime": "13:00", "#endTime": "14:30" });
        mount(note);

        act(() => removeTimeButton()?.click());

        expect(removeLabel).toHaveBeenCalledWith(note, "startTime");
        expect(removeLabel).toHaveBeenCalledWith(note, "endTime");
        expect(setLabel).not.toHaveBeenCalled();
        expect(dateInputs()).toHaveLength(2);
        expect(document.activeElement).toBe(addTimeButton());
    });

    it("commits an end date as the field is left, and emptying it makes the event a single day", () => {
        const note = buildNote({ title: "Fair", "#startDate": "2026-06-05", "#endDate": "2026-06-07" });
        mount(note);

        commitValue(dateInputs()[1], "2026-06-09");
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "endDate", "2026-06-09");

        commitValue(dateInputs()[1], "");
        expect(removeLabel).toHaveBeenCalledWith(note, "endDate");
    });

    it("never commits an emptied start date, without which the note would stop being an event", () => {
        const note = buildNote({ title: "Fair", "#startDate": "2026-06-05" });
        mount(note);

        commitValue(dateInputs()[0], "");
        expect(setLabel).not.toHaveBeenCalled();
        expect(removeLabel).not.toHaveBeenCalled();
    });

    it("reads and writes the labels a note renames for itself, as the event builder reads them", () => {
        const note = buildNote({
            title: "Fair",
            "#calendar:startDate": "myStartDate", "#myStartDate": "2026-06-05",
            "#calendar:endDate": "myEndDate", "#myEndDate": "2026-06-07"
        });
        mount(note);

        expect(addTimeButton()).not.toBeNull();
        expect(dateInputs()[0].value).toBe("2026-06-05");
        expect(dateInputs()[1].value).toBe("2026-06-07");

        commitValue(dateInputs()[1], "2026-06-09");
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "myEndDate", "2026-06-09");
    });

    it("falls back to a stock label the renamed one holds no value over, as the builder does", () => {
        mount(buildNote({ title: "Fair", "#calendar:startDate": "myStartDate", "#startDate": "2026-06-05" }));
        expect(dateInputs()[0].value).toBe("2026-06-05");
    });

    it("honours a renaming the note only inherits, as one just created under the calendar does", () => {
        // The renaming stands on the calendar, inheritable, the way a whole collection is pointed
        // at its own date labels; the event note holds only the stock label a fresh ghost commit
        // writes (see newEvent in api.ts).
        buildNote({
            title: "Calendar",
            "#calendar:startDate(inheritable)": "myStartDate",
            children: [ { id: "inheritingEvent", title: "Fair", "#startDate": "2026-06-05" } ]
        });
        // The fixture seeds each note's attribute cache with its owned attributes alone;
        // recomputed, the child sees what it inherits (see __getCachedAttributes in fnote.ts).
        noteAttributeCache.invalidate();
        const note = froca.notes["inheritingEvent"];
        mount(note);

        // Shown through the builder's fallback: the renamed label holds nothing yet.
        expect(dateInputs()[0].value).toBe("2026-06-05");

        // The first edit writes the renamed label on the note itself, which takes over from there.
        commitValue(dateInputs()[0], "2026-06-09");
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "myStartDate", "2026-06-09");
    });

    it("clears the stock label along with the renamed one, keeping the fallback from resurrecting it", () => {
        const note = buildNote({
            title: "Meeting", "#startDate": "2026-06-05",
            "#calendar:startTime": "myStartTime", "#myStartTime": "13:00",
            "#calendar:endTime": "myEndTime", "#myEndTime": "14:30"
        });
        mount(note);
        expect(addTimeButton()).toBeNull();
        expect(timeInputs()[0].value).toBe("13:00");

        act(() => removeTimeButton()?.click());

        expect(removeLabel).toHaveBeenCalledWith(note, "myStartTime");
        expect(removeLabel).toHaveBeenCalledWith(note, "startTime");
        expect(removeLabel).toHaveBeenCalledWith(note, "myEndTime");
        expect(removeLabel).toHaveBeenCalledWith(note, "endTime");
    });
});
