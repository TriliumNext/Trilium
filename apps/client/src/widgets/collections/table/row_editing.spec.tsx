import { render } from "preact";
import { act } from "preact/test-utils";
import type { CellComponent, EventCallBackMethods } from "tabulator-tables";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import { setAttribute, setLabel, setLabelValues, setRelationValues } from "../../../services/attributes";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import type AttributeDetailWidget from "../../attribute_widgets/attribute_detail";
import { ParentComponent } from "../../react/react_utils";
import useRowTableEditing from "./row_editing";

vi.mock("../../../services/attributes", () => ({
    setAttribute: vi.fn(),
    setLabel: vi.fn(),
    setLabelValues: vi.fn(),
    setRelationValues: vi.fn()
}));

describe("useRowTableEditing", () => {
    let container: HTMLElement;
    let events: Partial<EventCallBackMethods> | undefined;
    let note: FNote;

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        vi.spyOn(server, "put").mockResolvedValue(undefined);
        container = document.createElement("div");
        document.body.appendChild(container);
        note = buildNote({ title: "Task" });
        mount();
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    function Probe() {
        events = useRowTableEditing(
            { current: null },
            {} as AttributeDetailWidget,
            buildNote({ title: "Collection" })
        );
        return null;
    }

    function mount() {
        const parent = {
            componentId: "table-cid",
            registerHandler: () => {},
            removeHandler: () => {}
        } as unknown as Component;
        act(() => render(
            <ParentComponent.Provider value={parent}>
                <Probe />
            </ParentComponent.Provider>,
            container
        ));
    }

    /** Commits a cell as Tabulator does when the editor hands its value over. */
    async function editCell(field: string, value: unknown) {
        const cell = {
            getRow: () => ({ getData: () => ({ noteId: note.noteId }) }),
            getField: () => field,
            getValue: () => value
        } as unknown as CellComponent;
        await act(async () => { await events?.cellEdited?.(cell); });
    }

    // Every write carries the table's own component id, so that the reload it comes back as is
    // filtered out of useData rather than rebuilding the rows under the next cell's editor.
    it("stamps a title edit with the table's component id", async () => {
        await editCell("title", "Renamed");
        expect(server.put).toHaveBeenCalledWith(`notes/${note.noteId}/title`, { title: "Renamed" }, "table-cid");
    });

    it("stamps a label edit with the table's component id, normalising non-string values", async () => {
        await editCell("labels.status", "Done");
        expect(setLabel).toHaveBeenLastCalledWith(note.noteId, "status", "Done", false, "table-cid");

        await editCell("labels.done", true);
        expect(setLabel).toHaveBeenLastCalledWith(note.noteId, "done", "true", false, "table-cid");

        await editCell("labels.count", 3);
        expect(setLabel).toHaveBeenLastCalledWith(note.noteId, "count", "3", false, "table-cid");

        await editCell("labels.tag", [ "one", "two" ]);
        expect(setLabelValues).toHaveBeenCalledWith(note, "tag", [ "one", "two" ], "table-cid");
    });

    it("stamps a relation edit with the table's component id", async () => {
        await editCell("relations.owner", "targetNoteId");
        expect(setAttribute).toHaveBeenCalledWith(note, "relation", "owner", "targetNoteId", "table-cid");

        await editCell("relations.tags", [ "a", "b" ]);
        expect(setRelationValues).toHaveBeenCalledWith(note, "tags", [ "a", "b" ], "table-cid");
    });
});
