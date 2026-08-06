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

    const allDayBox = () => container.querySelector<HTMLInputElement>("input[type='checkbox']");
    const dateInputs = () => container.querySelectorAll<HTMLInputElement>("input[type='date']");
    const timeInputs = () => container.querySelectorAll<HTMLInputElement>("input[type='time']");

    /** Commits a field as leaving it does — the inputs commit on blur, bound as focusout (see
     *  the preact/compat note in label_value_input.tsx). */
    function commitValue(input: HTMLInputElement, value: string) {
        input.value = value;
        act(() => { input.dispatchEvent(new Event("focusout")); });
    }

    it("shows a whole-day event as a span of days, and a timed one as a day and its hours", () => {
        mount(buildNote({ title: "Fair", "#startDate": "2026-06-05", "#endDate": "2026-06-07" }));
        expect(allDayBox()?.checked).toBe(true);
        expect(dateInputs()).toHaveLength(2);
        expect(timeInputs()).toHaveLength(0);
        expect(dateInputs()[0].value).toBe("2026-06-05");
        expect(dateInputs()[1].value).toBe("2026-06-07");

        mount(buildNote({ title: "Meeting", "#startDate": "2026-06-05", "#startTime": "13:00", "#endTime": "14:30" }));
        expect(allDayBox()?.checked).toBe(false);
        expect(dateInputs()).toHaveLength(1);
        expect(timeInputs()).toHaveLength(2);
        expect(timeInputs()[0].value).toBe("13:00");
        expect(timeInputs()[1].value).toBe("14:30");
    });

    it("switching all-day off gives the day hours to edit and lets a span of days go", () => {
        const note = buildNote({ title: "Fair", "#startDate": "2026-06-05", "#endDate": "2026-06-07" });
        mount(note);

        act(() => allDayBox()?.click());

        expect(setLabel).toHaveBeenCalledWith(note.noteId, "startTime", "09:00");
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "endTime", "10:00");
        expect(removeLabel).toHaveBeenCalledWith(note, "endDate");
        // The fields answer the press at once, ahead of the labels echoing back.
        expect(timeInputs()).toHaveLength(2);
        expect(dateInputs()).toHaveLength(1);
    });

    it("switching all-day on takes the hours off and keeps the dates", () => {
        const note = buildNote({ title: "Meeting", "#startDate": "2026-06-05", "#startTime": "13:00", "#endTime": "14:30" });
        mount(note);

        act(() => allDayBox()?.click());

        expect(removeLabel).toHaveBeenCalledWith(note, "startTime");
        expect(removeLabel).toHaveBeenCalledWith(note, "endTime");
        expect(setLabel).not.toHaveBeenCalled();
        expect(dateInputs()).toHaveLength(2);
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

        expect(allDayBox()?.checked).toBe(true);
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
        expect(allDayBox()?.checked).toBe(false);
        expect(timeInputs()[0].value).toBe("13:00");

        act(() => allDayBox()?.click());

        expect(removeLabel).toHaveBeenCalledWith(note, "myStartTime");
        expect(removeLabel).toHaveBeenCalledWith(note, "startTime");
        expect(removeLabel).toHaveBeenCalledWith(note, "myEndTime");
        expect(removeLabel).toHaveBeenCalledWith(note, "endTime");
    });
});
