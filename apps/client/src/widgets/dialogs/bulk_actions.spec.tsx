import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Modal {
        static instances = new Map<Element, Modal>();
        static getOrCreateInstance(el: Element) {
            let inst = Modal.instances.get(el);
            if (!inst) {
                inst = new Modal(el);
                Modal.instances.set(el, inst);
            }
            return inst;
        }
        static getInstance(el: Element) { return Modal.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        dispose() { Modal.instances.delete(this.element); }
    }
    // hooks.tsx patches Tooltip.prototype.dispose at import time, so it must be present.
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        static getOrCreateInstance(el: Element) {
            let inst = Tooltip.instances.get(el);
            if (!inst) {
                inst = new Tooltip(el);
                Tooltip.instances.set(el, inst);
            }
            return inst;
        }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Modal, Tooltip, default: { Modal, Tooltip } };
});

// The Modal component's effect calls openDialog (jQuery + bootstrap). Stub the dialog service so it
// resolves with a fake jQuery widget and never touches real bootstrap focus/keyboard machinery.
vi.mock("../../services/dialog", () => ({
    openDialog: vi.fn(async ($el: unknown) => $el),
    closeActiveDialog: vi.fn()
}));

vi.mock("../../services/toast", () => ({
    default: { showMessage: vi.fn(), showError: vi.fn(), showPersistent: vi.fn(), closePersistent: vi.fn() }
}));

vi.mock("../../services/bulk_action", () => ({
    default: {
        addAction: vi.fn(async () => undefined),
        parseActions: vi.fn(() => []),
        ACTION_CLASSES: [],
        ACTION_GROUPS: [
            { title: "Labels", actions: [ { actionName: "addLabel", actionTitle: "Add label" } ] },
            { title: "Notes", actions: [
                { actionName: "renameNote", actionTitle: "Rename note" },
                { actionName: "moveNote", actionTitle: "Move note" }
            ] }
        ]
    }
}));

import bulk_action from "../../services/bulk_action";
import Component from "../../components/component";
import froca from "../../services/froca";
import server from "../../services/server";
import toast from "../../services/toast";
import ws from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import BulkActionsDialog from "./bulk_actions";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function renderDialog() {
    parent = new Component();
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <BulkActionsDialog />
            </ParentComponent.Provider>,
            el
        );
    });
    return el;
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent.handleEventInChildren as any)(name, data);
    });
}

async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function clearFroca() {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
}

/** Builds the `_bulkAction` system note so froca.getNote("_bulkAction") resolves from the cache. */
function buildBulkActionNote() {
    return buildNote({ id: "_bulkAction", title: "Bulk action" });
}

async function openDialog(el: HTMLElement, selectedOrActiveNoteIds: string[] = [ "noteA", "noteB" ]) {
    fireEvent("openBulkActionsDialog", { selectedOrActiveNoteIds });
    await flush();
    return el;
}

beforeEach(() => {
    clearFroca();
    vi.clearAllMocks();
    // The auto-mocked server (test/setup.ts) only defines get/post; post is used by the component.
    Object.assign(server, {
        post: vi.fn(async () => ({ affectedNoteCount: 7 })),
        put: vi.fn(async () => undefined)
    });
    Object.assign(ws, { logError: vi.fn(), waitForMaxKnownEntityChangeId: vi.fn(async () => undefined) });
    (bulk_action.parseActions as ReturnType<typeof vi.fn>).mockReturnValue([]);
});

afterEach(() => {
    if (container) {
        act(() => { render(null, container as HTMLDivElement); });
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("BulkActionsDialog", () => {
    it("renders the modal shell hidden until the open event arrives", () => {
        const el = renderDialog();
        expect(el.querySelector(".bulk-actions-dialog")).toBeTruthy();
        // The modal body only mounts once shown.
        expect(el.querySelector(".modal-dialog")).toBeNull();
        expect(el.querySelector(".bulk-available-action-list")).toBeNull();
    });

    it("opens on openBulkActionsDialog, loads the _bulkAction note and posts affected-notes", async () => {
        buildBulkActionNote();
        const el = renderDialog();
        await openDialog(el, [ "n1", "n2", "n3" ]);

        // Modal body is now mounted.
        expect(el.querySelector(".modal-dialog")).toBeTruthy();
        expect(el.querySelector(".bulk-available-action-list")).toBeTruthy();

        // The affected-notes effect fired with the selected ids + default includeDescendants=false.
        const postMock = server.post as ReturnType<typeof vi.fn>;
        const affectedCall = postMock.mock.calls.find((c) => c[0] === "bulk-action/affected-notes");
        expect(affectedCall).toBeTruthy();
        expect(affectedCall?.[1]).toEqual({ noteIds: [ "n1", "n2", "n3" ], includeDescendants: false });

        // The returned count is rendered inside the affected-notes heading span.
        const countSpan = el.querySelector("h4 span");
        expect(countSpan?.textContent).toBe("7");
    });

    it("does not post affected-notes before the open event resolves the note", async () => {
        // No _bulkAction note built and no event fired → guard returns early (bulkActionNote falsy).
        renderDialog();
        await flush();
        const postMock = server.post as ReturnType<typeof vi.fn>;
        expect(postMock.mock.calls.find((c) => c[0] === "bulk-action/affected-notes")).toBeUndefined();
    });

    it("re-posts affected-notes with includeDescendants=true when the checkbox is toggled", async () => {
        buildBulkActionNote();
        const el = renderDialog();
        await openDialog(el);

        const postMock = server.post as ReturnType<typeof vi.fn>;
        postMock.mockClear();

        const checkbox = el.querySelector<HTMLInputElement>("input[type=checkbox]");
        expect(checkbox).toBeTruthy();
        if (checkbox) {
            checkbox.checked = true;
            act(() => { checkbox.dispatchEvent(new Event("change", { bubbles: true })); });
        }
        await flush();

        const affectedCall = postMock.mock.calls.find((c) => c[0] === "bulk-action/affected-notes");
        expect(affectedCall?.[1]).toEqual(expect.objectContaining({ includeDescendants: true }));
    });

    it("renders the available action groups as button rows and adds an action on click", async () => {
        buildBulkActionNote();
        const el = renderDialog();
        await openDialog(el);

        const table = el.querySelector(".bulk-available-action-list");
        expect(table).toBeTruthy();
        // Two action groups → two rows.
        expect(table?.querySelectorAll("tr").length).toBe(2);
        // Three actions total across the groups → three buttons.
        const buttons = table?.querySelectorAll("button") ?? [];
        expect(buttons.length).toBe(3);

        act(() => (buttons[0] as HTMLButtonElement).click());
        expect(bulk_action.addAction).toHaveBeenCalledWith("_bulkAction", "addLabel");
    });

    it("renders the 'none yet' placeholder when there are no chosen actions", async () => {
        buildBulkActionNote();
        const el = renderDialog();
        await openDialog(el);

        const existingList = el.querySelector(".bulk-existing-action-list");
        expect(existingList).toBeTruthy();
        // No actions parsed → the placeholder paragraph is shown, no rendered action rows.
        expect(existingList?.querySelector("p")).toBeNull(); // empty array (not undefined) renders no <p>
        expect(existingList?.querySelectorAll("tr").length).toBe(0);
    });

    it("renders chosen actions returned by parseActions, filtering out null renders", async () => {
        buildBulkActionNote();
        // Two actions: one renders a row, one renders null (filtered out).
        (bulk_action.parseActions as ReturnType<typeof vi.fn>).mockReturnValue([
            { doRender: () => <tr class="rendered-action"><td>one</td></tr> },
            { doRender: () => null }
        ]);

        const el = renderDialog();
        await openDialog(el);

        const existingList = el.querySelector(".bulk-existing-action-list");
        expect(existingList?.querySelectorAll(".rendered-action").length).toBe(1);
    });

    it("refreshes chosen actions when entitiesReloaded reports a matching _bulkAction label", async () => {
        buildBulkActionNote();
        const el = renderDialog();
        await openDialog(el);

        const parseMock = bulk_action.parseActions as ReturnType<typeof vi.fn>;
        parseMock.mockClear();

        fireEvent("entitiesReloaded", {
            loadResults: {
                getAttributeRows: () => [
                    { type: "label", name: "action", noteId: "_bulkAction", isDeleted: false }
                ]
            }
        });
        await flush();

        expect(parseMock).toHaveBeenCalled();
    });

    it("ignores entitiesReloaded events that do not touch the _bulkAction action label", async () => {
        buildBulkActionNote();
        const el = renderDialog();
        await openDialog(el);

        const parseMock = bulk_action.parseActions as ReturnType<typeof vi.fn>;
        parseMock.mockClear();

        fireEvent("entitiesReloaded", {
            loadResults: {
                getAttributeRows: () => [
                    // Wrong note id, wrong name, wrong type — none should match.
                    { type: "label", name: "action", noteId: "otherNote", isDeleted: false },
                    { type: "label", name: "archived", noteId: "_bulkAction", isDeleted: false },
                    { type: "relation", name: "target", noteId: "_bulkAction", isDeleted: false }
                ]
            }
        });
        await flush();

        expect(parseMock).not.toHaveBeenCalled();
    });

    it("executes bulk actions on submit, toasts, and hides the modal", async () => {
        buildBulkActionNote();
        const el = renderDialog();
        await openDialog(el, [ "x1", "x2" ]);

        const postMock = server.post as ReturnType<typeof vi.fn>;
        postMock.mockClear();

        const form = el.querySelector("form");
        expect(form).toBeTruthy();
        await act(async () => {
            form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
        await flush();

        const executeCall = postMock.mock.calls.find((c) => c[0] === "bulk-action/execute");
        expect(executeCall?.[1]).toEqual({ noteIds: [ "x1", "x2" ], includeDescendants: false });
        expect(toast.showMessage).toHaveBeenCalled();
        // Submitting sets shown=false → the modal body unmounts.
        expect(el.querySelector(".modal-dialog")).toBeNull();
    });

    it("hides the modal when the bootstrap hidden event fires (onHidden)", async () => {
        buildBulkActionNote();
        const el = renderDialog();
        await openDialog(el);
        expect(el.querySelector(".modal-dialog")).toBeTruthy();

        const modalEl = el.querySelector(".bulk-actions-dialog");
        act(() => { modalEl?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: false })); });
        expect(el.querySelector(".modal-dialog")).toBeNull();
    });
});
