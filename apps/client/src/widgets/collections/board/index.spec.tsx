import { render } from "preact";
import { useContext, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Capture the props handed to the (mocked) Column so we can assert what the board feeds each column
// and exercise its callbacks (onColumnHover) without rendering the heavy real Column tree. The mock
// also reaches into BoardViewContext (resolved lazily at render time via a holder assigned after the
// top-level import) to expose setDraggedColumn, so tests can drive the board's column-drag lifecycle
// (start → hover → drop) that the real Column normally triggers.
const columnCalls: Record<string, unknown>[] = [];
const boardCtxRef = vi.hoisted(() => ({ current: undefined as Record<string, unknown> | undefined }));
// Assigned after the top import so the mock can read the real BoardViewContext + the same preact/hooks
// instance the component uses (a fresh require() of preact/hooks has a mismatched hook-state pointer
// and crashes the render). Importing ./index inside the hoisted factory deadlocks, hence the holder.
const ctxHolder = vi.hoisted(() => ({
    context: undefined as unknown,
    useContext: undefined as undefined | (<T>(c: unknown) => T)
}));
vi.mock("./column", () => ({
    default: (props: Record<string, unknown>) => {
        columnCalls.push(props);
        if (ctxHolder.context && ctxHolder.useContext) {
            boardCtxRef.current = ctxHolder.useContext<Record<string, unknown> | undefined>(ctxHolder.context);
        }
        return <div className="board-column-mock" data-column={String(props.column)} data-index={String(props.columnIndex)} />;
    }
}));

// The board data loader is the source of byColumn/columns; stub it so we control the rendered shape.
const dataState = vi.hoisted(() => ({
    impl: undefined as undefined | ((...args: unknown[]) => Promise<unknown>)
}));
vi.mock("./data", () => ({
    getBoardData: (...args: unknown[]) => {
        if (dataState.impl) return dataState.impl(...args);
        return Promise.resolve({ byColumn: new Map(), newPersistedData: undefined, isInRelationMode: false });
    }
}));

// BoardApi is constructed inside the component; the real constructor only manipulates strings, but we
// stub it so reorderColumn/addNewColumn are observable spies and we don't drag in services.
const apiState = vi.hoisted(() => ({ instances: [] as Record<string, ReturnType<typeof vi.fn>>[] }));
vi.mock("./api", () => {
    return {
        default: class FakeBoardApi {
            statusAttribute = "status";
            reorderColumn = vi.fn((_from: number, _to: number) => [ "A", "B" ]);
            addNewColumn = vi.fn(async (_name: string) => true);
            constructor() {
                apiState.instances.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>);
            }
        }
    };
});

// CollectionProperties pulls in the book/search-only ribbon machinery; render a thin marker.
vi.mock("../../note_bars/CollectionProperties", () => ({
    default: ({ note }: { note: FNote }) => (
        <div className="collection-properties-mock" data-note-id={note.noteId} />
    )
}));

// NoteAutocomplete bootstraps the jQuery autocomplete plugin; replace it with a controllable input.
vi.mock("../../react/NoteAutocomplete", () => ({
    default: (props: Record<string, unknown>) => {
        const onKeyDown = props.onKeyDown as ((e: KeyboardEvent) => void) | undefined;
        const onBlur = props.onBlur as (() => void) | undefined;
        const noteIdChanged = props.noteIdChanged as ((id: string) => void) | undefined;
        return (
            <input
                className="note-autocomplete-mock"
                data-note-id={String(props.noteId ?? "")}
                onKeyDown={(e) => onKeyDown?.(e as unknown as KeyboardEvent)}
                onBlur={() => onBlur?.()}
                onInput={(e) => noteIdChanged?.((e.currentTarget as HTMLInputElement).value)}
            />
        );
    }
}));

vi.mock("../../widget_utils", () => ({
    onWheelHorizontalScroll: vi.fn()
}));

vi.mock("../../../services/toast", () => ({
    default: { showMessage: vi.fn() }
}));

import Component from "../../../components/component";
import toast from "../../../services/toast";
import { buildNote } from "../../../test/easy-froca";
import { NoteContextContext, ParentComponent } from "../../react/react_utils";
import { onWheelHorizontalScroll } from "../../widget_utils";
import type { ViewModeProps } from "../interface";
import BoardView, { BoardViewContext, TitleEditor } from "./index";

// Hand the real BoardViewContext + the live useContext to the mocked Column so it can read
// setDraggedColumn at render time (using the same preact/hooks instance the component renders with).
ctxHolder.context = BoardViewContext;
ctxHolder.useContext = (<T,>(c: unknown) => useContext(c as Parameters<typeof useContext>[0]) as T);

// --- Harness --------------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent = new Component();

function setBoardData(byColumn: Map<string, unknown>, opts: { newPersistedData?: unknown; isInRelationMode?: boolean } = {}) {
    dataState.impl = async () => ({
        byColumn,
        newPersistedData: opts.newPersistedData,
        isInRelationMode: opts.isInRelationMode ?? false
    });
}

async function renderBoard(props: Partial<ViewModeProps<{ columns?: { value: string }[] }>> & { note: FNote }) {
    const target = document.createElement("div");
    document.body.appendChild(target);
    container = target;
    const fullProps: ViewModeProps<{ columns?: { value: string }[] }> = {
        notePath: "root/" + props.note.noteId,
        noteIds: [],
        highlightedTokens: null,
        viewConfig: undefined,
        saveConfig: vi.fn(),
        media: "screen",
        onReady: vi.fn(),
        ...props
    };
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={null}>
                    <BoardView {...fullProps} />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>,
            target
        );
    });
    // Let the refresh() async effect settle and re-render.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return target;
}

function fireTrilium(name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
    });
}

function loadResults(opts: {
    attributeRows?: Array<{ name?: string; noteId?: string }>;
    noteIds?: string[];
    branchRows?: Array<{ noteId?: string }>;
    attachmentRows?: Array<{ ownerId?: string; title?: string }>;
    optionNames?: string[];
} = {}) {
    return {
        getAttributeRows: () => opts.attributeRows ?? [],
        getBranchRows: () => opts.branchRows ?? [],
        getNoteIds: () => opts.noteIds ?? [],
        getAttachmentRows: () => opts.attachmentRows ?? [],
        getOptionNames: () => opts.optionNames ?? [],
        isNoteReloaded: () => false,
        isNoteContentReloaded: () => false,
        getEntityRow: () => undefined
    };
}

beforeEach(() => {
    parent = new Component();
    columnCalls.length = 0;
    apiState.instances.length = 0;
    dataState.impl = undefined;
    vi.clearAllMocks();
});

afterEach(async () => {
    if (container) {
        await act(async () => { render(null, container as HTMLDivElement); });
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- BoardView rendering --------------------------------------------------------------------------

describe("BoardView rendering", () => {
    it("renders the board shell and one Column per resolved column, preserving persisted order", async () => {
        setBoardData(new Map([ [ "Todo", [] ], [ "Done", [] ], [ "Extra", [] ] ]));
        const note = buildNote({ id: "b1", title: "Board" });
        const root = await renderBoard({
            note,
            noteIds: [ "x" ],
            viewConfig: { columns: [ { value: "Done" }, { value: "Todo" } ] }
        });

        expect(root.querySelector(".board-view")).toBeTruthy();
        expect(root.querySelector(".collection-properties-mock")?.getAttribute("data-note-id")).toBe("b1");
        expect(root.querySelector(".board-view-container")).toBeTruthy();

        // Persisted order (Done, Todo) comes first, then the new column (Extra) appended.
        const cols = Array.from(root.querySelectorAll(".board-column-mock")).map((el) => el.getAttribute("data-column"));
        expect(cols).toEqual([ "Done", "Todo", "Extra" ]);

        // The board passes through the AddNewColumn footer.
        expect(root.querySelector(".board-add-column")).toBeTruthy();
    });

    it("does not render the container until byColumn and columns resolve", async () => {
        // getBoardData never resolves → byColumn stays undefined → container is not rendered.
        dataState.impl = () => new Promise(() => { /* never resolves */ });
        const note = buildNote({ id: "pending", title: "P" });
        const root = await renderBoard({ note });
        expect(root.querySelector(".board-view")).toBeTruthy();
        expect(root.querySelector(".board-view-container")).toBeNull();
    });

    it("persists newly discovered columns via saveConfig when getBoardData returns new data", async () => {
        const saveConfig = vi.fn();
        setBoardData(new Map([ [ "A", [] ] ]), { newPersistedData: { columns: [ { value: "A" } ] } });
        const note = buildNote({ id: "persistNote", title: "P" });
        await renderBoard({ note, saveConfig });
        expect(saveConfig).toHaveBeenCalledWith({ columns: [ { value: "A" } ] });
    });

    it("forwards isInRelationMode and column items to each Column", async () => {
        const items = [ { note: buildNote({ id: "card1", title: "C1" }), branch: {} } ];
        setBoardData(new Map([ [ "Rel", items ] ]), { isInRelationMode: true });
        const note = buildNote({ id: "relBoard", title: "R" });
        await renderBoard({ note });
        const relProp = columnCalls.find((c) => c.column === "Rel");
        expect(relProp?.isInRelationMode).toBe(true);
        expect(relProp?.columnItems).toBe(items);
    });

    it("wheel scrolling on the container delegates to onWheelHorizontalScroll", async () => {
        setBoardData(new Map([ [ "C", [] ] ]));
        const note = buildNote({ id: "wheelBoard", title: "W" });
        const root = await renderBoard({ note });
        const containerEl = root.querySelector(".board-view-container") as HTMLElement;
        act(() => { containerEl.dispatchEvent(new WheelEvent("wheel", { bubbles: true })); });
        expect(onWheelHorizontalScroll).toHaveBeenCalled();
    });
});

// --- entitiesReloaded reactions -------------------------------------------------------------------

describe("BoardView - entitiesReloaded reactions", () => {
    async function setupBoard(noteIds: string[]) {
        setBoardData(new Map([ [ "C", [] ] ]));
        const note = buildNote({ id: "erBoard", title: "ER" });
        const root = await renderBoard({ note, noteIds });
        // Re-arm getBoardData so a later refresh is observable.
        const refreshImpl = vi.fn(async () => ({ byColumn: new Map([ [ "C", [] ] ]), newPersistedData: undefined, isInRelationMode: false }));
        dataState.impl = refreshImpl;
        return { note, root, refreshImpl };
    }

    it("refreshes on a status-attribute change for a tracked note", async () => {
        const { refreshImpl } = await setupBoard([ "tracked" ]);
        fireTrilium("entitiesReloaded", { loadResults: loadResults({ attributeRows: [ { name: "status", noteId: "tracked" } ] }) });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(refreshImpl).toHaveBeenCalled();
    });

    it("refreshes on a note-title change for a tracked note", async () => {
        const { refreshImpl } = await setupBoard([ "tracked" ]);
        fireTrilium("entitiesReloaded", { loadResults: loadResults({ noteIds: [ "tracked" ] }) });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(refreshImpl).toHaveBeenCalled();
    });

    it("refreshes on a branch change for a tracked note", async () => {
        const { refreshImpl } = await setupBoard([ "tracked" ]);
        fireTrilium("entitiesReloaded", { loadResults: loadResults({ branchRows: [ { noteId: "tracked" } ] }) });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(refreshImpl).toHaveBeenCalled();
    });

    it("refreshes on an icon/color change for a tracked note", async () => {
        const { refreshImpl } = await setupBoard([ "tracked" ]);
        fireTrilium("entitiesReloaded", { loadResults: loadResults({ attributeRows: [ { name: "iconClass", noteId: "tracked" } ] }) });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(refreshImpl).toHaveBeenCalled();
    });

    it("refreshes on a board.json attachment change on the parent note", async () => {
        const { refreshImpl } = await setupBoard([ "x" ]);
        fireTrilium("entitiesReloaded", { loadResults: loadResults({ attachmentRows: [ { ownerId: "erBoard", title: "board.json" } ] }) });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(refreshImpl).toHaveBeenCalled();
    });

    it("refreshes when board:groupBy changes on the parent note", async () => {
        const { refreshImpl } = await setupBoard([ "x" ]);
        fireTrilium("entitiesReloaded", { loadResults: loadResults({ attributeRows: [ { name: "board:groupBy", noteId: "erBoard" } ] }) });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(refreshImpl).toHaveBeenCalled();
    });

    it("ignores changes that do not affect the board", async () => {
        const { refreshImpl } = await setupBoard([ "tracked" ]);
        fireTrilium("entitiesReloaded", { loadResults: loadResults({
            attributeRows: [ { name: "status", noteId: "someOtherNote" } ],
            noteIds: [ "unrelated" ],
            branchRows: [ { noteId: "unrelated" } ],
            attachmentRows: [ { ownerId: "unrelated", title: "other.json" } ]
        }) });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(refreshImpl).not.toHaveBeenCalled();
    });
});

// --- column drag handlers (via Column props + container events) -----------------------------------

describe("BoardView - column drag interactions", () => {
    function getCtx() {
        const ctx = boardCtxRef.current;
        if (!ctx) throw new Error("BoardViewContext was not captured");
        return ctx as {
            setDraggedColumn: (v: { column: string; index: number } | null) => void;
            api: { reorderColumn: ReturnType<typeof vi.fn> };
        };
    }

    /** The board re-renders Column on every state change; grab the most recent props for a column so
     *  callbacks (onColumnHover) reflect the latest closure (e.g. after draggedColumn is set). */
    function latestColumnProps(column: string) {
        for (let i = columnCalls.length - 1; i >= 0; i--) {
            if (columnCalls[i].column === column) return columnCalls[i];
        }
        return undefined;
    }
    function hoverFor(column: string) {
        return latestColumnProps(column)?.onColumnHover as ((index: number, x: number, rect: DOMRect) => void) | undefined;
    }

    it("hover is a no-op until a column is being dragged", async () => {
        setBoardData(new Map([ [ "A", [] ], [ "B", [] ] ]));
        const note = buildNote({ id: "hoverBoard", title: "H" });
        const root = await renderBoard({ note, viewConfig: { columns: [ { value: "A" }, { value: "B" } ] } });

        const colA = columnCalls.find((c) => c.column === "A");
        const onColumnHover = colA?.onColumnHover as ((index: number, x: number, rect: DOMRect) => void) | undefined;
        expect(typeof onColumnHover).toBe("function");

        // No draggedColumn yet → hover does nothing (no placeholder appears).
        act(() => onColumnHover?.(1, 5, { left: 0, width: 100 } as DOMRect));
        expect(root.querySelectorAll(".column-drop-placeholder.show").length).toBe(0);
    });

    it("drives the full drag lifecycle: start, hover (places a placeholder), and drop (reorders)", async () => {
        setBoardData(new Map([ [ "A", [] ], [ "B", [] ] ]));
        const note = buildNote({ id: "dragBoard", title: "D" });
        const root = await renderBoard({ note, viewConfig: { columns: [ { value: "A" }, { value: "B" } ] } });

        // Begin dragging column A (index 0) by invoking the context setter the real Column would use.
        act(() => { getCtx().setDraggedColumn({ column: "A", index: 0 }); });

        // Now hover over column B (index 1) with the mouse on the left half → insertBefore → index 1.
        // Use the freshest onColumnHover closure (it now sees draggedColumn).
        act(() => hoverFor("B")?.(1, 10, { left: 0, width: 100 } as DOMRect)); // mouseX(10) < middle(50) → before
        // The placeholder appears at the computed drop index (1).
        expect(root.querySelectorAll(".column-drop-placeholder.show").length).toBeGreaterThanOrEqual(1);

        // Dragover on the container should preventDefault while a column is dragged.
        const containerEl = root.querySelector(".board-view-container") as HTMLElement;
        const overEvt = new Event("DragOver", { bubbles: true, cancelable: true }) as DragEvent;
        const overPrevent = vi.spyOn(overEvt, "preventDefault");
        act(() => { containerEl.dispatchEvent(overEvt); });
        expect(overPrevent).toHaveBeenCalled();

        // Drop on the container → reorderColumn(fromIndex 0, toIndex 1) and clears the drag state.
        const api = getCtx().api;
        const dropEvt = new Event("Drop", { bubbles: true, cancelable: true }) as DragEvent;
        act(() => { containerEl.dispatchEvent(dropEvt); });
        expect(api.reorderColumn).toHaveBeenCalledWith(0, 1);
        // After the drop the placeholder is gone (columnDropPosition reset to null).
        expect(root.querySelectorAll(".column-drop-placeholder.show").length).toBe(0);
    });

    it("places the trailing placeholder when hovering past the last column's middle", async () => {
        setBoardData(new Map([ [ "A", [] ], [ "B", [] ] ]));
        const note = buildNote({ id: "tailBoard", title: "T" });
        const root = await renderBoard({ note, viewConfig: { columns: [ { value: "A" }, { value: "B" } ] } });

        act(() => { getCtx().setDraggedColumn({ column: "A", index: 0 }); });
        // mouseX(90) > middle(50) → insert after the last column → drop index === columns.length (2).
        act(() => hoverFor("B")?.(1, 90, { left: 0, width: 100 } as DOMRect));
        expect(root.querySelectorAll(".column-drop-placeholder.show").length).toBeGreaterThanOrEqual(1);
    });

    it("container dragOver and drop are safe no-ops when nothing is being dragged", async () => {
        setBoardData(new Map([ [ "A", [] ] ]));
        const note = buildNote({ id: "idleBoard", title: "I" });
        const root = await renderBoard({ note });
        const containerEl = root.querySelector(".board-view-container") as HTMLElement;

        const overEvt = new Event("DragOver", { bubbles: true, cancelable: true }) as DragEvent;
        const overPrevent = vi.spyOn(overEvt, "preventDefault");
        act(() => { containerEl.dispatchEvent(overEvt); });
        expect(overPrevent).not.toHaveBeenCalled();

        const dropEvt = new Event("Drop", { bubbles: true, cancelable: true }) as DragEvent;
        const dropPrevent = vi.spyOn(dropEvt, "preventDefault");
        act(() => { containerEl.dispatchEvent(dropEvt); });
        // handleContainerDrop always preventDefaults, but reorderColumn must not run.
        expect(dropPrevent).toHaveBeenCalled();
        const api = apiState.instances[apiState.instances.length - 1];
        expect(api?.reorderColumn).not.toHaveBeenCalled();
    });

    it("does not reorder when reorderColumn returns nothing (no-op move)", async () => {
        setBoardData(new Map([ [ "A", [] ], [ "B", [] ] ]));
        const note = buildNote({ id: "noopBoard", title: "N" });
        const root = await renderBoard({ note, viewConfig: { columns: [ { value: "A" }, { value: "B" } ] } });
        const api = getCtx().api;
        api.reorderColumn.mockReturnValueOnce(undefined);

        act(() => { getCtx().setDraggedColumn({ column: "A", index: 0 }); });
        act(() => hoverFor("B")?.(1, 10, { left: 0, width: 100 } as DOMRect));

        const containerEl = root.querySelector(".board-view-container") as HTMLElement;
        act(() => { containerEl.dispatchEvent(new Event("Drop", { bubbles: true, cancelable: true })); });
        expect(api.reorderColumn).toHaveBeenCalled();
        // Columns list stays the same; the falsy return short-circuits setColumns.
        const cols = Array.from(root.querySelectorAll(".board-column-mock")).map((el) => el.getAttribute("data-column"));
        expect(cols).toEqual([ "A", "B" ]);
    });
});

// --- AddNewColumn ---------------------------------------------------------------------------------

describe("AddNewColumn", () => {
    async function renderWithColumns() {
        setBoardData(new Map([ [ "C", [] ] ]));
        const note = buildNote({ id: "ancBoard", title: "ANC" });
        const root = await renderBoard({ note });
        return root;
    }

    it("shows the add-column affordance and switches to an editor on click", async () => {
        const root = await renderWithColumns();
        const addCol = root.querySelector(".board-add-column") as HTMLElement;
        expect(addCol.className).not.toContain("editing");
        expect(addCol.querySelector("input")).toBeNull();

        act(() => addCol.click());
        expect(root.querySelector(".board-add-column")?.className).toContain("editing");
        expect(root.querySelector(".board-add-column input")).toBeTruthy();
    });

    it("switches to an editor on Enter keydown but not on other keys", async () => {
        const root = await renderWithColumns();
        const addCol = root.querySelector(".board-add-column") as HTMLElement;

        act(() => { addCol.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
        expect(root.querySelector(".board-add-column input")).toBeNull();

        act(() => { addCol.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
        expect(root.querySelector(".board-add-column input")).toBeTruthy();
    });

    it("saves a new column through api.addNewColumn and shows no toast when created", async () => {
        const root = await renderWithColumns();
        const api = apiState.instances[apiState.instances.length - 1];
        api.addNewColumn.mockResolvedValue(true);

        const addCol = root.querySelector(".board-add-column") as HTMLElement;
        act(() => addCol.click());
        const input = root.querySelector(".board-add-column input") as HTMLInputElement;
        input.value = "Backlog";
        // onBlur commits when the value is non-empty.
        await act(async () => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        expect(api.addNewColumn).toHaveBeenCalledWith("Backlog");
        expect(toast.showMessage).not.toHaveBeenCalled();
    });

    it("shows a toast when the column already exists (addNewColumn returns false)", async () => {
        const root = await renderWithColumns();
        const api = apiState.instances[apiState.instances.length - 1];
        api.addNewColumn.mockResolvedValue(false);

        const addCol = root.querySelector(".board-add-column") as HTMLElement;
        act(() => addCol.click());
        const input = root.querySelector(".board-add-column input") as HTMLInputElement;
        input.value = "Existing";
        await act(async () => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        expect(api.addNewColumn).toHaveBeenCalledWith("Existing");
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("dismisses the editor (back to the affordance) when the title editor is dismissed", async () => {
        const root = await renderWithColumns();
        const addCol = root.querySelector(".board-add-column") as HTMLElement;
        act(() => addCol.click());
        expect(root.querySelector(".board-add-column input")).toBeTruthy();

        // Blur with an empty value triggers the TitleEditor's dismiss() → AddNewColumn leaves editing.
        const input = root.querySelector(".board-add-column input") as HTMLInputElement;
        input.value = "";
        act(() => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        expect(root.querySelector(".board-add-column input")).toBeNull();
        expect(root.querySelector(".board-add-column")?.className).not.toContain("editing");
    });

    it("uses the relation-mode editor (NoteAutocomplete) when the board groups by a relation", async () => {
        setBoardData(new Map([ [ "C", [] ] ]), { isInRelationMode: true });
        const note = buildNote({ id: "ancRel", title: "Rel" });
        const root = await renderBoard({ note });
        const addCol = root.querySelector(".board-add-column") as HTMLElement;
        act(() => addCol.click());
        // Relation mode renders the (mocked) NoteAutocomplete instead of a plain text input.
        expect(root.querySelector(".board-add-column .note-autocomplete-mock")).toBeTruthy();
        expect(root.querySelector(".board-add-column input.form-control")).toBeNull();
    });
});

// --- TitleEditor ----------------------------------------------------------------------------------

describe("TitleEditor", () => {
    function renderEditor(props: Parameters<typeof TitleEditor>[0]) {
        const target = document.createElement("div");
        document.body.appendChild(target);
        container = target;
        act(() => {
            render(
                <ParentComponent.Provider value={parent}>
                    <NoteContextContext.Provider value={null}>
                        <TitleEditor {...props} />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>,
                target
            );
        });
        return target;
    }

    it("renders a single-line FormTextBox in normal mode and commits on blur with a changed value", () => {
        const save = vi.fn();
        const dismiss = vi.fn();
        const root = renderEditor({ currentValue: "Old", placeholder: "ph", save, dismiss, mode: "normal" });
        const input = root.querySelector("input") as HTMLInputElement;
        expect(input).toBeTruthy();
        expect(root.querySelector("textarea")).toBeNull();

        input.value = "New";
        act(() => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        expect(save).toHaveBeenCalledWith("New");
        // dismiss is deferred until the next render; not called immediately on save.
        expect(dismiss).not.toHaveBeenCalled();
    });

    it("renders a multiline FormTextArea in multiline mode", () => {
        const root = renderEditor({ save: vi.fn(), dismiss: vi.fn(), mode: "multiline" });
        expect(root.querySelector("textarea")).toBeTruthy();
        expect(root.querySelector("input")).toBeNull();
    });

    it("dismisses (without saving) on blur with an empty value", () => {
        const save = vi.fn();
        const dismiss = vi.fn();
        const root = renderEditor({ currentValue: "", save, dismiss, mode: "normal" });
        const input = root.querySelector("input") as HTMLInputElement;
        input.value = "   ";
        act(() => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        expect(save).not.toHaveBeenCalled();
        expect(dismiss).toHaveBeenCalled();
    });

    it("dismisses (without saving) on blur when the value is unchanged and not a new item", () => {
        const save = vi.fn();
        const dismiss = vi.fn();
        const root = renderEditor({ currentValue: "Same", save, dismiss, mode: "normal" });
        const input = root.querySelector("input") as HTMLInputElement;
        input.value = "Same";
        act(() => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        expect(save).not.toHaveBeenCalled();
        expect(dismiss).toHaveBeenCalled();
    });

    it("saves an unchanged value when isNewItem is set", () => {
        const save = vi.fn();
        const dismiss = vi.fn();
        const root = renderEditor({ currentValue: "Same", save, dismiss, mode: "normal", isNewItem: true });
        const input = root.querySelector("input") as HTMLInputElement;
        input.value = "Same";
        act(() => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        expect(save).toHaveBeenCalledWith("Same");
    });

    it("dismisses immediately on Enter/Escape when there is no element to refocus", () => {
        const dismiss = vi.fn();
        const root = renderEditor({ currentValue: "X", save: vi.fn(), dismiss, mode: "normal" });
        const input = root.querySelector("input") as HTMLInputElement;
        act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
        expect(dismiss).toHaveBeenCalledTimes(1);
    });

    it("refocuses the previously-focused element on Enter and marks dismiss=false so blur saves", () => {
        // Provide a focusable element that was active before the editor mounted.
        const prevFocus = document.createElement("button");
        document.body.appendChild(prevFocus);
        prevFocus.focus();

        const save = vi.fn();
        const dismiss = vi.fn();
        const root = renderEditor({ currentValue: "Old", save, dismiss, mode: "normal" });
        const input = root.querySelector("input") as HTMLInputElement;
        const focusSpy = vi.spyOn(prevFocus, "focus");

        // Type a changed value, then press Enter → focus returns to prevFocus (does not dismiss yet).
        input.value = "Edited";
        act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
        expect(focusSpy).toHaveBeenCalled();

        // The resulting blur should save (shouldDismiss=false because Enter, not Escape).
        act(() => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        expect(save).toHaveBeenCalledWith("Edited");
        prevFocus.remove();
    });

    it("refocuses and marks dismiss=true on Escape so the subsequent blur dismisses", () => {
        const prevFocus = document.createElement("button");
        document.body.appendChild(prevFocus);
        prevFocus.focus();

        const save = vi.fn();
        const dismiss = vi.fn();
        const root = renderEditor({ currentValue: "Old", save, dismiss, mode: "normal" });
        const input = root.querySelector("input") as HTMLInputElement;

        input.value = "Edited";
        act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
        // Escape sets shouldDismiss=true; the blur then dismisses instead of saving.
        act(() => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        expect(save).not.toHaveBeenCalled();
        expect(dismiss).toHaveBeenCalled();
        prevFocus.remove();
    });

    it("renders a NoteAutocomplete in relation mode and saves+dismisses on note change", () => {
        const save = vi.fn();
        const dismiss = vi.fn();
        const root = renderEditor({ currentValue: "root/target", save, dismiss, mode: "relation" });
        const input = root.querySelector(".note-autocomplete-mock") as HTMLInputElement;
        expect(input).toBeTruthy();
        expect(input.getAttribute("data-note-id")).toBe("root/target");

        input.value = "root/newTarget";
        act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });
        expect(save).toHaveBeenCalledWith("root/newTarget");
        expect(dismiss).toHaveBeenCalled();
    });

    it("dismisses a relation-mode editor on Escape keydown and on blur", () => {
        const dismiss = vi.fn();
        const root = renderEditor({ currentValue: "root/x", save: vi.fn(), dismiss, mode: "relation" });
        const input = root.querySelector(".note-autocomplete-mock") as HTMLInputElement;

        act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
        expect(dismiss).toHaveBeenCalledTimes(1);

        // Preact delegates onBlur from the native focusout event.
        act(() => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        expect(dismiss).toHaveBeenCalledTimes(2);
    });

    it("ignores non-Escape keys in relation mode", () => {
        const dismiss = vi.fn();
        const root = renderEditor({ currentValue: "root/x", save: vi.fn(), dismiss, mode: "relation" });
        const input = root.querySelector(".note-autocomplete-mock") as HTMLInputElement;
        act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })); });
        expect(dismiss).not.toHaveBeenCalled();
    });

    it("ignores keys other than Enter/Escape in normal mode", () => {
        const save = vi.fn();
        const dismiss = vi.fn();
        const root = renderEditor({ currentValue: "X", save, dismiss, mode: "normal" });
        const input = root.querySelector("input") as HTMLInputElement;
        act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })); });
        expect(save).not.toHaveBeenCalled();
        expect(dismiss).not.toHaveBeenCalled();
    });

    it("defaults the relation note id to empty when no current value is given", () => {
        const root = renderEditor({ save: vi.fn(), dismiss: vi.fn(), mode: "relation" });
        const input = root.querySelector(".note-autocomplete-mock") as HTMLInputElement;
        expect(input.getAttribute("data-note-id")).toBe("");
    });

    it("defers the dismiss until the next render after a successful save", () => {
        // After save(), dismissOnNextRefreshRef is armed; the effect on the *next* render calls dismiss().
        const save = vi.fn();
        const dismiss = vi.fn();
        const target = document.createElement("div");
        document.body.appendChild(target);
        container = target;

        let forceRerender: (() => void) | undefined;
        function Host() {
            const [ , setTick ] = useState(0);
            forceRerender = () => setTick((t) => t + 1);
            return <TitleEditor currentValue="Old" save={save} dismiss={dismiss} mode="normal" />;
        }
        act(() => {
            render(
                <ParentComponent.Provider value={parent}>
                    <NoteContextContext.Provider value={null}>
                        <Host />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>,
                target
            );
        });

        const input = target.querySelector("input") as HTMLInputElement;
        input.value = "Changed";
        // Save arms the deferred dismiss but does not call it yet.
        act(() => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        expect(save).toHaveBeenCalledWith("Changed");
        expect(dismiss).not.toHaveBeenCalled();

        // The next render runs the effect which fires the deferred dismiss exactly once.
        act(() => { forceRerender?.(); });
        expect(dismiss).toHaveBeenCalledTimes(1);

        // A further render does not dismiss again (the ref was reset).
        act(() => { forceRerender?.(); });
        expect(dismiss).toHaveBeenCalledTimes(1);
    });
});
