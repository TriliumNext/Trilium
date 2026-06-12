import { createContext } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type FBranch from "../../../entities/fbranch";
import type FNote from "../../../entities/fnote";
import { renderComponent, resetFroca } from "../../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The real index module pulls in FormTextBox/FormTextArea/NoteAutocomplete and CollectionProperties.
// We only need a real BoardViewContext (so our test Provider lines up with the component's useContext)
// and a lightweight TitleEditor that surfaces currentValue/save/dismiss for assertions.
// The factory runs lazily at import-resolution time, so the top-level `createContext` import is
// already initialised — using it (rather than require("preact")) keeps a single preact instance so
// ParentComponent's context still resolves to our Component.
vi.mock(".", () => {
    const BoardViewContext = createContext(undefined);
    function TitleEditor(props: Record<string, unknown>) {
        const save = props.save as ((value: string) => unknown) | undefined;
        const dismiss = props.dismiss as (() => void) | undefined;
        return (
            <span className="title-editor" data-mode={String(props.mode)} data-current={String(props.currentValue)}>
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

vi.mock("./context_menu", () => ({
    openNoteContextMenu: vi.fn()
}));

vi.mock("../../attribute_widgets/UserAttributesList", () => ({
    default: (props: { note: FNote; ignoredAttributes?: string[] }) => (
        <div className="user-attributes" data-ignored={(props.ignoredAttributes ?? []).join(",")} />
    )
}));

import type Component from "../../../components/component";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { BoardViewContext } from ".";
import type BoardApi from "./api";
import Card, { CARD_CLIPBOARD_TYPE } from "./card";
import { openNoteContextMenu } from "./context_menu";

// --- Helpers -------------------------------------------------------------------------------------

type ContextOverrides = Partial<{
    branchIdToEdit: string | undefined;
    setBranchIdToEdit: ReturnType<typeof vi.fn> | undefined;
    setDraggedCard: ReturnType<typeof vi.fn>;
}>;

function makeContext(overrides: ContextOverrides = {}) {
    return {
        api: undefined,
        parentNote: undefined,
        branchIdToEdit: overrides.branchIdToEdit,
        setBranchIdToEdit: "setBranchIdToEdit" in overrides ? overrides.setBranchIdToEdit : vi.fn(),
        columnNameToEdit: undefined,
        setColumnNameToEdit: vi.fn(),
        draggedColumn: null,
        setDraggedColumn: vi.fn(),
        dropPosition: null,
        setDropPosition: vi.fn(),
        setDropTarget: vi.fn(),
        dropTarget: null,
        draggedCard: null,
        setDraggedCard: overrides.setDraggedCard ?? vi.fn()
    };
}

function makeApi(overrides: Partial<Record<string, unknown>> = {}): BoardApi {
    return {
        openNote: vi.fn(),
        renameCard: vi.fn(),
        dismissEditingTitle: vi.fn(),
        statusAttribute: "status",
        ...overrides
    } as unknown as BoardApi;
}

/** Builds a parent + child note and returns the child note plus its branch from froca. */
function buildCard(childId: string, childDef: Record<string, unknown> = {}): { note: FNote; branch: FBranch } {
    const parentId = `parent-of-${childId}`;
    buildNote({ id: parentId, title: parentId, children: [ { id: childId, title: childId, ...childDef } ] });
    const branchId = `${parentId}_${childId}`;
    const branch = froca.branches[branchId];
    const note = froca.getNoteFromCache(childId);
    if (!note || !branch) throw new Error(`missing built note/branch for ${childId}`);
    return { note, branch };
}

let parent: Component | undefined;

interface CardProps {
    api?: BoardApi;
    note: FNote;
    branch: FBranch;
    column?: string;
    index?: number;
    isDragging?: boolean;
}

function renderCard(props: CardProps, ctxOverrides: ContextOverrides = {}) {
    const ctx = makeContext(ctxOverrides);
    const api = props.api ?? makeApi();
    const result = renderComponent(
        <BoardViewContext.Provider value={ctx as never}>
            <Card
                api={api}
                note={props.note}
                branch={props.branch}
                column={props.column ?? "Todo"}
                index={props.index ?? 0}
                isDragging={props.isDragging ?? false}
            />
        </BoardViewContext.Provider>
    );
    parent = result.parent;
    return { container: result.container, ctx, api };
}

function fireTriliumEvent(name: string, data: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent?.handleEventInChildren as any)(name, data);
    });
}

// --- Drag helpers (happy-dom registers delegated drag handlers under capitalized names) ----------

const DRAG_EVENT_NAME: Record<string, string> = {
    dragstart: "DragStart", dragend: "DragEnd"
};

function dragEvent(type: string, init: Partial<DragEvent> & { dataTransfer?: Partial<DataTransfer> } = {}) {
    const evt = new Event(DRAG_EVENT_NAME[type] ?? type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.assign(evt, init);
    return evt;
}

function fakeDataTransfer(data: Record<string, string> = {}) {
    return {
        effectAllowed: "",
        setData: vi.fn((k: string, v: string) => { data[k] = v; }),
        getData: vi.fn((k: string) => data[k] ?? "")
    } as unknown as DataTransfer;
}

beforeEach(() => {
    resetFroca();
    parent = undefined;
    vi.clearAllMocks();
});

// --- Tests ---------------------------------------------------------------------------------------

describe("Card rendering (non-editing)", () => {
    it("renders title, icon, edit-icon and the user attributes (status ignored)", () => {
        const { note, branch } = buildCard("c1");
        const api = makeApi();
        const { container } = renderCard({ note, branch, api });

        const card = container.querySelector(".board-note");
        expect(card).toBeTruthy();
        expect(card?.getAttribute("draggable")).not.toBeNull();
        expect(container.querySelector(".title")?.textContent).toContain("c1");
        expect(container.querySelector(".title .icon")).toBeTruthy();
        expect(container.querySelector(".edit-icon")).toBeTruthy();
        // UserAttributesDisplay receives the status attribute as ignored.
        expect(container.querySelector(".user-attributes")?.getAttribute("data-ignored")).toBe("status");
        // No editor in the non-editing state.
        expect(container.querySelector(".title-editor")).toBeNull();
    });

    it("applies the color class and the archived class based on the note's labels", () => {
        const { note, branch } = buildCard("c2", { "#color": "red", "#archived": "true" });
        const { container } = renderCard({ note, branch });
        const card = container.querySelector(".board-note") as HTMLElement;
        expect(card.className).toContain("archived");
        // getColorClass() returns a non-empty class for a colored note.
        expect(note.getColorClass()).not.toBe("");
        expect(card.className).toContain(note.getColorClass());
    });

    it("adds the dragging class and hides the card via display:none when isDragging is true", () => {
        const { note, branch } = buildCard("c3");
        const { container } = renderCard({ note, branch, isDragging: true });
        const card = container.querySelector(".board-note") as HTMLElement;
        expect(card.className).toContain("dragging");
        expect(card.style.display).toBe("none");
    });
});

describe("Card editing", () => {
    it("renders the TitleEditor when branchIdToEdit matches and applies the editing class", () => {
        const { note, branch } = buildCard("c4");
        const api = makeApi();
        const { container } = renderCard({ note, branch, api }, { branchIdToEdit: branch.branchId });

        const card = container.querySelector(".board-note") as HTMLElement;
        expect(card.className).toContain("editing");
        const editor = container.querySelector(".title-editor");
        expect(editor).toBeTruthy();
        expect(editor?.getAttribute("data-mode")).toBe("multiline");
        expect(editor?.getAttribute("data-current")).toBe("c4");
        // No plain title/edit-icon while editing.
        expect(container.querySelector(".edit-icon")).toBeNull();
    });

    it("save flows through api.renameCard and dismiss through api.dismissEditingTitle", () => {
        const { note, branch } = buildCard("c5");
        const api = makeApi();
        const { container } = renderCard({ note, branch, api }, { branchIdToEdit: branch.branchId });

        const input = container.querySelector(".title-editor-input") as HTMLInputElement;
        input.value = "Renamed card";
        act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });
        expect(api.renameCard).toHaveBeenCalledWith("c5", "Renamed card");

        act(() => (container.querySelector(".title-editor-dismiss") as HTMLButtonElement).click());
        expect(api.dismissEditingTitle).toHaveBeenCalledTimes(1);
    });
});

describe("Card interactions", () => {
    it("opens the note on click while not editing", () => {
        const { note, branch } = buildCard("c6");
        const api = makeApi();
        const { container } = renderCard({ note, branch, api });
        act(() => (container.querySelector(".board-note") as HTMLElement).click());
        expect(api.openNote).toHaveBeenCalledWith("c6");
    });

    it("does not open the note on click while editing", () => {
        const { note, branch } = buildCard("c7");
        const api = makeApi();
        const { container } = renderCard({ note, branch, api }, { branchIdToEdit: branch.branchId });
        act(() => (container.querySelector(".board-note") as HTMLElement).click());
        expect(api.openNote).not.toHaveBeenCalled();
    });

    it("enters editing via the edit icon and stops the click from bubbling to open", () => {
        const { note, branch } = buildCard("c8");
        const api = makeApi();
        const setBranchIdToEdit = vi.fn();
        const { container } = renderCard({ note, branch, api }, { setBranchIdToEdit });

        const editIcon = container.querySelector(".edit-icon") as HTMLElement;
        const clickEvt = new MouseEvent("click", { bubbles: true });
        const stop = vi.spyOn(clickEvt, "stopPropagation");
        act(() => { editIcon.dispatchEvent(clickEvt); });
        expect(stop).toHaveBeenCalled();
        expect(setBranchIdToEdit).toHaveBeenCalledWith(branch.branchId);
        // The card-level open must not have fired.
        expect(api.openNote).not.toHaveBeenCalled();
    });

    it("does not throw when setBranchIdToEdit is missing from context (optional chaining)", () => {
        const { note, branch } = buildCard("c9");
        const api = makeApi();
        const { container } = renderCard({ note, branch, api }, { setBranchIdToEdit: undefined });
        expect(() => {
            act(() => (container.querySelector(".edit-icon") as HTMLElement).click());
        }).not.toThrow();
    });

    it("opens the context menu on right click", () => {
        const { note, branch } = buildCard("c10");
        const api = makeApi();
        const { container } = renderCard({ note, branch, api, column: "Doing" });
        const card = container.querySelector(".board-note") as HTMLElement;
        act(() => { card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
        expect(openNoteContextMenu).toHaveBeenCalledWith(api, expect.anything(), note, branch.branchId, "Doing");
    });
});

describe("Card keyboard handling", () => {
    it("opens the note on Enter, starts editing on F2, and ignores other keys", () => {
        const { note, branch } = buildCard("c11");
        const api = makeApi();
        const setBranchIdToEdit = vi.fn();
        const { container } = renderCard({ note, branch, api }, { setBranchIdToEdit });
        const card = container.querySelector(".board-note") as HTMLElement;

        act(() => { card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
        expect(api.openNote).toHaveBeenCalledWith("c11");

        act(() => { card.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true })); });
        expect(setBranchIdToEdit).toHaveBeenCalledWith(branch.branchId);

        act(() => { card.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })); });
        expect(api.openNote).toHaveBeenCalledTimes(1);
        expect(setBranchIdToEdit).toHaveBeenCalledTimes(1);
    });

    it("does not throw on F2 when setBranchIdToEdit is missing (optional chaining)", () => {
        const { note, branch } = buildCard("c12");
        const { container } = renderCard({ note, branch }, { setBranchIdToEdit: undefined });
        const card = container.querySelector(".board-note") as HTMLElement;
        expect(() => {
            act(() => { card.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true })); });
        }).not.toThrow();
    });
});

describe("Card drag handling", () => {
    it("sets the dragged card payload on dragstart and clears it on dragend", () => {
        const { note, branch } = buildCard("c13");
        const setDraggedCard = vi.fn();
        const { container } = renderCard({ note, branch, column: "Backlog", index: 3 }, { setDraggedCard });
        const card = container.querySelector(".board-note") as HTMLElement;

        const data: Record<string, string> = {};
        const dt = fakeDataTransfer(data);
        act(() => { card.dispatchEvent(dragEvent("dragstart", { dataTransfer: dt })); });

        const expectedPayload = { noteId: "c13", branchId: branch.branchId, fromColumn: "Backlog", index: 3 };
        expect(setDraggedCard).toHaveBeenCalledWith(expectedPayload);
        expect(dt.setData).toHaveBeenCalledWith(CARD_CLIPBOARD_TYPE, JSON.stringify(expectedPayload));
        expect(dt.effectAllowed).toBe("move");

        act(() => { card.dispatchEvent(dragEvent("dragend", { dataTransfer: fakeDataTransfer() })); });
        expect(setDraggedCard).toHaveBeenLastCalledWith(null);
    });
});

describe("Card entitiesReloaded sync", () => {
    it("updates the displayed title when a matching note row is reloaded", () => {
        const { note, branch } = buildCard("c14");
        const { container } = renderCard({ note, branch });
        expect(container.querySelector(".title")?.textContent).toContain("c14");

        fireTriliumEvent("entitiesReloaded", {
            loadResults: {
                getEntityRow: (entityName: string, id: string) =>
                    entityName === "notes" && id === "c14" ? { title: "Updated title" } : undefined
            }
        });
        expect(container.querySelector(".title")?.textContent).toContain("Updated title");
    });

    it("leaves the title unchanged when no matching row is reloaded", () => {
        const { note, branch } = buildCard("c15");
        const { container } = renderCard({ note, branch });
        fireTriliumEvent("entitiesReloaded", {
            loadResults: { getEntityRow: () => undefined }
        });
        expect(container.querySelector(".title")?.textContent).toContain("c15");
    });
});
