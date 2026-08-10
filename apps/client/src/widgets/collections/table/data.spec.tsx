import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import type LoadResults from "../../../services/load_results";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import useData from "./data";

describe("useData", () => {
    let container: HTMLElement;
    let handlers: Map<string, (data: unknown) => void>;
    let captured: ReturnType<typeof useData> | undefined;
    let resetNewAttributePosition: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        vi.clearAllMocks();
        handlers = new Map();
        captured = undefined;
        resetNewAttributePosition = vi.fn();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    /** Runs the hook as the table does, under a parent that can hand it a reload. */
    function Probe({ note, noteIds }: { note: FNote; noteIds: string[] }) {
        captured = useData(note, noteIds, undefined, { current: undefined }, resetNewAttributePosition);
        return null;
    }

    async function mount(note: FNote, noteIds: string[]) {
        const parent = {
            componentId: "table-cid",
            registerHandler: (name: string, callback: (data: unknown) => void) => handlers.set(name, callback),
            removeHandler: () => {}
        } as unknown as Component;
        await act(async () => render(
            <ParentComponent.Provider value={parent}>
                <Probe note={note} noteIds={noteIds} />
            </ParentComponent.Provider>,
            container
        ));
        // The refresh the mount effect starts awaits its way through the caches; a whole turn of
        // the loop lets the chain settle before the assertions read what it wrote.
        await settle();
    }

    function settle() {
        return act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }

    function collection() {
        const note = buildNote({
            title: "Collection",
            "#label:status(inheritable)": "promoted,single,select,options=Todo;Done",
            children: [ { title: "Task 1", "#status": "Todo" }, { title: "Task 2" } ]
        });
        const noteIds = note.getChildBranches()
            .map((branch) => branch.noteId)
            .filter((noteId): noteId is string => !!noteId);
        return { note, noteIds };
    }

    async function fire(loadResults: Record<string, unknown>) {
        await act(async () => handlers.get("entitiesReloaded")?.({ loadResults: loadResults as unknown as LoadResults }));
        await settle();
    }

    it("builds the columns the definitions ask for and a row per child", async () => {
        const { note, noteIds } = collection();
        await mount(note, noteIds);

        expect(captured?.columnDefs?.map((column) => column.field)).toContain("labels.status");
        expect(captured?.rowData?.map((row) => row.title)).toEqual([ "Task 1", "Task 2" ]);
        // The columns were built, so a pending "place the new one here" has been spent.
        expect(resetNewAttributePosition).toHaveBeenCalled();

        // A select cell's options are read from the note as the cell is opened, late enough to
        // include one the definition has just been given.
        const statusColumn = captured?.columnDefs?.find((column) => column.field === "labels.status");
        const editorParams = statusColumn?.editorParams;
        if (typeof editorParams !== "function") throw new Error("expected the params to be a function");
        expect(editorParams(undefined as never)).toMatchObject({ options: [ "Todo", "Done" ] });
    });

    it("refreshes only the rows for a row change, leaving the columns be", async () => {
        const { note, noteIds } = collection();
        await mount(note, noteIds);
        const columnsBefore = captured?.columnDefs;

        const task = froca.notes[noteIds[0]];
        task.title = "Renamed";
        await fire({
            getAttributeRows: () => [],
            getBranchRows: () => [ { parentNoteId: note.noteId } ],
            getNoteIds: () => []
        });

        expect(captured?.rowData?.map((row) => row.title)).toEqual([ "Renamed", "Task 2" ]);
        // The very same array: rebuilt columns are replaced wholesale in Tabulator, which would
        // throw away the scroll position on every edit.
        expect(captured?.columnDefs).toBe(columnsBefore);
    });

    it("rebuilds the columns for a definition changed elsewhere, but not for its own change", async () => {
        const { note, noteIds } = collection();
        await mount(note, noteIds);
        const columnsBefore = captured?.columnDefs;

        const definitionRows = [ {
            noteId: note.noteId, type: "label", name: "label:status", value: "promoted,single,text", isInheritable: true
        } ];

        // The table's own write comes back around: rebuilding now would pull the open editor
        // out from under the user, so its component id filters the change away.
        await fire({
            getAttributeRows: (componentId?: string) => componentId === "table-cid" ? [] : definitionRows,
            getBranchRows: () => [],
            getNoteIds: () => []
        });
        expect(captured?.columnDefs).toBe(columnsBefore);

        // The same change made elsewhere rebuilds the columns.
        await fire({
            getAttributeRows: () => definitionRows,
            getBranchRows: () => [],
            getNoteIds: () => []
        });
        expect(captured?.columnDefs).not.toBe(columnsBefore);
    });
});
