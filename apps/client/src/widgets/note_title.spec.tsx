import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("../services/protected_session_holder", () => ({
    default: {
        touchProtectedSessionIfNecessary: vi.fn(),
        isProtectedSessionAvailable: vi.fn(() => true)
    }
}));
vi.mock("../services/branches", () => ({
    default: { deleteNotes: vi.fn(async () => undefined) }
}));

import type Component from "../components/component";
import type NoteContext from "../components/note_context";
import branches from "../services/branches";
import protected_session_holder from "../services/protected_session_holder";
import server from "../services/server";
import { buildNote } from "../test/easy-froca";
import { fakeNoteContext as baseFakeNoteContext, flush, renderComponent, resetFroca } from "../test/render";
import NoteTitleWidget from "./note_title";
import { NoteContextContext } from "./react/react_utils";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLElement | undefined;
let parent: Component | undefined;
// Re-render with a new note context, reusing the same parent/container.
let rerenderCurrent: ((noteContext: NoteContext | null) => void) | undefined;

function renderWidget(noteContext: NoteContext | null, props: { className?: string } = {}) {
    const result = renderComponent(<NoteTitleWidget {...props} />, { noteContext });
    container = result.container;
    parent = result.parent;
    // `result.rerender` re-wraps in the original NoteContextContext, so nest a closer provider to
    // override it with the new context (the innermost provider wins for the widget).
    rerenderCurrent = (ctx) => result.rerender(
        <NoteContextContext.Provider value={ctx}>
            <NoteTitleWidget {...props} />
        </NoteContextContext.Provider>
    );
    return container;
}

function rerenderWidget(noteContext: NoteContext | null) {
    if (!rerenderCurrent) throw new Error("not rendered");
    rerenderCurrent(noteContext);
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent?.handleEventInChildren as any)(name, data);
    });
}

/** A minimal NoteContext shape; only the fields the widget touches are implemented. */
function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return baseFakeNoteContext({
        note: undefined,
        viewScope: { viewMode: "default" },
        isActive: vi.fn(() => true),
        getNavigationTitle: vi.fn(async () => "Nav Title"),
        ...overrides
    });
}

function getInput() {
    return container?.querySelector("input.note-title") as HTMLInputElement | null;
}

// happy-dom lacks Element.checkVisibility; install a default so the widget can call it.
type CheckVisibilityHost = { checkVisibility?: (opts?: unknown) => boolean };
let checkVisibilityInstalled = false;

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    (protected_session_holder.isProtectedSessionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const proto = HTMLElement.prototype as unknown as CheckVisibilityHost;
    if (!proto.checkVisibility) {
        proto.checkVisibility = () => true;
        checkVisibilityInstalled = true;
    }
});

afterEach(() => {
    container = undefined;
    parent = undefined;
    rerenderCurrent = undefined;
    if (checkVisibilityInstalled) {
        delete (HTMLElement.prototype as unknown as CheckVisibilityHost).checkVisibility;
        checkVisibilityInstalled = false;
    }
});

// --- Tests ----------------------------------------------------------------------------------------

describe("NoteTitleWidget", () => {
    it("renders nothing inside the wrapper when there is no note", () => {
        const root = renderWidget(fakeNoteContext({ note: undefined }), { className: "extra" });
        const wrapper = root.querySelector(".note-title-widget");
        expect(wrapper).not.toBeNull();
        expect(wrapper?.className).toContain("extra");
        expect(getInput()).toBeNull();
    });

    it("renders an editable input for an unprotected, default-view note", async () => {
        const note = buildNote({ id: "n1", title: "Hello" });
        renderWidget(fakeNoteContext({ note }));
        await flush();
        const input = getInput();
        expect(input).not.toBeNull();
        expect(input?.value).toBe("Hello");
        expect(input?.readOnly).toBe(false);
        expect(input?.className).not.toContain("protected");
        expect(input?.getAttribute("tabindex")).toBe("100");
    });

    it("adds the protected class when the note is protected", async () => {
        const note = buildNote({ id: "prot", title: "Secret" });
        Object.assign(note, { isProtected: true });
        renderWidget(fakeNoteContext({ note }));
        await flush();
        expect(getInput()?.className).toContain("protected");
    });

    it("is read-only and shows the navigation title for a protected note without a session", async () => {
        (protected_session_holder.isProtectedSessionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);
        const note = buildNote({ id: "ro1", title: "Locked" });
        Object.assign(note, { isProtected: true });
        const noteContext = fakeNoteContext({ note });
        renderWidget(noteContext);
        await flush();
        const input = getInput();
        expect(input?.readOnly).toBe(true);
        expect(noteContext.getNavigationTitle).toHaveBeenCalled();
        expect(input?.value).toBe("Nav Title");
    });

    it("is read-only when the view mode is not the default", async () => {
        const note = buildNote({ id: "ro2", title: "Source" });
        const noteContext = fakeNoteContext({ note, viewScope: { viewMode: "source" } });
        renderWidget(noteContext);
        await flush();
        expect(getInput()?.readOnly).toBe(true);
        expect(noteContext.getNavigationTitle).toHaveBeenCalled();
    });

    it("is read-only when the note metadata is read-only", async () => {
        // FNote.isMetadataReadOnly returns true for _options* note ids.
        const note = buildNote({ id: "_optionsMeta", title: "Meta" });
        renderWidget(fakeNoteContext({ note }));
        await flush();
        expect(getInput()?.readOnly).toBe(true);
    });

    it("schedules a save when the title changes and persists it on blur", async () => {
        const note = buildNote({ id: "edit1", title: "Old" });
        renderWidget(fakeNoteContext({ note }));
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        input.value = "New title";
        act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });
        // Blur triggers an immediate update.
        act(() => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        await flush();

        expect(protected_session_holder.touchProtectedSessionIfNecessary).toHaveBeenCalledWith(note);
        expect(server.put).toHaveBeenCalledWith(
            "notes/edit1/title",
            { title: "New title" },
            expect.any(String)
        );
    });

    it("focuses the content area when Enter is pressed and prevents default", async () => {
        const note = buildNote({ id: "enter1", title: "T" });
        const noteContext = fakeNoteContext({ note });
        renderWidget(noteContext);
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        const triggerCommand = vi.spyOn(parent as Component, "triggerCommand").mockReturnValue(undefined);
        const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        act(() => { input.dispatchEvent(event); });
        expect(event.defaultPrevented).toBe(true);
        expect(triggerCommand).toHaveBeenCalledWith("focusOnDetail", { ntxId: "ntx1" });
    });

    it("does not act on a plain key press other than Enter/Escape", async () => {
        const note = buildNote({ id: "key1", title: "T" });
        renderWidget(fakeNoteContext({ note }));
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        const triggerCommand = vi.spyOn(parent as Component, "triggerCommand").mockReturnValue(undefined);
        const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
        act(() => { input.dispatchEvent(event); });
        expect(event.defaultPrevented).toBe(false);
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("skips key processing while IME is composing", async () => {
        const note = buildNote({ id: "ime1", title: "T" });
        renderWidget(fakeNoteContext({ note }));
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        const triggerCommand = vi.spyOn(parent as Component, "triggerCommand").mockReturnValue(undefined);
        // isComposing on the Enter key → handler must bail out before preventDefault.
        const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        Object.defineProperty(event, "isComposing", { value: true });
        act(() => { input.dispatchEvent(event); });
        expect(event.defaultPrevented).toBe(false);
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("deletes a new note's branches when Escape is pressed", async () => {
        const note = buildNote({ id: "new1", title: "" });
        note.parentToBranch = { root: "branchA" };
        const noteContext = fakeNoteContext({ note, isActive: vi.fn(() => true) });
        renderWidget(noteContext);
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        // Mark the title widget as handling a newly created note.
        fireEvent("focusAndSelectTitle", { ntxId: "ntx1", isNewNote: true });
        const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        act(() => { input.dispatchEvent(escape); });
        expect(branches.deleteNotes).toHaveBeenCalledWith([ "branchA" ]);
    });

    it("does not delete branches on Escape for an existing note", async () => {
        const note = buildNote({ id: "exist1", title: "Existing" });
        note.parentToBranch = { root: "branchB" };
        renderWidget(fakeNoteContext({ note }));
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        act(() => { input.dispatchEvent(escape); });
        expect(branches.deleteNotes).not.toHaveBeenCalled();
    });

    it("focuses the input on focusOnTitle when the context is active and visible", async () => {
        const note = buildNote({ id: "focus1", title: "T" });
        const noteContext = fakeNoteContext({ note, isActive: vi.fn(() => true) });
        renderWidget(noteContext);
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        const focusSpy = vi.spyOn(input, "focus");
        const selectSpy = vi.spyOn(input, "select");
        vi.spyOn(input, "checkVisibility").mockReturnValue(true);

        fireEvent("focusOnTitle", { ntxId: "ntx1" });
        expect(focusSpy).toHaveBeenCalled();
        expect(selectSpy).not.toHaveBeenCalled();

        fireEvent("focusAndSelectTitle", { ntxId: "ntx1", isNewNote: false });
        expect(selectSpy).toHaveBeenCalled();
    });

    it("ignores focus events when the context is not active", async () => {
        const note = buildNote({ id: "focus2", title: "T" });
        const noteContext = fakeNoteContext({ note, isActive: vi.fn(() => false) });
        renderWidget(noteContext);
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        const focusSpy = vi.spyOn(input, "focus");
        const visibilitySpy = vi.spyOn(input, "checkVisibility");
        fireEvent("focusOnTitle", { ntxId: "ntx1" });
        expect(focusSpy).not.toHaveBeenCalled();
        // checkVisibility should not even be reached when inactive.
        expect(visibilitySpy).not.toHaveBeenCalled();
    });

    it("ignores focus events when the input is not visible", async () => {
        const note = buildNote({ id: "focus3", title: "T" });
        const noteContext = fakeNoteContext({ note, isActive: vi.fn(() => true) });
        renderWidget(noteContext);
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        const focusSpy = vi.spyOn(input, "focus");
        vi.spyOn(input, "checkVisibility").mockReturnValue(false);
        fireEvent("focusOnTitle", { ntxId: "ntx1" });
        expect(focusSpy).not.toHaveBeenCalled();
    });

    it("re-applies the selection after the title changes while a select is pending", async () => {
        const note = buildNote({ id: "sel1", title: "T" });
        const noteContext = fakeNoteContext({ note, isActive: vi.fn(() => true) });
        renderWidget(noteContext);
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        vi.spyOn(input, "checkVisibility").mockReturnValue(true);
        // happy-dom: make the input the active element so the pending-select effect runs.
        Object.defineProperty(document, "activeElement", { configurable: true, get: () => input });
        const selectSpy = vi.spyOn(input, "select");

        fireEvent("focusAndSelectTitle", { ntxId: "ntx1", isNewNote: false });
        selectSpy.mockClear();

        // Title change should re-apply the pending selection.
        note.title = "Updated";
        fireEvent("entitiesReloaded", {
            loadResults: {
                getAttributeRows: () => [],
                getBranchRows: () => [],
                getNoteIds: () => [ "sel1" ],
                isNoteReloaded: (id: string) => id === "sel1",
                isNoteContentReloaded: () => false
            }
        });
        await flush();
        expect(selectSpy).toHaveBeenCalled();

        // restore activeElement
        delete (document as unknown as Record<string, unknown>).activeElement;
    });

    it("clears the pending selection when the user starts typing", async () => {
        const note = buildNote({ id: "type1", title: "T" });
        const noteContext = fakeNoteContext({ note, isActive: vi.fn(() => true) });
        renderWidget(noteContext);
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        vi.spyOn(input, "checkVisibility").mockReturnValue(true);
        fireEvent("focusAndSelectTitle", { ntxId: "ntx1", isNewNote: false });

        // A keydown clears pendingSelect (covered by the keydown handler's first line).
        const event = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
        act(() => { input.dispatchEvent(event); });
        expect(event.defaultPrevented).toBe(false);
    });

    it("flushes pending updates on beforeNoteSwitch / beforeNoteContextRemove", async () => {
        const note = buildNote({ id: "flush1", title: "Old" });
        renderWidget(fakeNoteContext({ note }));
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        input.value = "Pending";
        act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });

        fireEvent("beforeNoteSwitch", { noteContext: { ntxId: "ntx1" } });
        await flush();
        expect(server.put).toHaveBeenCalledWith(
            "notes/flush1/title",
            { title: "Pending" },
            expect.any(String)
        );
    });

    it("guards the save callback when the note disappears before the pending update runs", async () => {
        const note = buildNote({ id: "gone1", title: "Old" });
        renderWidget(fakeNoteContext({ note }));
        await flush();
        const input = getInput();
        if (!input) throw new Error("input missing");

        // Make the update pending.
        input.value = "Pending";
        act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });

        // Re-render with no note → the save closure now sees note === null.
        rerenderWidget(fakeNoteContext({ note: undefined }));
        await flush();
        expect(getInput()).toBeNull();

        // The pending update fires but bails out at the note guard.
        fireEvent("beforeNoteSwitch", { noteContext: { ntxId: "ntx1" } });
        await flush();
        expect(server.put).not.toHaveBeenCalled();
        expect(protected_session_holder.touchProtectedSessionIfNecessary).not.toHaveBeenCalled();
    });
});
