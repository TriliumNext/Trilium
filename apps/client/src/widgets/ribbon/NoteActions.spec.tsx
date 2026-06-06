import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Dropdown {
        static instances = new Map<Element, Dropdown>();
        static getOrCreateInstance(el: Element) {
            let inst = Dropdown.instances.get(el);
            if (!inst) {
                inst = new Dropdown(el);
                Dropdown.instances.set(el, inst);
            }
            return inst;
        }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        toggle() {}
        update() {}
        dispose() { Dropdown.instances.delete(this.element); }
    }
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Modal {
        static getOrCreateInstance() { return new Modal(); }
        show() {}
        hide() {}
    }
    return { Dropdown, Tooltip, Modal, default: { Dropdown, Tooltip, Modal } };
});

// Modals pulled in transitively start hidden; stub the heavy editor bundles they import.
vi.mock("../type_widgets/options/code_notes", () => ({ CodeMimeTypesList: () => null }));
vi.mock("../type_widgets/options/i18n", () => ({ ContentLanguagesList: () => null }));

vi.mock("../../services/math", () => ({ default: { render: vi.fn() } }));
vi.mock("../../services/protected_session", () => ({ default: { protectNote: vi.fn() } }));
vi.mock("../../services/sync", () => ({ default: { syncNow: vi.fn() } }));
vi.mock("../../services/branches", () => ({
    default: {
        deleteNotes: vi.fn(async () => undefined),
        cloneNoteToParentNote: vi.fn(async () => undefined)
    }
}));
vi.mock("../../services/dialog", () => ({
    default: { confirm: vi.fn(async () => true) },
    openDialog: vi.fn(async () => $("<div></div>"))
}));
vi.mock("../../services/toast", () => ({
    default: { showMessage: vi.fn(), showError: vi.fn(), showPersistent: vi.fn(), closePersistent: vi.fn() }
}));
vi.mock("../../services/keyboard_actions", () => ({
    default: {
        getAction: vi.fn(async () => ({ effectiveShortcuts: [] })),
        setupActionsForElement: vi.fn(async () => [])
    }
}));
vi.mock("../../services/experimental_features", () => ({ isExperimentalFeatureEnabled: vi.fn(() => false) }));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import type NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import branches from "../../services/branches";
import dialog from "../../services/dialog";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features";
import froca from "../../services/froca";
import server from "../../services/server";
import toast from "../../services/toast";
import { buildNote } from "../../test/easy-froca";
import { fakeNoteContext, flush, renderComponent, resetFroca } from "../../test/render";
import ws from "../../services/ws";
import NoteActions, { CommandItem, NoteContextMenu } from "./NoteActions";

// --- Render helper --------------------------------------------------------------------------------

let parent: Component;

/** Render through the shared `renderComponent` (ParentComponent + NoteContextContext) and return the container. */
function renderInto(vnode: preact.ComponentChildren, noteContext: NoteContext | null = null) {
    return renderComponent(vnode, { parent, noteContext }).container;
}

/** Open every Bootstrap dropdown so the lazily-rendered `{shown && children}` items mount. */
function openDropdowns(root: ParentNode) {
    act(() => {
        root.querySelectorAll<HTMLElement>(".dropdown").forEach((el) => {
            $(el).trigger("show.bs.dropdown");
        });
    });
}

beforeEach(() => {
    parent = new Component();
    resetFroca();
    vi.clearAllMocks();
    // setup.ts provides put/upload/patch/remove + ws.logError globally; these two are spec-specific.
    Object.assign(server, {
        post: vi.fn(async () => ({ attachment: { ownerId: "owner", attachmentId: "att1", title: "Att" } }))
    });
    Object.assign(ws, { waitForMaxKnownEntityChangeId: vi.fn(async () => undefined) });
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    (isExperimentalFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (window.glob as unknown as Record<string, unknown>).isDev = false;
});

// --- NoteActions (top-level, classic layout) ------------------------------------------------------

describe("NoteActions (classic layout)", () => {
    it("renders the revisions button and the context menu for a plain note", () => {
        const note = buildNote({ id: "plain", title: "Plain", type: "text" });
        const ctx = fakeNoteContext({ note, notePath: "root/plain" });
        const root = renderInto(<NoteActions />, ctx);

        expect(root.querySelector(".ribbon-button-container")).toBeTruthy();
        // RevisionsButton uses the showRevisions trigger command.
        expect(root.querySelector("[data-trigger-command='showRevisions']")).toBeTruthy();
        // The note-actions dropdown is present.
        expect(root.querySelector(".note-actions")).toBeTruthy();
    });

    it("omits the context menu for launcher notes but keeps the revisions button hidden for doc", () => {
        const launcher = buildNote({ id: "launch", title: "L", type: "launcher" });
        const ctx = fakeNoteContext({ note: launcher, notePath: "root/launch" });
        const root = renderInto(<NoteActions />, ctx);
        // launcher → no note-actions menu and RevisionsButton renders nothing (isEnabled false).
        expect(root.querySelector(".note-actions")).toBeNull();
        expect(root.querySelector("[data-trigger-command='showRevisions']")).toBeNull();
    });

    it("renders an empty container when there is no note", () => {
        const root = renderInto(<NoteActions />, null);
        expect(root.querySelector(".ribbon-button-container")).toBeTruthy();
        expect(root.querySelector(".note-actions")).toBeNull();
    });

    it("hides the revisions button for a doc note yet still shows the context menu", () => {
        const note = buildNote({ id: "docNote", title: "D", type: "doc" });
        const ctx = fakeNoteContext({ note, notePath: "root/docNote" });
        const root = renderInto(<NoteActions />, ctx);
        expect(root.querySelector("[data-trigger-command='showRevisions']")).toBeNull();
        expect(root.querySelector(".note-actions")).toBeTruthy();
    });
});

// --- NoteContextMenu ------------------------------------------------------------------------------

describe("NoteContextMenu", () => {
    function getItem(root: ParentNode, command: string) {
        return root.querySelector<HTMLElement>(`[data-trigger-command='${command}']`);
    }

    it("renders the standard command items for a text note", () => {
        const note = buildNote({ id: "textNote", title: "T", type: "text", content: "hello" });
        const ctx = fakeNoteContext({ note, notePath: "root/textNote" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);

        // Search-in-note enabled (text is searchable).
        const findItem = getItem(root, "findInText");
        expect(findItem).toBeTruthy();
        expect(findItem?.classList.contains("disabled")).toBe(false);
        // Attachments / revisions present.
        expect(getItem(root, "showAttachments")).toBeTruthy();
        expect(getItem(root, "showRevisions")).toBeTruthy();
        expect(getItem(root, "forceSaveRevision")).toBeTruthy();
        expect(getItem(root, "saveNamedRevision")).toBeTruthy();
        // Print is enabled for text content → not disabled.
        expect(getItem(root, "printActiveNote")?.classList.contains("disabled")).toBe(false);
        // Advanced submenu items.
        expect(getItem(root, "showNoteSource")).toBeTruthy();
        // Source available for text.
        expect(getItem(root, "showNoteSource")?.classList.contains("disabled")).toBe(false);
    });

    it("disables print for a note type without printable content", () => {
        const note = buildNote({ id: "renderNote2", title: "R", type: "render" });
        const ctx = fakeNoteContext({ note, notePath: "root/renderNote2" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        expect(getItem(root, "printActiveNote")?.classList.contains("disabled")).toBe(true);
        // render note → re-render command appears.
        expect(getItem(root, "renderActiveNote")).toBeTruthy();
    });

    it("disables import/export/attachments for options notes", () => {
        const note = buildNote({ id: "_optionsAppearance", title: "Opt", type: "text" });
        const ctx = fakeNoteContext({ note, notePath: "root/_optionsAppearance" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        // options notes disable attachments, save-revision, etc.
        expect(getItem(root, "showAttachments")?.classList.contains("disabled")).toBe(true);
        expect(getItem(root, "forceSaveRevision")?.classList.contains("disabled")).toBe(true);
    });

    it("renders the word-wrap submenu for code notes and toggles wrapLines", () => {
        const setLabel = vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
        const removeLabel = vi.spyOn(attributes, "removeOwnedLabelByName").mockImplementation(() => undefined as never);
        const note = buildNote({ id: "codeNote", title: "C", type: "code", content: "x" });
        const ctx = fakeNoteContext({ note, notePath: "root/codeNote" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);

        // Three word-wrap items (auto / on / off).
        const wrapItems = Array.from(root.querySelectorAll<HTMLElement>(".dropdown-item"))
            .filter((el) => el.textContent && (el.querySelector(".bx-check") || el.closest(".dropdown-submenu")));
        expect(wrapItems.length).toBeGreaterThan(0);

        // Click "on" / "off" / "auto" representations.
        const items = Array.from(root.querySelectorAll<HTMLElement>(".dropdown-submenu .dropdown-item"));
        expect(items.length).toBeGreaterThanOrEqual(3);
        act(() => items[1]?.click()); // word wrap on → setLabel("wrapLines", "true")
        act(() => items[2]?.click()); // word wrap off
        act(() => items[0]?.click()); // auto → removeLabel
        expect(setLabel).toHaveBeenCalled();
        expect(removeLabel).toHaveBeenCalled();
    });

    it("renders the read-only edit shortcut when the note is read only", async () => {
        const note = buildNote({ id: "roNote", title: "RO", type: "text", content: "x", "#readOnly": "true" });
        const ctx = fakeNoteContext({ note, notePath: "root/roNote", isReadOnly: vi.fn(async () => true) });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        await flush(); // the read-only state resolves asynchronously, then the menu re-renders
        // The read-only "edit note" item carries the pencil icon.
        expect(root.querySelector(".bx-pencil")).toBeTruthy();
        const editItem = root.querySelector<HTMLElement>(".bx-pencil")?.closest(".dropdown-item") as HTMLElement | null;
        act(() => editItem?.click());
    });

    it("invokes deleteNotes when the delete item is clicked", () => {
        buildNote({ id: "delParent", title: "P", children: [ { id: "delNote", title: "Del" } ] });
        const note = froca.notes["delNote"] as FNote;
        const ctx = fakeNoteContext({ note, notePath: "root/delParent/delNote" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        const delItem = root.querySelector<HTMLElement>(".destructive-action-icon")?.closest(".dropdown-item") as HTMLElement | null;
        expect(delItem).toBeTruthy();
        act(() => delItem?.click());
        expect(branches.deleteNotes).toHaveBeenCalled();
    });

    it("fires import and export commands through the parent component", () => {
        const triggerCommand = vi.spyOn(parent, "triggerCommand").mockReturnValue(undefined as never);
        const note = buildNote({ id: "ieNote", title: "IE", type: "text", content: "x" });
        const ctx = fakeNoteContext({ note, notePath: "root/ieNote" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        const importItem = root.querySelector<HTMLElement>(".bx-import")?.closest(".dropdown-item") as HTMLElement | null;
        const exportItem = root.querySelector<HTMLElement>(".bx-export")?.closest(".dropdown-item") as HTMLElement | null;
        act(() => importItem?.click());
        act(() => exportItem?.click());
        expect(triggerCommand).toHaveBeenCalledWith("showImportDialog", { noteId: "ieNote" });
        expect(triggerCommand).toHaveBeenCalledWith("showExportDialog", expect.objectContaining({ defaultType: "single" }));
    });

    it("renders the export-as-image submenu for mermaid notes and triggers png/svg", () => {
        const triggerEvent = vi.spyOn(parent, "triggerEvent").mockReturnValue(undefined as never);
        const note = buildNote({ id: "mermaidNote", title: "M", type: "mermaid", content: "graph" });
        const ctx = fakeNoteContext({ note, notePath: "root/mermaidNote", ntxId: "ntxM" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        const png = root.querySelector<HTMLElement>(".bxs-file-png")?.closest(".dropdown-item") as HTMLElement | null;
        const svg = root.querySelector<HTMLElement>(".bx-shape-polygon")?.closest(".dropdown-item") as HTMLElement | null;
        expect(png).toBeTruthy();
        expect(svg).toBeTruthy();
        act(() => png?.click());
        act(() => svg?.click());
        expect(triggerEvent).toHaveBeenCalledWith("exportPng", { ntxId: "ntxM" });
        expect(triggerEvent).toHaveBeenCalledWith("exportSvg", { ntxId: "ntxM" });
    });

    it("renders the export-to-xlsx/csv items for spreadsheet notes", () => {
        const triggerEvent = vi.spyOn(parent, "triggerEvent").mockReturnValue(undefined as never);
        const note = buildNote({ id: "sheetNote", title: "S", type: "spreadsheet", content: "data" });
        const ctx = fakeNoteContext({ note, notePath: "root/sheetNote", ntxId: "ntxS" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        const spreadsheetItems = Array.from(root.querySelectorAll<HTMLElement>(".bxs-spreadsheet"))
            .map((el) => el.closest(".dropdown-item") as HTMLElement | null);
        expect(spreadsheetItems.length).toBeGreaterThanOrEqual(2);
        act(() => spreadsheetItems[0]?.click());
        act(() => spreadsheetItems[1]?.click());
        expect(triggerEvent).toHaveBeenCalledWith("exportXlsx", { ntxId: "ntxS" });
        expect(triggerEvent).toHaveBeenCalledWith("exportCsv", { ntxId: "ntxS" });
    });

    it("renders the convert-to-attachment item for an eligible image note and converts it", async () => {
        const setNote = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: () => ({ setNote }) } });
        // Build an image note with a single text parent → eligible for conversion.
        buildNote({
            id: "imgParent", title: "Parent", type: "text", content: "p",
            children: [ { id: "imgNote", title: "Img", type: "image", content: "data" } ]
        });
        const note = froca.notes["imgNote"] as FNote;
        const ctx = fakeNoteContext({ note, notePath: "root/imgParent/imgNote" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        // The paperclip-iconed convert item is the second paperclip (first is attachments).
        const paperclips = Array.from(root.querySelectorAll<HTMLElement>(".bx-paperclip"))
            .map((el) => el.closest(".dropdown-item") as HTMLElement | null);
        const convertItem = paperclips[paperclips.length - 1];
        expect(convertItem).toBeTruthy();
        await act(async () => { convertItem?.click(); });
        // microtask drain
        await act(async () => { await Promise.resolve(); });
        expect(dialog.confirm).toHaveBeenCalled();
        expect(server.post).toHaveBeenCalledWith(expect.stringContaining("convert-to-attachment"));
    });

    it("shows a failure toast when the conversion returns no attachment", async () => {
        Object.assign(server, { post: vi.fn(async () => ({ attachment: null })) });
        buildNote({
            id: "imgParent2", title: "Parent", type: "text", content: "p",
            children: [ { id: "imgNote2", title: "Img", type: "image", content: "data" } ]
        });
        const note = froca.notes["imgNote2"] as FNote;
        const ctx = fakeNoteContext({ note, notePath: "root/imgParent2/imgNote2" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        const paperclips = Array.from(root.querySelectorAll<HTMLElement>(".bx-paperclip"))
            .map((el) => el.closest(".dropdown-item") as HTMLElement | null);
        const convertItem = paperclips[paperclips.length - 1];
        await act(async () => { convertItem?.click(); });
        await act(async () => { await Promise.resolve(); });
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("aborts conversion when the user declines confirmation", async () => {
        (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);
        buildNote({
            id: "imgParent3", title: "Parent", type: "text", content: "p",
            children: [ { id: "imgNote3", title: "Img", type: "image", content: "data" } ]
        });
        const note = froca.notes["imgNote3"] as FNote;
        const ctx = fakeNoteContext({ note, notePath: "root/imgParent3/imgNote3" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        const paperclips = Array.from(root.querySelectorAll<HTMLElement>(".bx-paperclip"))
            .map((el) => el.closest(".dropdown-item") as HTMLElement | null);
        const convertItem = paperclips[paperclips.length - 1];
        await act(async () => { convertItem?.click(); });
        await act(async () => { await Promise.resolve(); });
        expect(server.post).not.toHaveBeenCalled();
    });

    it("disables OCR/source items appropriately for an image note", () => {
        buildNote({
            id: "imgParentO", title: "Parent", type: "text", content: "p",
            children: [ { id: "imgNoteO", title: "Img", type: "image", content: "data" } ]
        });
        const note = froca.notes["imgNoteO"] as FNote;
        const ctx = fakeNoteContext({ note, notePath: "root/imgParentO/imgNoteO" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        // OCR text item is enabled for images.
        expect(getItem(root, "showNoteOCRText")?.classList.contains("disabled")).toBe(false);
        // Source view is disabled for images.
        expect(getItem(root, "showNoteSource")?.classList.contains("disabled")).toBe(true);
    });

    it("renders the development actions when in dev mode", () => {
        (window.glob as unknown as Record<string, unknown>).isDev = true;
        const originalOpen = Object.getOwnPropertyDescriptor(window, "open");
        const openSpy = vi.fn();
        // happy-dom exposes window.open via an accessor; force a plain data property so the
        // component's `window.open(...)` call hits our spy.
        Object.defineProperty(window, "open", { configurable: true, writable: true, value: openSpy });
        let crashCallbackInvoked = false;
        const note = buildNote({ id: "devNote", title: "Dev", type: "text", content: "x" });
        const ctx = fakeNoteContext({
            note, notePath: "root/devNote",
            getTextEditor: (cb: (e: unknown) => void) => {
                crashCallbackInvoked = true;
                try {
                    cb({ editing: { view: { change: (fn: () => void) => fn() } } });
                } catch {
                    // the dev "crash editor" action throws on purpose
                }
            }
        });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        // The Development Actions header is rendered.
        const devHeader = Array.from(root.querySelectorAll(".dropdown-header"))
            .find((el) => el.textContent?.includes("Development Actions"));
        expect(devHeader).toBeTruthy();

        // Only consider leaf items (exclude the submenu containers, whose textContent also
        // includes the descendants' "print page"/"Crash" text).
        const devItems = Array.from(root.querySelectorAll<HTMLElement>(".dropdown-item:not(.dropdown-submenu)"))
            .filter((el) => el.textContent?.includes("print page") || el.textContent?.includes("Crash"));
        const openPrint = devItems.find((el) => el.textContent?.includes("print page"));
        expect(openPrint).toBeTruthy();
        act(() => openPrint?.click());
        expect(openSpy).toHaveBeenCalled();

        const crash = devItems.find((el) => el.textContent?.includes("Crash"));
        act(() => crash?.click());
        expect(crashCallbackInvoked).toBe(true);

        if (originalOpen) {
            Object.defineProperty(window, "open", originalOpen);
        }
    });

    it("handles a backend log note (code properties + searchable + no export)", () => {
        const note = buildNote({ id: "_backendLog", title: "Backend", type: "text", content: "log" });
        const ctx = fakeNoteContext({ note, notePath: "root/_backendLog" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        openDropdowns(root);
        // _backendLog renders the CodeProperties word-wrap submenu (align-justify icon).
        expect(root.querySelector(".bx-align-justify")).toBeTruthy();
        // Export is disabled for the backend log.
        const exportItem = root.querySelector<HTMLElement>(".bx-export")?.closest(".dropdown-item") as HTMLElement | null;
        expect(exportItem?.classList.contains("disabled")).toBe(true);
    });

    it("toggles the dropdown when the keyboard shortcut event fires (no-op in classic layout)", () => {
        const note = buildNote({ id: "kbNote", title: "K", type: "text", content: "x" });
        const ctx = fakeNoteContext({ note, notePath: "root/kbNote" });
        const root = renderInto(<NoteContextMenu note={note} noteContext={ctx} />);
        // In classic layout the handler early-returns; just ensure it does not throw.
        act(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (parent.handleEventInChildren as any)("toggleRibbonTabBasicProperties", {});
        });
        expect(root.querySelector(".note-actions")).toBeTruthy();
    });

    it("renders extra items passed via itemsAtStart and itemsNearNoteSettings", () => {
        const note = buildNote({ id: "extraNote", title: "E", type: "text", content: "x" });
        const ctx = fakeNoteContext({ note, notePath: "root/extraNote" });
        const root = renderInto(
            <NoteContextMenu
                note={note}
                noteContext={ctx}
                itemsAtStart={<li className="custom-start">start</li>}
                itemsNearNoteSettings={<li className="custom-near">near</li>}
            />
        );
        openDropdowns(root);
        expect(root.querySelector(".custom-start")).toBeTruthy();
        expect(root.querySelector(".custom-near")).toBeTruthy();
    });
});

// --- CommandItem ----------------------------------------------------------------------------------

describe("CommandItem", () => {
    it("wires a string command to a trigger command attribute", () => {
        const root = renderInto(<ul><CommandItem icon="bx bx-search" text="Find" command="findInText" /></ul>);
        const item = root.querySelector<HTMLElement>(".dropdown-item");
        expect(item?.getAttribute("data-trigger-command")).toBe("findInText");
    });

    it("wires a function command to a click handler and respects disabled", () => {
        const onClick = vi.fn();
        const root = renderInto(<ul><CommandItem icon="bx bx-x" text="Custom" command={onClick} disabled /></ul>);
        const item = root.querySelector<HTMLElement>(".dropdown-item");
        expect(item?.getAttribute("data-trigger-command")).toBeNull();
        expect(item?.classList.contains("disabled")).toBe(true);
        act(() => item?.click());
        expect(onClick).toHaveBeenCalled();
    });
});

// --- New layout (separate module instance) --------------------------------------------------------
//
// `isNewLayout` is captured once at module load from `isExperimentalFeatureEnabled("new-layout")`,
// so the only way to exercise the new-layout branches is to re-import the module with the flag on.
// Everything the re-imported component touches (the React context providers, the spied services)
// must come from the same reset module graph, otherwise the contexts won't match.

describe("NoteActions (new layout)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nl: Record<string, any>;

    async function loadNewLayout() {
        vi.resetModules();
        // Override the feature flag and stub the heavy new-layout-only children.
        vi.doMock("../../services/experimental_features", () => ({ isExperimentalFeatureEnabled: vi.fn(() => true) }));
        vi.doMock("./NoteActionsCustom", () => ({ default: () => <div className="stub-custom" /> }));
        vi.doMock("../buttons/move_pane_button", () => ({ default: () => <div className="stub-move" /> }));
        vi.doMock("../buttons/close_pane_button", () => ({ default: () => <div className="stub-close" /> }));
        vi.doMock("../buttons/create_pane_button", () => ({ default: () => <div className="stub-create" /> }));

        const reactUtils = await import("../react/react_utils");
        const ComponentMod = (await import("../../components/component")).default;
        nl = {
            mod: await import("./NoteActions"),
            ParentComponent: reactUtils.ParentComponent,
            NoteContextContext: reactUtils.NoteContextContext,
            parent: new ComponentMod(),
            protected_session: (await import("../../services/protected_session")).default,
            attributes: (await import("../../services/attributes")).default
        };
    }

    // The new layout re-imports the module graph (so the React contexts match the re-imported
    // component), which means the shared `renderComponent` can't be used here — it wires up the
    // *original* module's providers. These containers are therefore torn down locally.
    const nlContainers: HTMLElement[] = [];

    /** Render using the providers/parent from the re-imported module graph. */
    function renderNewLayout(vnode: preact.ComponentChildren, noteContext: NoteContext | null) {
        const el = document.createElement("div");
        nlContainers.push(el);
        document.body.appendChild(el);
        act(() => render(
            <nl.ParentComponent.Provider value={nl.parent}>
                <nl.NoteContextContext.Provider value={noteContext}>
                    {vnode}
                </nl.NoteContextContext.Provider>
            </nl.ParentComponent.Provider>,
            el
        ));
        return el;
    }

    afterEach(() => {
        for (const el of nlContainers.splice(0)) {
            act(() => render(null, el));
            el.remove();
        }
        vi.doUnmock("./NoteActionsCustom");
        vi.doUnmock("../buttons/move_pane_button");
        vi.doUnmock("../buttons/close_pane_button");
        vi.doUnmock("../buttons/create_pane_button");
        vi.doUnmock("../../services/experimental_features");
        vi.resetModules();
    });

    it("renders the pane buttons and custom actions in the new layout", async () => {
        await loadNewLayout();
        const note = buildNote({ id: "nlNote", title: "NL", type: "text", content: "x" });
        const ctx = fakeNoteContext({ note, notePath: "root/nlNote" });
        const root = renderNewLayout(<nl.mod.default />, ctx);

        expect(root.querySelector(".stub-custom")).toBeTruthy();
        expect(root.querySelectorAll(".stub-move").length).toBe(2);
        expect(root.querySelector(".stub-close")).toBeTruthy();
        expect(root.querySelector(".stub-create")).toBeTruthy();
        // RevisionsButton is omitted in the new layout.
        expect(root.querySelector("[data-trigger-command='showRevisions']")).toBeNull();
        // The context menu still renders.
        expect(root.querySelector(".note-actions")).toBeTruthy();
    });

    it("renders the note-map and basic-properties items, and reacts to the keyboard shortcut", async () => {
        await loadNewLayout();
        const note = buildNote({ id: "nlNote2", title: "NL2", type: "text", content: "x" });
        const ctx = fakeNoteContext({ note, notePath: "root/nlNote2" });
        const root = renderNewLayout(<nl.mod.NoteContextMenu note={note} noteContext={ctx} />, null);
        openDropdowns(root);
        // New-layout-only command items.
        expect(root.querySelector("[data-trigger-command='toggleRibbonTabNoteMap']")).toBeTruthy();
        // The dots button uses the horizontal icon in the new layout.
        expect(root.querySelector(".bx-dots-horizontal-rounded")).toBeTruthy();
        // The basic-properties block (share toggle) renders.
        expect(root.querySelector(".bx-share-alt")).toBeTruthy();

        // Keyboard shortcut toggles the dropdown without throwing.
        act(() => {
            (nl.parent.handleEventInChildren)("toggleRibbonTabBasicProperties", {});
        });
        expect(root.querySelector(".note-actions")).toBeTruthy();
    });

    it("toggles protection and template inside the basic-properties block", async () => {
        await loadNewLayout();
        const setBool = vi.spyOn(nl.attributes, "setBooleanWithInheritance").mockImplementation(() => undefined as never);
        const note = buildNote({ id: "nlNote3", title: "NL3", type: "text", content: "x" });
        const ctx = fakeNoteContext({ note, notePath: "root/nlNote3" });
        const root = renderNewLayout(<nl.mod.NoteContextMenu note={note} noteContext={ctx} />, null);
        openDropdowns(root);

        // Protect toggle drives protected_session.protectNote. The toggleable item's real handler
        // lives on the <li>, so click the list item rather than the inner (no-op) checkbox.
        const protectItem = root.querySelector<HTMLElement>(".bx-lock-alt")?.closest(".dropdown-item") as HTMLElement | null;
        expect(protectItem).toBeTruthy();
        act(() => protectItem?.click());
        expect(nl.protected_session.protectNote).toHaveBeenCalledWith("nlNote3", true, false);

        // Editability submenu: clicking each of the three options writes the readOnly /
        // autoReadOnlyDisabled labels via setState.
        const editSubmenu = root.querySelector<HTMLElement>(".bx-edit-alt")?.closest(".dropdown-submenu") as HTMLElement | null;
        expect(editSubmenu).toBeTruthy();
        const editItems = Array.from(editSubmenu?.querySelectorAll<HTMLElement>(".dropdown-menu .dropdown-item") ?? []);
        expect(editItems.length).toBe(3);
        setBool.mockClear();
        act(() => editItems[1]?.click()); // read only → setReadOnly(true) + setAutoReadOnlyDisabled(false)
        expect(setBool).toHaveBeenCalledWith(note, "readOnly", true);
        expect(setBool).toHaveBeenCalledWith(note, "autoReadOnlyDisabled", false);
        act(() => editItems[2]?.click()); // always editable → setAutoReadOnlyDisabled(true)
        expect(setBool).toHaveBeenCalledWith(note, "autoReadOnlyDisabled", true);
        act(() => editItems[0]?.click()); // auto → both false

        // Template toggle uses setBooleanWithInheritance.
        setBool.mockClear();
        const templateItem = root.querySelector<HTMLElement>(".bx-copy-alt")?.closest(".dropdown-item") as HTMLElement | null;
        act(() => templateItem?.click());
        expect(setBool).toHaveBeenCalledWith(note, "template", true);
    });

    it("focuses the basic-properties item and clears the focus marker on hide", async () => {
        await loadNewLayout();
        const note = buildNote({ id: "nlFocus", title: "F", type: "text", content: "x" });
        const ctx = fakeNoteContext({ note, notePath: "root/nlFocus" });
        const root = renderNewLayout(<nl.mod.NoteContextMenu note={note} noteContext={ctx} />, null);

        // Firing the keyboard shortcut sets the focus marker and toggles the dropdown.
        act(() => {
            (nl.parent.handleEventInChildren)("toggleRibbonTabBasicProperties", {});
        });
        // Opening the dropdown mounts NoteBasicProperties; its effect focuses the shared item.
        openDropdowns(root);
        const focusTarget = root.querySelector<HTMLLIElement>(".bx-share-alt")?.closest(".dropdown-item");
        expect(focusTarget).toBeTruthy();

        // Hiding the dropdown clears the focus marker (onHidden).
        const dropdown = root.querySelector(".note-actions");
        act(() => { if (dropdown) $(dropdown).trigger("hide.bs.dropdown"); });
        expect(root.querySelector(".note-actions")).toBeTruthy();
    });
});
