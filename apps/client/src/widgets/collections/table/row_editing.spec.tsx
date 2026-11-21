import { render } from "preact";
import { act } from "preact/test-utils";
import type { CellComponent, EventCallBackMethods } from "tabulator-tables";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import { setAttribute, setLabel, setLabelValues, setRelationValues } from "../../../services/attributes";
import note_create from "../../../services/note_create";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import type AttributeDetailWidget from "../../attribute_widgets/attribute_detail";
import { ParentComponent } from "../../react/react_utils";
import useRowTableEditing from "./row_editing";

vi.mock("../../../services/note_create", () => ({
    default: { createNote: vi.fn() }
}));

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

describe("useRowTableEditing: New row", () => {
    const container = document.createElement("div");

    afterEach(() => {
        render(null, container);
        vi.useRealTimers();
    });

    it("leaves the button, then scrolls to the new row and edits its title once the row is there", async () => {
        vi.useFakeTimers();
        const edit = vi.fn();
        const scrollTo = vi.fn(() => Promise.resolve());
        const newRow = { getIndex: () => "new-branch", getTreeChildren: () => [], getCell: () => ({ edit }), scrollTo };
        let rows: unknown[] = [];
        const api = { current: { getRows: () => rows, options: {} } } as never;
        vi.mocked(note_create.createNote).mockResolvedValue({ branch: { branchId: "new-branch" } } as never);

        const parent = { registerHandler: () => {}, removeHandler: () => {} } as unknown as Component & { addNewRowCommand: (data: object) => void };
        function Probe() {
            useRowTableEditing(api, {} as AttributeDetailWidget, buildNote({ title: "Collection" }));
            return null;
        }
        act(() => render(<ParentComponent.Provider value={parent}><Probe /></ParentComponent.Provider>, container));

        const button = document.createElement("button");
        document.body.appendChild(button);
        button.focus();
        await act(async () => { parent.addNewRowCommand({}); });
        expect(document.activeElement).not.toBe(button);

        // The row shows up a few rebuilds later, as in a long table.
        await vi.advanceTimersByTimeAsync(500);
        expect(edit).not.toHaveBeenCalled();
        rows = [ newRow ];
        await vi.advanceTimersByTimeAsync(100);
        expect(scrollTo).toHaveBeenCalledWith("nearest", false);
        expect(edit).toHaveBeenCalledOnce();
        button.remove();
    });
});
