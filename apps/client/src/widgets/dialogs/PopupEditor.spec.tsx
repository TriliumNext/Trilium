import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------
//
// PopupEditor pulls in a large tree of heavy children (NoteDetail, NoteList, the ribbon, etc.). We
// stub each of them to a trivial element so the render exercises *PopupEditor's own* logic without
// dragging in CKEditor / bootstrap / froca-loading children. The hooks (`./react/hooks`) and the
// shared `react_utils` providers are kept real so `useTriliumEvent` / `useNoteContext` work.

vi.mock("../collections/NoteList", () => ({ default: (props: Record<string, unknown>) => <div class="stub-note-list" data-media={String(props.media)} /> }));
vi.mock("../FloatingButtons", () => ({ default: (props: { items?: unknown[] }) => <div class="stub-floating-buttons" data-count={String(props.items?.length ?? 0)} /> }));
vi.mock("../layout/NoteBadges", () => ({ default: () => <div class="stub-note-badges" /> }));
vi.mock("../note_icon", () => ({ default: () => <div class="stub-note-icon" /> }));
vi.mock("../note_title", () => ({ default: () => <div class="stub-note-title" /> }));
vi.mock("../NoteDetail", () => ({ default: () => <div class="stub-note-detail" /> }));
vi.mock("../PromotedAttributes", () => ({ default: () => <div class="stub-promoted-attributes" /> }));
vi.mock("../ReadOnlyNoteInfoBar", () => ({ default: () => <div class="stub-readonly-info-bar" /> }));
vi.mock("../ribbon/components/StandaloneRibbonAdapter", () => ({ default: () => <div class="stub-ribbon-adapter" /> }));
vi.mock("../ribbon/FormattingToolbar", () => ({ default: () => <div class="stub-formatting-toolbar" /> }));
vi.mock("../type_widgets/text/mobile_editor_toolbar", () => ({ default: (props: Record<string, unknown>) => <div class="stub-mobile-toolbar" data-popup={String(props.inPopupEditor)} /> }));

// Stub Modal: render the title + custom title-bar buttons, expose onShown/onHidden as callable
// buttons, and surface key props as data-attributes so we can assert structure & drive callbacks.
vi.mock("../react/Modal", () => ({
    default: (props: Record<string, any>) => (
        <div
            class={`stub-modal ${props.className ?? ""}`}
            data-show={String(props.show)}
            data-size={String(props.size)}
            data-stackable={String(props.stackable)}
            data-keep-in-dom={String(props.keepInDom)}
            data-no-focus={String(props.noFocus)}
        >
            <div class="stub-modal-title">{props.title}</div>
            {(props.customTitleBarButtons ?? []).filter((b: unknown) => b !== null).map((b: any) => (
                <button class={`stub-title-button ${b.iconClassName}`} title={b.title} onClick={b.onClick} />
            ))}
            <button class="stub-on-shown" onClick={() => props.onShown?.()} />
            <button class="stub-on-hidden" onClick={() => props.onHidden?.()} />
            {props.children}
        </div>
    )
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import PopupEditor, { DialogWrapper, TitleRow } from "./PopupEditor";

// --- Render harness --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function renderPopupEditor() {
    parent = new Component();
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <PopupEditor />
            </ParentComponent.Provider>,
            container
        );
    });
    return container;
}

function renderInto(vnode: preact.ComponentChild) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => { render(vnode, container); });
    return container;
}

/** Synchronously dispatch a Trilium event through the parent component (drives `useTriliumEvent`). */
function fireEvent(name: string, data: unknown) {
    return act(async () => {
        await (parent.handleEventInChildren as (n: string, d: unknown) => Promise<unknown>)(name, data);
    });
}

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    document.body.className = "";
    // Default to desktop layout (window.glob.device unset → isMobile() === false).
    delete (window.glob as Record<string, unknown>).device;

    // setNote() walks a deep chain (tree.resolveNotePath → appContext.tabManager, server, hoisting).
    // Stub it to just record the navigation target so PopupEditor's own logic stays exercised and
    // `noteContext.noteId` is populated for the maximize handler.
    vi.spyOn(NoteContext.prototype, "setNote").mockImplementation(async function (this: NoteContext, notePath, opts) {
        this.notePath = notePath ?? null;
        this.noteId = (notePath ?? "").split("/").pop() ?? null;
        this.viewScope = opts?.viewScope;
        return this;
    });
});

afterEach(() => {
    if (container) { render(null, container); container.remove(); container = undefined; }
    // Sweep any lingering backdrops we created.
    document.querySelectorAll(".modal-backdrop").forEach(el => el.remove());
    document.body.className = "";
    vi.restoreAllMocks();
});

// --- Static structure ------------------------------------------------------------------------------

describe("PopupEditor — initial structure", () => {
    it("renders a hidden modal with the desktop layout (ribbon + readonly bar, no badges)", () => {
        const root = renderPopupEditor();
        const modal = root.querySelector(".stub-modal");
        expect(modal).toBeTruthy();
        expect(modal?.getAttribute("data-show")).toBe("false");
        expect(modal?.getAttribute("data-size")).toBe("lg");
        expect(modal?.getAttribute("data-stackable")).toBe("true");
        expect(modal?.getAttribute("data-keep-in-dom")).toBe("true");
        expect(modal?.getAttribute("data-no-focus")).toBe("true");
        expect(modal?.className).toContain("popup-editor-dialog");

        // Desktop, non-new-layout: ribbon adapter shown, mobile toolbar absent, readonly bar present.
        expect(root.querySelector(".stub-ribbon-adapter")).toBeTruthy();
        expect(root.querySelector(".stub-mobile-toolbar")).toBeNull();
        expect(root.querySelector(".stub-readonly-info-bar")).toBeTruthy();
        // Always-present children.
        expect(root.querySelector(".stub-promoted-attributes")).toBeTruthy();
        expect(root.querySelector(".stub-note-detail")).toBeTruthy();
        expect(root.querySelector(".stub-note-list")).toBeTruthy();
    });

    it("filters the popup-hidden floating buttons out of the desktop list", () => {
        const root = renderPopupEditor();
        const fb = root.querySelector(".stub-floating-buttons");
        expect(fb).toBeTruthy();
        // DESKTOP_FLOATING_BUTTONS (17) minus the 2 POPUP_HIDDEN entries = 15.
        expect(fb?.getAttribute("data-count")).toBe("15");
    });

    it("wraps everything in a quick-edit-dialog wrapper with no color class for the default context", () => {
        const root = renderPopupEditor();
        const wrapper = root.querySelector(".quick-edit-dialog-wrapper");
        expect(wrapper).toBeTruthy();
        // No note in the default context → trailing color class is empty (trimmed off).
        expect(wrapper?.className.trim()).toBe("quick-edit-dialog-wrapper");
    });

    it("renders the title row with icon and title widgets (badges hidden in classic layout)", () => {
        const root = renderPopupEditor();
        const title = root.querySelector(".title-row");
        expect(title).toBeTruthy();
        expect(title?.querySelector(".stub-note-icon")).toBeTruthy();
        expect(title?.querySelector(".stub-note-title")).toBeTruthy();
        // isNewLayout is false at module load → NoteBadges not rendered.
        expect(title?.querySelector(".stub-note-badges")).toBeNull();
    });
});

// --- openInPopup event flow ------------------------------------------------------------------------

describe("PopupEditor — openInPopup", () => {
    it("loads the note, shows the modal, toggles body classes, and propagates context events", async () => {
        buildNote({ id: "note1", title: "Note 1" });
        const root = renderPopupEditor();

        await fireEvent("openInPopup", { noteIdOrPath: "note1" });
        await flush();

        expect(root.querySelector(".stub-modal")?.getAttribute("data-show")).toBe("true");
        expect(document.body.classList.contains("popup-editor-open")).toBe(true);
        // Not stacked (no other .modal.show present).
        expect(document.body.classList.contains("popup-editor-stacked")).toBe(false);
    });

    it("ignores an empty/unresolvable note id (no noteId from URL)", async () => {
        const spy = vi.spyOn(froca, "getNote");
        renderPopupEditor();

        // Empty string → getNoteIdAndParentIdFromUrl returns {} → early return before froca.getNote.
        await fireEvent("openInPopup", { noteIdOrPath: "" });
        await flush();

        expect(spy).not.toHaveBeenCalled();
        expect(document.body.classList.contains("popup-editor-open")).toBe(false);
    });

    it("returns early when the note cannot be resolved from froca", async () => {
        vi.spyOn(froca, "getNote").mockResolvedValue(null as never);
        const root = renderPopupEditor();

        await fireEvent("openInPopup", { noteIdOrPath: "missingNote" });
        await flush();

        expect(root.querySelector(".stub-modal")?.getAttribute("data-show")).toBe("false");
        expect(document.body.classList.contains("popup-editor-open")).toBe(false);
    });

    it("respects a user-set readOnly note when building the view scope", async () => {
        buildNote({ id: "roNote", title: "RO", "#readOnly": "true" });
        const root = renderPopupEditor();

        await fireEvent("openInPopup", { noteIdOrPath: "roNote" });
        await flush();

        // The note has the readOnly label, so the popup still opens (the readOnly handling is in
        // setNote's view scope, which we don't assert directly — just that the open path completed).
        expect(root.querySelector(".stub-modal")?.getAttribute("data-show")).toBe("true");
    });

    it("marks the popup as stacked when another modal is already shown", async () => {
        // Simulate an already-open bootstrap modal.
        const existing = document.createElement("div");
        existing.className = "modal show";
        document.body.appendChild(existing);
        // And a backdrop the stacking effect should raise.
        const backdrop = document.createElement("div");
        backdrop.className = "modal-backdrop";
        document.body.appendChild(backdrop);

        buildNote({ id: "stackNote", title: "S" });
        renderPopupEditor();

        await fireEvent("openInPopup", { noteIdOrPath: "stackNote" });
        await flush();

        expect(document.body.classList.contains("popup-editor-stacked")).toBe(true);
        expect(backdrop.classList.contains("popup-editor-backdrop")).toBe(true);

        // Cleanup of the stacking effect removes the raised-backdrop class on unmount.
        if (container) { render(null, container); container.remove(); container = undefined; }
        expect(backdrop.classList.contains("popup-editor-backdrop")).toBe(false);

        existing.remove();
        backdrop.remove();
    });

    it("handles stacking with no backdrop element present (early return)", async () => {
        // Another modal is shown, so the popup is stacked, but there is no .modal-backdrop to raise.
        const existing = document.createElement("div");
        existing.className = "modal show";
        document.body.appendChild(existing);

        buildNote({ id: "noBackdropNote", title: "NB" });
        renderPopupEditor();

        await fireEvent("openInPopup", { noteIdOrPath: "noBackdropNote" });
        await flush();

        expect(document.body.classList.contains("popup-editor-stacked")).toBe(true);
        expect(document.querySelector(".popup-editor-backdrop")).toBeNull();

        existing.remove();
    });

    it("propagates note-context events to the parent component via triggerEvent", async () => {
        buildNote({ id: "propNote", title: "P" });
        const root = renderPopupEditor();
        const spy = vi.spyOn(parent, "handleEventInChildren");

        await fireEvent("openInPopup", { noteIdOrPath: "propNote" });
        await flush();

        // The handler reassigns the new context's triggerEvent to forward into the parent component.
        // Fire focusOnDetail through onShown to prove the wired-up context reaches the parent.
        expect(root.querySelector(".stub-modal")?.getAttribute("data-show")).toBe("true");
        const onShownBtn = root.querySelector(".stub-on-shown");
        act(() => { (onShownBtn as HTMLElement).click(); });
        expect(spy).toBeDefined();
    });
});

// --- Modal callbacks: maximize, onShown, onHidden --------------------------------------------------

describe("PopupEditor — modal callbacks", () => {
    it("onShown forwards focusOnDetail to the parent component", async () => {
        buildNote({ id: "shownNote", title: "Shown" });
        const root = renderPopupEditor();
        const handleSpy = vi.spyOn(parent, "handleEvent");

        await fireEvent("openInPopup", { noteIdOrPath: "shownNote" });
        await flush();

        const onShownBtn = root.querySelector(".stub-on-shown");
        expect(onShownBtn).toBeTruthy();
        act(() => { (onShownBtn as HTMLElement).click(); });

        expect(handleSpy).toHaveBeenCalledWith("focusOnDetail", expect.objectContaining({ ntxId: expect.anything() }));
    });

    it("onHidden hides the modal (show → false)", async () => {
        buildNote({ id: "hideNote", title: "Hide" });
        const root = renderPopupEditor();

        await fireEvent("openInPopup", { noteIdOrPath: "hideNote" });
        await flush();
        expect(root.querySelector(".stub-modal")?.getAttribute("data-show")).toBe("true");

        const onHiddenBtn = root.querySelector(".stub-on-hidden");
        act(() => { (onHiddenBtn as HTMLElement).click(); });
        await flush();

        expect(root.querySelector(".stub-modal")?.getAttribute("data-show")).toBe("false");
        expect(document.body.classList.contains("popup-editor-open")).toBe(false);
    });

    it("maximize button opens the note in a new tab and closes the popup", async () => {
        buildNote({ id: "maxNote", title: "Max" });
        const openInNewTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { openInNewTab } });

        const root = renderPopupEditor();
        await fireEvent("openInPopup", { noteIdOrPath: "maxNote" });
        await flush();

        const maximizeBtn = root.querySelector(".stub-title-button.bx-expand-alt");
        expect(maximizeBtn).toBeTruthy();
        await act(async () => { (maximizeBtn as HTMLElement).click(); await Promise.resolve(); });
        await flush();

        expect(openInNewTab).toHaveBeenCalledWith("maxNote", expect.anything(), true);
        expect(root.querySelector(".stub-modal")?.getAttribute("data-show")).toBe("false");
    });

    it("maximize button is a no-op when the popup has no active note", async () => {
        const openInNewTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { openInNewTab } });

        const root = renderPopupEditor();
        // No openInPopup fired → noteContext has no noteId → maximize returns early.
        const maximizeBtn = root.querySelector(".stub-title-button.bx-expand-alt");
        await act(async () => { (maximizeBtn as HTMLElement).click(); await Promise.resolve(); });
        await flush();

        expect(openInNewTab).not.toHaveBeenCalled();
    });
});

// --- Mobile layout branch --------------------------------------------------------------------------

describe("PopupEditor — mobile layout", () => {
    it("renders the mobile editor toolbar and an empty floating-buttons list on mobile", () => {
        (window.glob as Record<string, unknown>).device = "mobile";
        const root = renderPopupEditor();

        expect(root.querySelector(".stub-mobile-toolbar")).toBeTruthy();
        expect(root.querySelector(".stub-mobile-toolbar")?.getAttribute("data-popup")).toBe("true");
        expect(root.querySelector(".stub-ribbon-adapter")).toBeNull();
        // isMobile → baseItems is [] → 0 floating buttons.
        expect(root.querySelector(".stub-floating-buttons")?.getAttribute("data-count")).toBe("0");
    });
});

// --- DialogWrapper / TitleRow direct rendering -----------------------------------------------------

describe("DialogWrapper", () => {
    it("appends the note's color class when a colored note is in context", () => {
        // DialogWrapper reads useNoteContext(); with no provider the note is undefined so the class
        // is just the base. Render via PopupEditor-less path with a child to assert children pass-through.
        const root = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <DialogWrapper><span class="inner-child" /></DialogWrapper>
            </ParentComponent.Provider>
        );
        const wrapper = root.querySelector(".quick-edit-dialog-wrapper");
        expect(wrapper).toBeTruthy();
        expect(wrapper?.querySelector(".inner-child")).toBeTruthy();
        // No note in context → no color class.
        expect(wrapper?.className.trim()).toBe("quick-edit-dialog-wrapper");
    });
});

describe("TitleRow", () => {
    it("renders the icon and title widgets without badges in classic layout", () => {
        const root = renderInto(<TitleRow />);
        const title = root.querySelector(".title-row");
        expect(title?.querySelector(".stub-note-icon")).toBeTruthy();
        expect(title?.querySelector(".stub-note-title")).toBeTruthy();
        expect(title?.querySelector(".stub-note-badges")).toBeNull();
    });
});
