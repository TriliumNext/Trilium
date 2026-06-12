import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../test/mocks";
import { fakeNoteContext, renderComponent, resetFroca } from "../test/render";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

vi.mock("bootstrap", () => bootstrapMock());
vi.mock("../services/keyboard_actions", () => ({
    default: {
        getAction: vi.fn(async () => ({ effectiveShortcuts: [] })),
        setupActionsForElement: vi.fn(async () => [])
    }
}));

import Component from "../components/component";
import type NoteContext from "../components/note_context";
import { buildNote } from "../test/easy-froca";
import FloatingButtons from "./FloatingButtons";
import { type FloatingButtonContext, type FloatingButtonsList } from "./FloatingButtonsDefinitions";
import { NoteContextContext } from "./react/react_utils";

// Fire a Trilium event through a rendered component's parent (the shared renderComponent exposes the parent).
function fireEventOn(parent: Component, name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as (n: string, d: unknown) => void)(name, data);
    });
}

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
});

describe("FloatingButtons", () => {
    it("renders the root structure and the close button when a context is provided", () => {
        const note = buildNote({ id: "fbNote", title: "N" });
        const noteContext = fakeNoteContext({ note, notePath: "root/fbNote" });
        const { container } = renderComponent(<FloatingButtons items={[]} />, { noteContext });

        const root = container.querySelector(".floating-buttons.no-print");
        expect(root).toBeTruthy();
        // top defaults to 0.
        expect((root as HTMLElement).style.top).toBe("0px");

        // The children wrapper is visible by default (no temporarily-hidden class).
        const children = container.querySelector(".floating-buttons-children");
        expect(children?.className).not.toContain("temporarily-hidden");

        // Close button is shown while visible; show button is not.
        expect(container.querySelector(".close-floating-buttons")).toBeTruthy();
        expect(container.querySelector(".show-floating-buttons")).toBeNull();
    });

    it("builds the context object and passes it to each item, including viewType / isReadOnly / triggerEvent", () => {
        const note = buildNote({
            id: "ctxNote",
            title: "Ctx",
            "#viewType": "list",
            "#readOnly": "true"
        });
        const noteContext = fakeNoteContext({ note, notePath: "root/ctxNote", viewScope: { viewMode: "default" } });

        const captured: FloatingButtonContext[] = [];
        const triggerEventSpy = vi.spyOn(Component.prototype, "triggerEvent").mockReturnValue(undefined);

        const Item = (ctx: FloatingButtonContext) => {
            captured.push(ctx);
            return <button class="item-button" onClick={() => ctx.triggerEvent("showHighlightsListWidget", { noteId: "x" })}>item</button>;
        };
        const items: FloatingButtonsList = [Item];

        const { container } = renderComponent(<FloatingButtons items={items} />, { noteContext });

        expect(captured.length).toBeGreaterThan(0);
        const ctx = captured[captured.length - 1];
        expect(ctx?.note).toBe(note);
        expect(ctx?.noteContext).toBe(noteContext);
        expect(ctx?.isDefaultViewMode).toBe(true);
        expect(ctx?.viewType).toBe("list");
        expect(ctx?.isReadOnly).toBe(true);

        // The item rendered and its triggerEvent shorthand forwards through the parent component.
        const itemButton = container.querySelector(".item-button");
        expect(itemButton).toBeTruthy();
        (itemButton as HTMLButtonElement).click();
        expect(triggerEventSpy).toHaveBeenCalledWith("showHighlightsListWidget", { ntxId: "ntx1", noteId: "x" });
    });

    it("marks isDefaultViewMode false when the view mode is not default", () => {
        const note = buildNote({ id: "srcNote", title: "S" });
        const noteContext = fakeNoteContext({ note, notePath: "root/srcNote", viewScope: { viewMode: "source" } });

        let captured: FloatingButtonContext | undefined;
        const Item: FloatingButtonsList[number] = (ctx) => { captured = ctx; return false; };

        renderComponent(<FloatingButtons items={[Item]} />, { noteContext });
        expect(captured?.isDefaultViewMode).toBe(false);
        expect(captured?.isReadOnly).toBe(false);
    });

    it("does not render items (context is null) when no note context is present", () => {
        const items: FloatingButtonsList = [() => <button class="item-button">x</button>];
        const { container } = renderComponent(<FloatingButtons items={items} />, { noteContext: null });

        // Without note/noteContext, the memoized context is null, so no item is rendered.
        expect(container.querySelector(".item-button")).toBeNull();
        // The close button still renders since `visible` is true.
        expect(container.querySelector(".close-floating-buttons")).toBeTruthy();
    });

    it("toggles visibility: close hides children and shows the show-button; show restores them", () => {
        const note = buildNote({ id: "togNote", title: "T" });
        const noteContext = fakeNoteContext({ note, notePath: "root/togNote" });
        const { container } = renderComponent(<FloatingButtons items={[]} />, { noteContext });

        const closeButton = container.querySelector(".close-floating-buttons-button");
        expect(closeButton).toBeTruthy();
        act(() => (closeButton as HTMLButtonElement).click());

        // Children wrapper becomes temporarily hidden, the close button disappears, the show button appears.
        const children = container.querySelector(".floating-buttons-children");
        expect(children?.className).toContain("temporarily-hidden");
        expect(container.querySelector(".close-floating-buttons")).toBeNull();
        const showButton = container.querySelector(".show-floating-buttons-button");
        expect(showButton).toBeTruthy();

        act(() => (showButton as HTMLButtonElement).click());
        const childrenAfter = container.querySelector(".floating-buttons-children");
        expect(childrenAfter?.className).not.toContain("temporarily-hidden");
        expect(container.querySelector(".show-floating-buttons")).toBeNull();
        expect(container.querySelector(".close-floating-buttons")).toBeTruthy();
    });

    it("updates the top offset on a contentSafeMarginChanged event for the matching context and ignores others", () => {
        const note = buildNote({ id: "marginNote", title: "M" });
        const noteContext = fakeNoteContext({ note, notePath: "root/marginNote" });
        const { container, parent } = renderComponent(<FloatingButtons items={[]} />, { noteContext });

        const root = () => container.querySelector(".floating-buttons") as HTMLElement;
        expect(root().style.top).toBe("0px");

        // Matching note context updates the top offset.
        fireEventOn(parent, "contentSafeMarginChanged", { top: 42, noteContext });
        expect(root().style.top).toBe("42px");

        // A different note context is ignored.
        fireEventOn(parent, "contentSafeMarginChanged", { top: 99, noteContext: fakeNoteContext({ ntxId: "other" }) });
        expect(root().style.top).toBe("42px");
    });

    it("resets visibility to true when the note changes (close, then switch note)", () => {
        const noteA = buildNote({ id: "noteA", title: "A" });
        const noteB = buildNote({ id: "noteB", title: "B" });
        const ctxA = fakeNoteContext({ note: noteA, notePath: "root/noteA" });

        const { container, rerender } = renderComponent(<FloatingButtons items={[]} />, { noteContext: ctxA });

        // Hide the buttons.
        act(() => (container.querySelector(".close-floating-buttons-button") as HTMLButtonElement).click());
        expect(container.querySelector(".show-floating-buttons")).toBeTruthy();

        // Switch to a different note: the visibility effect runs and re-shows the buttons.
        const ctxB = fakeNoteContext({ note: noteB, notePath: "root/noteB" });
        act(() => rerender(
            <ParentComponentRerender ctx={ctxB} />
        ));

        // After the note changes, the close button is visible again and the show button is gone.
        expect(container.querySelector(".close-floating-buttons")).toBeTruthy();
        expect(container.querySelector(".show-floating-buttons")).toBeNull();
    });
});

/**
 * Helper that re-renders FloatingButtons under a fresh NoteContext so the `note` dependency of the
 * visibility effect changes. Defined below the test that uses it (primary export stays on top).
 */
function ParentComponentRerender({ ctx }: { ctx: NoteContext }) {
    return (
        <NoteContextContext.Provider value={ctx}>
            <FloatingButtons items={[]} />
        </NoteContextContext.Provider>
    );
}
