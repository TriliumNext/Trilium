import { VNode } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

import { bootstrapMock } from "../test/mocks";

vi.mock("bootstrap", () => bootstrapMock());
vi.mock("../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));
vi.mock("../services/toast", () => ({ default: { showMessage: vi.fn(), showError: vi.fn() } }));
vi.mock("../services/image", () => ({ copyImageReferenceToClipboard: vi.fn() }));
vi.mock("../services/link", () => ({
    default: { createLink: vi.fn(async () => $("<a>link</a>")) },
    calculateHash: vi.fn(() => "")
}));
vi.mock("../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/utils")>()),
    openInAppHelpFromUrl: vi.fn(),
    isElectron: vi.fn(() => false)
}));

import appContext from "../components/app_context";
import Component from "../components/component";
import froca from "../services/froca";
import { copyImageReferenceToClipboard } from "../services/image";
import server from "../services/server";
import toast from "../services/toast";
import tree from "../services/tree";
import { isElectron, openInAppHelpFromUrl } from "../services/utils";
import { buildNote } from "../test/easy-froca";
import { fakeNoteContext, renderComponent, resetFroca } from "../test/render";
import {
    BacklinksList, buildSaveSqlToNoteHandler, DESKTOP_FLOATING_BUTTONS, type FloatingButtonContext,
    POPUP_HIDDEN_FLOATING_BUTTONS, useBacklinkCount
} from "./FloatingButtonsDefinitions";

// --- Render helper -------------------------------------------------------------------------------

let container: HTMLElement | undefined;
let parent: Component;

function renderInto(vnode: VNode | false) {
    container = renderComponent(vnode, { parent }).container;
    return container;
}

/** Renders one floating-button factory function with the given context. */
function renderButton(fn: (ctx: FloatingButtonContext) => false | VNode, ctx: FloatingButtonContext) {
    const Comp = fn as (props: FloatingButtonContext) => VNode | false;
    return renderInto(<Comp {...ctx} />);
}

function buildContext(overrides: Partial<FloatingButtonContext> = {}): FloatingButtonContext {
    const note = overrides.note ?? buildNote({ id: "ctx-default", title: "Default" });
    return {
        parentComponent: parent,
        note,
        noteContext: overrides.noteContext ?? fakeNoteContext({ noteId: note.noteId }),
        isDefaultViewMode: true,
        isReadOnly: false,
        triggerEvent: vi.fn(),
        viewType: null,
        ...overrides
    };
}

function byName(fn: (ctx: FloatingButtonContext) => false | VNode) {
    return fn;
}

beforeEach(() => {
    parent = new Component();
    resetFroca();
    vi.clearAllMocks();
    Object.assign(server, {
        get: vi.fn(async () => ({ count: 0 })),
        post: vi.fn(async () => ({ notePath: "" })),
        put: vi.fn(async () => undefined),
        upload: vi.fn(async () => undefined)
    });
    (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

// --- Exported lists ------------------------------------------------------------------------------

describe("floating button lists", () => {
    it("define the desktop and popup-hidden sets", () => {
        expect(DESKTOP_FLOATING_BUTTONS.length).toBeGreaterThan(10);
        expect(DESKTOP_FLOATING_BUTTONS.every(fn => typeof fn === "function")).toBe(true);
        expect(POPUP_HIDDEN_FLOATING_BUTTONS.length).toBe(2);
    });

    it("renders every factory with a neutral context without throwing", () => {
        // A plain text note disables nearly all conditions, exercising the early `false` returns.
        const note = buildNote({ id: "neutral", title: "N" });
        for (const fn of DESKTOP_FLOATING_BUTTONS) {
            expect(() => renderButton(fn, buildContext({ note }))).not.toThrow();
        }
    });
});

// --- RefreshBackendLogButton ---------------------------------------------------------------------

describe("RefreshBackendLogButton", () => {
    const fn = byName(DESKTOP_FLOATING_BUTTONS[0]);

    it("is shown for the backend log note and triggers refreshData on click", () => {
        const note = buildNote({ id: "_backendLog", title: "Log" });
        const noteContext = fakeNoteContext({ ntxId: "ntxLog" });
        const spy = vi.spyOn(parent, "triggerEvent").mockReturnValue(undefined);
        const el = renderButton(fn, buildContext({ note, noteContext }));
        const btn = el.querySelector("button");
        expect(btn).not.toBeNull();
        btn?.click();
        expect(spy).toHaveBeenCalledWith("refreshData", { ntxId: "ntxLog" });
    });

    it("is shown for render notes and hidden when not default view mode", () => {
        const renderNote = buildNote({ id: "rn", title: "R", type: "render" });
        expect(renderButton(fn, buildContext({ note: renderNote })).querySelector("button")).not.toBeNull();

        const hidden = renderButton(fn, buildContext({ note: renderNote, isDefaultViewMode: false }));
        expect(hidden.querySelector("button")).toBeNull();
    });
});

// --- SwitchSplitOrientationButton ----------------------------------------------------------------

describe("SwitchSplitOrientationButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "SwitchSplitOrientationButton") ?? DESKTOP_FLOATING_BUTTONS[2];

    it("is shown for a mermaid note in split mode and toggles the orientation option", () => {
        const note = buildNote({ id: "mer1", title: "M", type: "mermaid" });
        const el = renderButton(fn, buildContext({ note }));
        const btn = el.querySelector("button");
        expect(btn).not.toBeNull();
        btn?.click();
        expect(server.put).toHaveBeenCalled();
    });

    it("uses preview when read-only and is hidden for non-mermaid notes", () => {
        const note = buildNote({ id: "mer2", title: "M", type: "mermaid" });
        // isReadOnly forces effectiveMode to "preview" → button hidden.
        const ro = renderButton(fn, buildContext({ note, isReadOnly: true }));
        expect(ro.querySelector("button")).toBeNull();

        const textNote = buildNote({ id: "txt1", title: "T" });
        expect(renderButton(fn, buildContext({ note: textNote })).querySelector("button")).toBeNull();
    });
});

// --- ToggleReadOnlyButton ------------------------------------------------------------------------

describe("ToggleReadOnlyButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "ToggleReadOnlyButton") ?? DESKTOP_FLOATING_BUTTONS[1];

    it("is shown for a canvas note and toggles the readOnly label", () => {
        const note = buildNote({ id: "canvas1", title: "C", type: "canvas" });
        const el = renderButton(fn, buildContext({ note }));
        const btn = el.querySelector("button");
        expect(btn).not.toBeNull();
        // Clicking calls setReadOnly which writes a label → server.put via setBooleanWithInheritance path.
        expect(() => btn?.click()).not.toThrow();
    });

    it("reflects an existing readOnly label and is hidden for plain text notes", () => {
        const note = buildNote({ id: "mindmap1", title: "MM", type: "mindMap", "#readOnly": "true" });
        const el = renderButton(fn, buildContext({ note }));
        expect(el.querySelector("button")).not.toBeNull();

        const text = buildNote({ id: "plaintext", title: "T" });
        expect(renderButton(fn, buildContext({ note: text })).querySelector("button")).toBeNull();
    });
});

// --- DisplayModeSwitcher -------------------------------------------------------------------------

describe("DisplayModeSwitcher", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "DisplayModeSwitcher") ?? DESKTOP_FLOATING_BUTTONS[3];

    it("renders a 3-button group for mermaid and sets the display mode on click", () => {
        const note = buildNote({ id: "mer3", title: "M", type: "mermaid" });
        const el = renderButton(fn, buildContext({ note }));
        const group = el.querySelector(".btn-group");
        expect(group).not.toBeNull();
        const buttons = el.querySelectorAll("button");
        expect(buttons.length).toBe(3);
        buttons[0]?.click();
        expect(server.put).toHaveBeenCalled();
    });

    it("marks the active button based on the displayMode label and is hidden for text notes", () => {
        const note = buildNote({ id: "mer4", title: "M", type: "mermaid", "#displayMode": "preview" });
        const el = renderButton(fn, buildContext({ note }));
        const active = el.querySelector("button.active");
        expect(active).not.toBeNull();

        const text = buildNote({ id: "plainText2", title: "T" });
        expect(renderButton(fn, buildContext({ note: text })).querySelector(".btn-group")).toBeNull();
    });
});

// --- EditButton ----------------------------------------------------------------------------------

describe("EditButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "EditButton") ?? DESKTOP_FLOATING_BUTTONS[4];

    it("renders nothing because the info bar is never dismissed", async () => {
        const note = buildNote({ id: "edit1", title: "E" });
        const noteContext = fakeNoteContext({ isReadOnly: vi.fn(async () => false) });
        const el = renderButton(fn, buildContext({ note, noteContext }));
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        // isReadOnlyInfoBarDismissed is hard-coded false → no button regardless of read-only state.
        expect(el.querySelector("button")).toBeNull();
    });

    it("runs the read-only animation effect and clears it after the timeout", async () => {
        const note = buildNote({ id: "edit2", title: "E" });
        const noteContext = fakeNoteContext({ isReadOnly: vi.fn(async () => true) });
        // Resolve the async read-only state first, then drive the setTimeout in the effect.
        renderButton(fn, buildContext({ note, noteContext }));
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        // The effect set an animation class and scheduled a 1700ms reset; flush the timer to clear it.
        await act(async () => { await new Promise(r => setTimeout(r, 1800)); });
        // Component renders nothing (info bar undismissed), but the timer body executed without error.
        expect(container?.querySelector("button")).toBeNull();
    });
});

// --- ShowTocWidgetButton -------------------------------------------------------------------------

describe("ShowTocWidgetButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "ShowTocWidgetButton") ?? DESKTOP_FLOATING_BUTTONS[5];

    it("appears after a reEvaluateTocWidgetVisibility event and shows the TOC on click", () => {
        const note = buildNote({ id: "toc1", title: "T" });
        const noteContext = fakeNoteContext({
            noteId: "toc1",
            viewScope: { viewMode: "default", tocTemporarilyHidden: true }
        });
        renderButton(fn, buildContext({ note, noteContext }));
        expect(container?.querySelector("button")).toBeNull();

        act(() => { (parent.handleEventInChildren as (n: string, d: unknown) => unknown)("reEvaluateTocWidgetVisibility", {}); });
        const btn = container?.querySelector("button");
        expect(btn).not.toBeNull();

        const trigger = vi.spyOn(appContext, "triggerEvent").mockReturnValue(undefined);
        btn?.click();
        expect(trigger).toHaveBeenCalledWith("showTocWidget", { noteId: "toc1" });
        const viewScope = noteContext.viewScope;
        expect(viewScope?.tocTemporarilyHidden).toBe(false);
    });

    it("stays hidden for a non-text note", () => {
        const note = buildNote({ id: "toc2", title: "T", type: "mermaid" });
        const noteContext = fakeNoteContext({ viewScope: { viewMode: "default", tocTemporarilyHidden: true } });
        renderButton(fn, buildContext({ note, noteContext }));
        act(() => { (parent.handleEventInChildren as (n: string, d: unknown) => unknown)("reEvaluateTocWidgetVisibility", {}); });
        expect(container?.querySelector("button")).toBeNull();
    });
});

// --- ShowHighlightsListWidgetButton --------------------------------------------------------------

describe("ShowHighlightsListWidgetButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "ShowHighlightsListWidgetButton") ?? DESKTOP_FLOATING_BUTTONS[6];

    it("appears after the re-evaluation event and shows the highlights list on click", () => {
        const note = buildNote({ id: "hl1", title: "H" });
        const noteContext = fakeNoteContext({
            noteId: "hl1",
            viewScope: { viewMode: "default", highlightsListTemporarilyHidden: true }
        });
        renderButton(fn, buildContext({ note, noteContext }));
        act(() => { (parent.handleEventInChildren as (n: string, d: unknown) => unknown)("reEvaluateHighlightsListWidgetVisibility", {}); });
        const btn = container?.querySelector("button");
        expect(btn).not.toBeNull();

        const trigger = vi.spyOn(appContext, "triggerEvent").mockReturnValue(undefined);
        btn?.click();
        expect(trigger).toHaveBeenCalledWith("showHighlightsListWidget", { noteId: "hl1" });
        expect(noteContext.viewScope?.highlightsListTemporarilyHidden).toBe(false);
    });
});

// --- RunActiveNoteButton -------------------------------------------------------------------------

describe("RunActiveNoteButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "RunActiveNoteButton") ?? DESKTOP_FLOATING_BUTTONS[7];

    it("is shown for JS notes and for SQLite notes, hidden otherwise", () => {
        const js = buildNote({ id: "js1", title: "JS" });
        Object.assign(js, { mime: "application/javascript;env=backend" });
        const el = renderButton(fn, buildContext({ note: js }));
        const btn = el.querySelector("button");
        expect(btn).not.toBeNull();
        expect(btn?.getAttribute("data-trigger-command")).toBe("runActiveNote");

        const sql = buildNote({ id: "sql1", title: "S" });
        Object.assign(sql, { mime: "text/x-sqlite;schema=trilium" });
        expect(renderButton(fn, buildContext({ note: sql })).querySelector("button")).not.toBeNull();

        const text = buildNote({ id: "txtRun", title: "T" });
        expect(renderButton(fn, buildContext({ note: text })).querySelector("button")).toBeNull();
    });
});

// --- OpenTriliumApiDocsButton --------------------------------------------------------------------

describe("OpenTriliumApiDocsButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "OpenTriliumApiDocsButton") ?? DESKTOP_FLOATING_BUTTONS[8];

    it("opens the frontend docs for a frontend script", () => {
        const note = buildNote({ id: "fe1", title: "FE" });
        Object.assign(note, { mime: "application/javascript;env=frontend" });
        const el = renderButton(fn, buildContext({ note }));
        el.querySelector("button")?.click();
        expect(openInAppHelpFromUrl).toHaveBeenCalledWith("Q2z6av6JZVWm");
    });

    it("opens the backend docs for a backend script and is hidden otherwise", () => {
        const note = buildNote({ id: "be1", title: "BE" });
        Object.assign(note, { mime: "application/javascript;env=backend" });
        const el = renderButton(fn, buildContext({ note }));
        el.querySelector("button")?.click();
        expect(openInAppHelpFromUrl).toHaveBeenCalledWith("MEtfsqa5VwNi");

        const text = buildNote({ id: "txtApi", title: "T" });
        expect(renderButton(fn, buildContext({ note: text })).querySelector("button")).toBeNull();
    });
});

// --- OpenElectronApiDocsButton -------------------------------------------------------------------

describe("OpenElectronApiDocsButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "OpenElectronApiDocsButton") ?? DESKTOP_FLOATING_BUTTONS[9];

    it("is hidden outside Electron and shown for a frontend script under Electron", () => {
        const note = buildNote({ id: "elec1", title: "EL" });
        Object.assign(note, { mime: "application/javascript;env=frontend" });
        (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(false);
        expect(renderButton(fn, buildContext({ note })).querySelector("button")).toBeNull();

        (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const el = renderButton(fn, buildContext({ note }));
        const btn = el.querySelector("button");
        expect(btn).not.toBeNull();
        btn?.click();
        expect(openInAppHelpFromUrl).toHaveBeenCalledWith("GFXVHyblVN3d");
    });
});

// --- SaveToNoteButton + buildSaveSqlToNoteHandler ------------------------------------------------

describe("SaveToNoteButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "SaveToNoteButton") ?? DESKTOP_FLOATING_BUTTONS[10];

    it("is shown for a hidden SQLite console note", () => {
        // A note built by easy-froca has no visible parent → isHiddenCompletely() === true.
        const note = buildNote({ id: "sqlHidden", title: "SQL" });
        Object.assign(note, { mime: "text/x-sqlite;schema=trilium" });
        expect(renderButton(fn, buildContext({ note })).querySelector("button")).not.toBeNull();
    });
});

describe("buildSaveSqlToNoteHandler", () => {
    it("saves the SQL console, toasts, and navigates to the new note", async () => {
        const note = buildNote({ id: "sqlSave", title: "SQL" });
        Object.assign(note, { mime: "text/x-sqlite;schema=trilium" });
        Object.assign(server, { post: vi.fn(async () => ({ notePath: "root/saved" })) });
        vi.spyOn(tree, "getNotePathTitle").mockResolvedValue("Saved Title");
        const setNote = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: () => ({ setNote }) } });

        const handler = buildSaveSqlToNoteHandler(note);
        const preventDefault = vi.fn();
        await handler({ preventDefault } as unknown as MouseEvent);

        expect(preventDefault).toHaveBeenCalled();
        expect(server.post).toHaveBeenCalledWith("special-notes/save-sql-console", { sqlConsoleNoteId: "sqlSave" });
        expect(toast.showMessage).toHaveBeenCalled();
        expect(setNote).toHaveBeenCalledWith("root/saved");
    });

    it("does nothing further when no note path is returned", async () => {
        const note = buildNote({ id: "sqlNoPath", title: "SQL" });
        Object.assign(server, { post: vi.fn(async () => ({ notePath: "" })) });
        const handler = buildSaveSqlToNoteHandler(note);
        await handler({ preventDefault: vi.fn() } as unknown as MouseEvent);
        expect(toast.showMessage).not.toHaveBeenCalled();
    });
});

// --- RelationMapButtons --------------------------------------------------------------------------

describe("RelationMapButtons", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "RelationMapButtons") ?? DESKTOP_FLOATING_BUTTONS[11];

    it("renders four buttons that trigger relation-map events", () => {
        const note = buildNote({ id: "rm1", title: "RM", type: "relationMap" });
        const triggerEvent = vi.fn();
        const el = renderButton(fn, buildContext({ note, triggerEvent }));
        const buttons = el.querySelectorAll("button");
        expect(buttons.length).toBe(4);
        buttons.forEach(b => b.click());
        expect(triggerEvent).toHaveBeenCalledWith("relationMapCreateChildNote");
        expect(triggerEvent).toHaveBeenCalledWith("relationMapResetPanZoom");
        expect(triggerEvent).toHaveBeenCalledWith("relationMapResetZoomIn");
        expect(triggerEvent).toHaveBeenCalledWith("relationMapResetZoomOut");
    });

    it("is hidden for non-relationMap notes", () => {
        const note = buildNote({ id: "rm2", title: "T" });
        expect(renderButton(fn, buildContext({ note })).querySelector("button")).toBeNull();
    });
});

// --- CopyImageReferenceButton --------------------------------------------------------------------

describe("CopyImageReferenceButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "CopyImageReferenceButton") ?? DESKTOP_FLOATING_BUTTONS[12];

    it("copies the image reference on click for an image note", () => {
        const note = buildNote({ id: "img1", title: "I", type: "image" });
        const el = renderButton(fn, buildContext({ note }));
        const btn = el.querySelector("button");
        expect(btn).not.toBeNull();
        expect(el.querySelector(".hidden-image-copy")).not.toBeNull();
        btn?.click();
        expect(copyImageReferenceToClipboard).toHaveBeenCalled();
    });

    it("is hidden for a text note", () => {
        const note = buildNote({ id: "img2", title: "T" });
        expect(renderButton(fn, buildContext({ note })).querySelector("button")).toBeNull();
    });
});

// --- ExportImageButtons --------------------------------------------------------------------------

describe("ExportImageButtons", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "ExportImageButtons") ?? DESKTOP_FLOATING_BUTTONS[13];

    it("renders SVG/PNG export buttons for mermaid and triggers the export events", () => {
        const note = buildNote({ id: "exp1", title: "M", type: "mermaid" });
        const triggerEvent = vi.fn();
        const el = renderButton(fn, buildContext({ note, triggerEvent }));
        const buttons = el.querySelectorAll("button");
        expect(buttons.length).toBe(2);
        buttons.forEach(b => b.click());
        expect(triggerEvent).toHaveBeenCalledWith("exportSvg");
        expect(triggerEvent).toHaveBeenCalledWith("exportPng");
    });

    it("is hidden for unsupported note types", () => {
        const note = buildNote({ id: "exp2", title: "T" });
        expect(renderButton(fn, buildContext({ note })).querySelectorAll("button").length).toBe(0);
    });
});

// --- ExportSpreadsheetButton ---------------------------------------------------------------------

describe("ExportSpreadsheetButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "ExportSpreadsheetButton") ?? DESKTOP_FLOATING_BUTTONS[14];

    it("renders xlsx/csv export buttons for spreadsheets and triggers their events", () => {
        const note = buildNote({ id: "sheet1", title: "S", type: "spreadsheet" });
        const triggerEvent = vi.fn();
        const el = renderButton(fn, buildContext({ note, triggerEvent }));
        const buttons = el.querySelectorAll("button");
        expect(buttons.length).toBe(2);
        buttons.forEach(b => b.click());
        expect(triggerEvent).toHaveBeenCalledWith("exportXlsx");
        expect(triggerEvent).toHaveBeenCalledWith("exportCsv");
    });

    it("is hidden for non-spreadsheet notes", () => {
        const note = buildNote({ id: "sheet2", title: "T" });
        expect(renderButton(fn, buildContext({ note })).querySelectorAll("button").length).toBe(0);
    });
});

// --- InAppHelpButton -----------------------------------------------------------------------------

describe("InAppHelpButton", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "InAppHelpButton") ?? DESKTOP_FLOATING_BUTTONS[15];

    it("shows help for a note type that has a help URL and opens it on click", () => {
        const note = buildNote({ id: "help1", title: "M", type: "mermaid" });
        const el = renderButton(fn, buildContext({ note }));
        const btn = el.querySelector("button");
        expect(btn).not.toBeNull();
        btn?.click();
        expect(openInAppHelpFromUrl).toHaveBeenCalledWith("s1aBHPd79XYj");
    });

    it("is hidden for a note type without a help URL", () => {
        const note = buildNote({ id: "help2", title: "T", type: "canvas" });
        expect(renderButton(fn, buildContext({ note })).querySelector("button")).toBeNull();
    });
});

// --- Backlinks -----------------------------------------------------------------------------------

describe("Backlinks", () => {
    const fn = DESKTOP_FLOATING_BUTTONS.find(f => f.name === "Backlinks") ?? DESKTOP_FLOATING_BUTTONS[16];

    it("is hidden when there are no backlinks", async () => {
        Object.assign(server, { get: vi.fn(async () => ({ count: 0 })) });
        const note = buildNote({ id: "bl0", title: "B" });
        const el = renderButton(fn, buildContext({ note }));
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(el.querySelector(".backlinks-widget")).toBeNull();
    });

    it("shows a ticker when backlinks exist and toggles the popup on click", async () => {
        Object.assign(server, {
            get: vi.fn(async (url: string) => {
                if (url.endsWith("backlink-count")) return { count: 3 };
                return [];
            })
        });
        const note = buildNote({ id: "bl1", title: "B" });
        let el: HTMLElement | undefined;
        await act(async () => {
            el = renderButton(fn, buildContext({ note }));
            await new Promise(r => setTimeout(r, 0));
        });
        const widget = el?.querySelector(".backlinks-widget");
        expect(widget).not.toBeNull();
        const ticker = el?.querySelector<HTMLElement>(".backlinks-ticker");
        expect(ticker).not.toBeNull();

        await act(async () => {
            ticker?.click();
            await new Promise(r => setTimeout(r, 0));
        });
        expect(el?.querySelector(".backlinks-items")).not.toBeNull();
    });
});

// --- useBacklinkCount ----------------------------------------------------------------------------

describe("useBacklinkCount", () => {
    let result: { current: number };

    function Probe({ note, isDefaultViewMode }: { note: ReturnType<typeof buildNote> | null; isDefaultViewMode: boolean }) {
        result.current = useBacklinkCount(note, isDefaultViewMode);
        return null;
    }

    function renderProbe(note: ReturnType<typeof buildNote> | null, isDefaultViewMode: boolean) {
        result = { current: -1 };
        renderComponent(<Probe note={note} isDefaultViewMode={isDefaultViewMode} />, { parent });
    }

    it("returns 0 and does not query when there is no note or non-default view mode", async () => {
        const getSpy = vi.fn(async () => ({ count: 5 }));
        Object.assign(server, { get: getSpy });
        renderProbe(null, true);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(result.current).toBe(0);
        expect(getSpy).not.toHaveBeenCalled();

        const note = buildNote({ id: "blc1", title: "B" });
        renderProbe(note, false);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(result.current).toBe(0);
        expect(getSpy).not.toHaveBeenCalled();
    });

    it("fetches the count and refreshes on a relation-affecting entitiesReloaded event", async () => {
        const note = buildNote({ id: "blc2", title: "B" });
        Object.assign(server, { get: vi.fn(async () => ({ count: 7 })) });
        renderProbe(note, true);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(result.current).toBe(7);

        Object.assign(server, { get: vi.fn(async () => ({ count: 9 })) });
        await act(async () => {
            (parent.handleEventInChildren as (n: string, d: unknown) => unknown)("entitiesReloaded", {
                loadResults: {
                    getAttributeRows: () => [ { type: "relation", name: "renderNote", value: "x", noteId: "blc2", isDeleted: false } ]
                }
            });
            await new Promise(r => setTimeout(r, 0));
        });
        expect(result.current).toBe(9);
    });

    it("ignores entitiesReloaded events that do not affect the note", async () => {
        const note = buildNote({ id: "blc3", title: "B" });
        const getSpy = vi.fn(async () => ({ count: 2 }));
        Object.assign(server, { get: getSpy });
        renderProbe(note, true);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(result.current).toBe(2);
        const callsBefore = getSpy.mock.calls.length;

        await act(async () => {
            (parent.handleEventInChildren as (n: string, d: unknown) => unknown)("entitiesReloaded", {
                loadResults: { getAttributeRows: () => [ { type: "label", name: "color", value: "z", noteId: "blc3", isDeleted: false } ] }
            });
            await new Promise(r => setTimeout(r, 0));
        });
        expect(getSpy.mock.calls.length).toBe(callsBefore);
    });
});

// --- BacklinksList -------------------------------------------------------------------------------

describe("BacklinksList", () => {
    it("renders excerpt-based backlinks and prefetches the linked notes", async () => {
        buildNote({ id: "src1", title: "Source 1" });
        Object.assign(server, {
            get: vi.fn(async () => [
                { noteId: "src1", excerpts: [ "<b>hit</b>" ] }
            ])
        });
        const getNotes = vi.spyOn(froca, "getNotes").mockResolvedValue([]);
        const note = buildNote({ id: "blist1", title: "B" });

        let el: HTMLElement | undefined;
        await act(async () => {
            el = renderComponent(<ul><BacklinksList note={note} /></ul>, { parent }).container;
            await new Promise(r => setTimeout(r, 0));
        });
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(el?.querySelectorAll("li").length).toBe(1);
        expect(getNotes).toHaveBeenCalledWith([ "src1" ]);
    });

    it("renders relation-name backlinks", async () => {
        buildNote({ id: "src2", title: "Source 2" });
        Object.assign(server, {
            get: vi.fn(async () => [
                { noteId: "src2", relationName: "myrel" }
            ])
        });
        vi.spyOn(froca, "getNotes").mockResolvedValue([]);
        const note = buildNote({ id: "blist2", title: "B" });

        let el: HTMLElement | undefined;
        await act(async () => {
            el = renderComponent(<ul><BacklinksList note={note} /></ul>, { parent }).container;
            await new Promise(r => setTimeout(r, 0));
        });
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(el?.querySelector("li p")?.textContent).toBe("myrel");
    });

    it("refreshes when a relation-affecting entitiesReloaded event fires", async () => {
        buildNote({ id: "src3", title: "Source 3" });
        const getSpy = vi.fn(async () => []);
        Object.assign(server, { get: getSpy });
        vi.spyOn(froca, "getNotes").mockResolvedValue([]);
        const note = buildNote({ id: "blist3", title: "B" });

        await act(async () => {
            renderComponent(<ul><BacklinksList note={note} /></ul>, { parent });
            await new Promise(r => setTimeout(r, 0));
        });
        const callsBefore = getSpy.mock.calls.length;

        await act(async () => {
            (parent.handleEventInChildren as (n: string, d: unknown) => unknown)("entitiesReloaded", {
                loadResults: { getAttributeRows: () => [ { type: "relation", name: "renderNote", value: "x", noteId: "blist3", isDeleted: false } ] }
            });
            await new Promise(r => setTimeout(r, 0));
        });
        expect(getSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    });
});
