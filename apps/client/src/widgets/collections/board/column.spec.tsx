import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FBranch from "../../../entities/fbranch";
import type FNote from "../../../entities/fnote";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The real index module pulls in FormTextBox/FormTextArea/NoteAutocomplete and CollectionProperties.
// We only need a real BoardViewContext (so our test Provider lines up with the component's useContext)
// and a lightweight TitleEditor that surfaces save/dismiss for assertions.
vi.mock(".", () => {
    const { createContext: cc } = require("preact");
    const BoardViewContext = cc(undefined);
    function TitleEditor(props: Record<string, unknown>) {
        const save = props.save as ((value: string) => unknown) | undefined;
        const dismiss = props.dismiss as (() => void) | undefined;
        return (
            <span className="title-editor" data-mode={String(props.mode)}>
                <input
                    className="title-editor-input"
                    onInput={(e) => save?.((e.currentTarget as HTMLInputElement).value)}
                />
                <button
                    className="title-editor-dismiss"
                    onClick={(e) => { e.stopPropagation(); dismiss?.(); }}
                />
            </span>
        );
    }
    return { BoardViewContext, TitleEditor };
});

vi.mock("./card", () => ({
    CARD_CLIPBOARD_TYPE: "trilium/board-card",
    default: (props: { note: FNote; isDragging: boolean; index: number }) => (
        <div className="board-note" data-note-id={props.note.noteId} data-dragging={String(props.isDragging)} data-index={props.index} />
    )
}));

vi.mock("./context_menu", () => ({
    openColumnContextMenu: vi.fn()
}));

vi.mock("../../react/NoteLink", () => ({
    default: (props: { notePath: string }) => <span className="note-link" data-note-path={props.notePath} />
}));

// note_tree.ts imports jquery.fancytree at module top, which throws under happy-dom before the
// global jQuery is established. Column only needs the TREE_CLIPBOARD_TYPE constant from it.
vi.mock("../../note_tree", () => ({
    TREE_CLIPBOARD_TYPE: "application/x-fancytree-node"
}));

import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { BoardViewContext } from ".";
import type BoardApi from "./api";
import Column from "./column";
import { openColumnContextMenu } from "./context_menu";

// --- Helpers -------------------------------------------------------------------------------------

type ContextOverrides = Partial<{
    columnNameToEdit: string | undefined;
    setColumnNameToEdit: ReturnType<typeof vi.fn>;
    dropTarget: string | null;
    draggedCard: { noteId: string; branchId: string; fromColumn: string; index: number } | null;
    dropPosition: { column: string; index: number } | null;
    draggedColumn: { column: string; index: number } | null;
    setDraggedColumn: ReturnType<typeof vi.fn>;
    setDropTarget: ReturnType<typeof vi.fn>;
    setDropPosition: ReturnType<typeof vi.fn>;
    setDraggedCard: ReturnType<typeof vi.fn>;
    parentNote: FNote;
    api: BoardApi;
}>;

function makeContext(overrides: ContextOverrides = {}) {
    return {
        api: overrides.api,
        parentNote: overrides.parentNote,
        branchIdToEdit: undefined,
        setBranchIdToEdit: vi.fn(),
        columnNameToEdit: overrides.columnNameToEdit,
        setColumnNameToEdit: overrides.setColumnNameToEdit ?? vi.fn(),
        draggedColumn: overrides.draggedColumn ?? null,
        setDraggedColumn: overrides.setDraggedColumn ?? vi.fn(),
        dropPosition: overrides.dropPosition ?? null,
        setDropPosition: overrides.setDropPosition ?? vi.fn(),
        setDropTarget: overrides.setDropTarget ?? vi.fn(),
        dropTarget: overrides.dropTarget ?? null,
        draggedCard: overrides.draggedCard ?? null,
        setDraggedCard: overrides.setDraggedCard ?? vi.fn()
    };
}

function makeApi(overrides: Partial<Record<string, unknown>> = {}): BoardApi {
    return {
        renameColumn: vi.fn(),
        createNewItem: vi.fn(),
        changeColumn: vi.fn(async () => undefined),
        moveWithinBoard: vi.fn(),
        columns: [],
        statusAttribute: "status",
        ...overrides
    } as unknown as BoardApi;
}

/** Builds a parent with children and returns the {note, branch} pairs as the board feeds them. */
function buildColumnItems(parentId: string, childIds: string[]): { note: FNote; branch: FBranch }[] {
    buildNote({ id: parentId, title: parentId, children: childIds.map((id) => ({ id, title: id })) });
    return childIds.map((id) => {
        const branchId = `${parentId}_${id}`;
        const branch = froca.branches[branchId];
        const note = froca.getNoteFromCache(id);
        if (!note || !branch) throw new Error(`missing built note/branch for ${id}`);
        return { note, branch };
    });
}

let container: HTMLDivElement | undefined;

function renderColumn(props: Parameters<typeof Column>[0], ctxOverrides: ContextOverrides = {}) {
    const localContainer = document.createElement("div");
    container = localContainer;
    document.body.appendChild(localContainer);
    const ctx = makeContext({ api: props.api, ...ctxOverrides });
    act(() => {
        render(
            <BoardViewContext.Provider value={ctx as never}>
                <Column {...props} />
            </BoardViewContext.Provider>,
            localContainer
        );
    });
    return { container: localContainer, ctx };
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
});

afterEach(() => {
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests ---------------------------------------------------------------------------------------

describe("Column rendering", () => {
    it("renders the title, counter badge, edit icon and cards", () => {
        const api = makeApi();
        const items = buildColumnItems("p1", [ "a", "b" ]);
        const { container } = renderColumn({
            column: "Todo", columnIndex: 0, isDraggingColumn: false, columnItems: items,
            api, isInRelationMode: false
        });

        const col = container.querySelector(".board-column");
        expect(col).toBeTruthy();
        expect(container.querySelector("h3 .title")?.textContent).toContain("Todo");
        expect(container.querySelector(".counter-badge")?.textContent).toBe("2");
        expect(container.querySelector(".edit-icon")).toBeTruthy();
        expect(container.querySelectorAll(".board-note").length).toBe(2);
        // Not in relation mode → plain text, no NoteLink.
        expect(container.querySelector(".note-link")).toBeNull();
        // The AddNewItem footer is present.
        expect(container.querySelector(".board-new-item")).toBeTruthy();
    });

    it("renders a NoteLink for the title when in relation mode and counts 0 with no items", () => {
        const api = makeApi();
        const { container } = renderColumn({
            column: "root/colNote", columnIndex: 1, isDraggingColumn: false, columnItems: undefined,
            api, isInRelationMode: true
        });
        const link = container.querySelector(".note-link");
        expect(link?.getAttribute("data-note-path")).toBe("root/colNote");
        expect(container.querySelector(".counter-badge")?.textContent).toBe("0");
    });

    it("applies the drag-over class only when dropTarget matches and the dragged card is from another column", () => {
        const api = makeApi();
        const overFromOther = renderColumn(
            { column: "Doing", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { dropTarget: "Doing", draggedCard: { noteId: "n", branchId: "b", fromColumn: "Done", index: 0 } }
        );
        expect(overFromOther.container.querySelector(".board-column")?.className).toContain("drag-over");
    });

    it("does NOT apply drag-over when the dragged card is from the same column", () => {
        const api = makeApi();
        const sameCol = renderColumn(
            { column: "Doing", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { dropTarget: "Doing", draggedCard: { noteId: "n", branchId: "b", fromColumn: "Doing", index: 0 } }
        );
        expect(sameCol.container.querySelector(".board-column")?.className).not.toContain("drag-over");
    });

    it("hides the column (display:none) when isDraggingColumn is true", () => {
        const api = makeApi();
        const { container } = renderColumn({
            column: "X", columnIndex: 0, isDraggingColumn: true, columnItems: [], api, isInRelationMode: false
        });
        const col = container.querySelector(".board-column") as HTMLElement;
        expect(col.style.display).toBe("none");
    });
});

describe("Column editing mode", () => {
    it("switches to the TitleEditor when columnNameToEdit matches and saves/dismisses through the api", () => {
        const api = makeApi();
        const setColumnNameToEdit = vi.fn();
        const { container } = renderColumn(
            { column: "Edit Me", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { columnNameToEdit: "Edit Me", setColumnNameToEdit }
        );

        const editor = container.querySelector(".title-editor");
        expect(editor).toBeTruthy();
        expect(container.querySelector("h3")?.className).toContain("editing");
        // normal mode (not relation).
        expect(editor?.getAttribute("data-mode")).toBe("normal");

        // Save flows into api.renameColumn.
        const input = container.querySelector(".title-editor-input") as HTMLInputElement;
        input.value = "Renamed";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(api.renameColumn).toHaveBeenCalledWith("Edit Me", "Renamed");

        // Dismiss clears the editing target.
        (container.querySelector(".title-editor-dismiss") as HTMLButtonElement).click();
        expect(setColumnNameToEdit).toHaveBeenCalledWith(undefined);
    });

    it("passes relation mode through to the TitleEditor", () => {
        const api = makeApi();
        const { container } = renderColumn(
            { column: "root/rel", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: true },
            { columnNameToEdit: "root/rel" }
        );
        expect(container.querySelector(".title-editor")?.getAttribute("data-mode")).toBe("relation");
    });

    it("enters editing via the edit icon click and via F2 on the title", () => {
        const api = makeApi();
        const setColumnNameToEdit = vi.fn();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { setColumnNameToEdit }
        );

        (container.querySelector(".edit-icon") as HTMLElement).click();
        expect(setColumnNameToEdit).toHaveBeenCalledWith("Col");

        const h3 = container.querySelector("h3") as HTMLElement;
        h3.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
        expect(setColumnNameToEdit).toHaveBeenCalledTimes(2);

        // A non-F2 key does nothing extra.
        h3.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(setColumnNameToEdit).toHaveBeenCalledTimes(2);
    });

    it("opens the column context menu on right click", () => {
        const api = makeApi();
        const { container } = renderColumn({
            column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false
        });
        const h3 = container.querySelector("h3") as HTMLElement;
        h3.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        expect(openColumnContextMenu).toHaveBeenCalledWith(api, expect.anything(), "Col");
    });
});

describe("Column drop placeholders", () => {
    it("shows a placeholder before a card and one at the end based on dropPosition", () => {
        const api = makeApi();
        const items = buildColumnItems("pp", [ "c1", "c2" ]);

        // Placeholder before index 0 (and not equal to dragged card).
        const before = renderColumn(
            { column: "C", columnIndex: 0, isDraggingColumn: false, columnItems: items, api, isInRelationMode: false },
            { dropPosition: { column: "C", index: 0 }, draggedCard: { noteId: "other", branchId: "x", fromColumn: "D", index: 0 } }
        );
        expect(before.container.querySelectorAll(".board-drop-placeholder.show").length).toBeGreaterThanOrEqual(1);
    });

    it("shows the end placeholder when dropPosition.index equals the item count", () => {
        const api = makeApi();
        const items = buildColumnItems("pe", [ "e1" ]);
        const { container } = renderColumn(
            { column: "C", columnIndex: 0, isDraggingColumn: false, columnItems: items, api, isInRelationMode: false },
            { dropPosition: { column: "C", index: 1 } }
        );
        expect(container.querySelectorAll(".board-drop-placeholder.show").length).toBe(1);
    });

    it("does not show a before-placeholder when the dragged card is the same note at that index", () => {
        const api = makeApi();
        const items = buildColumnItems("ps", [ "s1" ]);
        const { container } = renderColumn(
            { column: "C", columnIndex: 0, isDraggingColumn: false, columnItems: items, api, isInRelationMode: false },
            { dropPosition: { column: "C", index: 0 }, draggedCard: { noteId: "s1", branchId: "ps_s1", fromColumn: "C", index: 0 } }
        );
        // Only the end placeholder logic could apply (index 0 != count 1), so none should show before s1.
        expect(container.querySelectorAll(".board-drop-placeholder.show").length).toBe(0);
    });

    it("marks the matching card as dragging", () => {
        const api = makeApi();
        const items = buildColumnItems("pd", [ "d1", "d2" ]);
        const { container } = renderColumn(
            { column: "C", columnIndex: 0, isDraggingColumn: false, columnItems: items, api, isInRelationMode: false },
            { draggedCard: { noteId: "d2", branchId: "pd_d2", fromColumn: "C", index: 1 } }
        );
        const dragging = Array.from(container.querySelectorAll(".board-note")).filter((el) => el.getAttribute("data-dragging") === "true");
        expect(dragging.length).toBe(1);
        expect(dragging[0].getAttribute("data-note-id")).toBe("d2");
    });
});

describe("AddNewItem", () => {
    it("switches into a TitleEditor on click and on Enter, and saves via api.createNewItem", () => {
        const api = makeApi();
        const { container } = renderColumn({
            column: "Inbox", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false
        });

        const addItem = container.querySelector(".board-new-item") as HTMLElement;
        expect(addItem.querySelector(".title-editor")).toBeNull();

        act(() => addItem.click());
        const input = container.querySelector(".board-new-item .title-editor-input") as HTMLInputElement;
        expect(input).toBeTruthy();
        expect(container.querySelector(".board-new-item")?.className).toContain("editing");

        input.value = "New card";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(api.createNewItem).toHaveBeenCalledWith("Inbox", "New card");

        // Dismiss returns to the non-editing state.
        act(() => (container.querySelector(".board-new-item .title-editor-dismiss") as HTMLButtonElement).click());
        expect(container.querySelector(".board-new-item .title-editor")).toBeNull();
    });

    it("opens the editor on Enter keydown but not on other keys", () => {
        const api = makeApi();
        const { container } = renderColumn({
            column: "Inbox", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false
        });
        const addItem = container.querySelector(".board-new-item") as HTMLElement;

        act(() => { addItem.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
        expect(container.querySelector(".board-new-item .title-editor")).toBeNull();

        act(() => { addItem.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
        expect(container.querySelector(".board-new-item .title-editor")).toBeTruthy();
    });
});

describe("scroll handling", () => {
    function fireWheel(el: HTMLElement, scrollHeight: number, clientHeight: number) {
        Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
        Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
        const evt = new WheelEvent("wheel", { bubbles: true, cancelable: true });
        const stop = vi.spyOn(evt, "stopPropagation");
        el.dispatchEvent(evt);
        return stop;
    }

    it("stops propagation only when the content overflows", () => {
        const api = makeApi();
        const { container } = renderColumn({
            column: "C", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false
        });
        const content = container.querySelector(".board-column-content") as HTMLElement;

        const stoppedOverflow = fireWheel(content, 500, 100);
        expect(stoppedOverflow).toHaveBeenCalled();

        const notStopped = fireWheel(content, 50, 100);
        expect(notStopped).not.toHaveBeenCalled();
    });
});

describe("column dragging (useDragging)", () => {
    // happy-dom's div lacks `ondrag*`/`ondrop` props, so Preact registers these delegated handlers
    // under capitalized event names (DragStart, DragOver, ...). Dispatch with those exact names.
    const DRAG_EVENT_NAME: Record<string, string> = {
        dragstart: "DragStart", dragend: "DragEnd", dragover: "DragOver", dragleave: "DragLeave", drop: "Drop"
    };
    function dragEvent(type: string, init: Partial<DragEvent> & { dataTransfer?: Partial<DataTransfer> } = {}) {
        const evt = new Event(DRAG_EVENT_NAME[type] ?? type, { bubbles: true, cancelable: true }) as DragEvent;
        Object.assign(evt, init);
        return evt;
    }

    function fakeDataTransfer(types: string[] = [], data: Record<string, string> = {}) {
        return {
            effectAllowed: "",
            types,
            setData: vi.fn((k: string, v: string) => { data[k] = v; }),
            getData: vi.fn((k: string) => data[k] ?? "")
        } as unknown as DataTransfer;
    }

    it("starts a column drag, sets the dragged column, and ends it", () => {
        const api = makeApi();
        const setDraggedColumn = vi.fn();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 2, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { setDraggedColumn }
        );
        const h3 = container.querySelector("h3") as HTMLElement;

        const dt = fakeDataTransfer();
        const start = dragEvent("dragstart", { dataTransfer: dt });
        h3.dispatchEvent(start);
        expect(setDraggedColumn).toHaveBeenCalledWith({ column: "Col", index: 2 });
        expect(dt.setData).toHaveBeenCalledWith("text/plain", "Col");

        h3.dispatchEvent(dragEvent("dragend"));
        expect(setDraggedColumn).toHaveBeenLastCalledWith(null);
    });

    it("does not start a column drag while the column is being edited", () => {
        const api = makeApi();
        const setDraggedColumn = vi.fn();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { columnNameToEdit: "Col", setDraggedColumn }
        );
        // In editing mode the h3 still exists; dragstart should early-return.
        const h3 = container.querySelector("h3") as HTMLElement;
        h3.dispatchEvent(dragEvent("dragstart", { dataTransfer: fakeDataTransfer() }));
        expect(setDraggedColumn).not.toHaveBeenCalled();
    });

    it("handles card dragover, sets drop target and computes the drop position", () => {
        const api = makeApi();
        const items = buildColumnItems("dr", [ "x1", "x2" ]);
        const setDropTarget = vi.fn();
        const setDropPosition = vi.fn();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: items, api, isInRelationMode: false },
            { setDropTarget, setDropPosition }
        );
        const col = container.querySelector(".board-column") as HTMLElement;

        const evt = dragEvent("dragover", {
            dataTransfer: fakeDataTransfer([ "trilium/board-card" ]),
            clientY: 0
        });
        const preventDefault = vi.spyOn(evt, "preventDefault");
        col.dispatchEvent(evt);
        expect(preventDefault).toHaveBeenCalled();
        expect(setDropTarget).toHaveBeenCalledWith("Col");
        // happy-dom returns zero-sized rects, so every card's middle is 0 and the loop never breaks;
        // the computed index falls through to the card count (2 items).
        expect(setDropPosition).toHaveBeenCalledWith({ column: "Col", index: 2 });
    });

    it("computes a drop index before a card when the mouse is above the card middle", () => {
        const api = makeApi();
        const items = buildColumnItems("dr2", [ "y1", "y2" ]);
        const setDropPosition = vi.fn();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: items, api, isInRelationMode: false },
            { setDropPosition }
        );
        const col = container.querySelector(".board-column") as HTMLElement;

        // Give the cards real geometry so the mid-point comparison can pick an index < count.
        const cards = Array.from(col.querySelectorAll(".board-note")) as HTMLElement[];
        cards.forEach((card, i) => {
            vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
                top: 100 + i * 100, height: 50, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({})
            } as DOMRect);
        });

        // mouseY (120) < first card middle (125) → break at index 0.
        col.dispatchEvent(dragEvent("dragover", {
            dataTransfer: fakeDataTransfer([ "trilium/board-card" ]),
            clientY: 120
        }));
        expect(setDropPosition).toHaveBeenCalledWith({ column: "Col", index: 0 });
    });

    it("does not re-set the drop position when it already matches the computed index", () => {
        const api = makeApi();
        const items = buildColumnItems("dr3", [ "z1" ]);
        const setDropPosition = vi.fn();
        // dropPosition already equals what will be computed (zero-rect → index === count === 1).
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: items, api, isInRelationMode: false },
            { setDropPosition, dropPosition: { column: "Col", index: 1 } }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        col.dispatchEvent(dragEvent("dragover", { dataTransfer: fakeDataTransfer([ "trilium/board-card" ]), clientY: 0 }));
        expect(setDropPosition).not.toHaveBeenCalled();
    });

    it("ignores card dragover when the clipboard has neither card nor tree types", () => {
        const api = makeApi();
        const setDropTarget = vi.fn();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { setDropTarget }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        col.dispatchEvent(dragEvent("dragover", { dataTransfer: fakeDataTransfer([ "text/plain" ]) }));
        expect(setDropTarget).not.toHaveBeenCalled();
    });

    it("ignores card dragover while a column is being dragged", () => {
        const api = makeApi();
        const setDropTarget = vi.fn();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { setDropTarget, draggedColumn: { column: "Other", index: 1 } }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        col.dispatchEvent(dragEvent("dragover", { dataTransfer: fakeDataTransfer([ "trilium/board-card" ]) }));
        expect(setDropTarget).not.toHaveBeenCalled();
    });

    it("clears drop target/position on drag leave outside the column", () => {
        const api = makeApi();
        const setDropTarget = vi.fn();
        const setDropPosition = vi.fn();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { setDropTarget, setDropPosition }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        col.dispatchEvent(dragEvent("dragleave", { relatedTarget: document.body }));
        expect(setDropTarget).toHaveBeenCalledWith(null);
        expect(setDropPosition).toHaveBeenCalledWith(null);
    });

    it("does not clear on drag leave to a child element", () => {
        const api = makeApi();
        const setDropTarget = vi.fn();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { setDropTarget }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        const child = container.querySelector(".board-column-content") as HTMLElement;
        col.dispatchEvent(dragEvent("dragleave", { relatedTarget: child }));
        expect(setDropTarget).not.toHaveBeenCalled();
    });
});

describe("column hover (handleColumnDragOver)", () => {
    function dragEvent(type: string) {
        const name = type === "dragover" ? "DragOver" : type;
        return new Event(name, { bubbles: true, cancelable: true }) as DragEvent;
    }

    it("invokes onColumnHover when any column is dragging", () => {
        const api = makeApi();
        const onColumnHover = vi.fn();
        const { container } = renderColumn({
            column: "Col", columnIndex: 3, isDraggingColumn: false, columnItems: [], api,
            isInRelationMode: false, isAnyColumnDragging: true, onColumnHover
        });
        const col = container.querySelector(".board-column") as HTMLElement;
        const evt = dragEvent("dragover");
        Object.assign(evt, { clientX: 42 });
        col.dispatchEvent(evt);
        expect(onColumnHover).toHaveBeenCalledWith(3, 42, expect.anything());
    });

    it("does nothing when not any-column-dragging or onColumnHover is missing", () => {
        const api = makeApi();
        const onColumnHover = vi.fn();
        // isAnyColumnDragging falsy → falls through to card dragover (no card types → no-op).
        const { container } = renderColumn({
            column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api,
            isInRelationMode: false, isAnyColumnDragging: false, onColumnHover
        });
        const col = container.querySelector(".board-column") as HTMLElement;
        col.dispatchEvent(dragEvent("dragover"));
        expect(onColumnHover).not.toHaveBeenCalled();
    });

    it("does nothing on column dragover when onColumnHover is not provided", () => {
        const api = makeApi();
        // isAnyColumnDragging true but no onColumnHover → handler short-circuits without preventDefault.
        const { container } = renderColumn({
            column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api,
            isInRelationMode: false, isAnyColumnDragging: true
        });
        const col = container.querySelector(".board-column") as HTMLElement;
        const evt = dragEvent("dragover");
        const preventDefault = vi.spyOn(evt, "preventDefault");
        col.dispatchEvent(evt);
        expect(preventDefault).not.toHaveBeenCalled();
    });
});

describe("drop handling (handleDrop)", () => {
    function dropEvent(data: Record<string, string>) {
        const evt = new Event("Drop", { bubbles: true, cancelable: true }) as DragEvent;
        Object.assign(evt, {
            dataTransfer: {
                getData: (k: string) => data[k] ?? ""
            }
        });
        return evt;
    }

    it("ignores drops while a column is being dragged", () => {
        const api = makeApi();
        const setDropTarget = vi.fn();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { setDropTarget, draggedColumn: { column: "Other", index: 0 } }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        act(() => { col.dispatchEvent(dropEvent({})); });
        expect(setDropTarget).not.toHaveBeenCalled();
    });

    it("returns early when there is no payload data", async () => {
        const api = makeApi();
        const setDropTarget = vi.fn();
        const setDropPosition = vi.fn();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { setDropTarget, setDropPosition }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        await act(async () => { col.dispatchEvent(dropEvent({})); });
        // It still resets target/position before the no-data return.
        expect(setDropTarget).toHaveBeenCalledWith(null);
        expect(setDropPosition).toHaveBeenCalledWith(null);
        expect(api.moveWithinBoard).not.toHaveBeenCalled();
    });

    it("returns silently when the payload is invalid JSON", async () => {
        const api = makeApi();
        const { container } = renderColumn(
            { column: "Col", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { dropPosition: { column: "Col", index: 0 } }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        await act(async () => { col.dispatchEvent(dropEvent({ "trilium/board-card": "not json{" })); });
        expect(api.moveWithinBoard).not.toHaveBeenCalled();
    });

    it("moves a card within the board for a card payload", async () => {
        const api = makeApi();
        const { container } = renderColumn(
            { column: "Done", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { dropPosition: { column: "Done", index: 1 } }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        const payload = JSON.stringify({ noteId: "n1", branchId: "b1", index: 0, fromColumn: "Todo" });
        await act(async () => { col.dispatchEvent(dropEvent({ "trilium/board-card": payload })); });
        expect(api.moveWithinBoard).toHaveBeenCalledWith("n1", "b1", 0, 1, "Todo", "Done");
    });

    it("handles a tree payload by cloning to the first position when there is no target branch", async () => {
        const parentNote = buildNote({ id: "boardParent", title: "Board" });
        const dropped = buildNote({ id: "treeNote", title: "Tree" });
        vi.spyOn(froca, "getNote").mockResolvedValue(dropped);
        const branches = await import("../../../services/branches");
        const cloneToParent = vi.spyOn(branches.default, "cloneNoteToParentNote").mockResolvedValue(undefined as never);

        const api = makeApi();
        const { container } = renderColumn(
            { column: "Done", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false },
            { parentNote, dropPosition: { column: "Done", index: 0 } }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        const treePayload = JSON.stringify([ { noteId: "treeNote", branchId: "treeBranch" } ]);
        await act(async () => { col.dispatchEvent(dropEvent({ text: treePayload })); });

        expect(api.changeColumn).toHaveBeenCalledWith("treeNote", "Done");
        expect(cloneToParent).toHaveBeenCalledWith("treeNote", "boardParent");
    });

    it("handles a tree payload by cloning after the target branch when a target exists", async () => {
        const parentNote = buildNote({ id: "boardParent2", title: "Board2" });
        const items = buildColumnItems("col2", [ "existing1" ]);
        const dropped = buildNote({ id: "treeNote2", title: "Tree2" });
        vi.spyOn(froca, "getNote").mockResolvedValue(dropped);
        const branches = await import("../../../services/branches");
        const cloneAfter = vi.spyOn(branches.default, "cloneNoteAfter").mockResolvedValue(undefined as never);

        const api = makeApi();
        const { container } = renderColumn(
            { column: "Done", columnIndex: 0, isDraggingColumn: false, columnItems: items, api, isInRelationMode: false },
            { parentNote, dropPosition: { column: "Done", index: 1 } }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        const treePayload = JSON.stringify([ { noteId: "treeNote2", branchId: "treeBranch2" } ]);
        await act(async () => { col.dispatchEvent(dropEvent({ "trilium/board-card": "", text: treePayload })); });

        expect(cloneAfter).toHaveBeenCalledWith("treeNote2", "col2_existing1");
    });

    it("moves the branch after the target when the note already lives under the board parent", async () => {
        const parentNote = buildNote({ id: "boardParent3", title: "Board3" });
        const items = buildColumnItems("col3", [ "child3" ]);
        // The dropped note already has the board parent among its parents.
        const dropped = buildNote({ id: "alreadyChild", title: "AC" });
        vi.spyOn(dropped, "getParentNoteIds").mockReturnValue([ "boardParent3" ]);
        vi.spyOn(froca, "getNote").mockResolvedValue(dropped);
        const branches = await import("../../../services/branches");
        const moveAfter = vi.spyOn(branches.default, "moveAfterBranch").mockResolvedValue(undefined as never);

        const api = makeApi();
        const { container } = renderColumn(
            { column: "Done", columnIndex: 0, isDraggingColumn: false, columnItems: items, api, isInRelationMode: false },
            { parentNote, dropPosition: { column: "Done", index: 1 } }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        const treePayload = JSON.stringify([ { noteId: "alreadyChild", branchId: "acBranch" } ]);
        await act(async () => { col.dispatchEvent(dropEvent({ text: treePayload })); });

        expect(moveAfter).toHaveBeenCalledWith([ "acBranch" ], "col3_child3");
    });

    it("handles a tree payload with no columnItems, cloning to the parent", async () => {
        const parentNote = buildNote({ id: "boardParent4", title: "Board4" });
        const dropped = buildNote({ id: "treeNote4", title: "T4" });
        vi.spyOn(froca, "getNote").mockResolvedValue(dropped);
        const branches = await import("../../../services/branches");
        const cloneToParent = vi.spyOn(branches.default, "cloneNoteToParentNote").mockResolvedValue(undefined as never);

        const api = makeApi();
        // columnItems is omitted entirely → the `columnItems || []` fallback is exercised.
        const { container } = renderColumn(
            { column: "Done", columnIndex: 0, isDraggingColumn: false, columnItems: undefined, api, isInRelationMode: false },
            { parentNote, dropPosition: { column: "Done", index: 0 } }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        const treePayload = JSON.stringify([ { noteId: "treeNote4", branchId: "tb4" } ]);
        await act(async () => { col.dispatchEvent(dropEvent({ text: treePayload })); });
        expect(cloneToParent).toHaveBeenCalledWith("treeNote4", "boardParent4");
    });

    it("returns early for a tree payload when there is no parent note or no drop position", async () => {
        const dropped = buildNote({ id: "treeNote3", title: "T3" });
        vi.spyOn(froca, "getNote").mockResolvedValue(dropped);
        const branches = await import("../../../services/branches");
        const cloneToParent = vi.spyOn(branches.default, "cloneNoteToParentNote").mockResolvedValue(undefined as never);

        const api = makeApi();
        // No parentNote in context, no dropPosition.
        const { container } = renderColumn(
            { column: "Done", columnIndex: 0, isDraggingColumn: false, columnItems: [], api, isInRelationMode: false }
        );
        const col = container.querySelector(".board-column") as HTMLElement;
        const treePayload = JSON.stringify([ { noteId: "treeNote3", branchId: "tb3" } ]);
        await act(async () => { col.dispatchEvent(dropEvent({ text: treePayload })); });
        expect(cloneToParent).not.toHaveBeenCalled();
    });
});
