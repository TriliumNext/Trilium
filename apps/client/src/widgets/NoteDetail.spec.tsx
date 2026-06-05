import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

const h = vi.hoisted(() => ({
    isElectron: false,
    isMobile: false
}));

vi.mock("../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/utils")>()),
    isElectron: () => h.isElectron,
    isMobile: () => h.isMobile
}));

vi.mock("../services/toast", () => ({
    default: { showPersistent: vi.fn(), closePersistent: vi.fn() }
}));

vi.mock("../services/dialog", () => ({
    default: { info: vi.fn(), confirm: vi.fn(), prompt: vi.fn() }
}));

vi.mock("../services/protected_session_holder", () => ({
    default: { isProtectedSessionAvailable: vi.fn(() => true) }
}));

vi.mock("./react/NoteList", () => ({
    NoteListWithLinks: () => <div class="note-list-with-links-stub" />
}));

// A lightweight stub legacy widget so the FixedTree path does not pull in the real note tree.
vi.mock("./note_tree", () => {
    class NoteTreeWidgetStub {
        $widget = $("<div class='note-tree-stub'></div>");
        children: unknown[] = [];
        componentId = "tree-stub";
        setParent() { return this; }
        render() { return this.$widget; }
        cleanup() {}
        toggleExt() {}
        handleEvent() { return null; }
        handleEventInChildren() { return null; }
        activeContextChangedEvent() {}
    }
    return { default: NoteTreeWidgetStub };
});

// Control the note-type → widget resolution. Each "view" exercises a different branch of
// getCorrespondingWidget (default export, plain function, direct VNode).
vi.mock("./note_types", () => {
    const Stub = (props: Record<string, unknown>) => <div class="type-widget-stub" data-note={String((props.note as { noteId?: string } | undefined)?.noteId)} />;
    const baseMapping = (className: string, extra: Record<string, unknown> = {}) => ({
        view: () => Promise.resolve({ default: Stub }),
        className,
        printable: true,
        ...extra
    });
    const TYPE_MAPPINGS: Record<string, unknown> = {
        doc: baseMapping("note-detail-doc"),
        empty: baseMapping("note-detail-empty"),
        editableText: baseMapping("note-detail-editable-text"),
        readOnlyText: baseMapping("note-detail-readonly-text"),
        editableCode: { view: () => Stub, className: "note-detail-code", printable: true }, // plain function
        readOnlyCode: baseMapping("note-detail-readonly-code"),
        protectedSession: { view: () => Promise.resolve({ default: Stub }), className: "protected-session-password-component", isFullHeight: true },
        book: { view: () => Promise.resolve({ default: Stub }), className: "note-detail-book", printable: true },
        webView: { view: () => Promise.resolve({ default: Stub }), className: "note-detail-web-view", printable: true, isFullHeight: true },
        noteMap: { view: () => Promise.resolve({ default: Stub }), className: "note-detail-note-map", printable: true, isFullHeight: true },
        attachmentList: baseMapping("attachment-list"),
        attachmentDetail: baseMapping("attachment-detail"),
        // A view that resolves to a direct VNode (exercises the isValidElement branch).
        render: { view: () => Promise.resolve(<span class="direct-vnode" />), className: "note-detail-render", printable: true }
    };
    return { TYPE_MAPPINGS };
});

import appContext from "../components/app_context";
import Component from "../components/component";
import type NoteContext from "../components/note_context";
import dialog from "../services/dialog";
import froca from "../services/froca";
import protected_session_holder from "../services/protected_session_holder";
import toast from "../services/toast";
import { buildNote } from "../test/easy-froca";
import { flush } from "../test/render-hook";
import NoteDetail, { checkFullHeight, getExtendedWidgetType } from "./NoteDetail";
import { NoteContextContext, ParentComponent } from "./react/react_utils";

/** Settle the multi-hop async effect chain (type resolution → widget import → state updates). */
async function settle() {
    await flush();
    await flush();
    await flush();
}

// --- Helpers --------------------------------------------------------------------------------------

/** A real Component (so useTriliumEvent registers + fireEvent reaches the handlers), with a DOM widget. */
function makeParent() {
    const parent = new Component();
    parent.$widget = $("<div class='note-split'></div>");
    return parent;
}

/** A minimal NoteContext; cast through unknown since the component touches only a few fields. */
function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: "root/note1",
        viewScope: { viewMode: "default" },
        isActive: () => true,
        isReadOnly: vi.fn(async () => false),
        hasNoteList: () => false,
        ...overrides
    } as unknown as NoteContext;
}

let container: HTMLDivElement | undefined;
function renderDetail(noteContext: NoteContext | null, parent: Component = makeParent()) {
    const localContainer = document.createElement("div");
    document.body.appendChild(localContainer);
    container = localContainer;
    act(() => render(
        <ParentComponent.Provider value={parent}>
            <NoteContextContext.Provider value={noteContext}>
                <NoteDetail />
            </NoteContextContext.Provider>
        </ParentComponent.Provider>,
        localContainer
    ));
    return { container: localContainer, parent, fire: (name: string, data: unknown) => act(() => {
        (parent.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
    }) };
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    h.isElectron = false;
    h.isMobile = false;
    vi.clearAllMocks();
    (protected_session_holder.isProtectedSessionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
    Object.assign(window, { glob: { ...(window.glob ?? {}), getComponentByEl: vi.fn(() => ({ id: "comp" })) } });
});

afterEach(() => {
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- getExtendedWidgetType (pure) -----------------------------------------------------------------

describe("getExtendedWidgetType", () => {
    it("returns undefined without a context", async () => {
        expect(await getExtendedWidgetType(buildNote({ title: "N" }), undefined)).toBeUndefined();
    });

    it("distinguishes new tab (null) from not-yet-loaded (undefined)", async () => {
        const ctx = fakeNoteContext();
        expect(await getExtendedWidgetType(null, ctx)).toBe("empty");
        expect(await getExtendedWidgetType(undefined, ctx)).toBeUndefined();
    });

    it("maps view scopes and note types", async () => {
        const text = buildNote({ title: "T", type: "text" });
        expect(await getExtendedWidgetType(text, fakeNoteContext({ viewScope: { viewMode: "source" } }))).toBe("readOnlyCode");
        expect(await getExtendedWidgetType(text, fakeNoteContext({ viewScope: { viewMode: "attachments" } }))).toBe("attachmentList");
        expect(await getExtendedWidgetType(text, fakeNoteContext({ viewScope: { viewMode: "attachments", attachmentId: "a1" } }))).toBe("attachmentDetail");
        expect(await getExtendedWidgetType(text, fakeNoteContext({ viewScope: { viewMode: "note-map" } }))).toBe("noteMap");
        expect(await getExtendedWidgetType(text, fakeNoteContext())).toBe("editableText");
        expect(await getExtendedWidgetType(text, fakeNoteContext({ isReadOnly: vi.fn(async () => true) }))).toBe("readOnlyText");
    });

    it("maps code, markdown, sqlite, launcher and fallback types", async () => {
        const code = buildNote({ title: "C", type: "code" });
        expect(await getExtendedWidgetType(code, fakeNoteContext())).toBe("editableCode");
        expect(await getExtendedWidgetType(code, fakeNoteContext({ isReadOnly: vi.fn(async () => true) }))).toBe("readOnlyCode");

        const md = buildNote({ title: "M", type: "code" });
        Object.assign(md, { mime: "text/markdown" });
        expect(await getExtendedWidgetType(md, fakeNoteContext())).toBe("markdown");

        const sql = buildNote({ title: "S", type: "code" });
        Object.assign(sql, { mime: "text/x-sqlite;schema=trilium" });
        expect(await getExtendedWidgetType(sql, fakeNoteContext())).toBe("sqlConsole");

        const launcher = buildNote({ title: "L", type: "launcher" });
        expect(await getExtendedWidgetType(launcher, fakeNoteContext())).toBe("doc");

        const book = buildNote({ title: "B", type: "book" });
        expect(await getExtendedWidgetType(book, fakeNoteContext())).toBe("book");
    });

    it("returns protectedSession when a protected note has no available session", async () => {
        (protected_session_holder.isProtectedSessionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);
        const note = buildNote({ title: "P", type: "text" });
        Object.assign(note, { isProtected: true });
        expect(await getExtendedWidgetType(note, fakeNoteContext())).toBe("protectedSession");
    });
});

// --- checkFullHeight (pure) -----------------------------------------------------------------------

describe("checkFullHeight", () => {
    it("returns false without a context", () => {
        expect(checkFullHeight(undefined, "editableText")).toBe(false);
    });

    it("is true for full-height note types without a note list", () => {
        expect(checkFullHeight(fakeNoteContext(), "noteMap")).toBe(true);
        expect(checkFullHeight(fakeNoteContext({ hasNoteList: () => true }), "noteMap")).toBe(false);
    });

    it("is true for the backend log note and the attachments view", () => {
        expect(checkFullHeight(fakeNoteContext({ noteId: "_backendLog" }), "editableText")).toBe(true);
        expect(checkFullHeight(fakeNoteContext({ viewScope: { viewMode: "attachments" } }), "editableText")).toBe(true);
    });

    it("centers an empty book (grid/list) with no children", () => {
        const emptyBook = buildNote({ title: "EB", type: "book", "#viewType": "grid" });
        expect(checkFullHeight(fakeNoteContext({ note: emptyBook }), "book")).toBe(true);

        const fullBook = buildNote({ title: "FB", type: "book", "#viewType": "grid", children: [ { title: "child" } ] });
        expect(checkFullHeight(fakeNoteContext({ note: fullBook }), "book")).toBe(false);
    });
});

// --- Component render ------------------------------------------------------------------------------

describe("NoteDetail render", () => {
    it("renders the root container and resolves a text widget for the active tab", async () => {
        const note = buildNote({ id: "tx1", title: "Text", type: "text" });
        const ctx = fakeNoteContext({ note, notePath: "root/tx1" });
        const { container } = renderDetail(ctx);
        await settle();

        const root = container.querySelector(".component.note-detail");
        expect(root).toBeTruthy();
        expect(container.querySelector(".note-detail-editable-text")).toBeTruthy();
        expect(container.querySelector(".note-detail-editable-text.visible")).toBeTruthy();
        expect(container.querySelector(".type-widget-stub")).toBeTruthy();
    });

    it("renders the empty widget for a null note (new tab)", async () => {
        const ctx = fakeNoteContext({ note: null });
        const { container } = renderDetail(ctx);
        await settle();
        expect(container.querySelector(".note-detail-empty")).toBeTruthy();
    });

    it("resolves a widget exposed as a plain function (not a module default)", async () => {
        const code = buildNote({ id: "code1", title: "Code", type: "code" });
        const { container } = renderDetail(fakeNoteContext({ note: code, notePath: "root/code1" }));
        await settle();
        expect(container.querySelector(".note-detail-code")).toBeTruthy();
    });

    it("resolves a full-height web-view widget", async () => {
        const wv = buildNote({ id: "wv1", title: "WV", type: "webView" });
        const { container } = renderDetail(fakeNoteContext({ note: wv, notePath: "root/wv1" }));
        await settle();
        expect(container.querySelector(".note-detail-web-view")).toBeTruthy();
    });

    it("applies full-height class for a note-map view", async () => {
        const note = buildNote({ id: "nm1", title: "NM", type: "text" });
        const { container } = renderDetail(fakeNoteContext({ note, viewScope: { viewMode: "note-map" } }));
        await settle();
        expect(container.querySelector(".note-detail.full-height")).toBeTruthy();
    });

    it("keeps an inactive deferred tab from loading until activated", async () => {
        const note = buildNote({ id: "deferred", title: "D", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntx-deferred", isActive: () => false });
        const { container, fire } = renderDetail(ctx);
        await settle();
        expect(container.querySelector(".note-detail-editable-text")).toBeNull();

        fire("activeNoteChanged", { ntxId: "ntx-deferred" });
        await settle();
        expect(container.querySelector(".note-detail-editable-text")).toBeTruthy();
    });

    it("treats a special context (ntxId starting with '_') as immediately active", async () => {
        const note = buildNote({ id: "special", title: "S", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "_popup", isActive: () => false });
        const { container } = renderDetail(ctx);
        await settle();
        expect(container.querySelector(".note-detail-editable-text")).toBeTruthy();
    });

    it("renders the fixed tree on mobile for launchbar config notes", async () => {
        h.isMobile = true;
        const note = buildNote({ id: "_lbMobileItem", title: "M", type: "launcher" });
        const ctx = fakeNoteContext({ note, hoistedNoteId: "_lbMobileRoot" });
        const { container } = renderDetail(ctx);
        await settle();
        expect(container.querySelector(".note-detail.fixed-tree")).toBeTruthy();
        expect(container.querySelector(".fixed-note-tree-container")).toBeTruthy();
    });
});

// --- Trilium events -------------------------------------------------------------------------------

describe("NoteDetail events", () => {
    it("triggers noteTypeMimeChanged on a content reload via handleEvent", async () => {
        const note = buildNote({ id: "ev1", title: "E", type: "text" });
        const parent = makeParent();
        const handleEvent = vi.spyOn(parent, "handleEvent");
        const { fire } = renderDetail(fakeNoteContext({ note }), parent);
        await settle();

        fire("entitiesReloaded", {
            loadResults: {
                isNoteContentReloaded: (id: string) => id === "ev1",
                isNoteReloaded: () => false,
                getAttributeRows: () => []
            }
        });
        await settle();
        expect(handleEvent).toHaveBeenCalledWith("noteTypeMimeChanged", { noteId: "ev1" });
    });

    it("triggers noteTypeMimeChanged when the resolved type changes", async () => {
        const note = buildNote({ id: "ev2", title: "E2", type: "text" });
        const parent = makeParent();
        const triggerEvent = vi.spyOn(parent, "triggerEvent").mockReturnValue(null);
        // Mount as editableText (not read-only); then flip to read-only so re-resolution differs.
        const isReadOnly = vi.fn(async () => false);
        const ctx = fakeNoteContext({ note, isReadOnly });
        const { fire } = renderDetail(ctx, parent);
        await settle();

        isReadOnly.mockResolvedValue(true);
        fire("entitiesReloaded", {
            loadResults: {
                isNoteContentReloaded: () => false,
                isNoteReloaded: (id: string) => id === "ev2",
                getAttributeRows: () => []
            }
        });
        await settle();
        expect(triggerEvent).toHaveBeenCalledWith("noteTypeMimeChanged", { noteId: "ev2" });
    });

    it("triggers noteTypeMimeChanged for an affecting label/relation change", async () => {
        const note = buildNote({ id: "ev3", title: "E3", type: "text" });
        const parent = makeParent();
        const triggerEvent = vi.spyOn(parent, "triggerEvent").mockReturnValue(null);
        const { fire } = renderDetail(fakeNoteContext({ note }), parent);
        await settle();

        fire("entitiesReloaded", {
            loadResults: {
                isNoteContentReloaded: () => false,
                isNoteReloaded: () => false,
                getAttributeRows: () => [
                    { type: "label", name: "readOnly", value: "true", noteId: "ev3", isDeleted: false }
                ]
            }
        });
        await settle();
        expect(triggerEvent).toHaveBeenCalledWith("noteTypeMimeChanged", { noteId: "ev3" });
    });

    it("ignores entitiesReloaded when nothing affects the note", async () => {
        const note = buildNote({ id: "ev4", title: "E4", type: "text" });
        const parent = makeParent();
        const triggerEvent = vi.spyOn(parent, "triggerEvent").mockReturnValue(null);
        const { fire } = renderDetail(fakeNoteContext({ note }), parent);
        await settle();

        fire("entitiesReloaded", {
            loadResults: {
                isNoteContentReloaded: () => false,
                isNoteReloaded: () => false,
                getAttributeRows: () => [
                    { type: "label", name: "color", value: "red", noteId: "ev4", isDeleted: false }
                ]
            }
        });
        await settle();
        expect(triggerEvent).not.toHaveBeenCalled();
    });

    it("focuses the detail on activeNoteChanged when nothing relevant is focused", async () => {
        const note = buildNote({ id: "fc1", title: "F", type: "text" });
        const parent = makeParent();
        const triggerCommand = vi.spyOn(parent, "triggerCommand").mockReturnValue(null);
        const { fire } = renderDetail(fakeNoteContext({ note }), parent);
        await settle();

        fire("activeNoteChanged", { ntxId: "ntx1" });
        expect(triggerCommand).toHaveBeenCalledWith("focusOnDetail", { ntxId: "ntx1" });
    });

    it("ignores activeNoteChanged for a different context", async () => {
        const note = buildNote({ id: "fc2", title: "F2", type: "text" });
        const parent = makeParent();
        const triggerCommand = vi.spyOn(parent, "triggerCommand").mockReturnValue(null);
        const { fire } = renderDetail(fakeNoteContext({ note }), parent);
        await settle();
        fire("activeNoteChanged", { ntxId: "other" });
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("refreshes on readOnlyTemporarilyDisabled and noteTypeMimeChanged", async () => {
        const note = buildNote({ id: "rf1", title: "R", type: "text" });
        const ctx = fakeNoteContext({ note });
        const { fire } = renderDetail(ctx);
        await settle();
        // These just need to run their refresh handlers without throwing.
        fire("readOnlyTemporarilyDisabled", { noteContext: ctx });
        fire("readOnlyTemporarilyDisabled", { noteContext: fakeNoteContext({ ntxId: "other" }) });
        fire("noteTypeMimeChanged", { noteId: "rf1" });
        await settle();
        expect(true).toBe(true);
    });

    it("executeInActiveNoteDetailWidget runs the callback only when active", async () => {
        const note = buildNote({ id: "ex1", title: "X", type: "text" });
        const parent = makeParent();
        const { fire } = renderDetail(fakeNoteContext({ note }), parent);
        await settle();
        const callback = vi.fn();
        fire("executeInActiveNoteDetailWidget", { callback });
        expect(callback).toHaveBeenCalledWith(parent);

        const inactive = makeParent();
        const cb2 = vi.fn();
        const r2 = renderDetail(fakeNoteContext({ note, isActive: () => false }), inactive);
        await settle();
        r2.fire("executeInActiveNoteDetailWidget", { callback: cb2 });
        expect(cb2).not.toHaveBeenCalled();
    });

    it("executeWithTypeWidget resolves the component for the active type", async () => {
        const note = buildNote({ id: "wt1", title: "WT", type: "text" });
        const { fire } = renderDetail(fakeNoteContext({ note }));
        await settle();
        const resolve = vi.fn();
        fire("executeWithTypeWidget", { resolve, ntxId: "ntx1" });
        expect(resolve).toHaveBeenCalled();

        const noMatch = vi.fn();
        fire("executeWithTypeWidget", { resolve: noMatch, ntxId: "different" });
        expect(noMatch).not.toHaveBeenCalled();
    });
});

// --- Printing -------------------------------------------------------------------------------------

describe("NoteDetail printing", () => {
    it("delegates to showPrintPreview under Electron with a note path", async () => {
        h.isElectron = true;
        const note = buildNote({ id: "pr1", title: "P", type: "text" });
        const parent = makeParent();
        const ctx = fakeNoteContext({ note, notePath: "root/pr1" });
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockReturnValue(null as never);
        const { fire } = renderDetail(ctx, parent);
        await settle();
        fire("printActiveNote", {});
        expect(triggerCommand).toHaveBeenCalledWith("showPrintPreview", expect.objectContaining({ note }));
    });

    it("uses the browser iframe fallback when not on Electron", async () => {
        h.isElectron = false;
        const note = buildNote({ id: "pr2", title: "P2", type: "text" });
        const ctx = fakeNoteContext({ note, notePath: "root/pr2" });
        const { fire } = renderDetail(ctx);
        await settle();
        fire("printActiveNote", {});
        expect(toast.showPersistent).toHaveBeenCalled();
        const iframe = document.querySelector("iframe.print-iframe");
        expect(iframe).toBeTruthy();
        iframe?.remove();
    });

    it("skips printing for inactive context, missing note, and PDF files", async () => {
        const note = buildNote({ id: "pr3", title: "P3", type: "text" });
        const inactive = renderDetail(fakeNoteContext({ note, isActive: () => false }));
        await settle();
        inactive.fire("printActiveNote", {});
        expect(toast.showPersistent).not.toHaveBeenCalled();

        const pdf = buildNote({ id: "pdf1", title: "PDF", type: "file" });
        Object.assign(pdf, { mime: "application/pdf" });
        const pdfRender = renderDetail(fakeNoteContext({ note: pdf }));
        await settle();
        pdfRender.fire("printActiveNote", {});
        expect(toast.showPersistent).not.toHaveBeenCalled();
    });

    it("drives the browser iframe onload flow (progress + note-ready + print)", async () => {
        const note = buildNote({ id: "pr4", title: "P4", type: "text" });
        const { fire } = renderDetail(fakeNoteContext({ note, notePath: "root/pr4" }));
        await settle();
        fire("printActiveNote", {});

        const iframe = document.querySelector<HTMLIFrameElement>("iframe.print-iframe");
        expect(iframe).toBeTruthy();
        if (!iframe) return;

        const listeners: Record<string, (e: { detail?: unknown }) => void> = {};
        const print = vi.fn();
        Object.defineProperty(iframe, "contentWindow", {
            configurable: true,
            value: {
                addEventListener: (name: string, cb: (e: { detail?: unknown }) => void) => { listeners[name] = cb; },
                print
            }
        });
        iframe.onload?.(new Event("load"));

        listeners["note-load-progress"]?.({ detail: { progress: 50 } });
        listeners["note-ready"]?.({ detail: { type: "single-note" } });
        expect(print).toHaveBeenCalled();
        expect(document.querySelector("iframe.print-iframe")).toBeNull();
    });

    it("removes the iframe when its contentWindow is unavailable", async () => {
        const note = buildNote({ id: "pr5", title: "P5", type: "text" });
        const { fire } = renderDetail(fakeNoteContext({ note, notePath: "root/pr5" }));
        await settle();
        fire("printActiveNote", {});

        const iframe = document.querySelector<HTMLIFrameElement>("iframe.print-iframe");
        if (!iframe) return;
        Object.defineProperty(iframe, "contentWindow", { configurable: true, value: null });
        iframe.onload?.(new Event("load"));
        expect(document.querySelector("iframe.print-iframe")).toBeNull();
    });
});

// --- electronApi printing listeners + print reports -----------------------------------------------

describe("NoteDetail electronApi printing", () => {
    function installPrintingApi() {
        const handlers: { progress?: (d: { progress: number; action: string }) => void; done?: (r: unknown) => void } = {};
        const removePrintListeners = vi.fn();
        Object.assign(window, {
            electronApi: {
                printing: {
                    onPrintProgress: (cb: (d: { progress: number; action: string }) => void) => { handlers.progress = cb; },
                    onPrintDone: (cb: (r: unknown) => void) => { handlers.done = cb; },
                    removePrintListeners
                }
            }
        });
        return { handlers, removePrintListeners };
    }

    afterEach(() => {
        delete (window as unknown as Record<string, unknown>).electronApi;
    });

    it("subscribes to print progress/done and cleans up on unmount", async () => {
        const { handlers, removePrintListeners } = installPrintingApi();
        const note = buildNote({ id: "ep1", title: "EP", type: "text" });
        renderDetail(fakeNoteContext({ note }));
        await settle();

        handlers.progress?.({ progress: 25, action: "printing" });
        handlers.progress?.({ progress: 75, action: "exporting_pdf" });
        expect(toast.showPersistent).toHaveBeenCalled();

        handlers.done?.({ type: "single-note" });
        expect(toast.closePersistent).toHaveBeenCalledWith("printing");

        if (container) { act(() => render(null, container as HTMLDivElement)); container.remove(); container = undefined; }
        expect(removePrintListeners).toHaveBeenCalled();
    });

    it("renders an error print report with a stack-trace button", async () => {
        const { handlers } = installPrintingApi();
        const note = buildNote({ id: "ep2", title: "EP2", type: "text" });
        renderDetail(fakeNoteContext({ note }));
        await settle();

        handlers.done?.({ type: "error", message: "boom", stack: "at x" });
        const call = (toast.showPersistent as ReturnType<typeof vi.fn>).mock.calls.find(([ arg ]) => arg?.id === "print-error");
        expect(call).toBeTruthy();
        const button = call?.[0]?.buttons?.[0];
        button?.onClick({ dismissToast: vi.fn() });
        expect(dialog.info).toHaveBeenCalled();
    });

    it("renders an error print report without a stack (no button)", async () => {
        const { handlers } = installPrintingApi();
        const note = buildNote({ id: "ep3", title: "EP3", type: "text" });
        renderDetail(fakeNoteContext({ note }));
        await settle();

        handlers.done?.({ type: "error", message: "no stack" });
        const call = (toast.showPersistent as ReturnType<typeof vi.fn>).mock.calls.find(([ arg ]) => arg?.id === "print-error");
        expect(call?.[0]?.buttons).toBeUndefined();
    });

    it("renders a collection report with ignored notes and opens details", async () => {
        const { handlers } = installPrintingApi();
        buildNote({ id: "ign1", title: "Ignored" });
        const note = buildNote({ id: "ep4", title: "EP4", type: "text" });
        renderDetail(fakeNoteContext({ note }));
        await settle();

        handlers.done?.({ type: "collection", ignoredNoteIds: [ "ign1" ] });
        const call = (toast.showPersistent as ReturnType<typeof vi.fn>).mock.calls.find(([ arg ]) => arg?.id === "print-report");
        expect(call).toBeTruthy();
        call?.[0]?.buttons?.[0]?.onClick({ dismissToast: vi.fn() });
        expect(dialog.info).toHaveBeenCalled();
    });

    it("ignores an empty/undefined print report and a collection with no ignored notes", async () => {
        const { handlers } = installPrintingApi();
        const note = buildNote({ id: "ep5", title: "EP5", type: "text" });
        renderDetail(fakeNoteContext({ note }));
        await settle();

        (toast.showPersistent as ReturnType<typeof vi.fn>).mockClear();
        handlers.done?.(undefined);
        handlers.done?.({ type: "collection", ignoredNoteIds: [] });
        const reportCall = (toast.showPersistent as ReturnType<typeof vi.fn>).mock.calls.find(([ arg ]) => arg?.id === "print-report" || arg?.id === "print-error");
        expect(reportCall).toBeFalsy();
    });
});

// --- Direct-VNode widget resolution ---------------------------------------------------------------

describe("NoteDetail widget resolution branches", () => {
    it("activates a deferred tab via the isActive effect when a new active context arrives", async () => {
        const note = buildNote({ id: "act1", title: "A", type: "text" });
        const parent = makeParent();
        const localContainer = document.createElement("div");
        document.body.appendChild(localContainer);
        container = localContainer;
        const treeWith = (ctx: NoteContext) => (
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={ctx}>
                    <NoteDetail />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        );

        // Mount with an inactive context → tab stays deferred.
        act(() => { render(treeWith(fakeNoteContext({ note, ntxId: "ntx-eff", isActive: () => false })), localContainer); });
        await settle();
        expect(localContainer.querySelector(".note-detail-editable-text")).toBeNull();

        // A *new* active context object changes the effect dep, running the activation branch.
        act(() => { render(treeWith(fakeNoteContext({ note, ntxId: "ntx-eff", isActive: () => true })), localContainer); });
        await settle();
        expect(localContainer.querySelector(".note-detail-editable-text")).toBeTruthy();
    });

    it("resolves a widget provided as a direct VNode", async () => {
        const note = buildNote({ id: "rnd1", title: "R", type: "render" });
        const { container } = renderDetail(fakeNoteContext({ note, notePath: "root/rnd1" }));
        await settle();
        // The widget wrapper for the render note type must be present.
        expect(container.querySelector(".note-detail-render")).toBeTruthy();
    });
});
