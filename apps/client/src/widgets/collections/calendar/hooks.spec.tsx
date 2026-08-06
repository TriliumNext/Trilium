import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { useEventLabel, useEventLabelOmissions } from "./hooks";
import { EventLabelName } from "./utils";

describe("calendar hooks", () => {
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

    /**
     * Mounts a hook in the tree it expects to stand in and hands back what it answered — read from
     * the last render, the label hooks reporting through an effect rather than on the first pass.
     */
    function renderHook<T>(use: () => T): () => T {
        const answers: T[] = [];

        function Probe() {
            answers.push(use());
            return null;
        }

        act(() => render(
            <ParentComponent.Provider value={new Component()}>
                <Probe />
            </ParentComponent.Provider>,
            container));

        return () => {
            const last = answers.at(-1);
            if (last === undefined) throw new Error("The hook was never rendered.");
            return last;
        };
    }

    describe("useEventLabel", () => {
        /** The hook's pair, for the note and the label the calendar draws an event by. */
        function mount(note: FNote, name: EventLabelName) {
            return renderHook(() => useEventLabel(note, name));
        }

        it("reads the stock label where the note renames none", () => {
            const note = buildNote({ title: "Fair", "#startDate": "2026-06-05" });
            expect(mount(note, "startDate")()[0]).toBe("2026-06-05");
        });

        it("reads the label a note renames for itself, in preference to the stock one", () => {
            const note = buildNote({
                title: "Fair",
                "#calendar:startDate": "myStartDate", "#myStartDate": "2026-06-09",
                "#startDate": "2026-06-05"
            });
            expect(mount(note, "startDate")()[0]).toBe("2026-06-09");
        });

        it("falls back to the stock label where the renamed one holds nothing, as the builder does", () => {
            const note = buildNote({
                title: "Fair", "#calendar:startDate": "myStartDate", "#startDate": "2026-06-05"
            });
            expect(mount(note, "startDate")()[0]).toBe("2026-06-05");
        });

        it("says nothing at all where neither label holds a value", () => {
            expect(mount(buildNote({ title: "Fair" }), "startDate")()[0]).toBeNull();
        });

        it("writes the stock label where the note renames none", () => {
            const note = buildNote({ title: "Fair", "#startDate": "2026-06-05" });
            act(() => mount(note, "startDate")()[1]("2026-06-09"));

            expect(setLabel).toHaveBeenCalledWith(note.noteId, "startDate", "2026-06-09");
        });

        it("writes the renamed label, leaving the stock one where it stands", () => {
            const note = buildNote({
                title: "Fair", "#calendar:startDate": "myStartDate", "#startDate": "2026-06-05"
            });
            act(() => mount(note, "startDate")()[1]("2026-06-09"));

            expect(setLabel).toHaveBeenCalledWith(note.noteId, "myStartDate", "2026-06-09");
            expect(setLabel).toHaveBeenCalledTimes(1);
        });

        it("clears the stock label along with the renamed one, so the fallback cannot resurrect it", () => {
            const note = buildNote({
                title: "Fair",
                "#calendar:startDate": "myStartDate", "#myStartDate": "2026-06-09",
                "#startDate": "2026-06-05"
            });
            act(() => mount(note, "startDate")()[1](null));

            // Both names, the stale stock value being exactly what the builder's fallback would
            // pick up the moment the renamed label went.
            expect(removeLabel.mock.calls.map((call) => call[1])).toEqual([ "myStartDate", "startDate" ]);
        });
    });

    describe("useEventLabelOmissions", () => {
        it("names the stock labels, which the popover's own fields already speak for", () => {
            const omissions = renderHook(() => useEventLabelOmissions(buildNote({ title: "Fair" })))();

            expect(omissions).toEqual([ "startDate", "endDate", "startTime", "endTime", "recurrence" ]);
        });

        it("names the labels a note points the calendar at as well, so the grid does not repeat them", () => {
            const note = buildNote({
                title: "Fair",
                "#calendar:startDate": "myStartDate",
                "#calendar:endDate": "myEndDate",
                "#calendar:startTime": "myStartTime",
                "#calendar:endTime": "myEndTime",
                "#calendar:recurrence": "myRecurrence"
            });

            expect(renderHook(() => useEventLabelOmissions(note))()).toEqual([
                "startDate", "endDate", "startTime", "endTime", "recurrence",
                "myStartDate", "myEndDate", "myStartTime", "myEndTime", "myRecurrence"
            ]);
        });

        it("names only the renamings that were actually made", () => {
            const note = buildNote({
                title: "Fair", "#calendar:startDate": "myStartDate", "#calendar:recurrence": "myRecurrence"
            });

            expect(renderHook(() => useEventLabelOmissions(note))()).toEqual([
                "startDate", "endDate", "startTime", "endTime", "recurrence",
                "myStartDate", "myRecurrence"
            ]);
        });
    });
});
