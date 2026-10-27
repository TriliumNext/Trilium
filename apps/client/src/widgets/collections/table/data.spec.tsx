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
    /** Every distinct row set and column set the hook has handed out, in order. */
    let builds: { rows: Set<unknown>; columns: Set<unknown> };
    let resetNewAttributePosition: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        vi.clearAllMocks();
        handlers = new Map();
        captured = undefined;
        builds = { rows: new Set(), columns: new Set() };
        resetNewAttributePosition = vi.fn();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.restoreAllMocks();
    });

    /** Runs the hook as the table does, under a parent that can hand it a reload. */
    function Probe({ note, noteIds, isReadOnly }: { note: FNote; noteIds: string[]; isReadOnly?: boolean }) {
        captured = useData(note, noteIds, undefined, { current: undefined }, resetNewAttributePosition, isReadOnly);
        if (captured.rowData) builds.rows.add(captured.rowData);
        if (captured.columnDefs) builds.columns.add(captured.columnDefs);
        return null;
    }

    async function mount(note: FNote, noteIds: string[], isReadOnly?: boolean) {
        const parent = {
            componentId: "table-cid",
            registerHandler: (name: string, callback: (data: unknown) => void) => handlers.set(name, callback),
            removeHandler: () => {}
        } as unknown as Component;
        await act(async () => render(
            <ParentComponent.Provider value={parent}>
                <Probe note={note} noteIds={noteIds} isReadOnly={isReadOnly} />
            </ParentComponent.Provider>,
            container
        ));
        // The refresh the mount effect starts awaits its way through the caches; a whole turn of
        // the loop lets the chain settle before the assertions read what it wrote.
        await settle();
    }

    function settle(ms = 0) {
        return act(async () => {
            await new Promise((resolve) => setTimeout(resolve, ms));
        });
    }

    /** Holds back the next `froca.getNotes()` call, as a cold cache does the refresh that fetches. */
    function delayNextGetNotes() {
        const getNotes = froca.getNotes.bind(froca);
        let delayed = false;
        vi.spyOn(froca, "getNotes").mockImplementation(async (...args) => {
            if (!delayed) {
                delayed = true;
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            return getNotes(...args);
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

    /** Hands the hook a reload reporting nothing but what the test overrides. */
    async function fire(loadResults: Record<string, unknown>) {
        const reload = {
            getAttributeRows: () => [],
            getBranchRows: () => [],
            isNoteReloaded: () => false,
            ...loadResults
        };
        await act(async () => handlers.get("entitiesReloaded")?.({ loadResults: reload as unknown as LoadResults }));
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

    it("builds a read-only table's columns without editors and keeps its rows from being dragged", async () => {
        const { note, noteIds } = collection();
        await mount(note, noteIds);
        expect(captured?.columnDefs?.some((column) => column.editor)).toBe(true);
        expect(captured?.movableRows).toBe(true);

        render(null, container);
        await mount(note, noteIds, true);
        expect(captured?.columnDefs?.map((column) => column.field)).toContain("labels.status");
        expect(captured?.columnDefs?.some((column) => column.editor || column.editorParams)).toBe(false);
        expect(captured?.columnDefs?.every((column) => column.editable === false)).toBe(true);
        expect(captured?.movableRows).toBe(false);
    });

    it("gives movable rows a handle even when the first refresh finishes last", async () => {
        const { note, noteIds } = collection();
        delayNextGetNotes();
        await mount(note, noteIds);
        await settle(50);

        // Without the handle column, Tabulator drags a row by any cell, and opening a cell's
        // editor on mousedown keeps the mouseup from cancelling the drag (#12225).
        expect(captured?.movableRows).toBe(true);
        expect(captured?.columnDefs?.[0]).toMatchObject({ title: "#", rowHandle: true });
    });

    it("keeps an older, slower refresh from overwriting a newer one", async () => {
        const { note, noteIds } = collection();
        await mount(note, noteIds);

        const other = buildNote({ title: "Other", children: [ { title: "Other task" } ] });
        delayNextGetNotes();
        await mount(other, []);
        await mount(note, noteIds);
        await settle(50);

        expect(captured?.rowData?.map((row) => row.title)).toEqual([ "Task 1", "Task 2" ]);
    });

    it("builds a nested table once, though its note list and its subtree are known only later", async () => {
        const note = buildNote({
            title: "Collection",
            children: [ { title: "Task", children: [ { title: "Subtask" } ] }, { title: "Other" } ]
        });

        // `useNoteIds()` starts out empty and hands over the list once its search returns.
        await mount(note, []);
        await mount(note, [ ...note.children ]);

        expect(builds.rows.size).toBe(1);
        expect(builds.columns.size).toBe(1);
        // The subtree keeps the rows from being dragged, and the one column set built knows it.
        expect(captured?.movableRows).toBe(false);
        expect(captured?.columnDefs?.[0]).toMatchObject({ title: "#", rowHandle: false });
    });

    it("rebuilds the rows for a note list that differs from the one it walked", async () => {
        const { note, noteIds } = collection();
        await mount(note, noteIds);

        // A search collection's results change without a branch reload; only the list tells.
        note.children.reverse();
        await mount(note, [ ...note.children ]);

        expect(captured?.rowData?.map((row) => row.title)).toEqual([ "Task 2", "Task 1" ]);
    });

    it("refreshes only the rows for a row change, leaving the columns be", async () => {
        const { note, noteIds } = collection();
        await mount(note, noteIds);
        const columnsBefore = captured?.columnDefs;

        const task = froca.notes[noteIds[0]];
        task.title = "Renamed";
        await fire({ getBranchRows: () => [ { parentNoteId: note.noteId } ] });

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
        await fire({ getAttributeRows: (componentId?: string) => componentId === "table-cid" ? [] : definitionRows });
        expect(captured?.columnDefs).toBe(columnsBefore);

        // The same change made elsewhere rebuilds the columns.
        await fire({ getAttributeRows: () => definitionRows });
        expect(captured?.columnDefs).not.toBe(columnsBefore);
    });

    it("rebuilds the rows for a cell changed elsewhere, but not for its own edit", async () => {
        const { note, noteIds } = collection();
        await mount(note, noteIds);
        const rowsBefore = captured?.rowData;

        const task = froca.notes[noteIds[0]];
        task.title = "Renamed";
        const labelRows = [ { noteId: noteIds[0], type: "label", name: "status", value: "Done" } ];

        // The title and the label this table has just written come back as this table's own
        // reload: rebuilding the rows now would cancel the editor Tab has opened in the next cell.
        await fire({
            isNoteReloaded: (noteId: string, componentId?: string) => noteId === noteIds[0] && componentId !== "table-cid",
            getAttributeRows: (componentId?: string) => componentId === "table-cid" ? [] : labelRows
        });
        expect(captured?.rowData).toBe(rowsBefore);

        // The same title change made elsewhere rebuilds the rows.
        await fire({ isNoteReloaded: (noteId: string) => noteId === noteIds[0] });
        expect(captured?.rowData?.map((row) => row.title)).toEqual([ "Renamed", "Task 2" ]);

        // As does a label changed elsewhere.
        const rowsAfterTitle = captured?.rowData;
        await fire({ getAttributeRows: () => labelRows });
        expect(captured?.rowData).not.toBe(rowsAfterTitle);
    });
});
