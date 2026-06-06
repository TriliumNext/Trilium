import { ComponentChild, ComponentChildren } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../test/mocks";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => bootstrapMock());

vi.mock("../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));

// Keep parseColor/createClassForColor real, but route getHue through a spy so a single test
// can force it to throw and exercise the catch branch in getWorkspaceTabBackgroundColorHue.
vi.mock("../../services/css_class_manager", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../services/css_class_manager")>();
    return { ...actual, getHue: vi.fn(actual.getHue) };
});

// Captures the contextMenu.show config so the title-bar "more options" handler can be exercised.
const contextMenuShow = vi.fn();
vi.mock("../../menus/context_menu", () => ({
    default: { show: (config: unknown) => contextMenuShow(config) }
}));

// NoteContent pulls in content_renderer and a module-level ResizeObserver; stub it out.
vi.mock("../collections/legacy/ListOrGridView", () => ({
    NoteContent: ({ note }: { note: { noteId: string } }) => (
        <div className="mock-note-content" data-note-id={note.noteId} />
    )
}));

// Render the real Modal contents inline so the modal callbacks/title bar/footer are reachable
// without bootstrap. `show` still gates the children mount, mirroring the real Modal.
vi.mock("../react/Modal", () => ({
    default: ({ children, className, title, customTitleBarButtons, footer, show, onShown, onHidden }: {
        children: ComponentChildren;
        className: string;
        title: ComponentChildren;
        customTitleBarButtons?: ({ iconClassName: string; title: string; onClick: (e: MouseEvent) => void } | null)[];
        footer: ComponentChildren;
        show: boolean;
        onShown?: () => void;
        onHidden: () => void;
    }) => (
        <div className={`modal ${className}`} data-shown={String(show)} role="dialog">
            <div className="modal-title">{title}</div>
            <button className="mock-on-shown" onClick={() => onShown?.()} />
            <button className="mock-on-hidden" onClick={() => onHidden()} />
            {customTitleBarButtons?.filter(b => b !== null).map(b => (
                <button
                    className={`mock-title-bar-button ${b.iconClassName}`}
                    onClick={(e) => b.onClick(e as unknown as MouseEvent)}
                />
            ))}
            {show && <div className="modal-body">{children}</div>}
            <div className="modal-footer">{footer}</div>
        </div>
    )
}));

import { act } from "preact/test-utils";

import appContext from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import { getHue } from "../../services/css_class_manager";
import keyboard_actions from "../../services/keyboard_actions";
import { buildNote } from "../../test/easy-froca";
import { fakeNoteContext, renderComponent, resetFroca } from "../../test/render";
import Component from "../../components/component";
import TabSwitcher from "./TabSwitcher";

// --- Helpers --------------------------------------------------------------------------------------

let currentParent: Component | undefined;

/** Renders through the shared helper (ParentComponent wrapper + auto-teardown) and captures the
 * parent so `fireTriliumEvent` can dispatch events into the rendered tree. */
function renderInto(vnode: ComponentChild) {
    const { container, parent } = renderComponent(vnode);
    currentParent = parent;
    return container;
}

/** Dispatches a Trilium event through the ParentComponent rendered by the last `renderInto`. */
function fireTriliumEvent(name: string, data: unknown) {
    const parent = currentParent;
    if (parent) {
        act(() => { (parent.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data); });
    }
}

/** Minimal NoteContext-shaped object; only the fields TabSwitcher reads are implemented. */
function fakeContext(overrides: Partial<Record<string, unknown>> = {}): NoteContext {
    const base = fakeNoteContext({
        note: null,
        hoistedNoteId: null,
        mainNtxId: null,
        viewScope: { viewMode: "default" },
        isMainContext() { return !(base as Record<string, unknown>).mainNtxId; },
        getSubContexts() { return [ base ]; },
        getNavigationTitle: vi.fn(async () => null)
    }) as unknown as Record<string, unknown>;
    Object.assign(base, overrides);
    return base as unknown as NoteContext;
}

function setTabManager(opts: {
    mainNoteContexts?: NoteContext[];
    activeContext?: NoteContext | null;
    recentlyClosedTabs?: unknown[];
} = {}) {
    const activate = vi.fn();
    const remove = vi.fn();
    Object.assign(appContext, {
        tabManager: {
            getMainNoteContexts: () => opts.mainNoteContexts ?? [],
            getActiveContext: () => opts.activeContext ?? null,
            activateNoteContext: activate,
            removeNoteContext: remove,
            recentlyClosedTabs: opts.recentlyClosedTabs ?? []
        }
    });
    return { activate, remove };
}

function launcherNote() {
    return buildNote({ id: "launcher1", title: "Tabs", type: "launcher", "#iconClass": "bx bx-rectangle" });
}

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    (keyboard_actions.getAction as ReturnType<typeof vi.fn>).mockResolvedValue({ effectiveShortcuts: [] });
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });
});

afterEach(() => {
    // Remove any portals left appended to document.body (the shared teardown unmounts the owning
    // tree, but guard against a stray portal if a test threw before unmount).
    for (const el of Array.from(document.body.querySelectorAll(".tab-bar-modal"))) {
        el.remove();
    }
});

// --- Tests ----------------------------------------------------------------------------------------

describe("TabSwitcher launcher button", () => {
    it("renders the launch-bar button with a numeric tab count and opens the modal on click", () => {
        const ctx = fakeContext({ ntxId: "a" });
        setTabManager({ mainNoteContexts: [ ctx ], activeContext: ctx });
        renderInto(<TabSwitcher launcherNote={launcherNote()} />);

        const button = document.querySelector(".mobile-tab-switcher");
        expect(button).toBeTruthy();
        expect(button?.getAttribute("data-tab-count")).toBe("1");

        // Modal starts hidden (body not mounted).
        const modal = document.querySelector(".tab-bar-modal");
        expect(modal?.getAttribute("data-shown")).toBe("false");
        expect(document.querySelector(".tab-bar-modal .modal-body")).toBeNull();

        // Clicking the launcher shows the modal.
        act(() => { (button as HTMLElement).click(); });
        expect(document.querySelector(".tab-bar-modal")?.getAttribute("data-shown")).toBe("true");
    });

    it("caps the tab count display at infinity when over 99 tabs", () => {
        const contexts = Array.from({ length: 100 }, (_, i) => fakeContext({ ntxId: `c${i}` }));
        setTabManager({ mainNoteContexts: contexts });
        renderInto(<TabSwitcher launcherNote={launcherNote()} />);
        expect(document.querySelector(".mobile-tab-switcher")?.getAttribute("data-tab-count")).toBe("∞");
    });

    it("updates the tab count when a note context is created and removed", () => {
        const first = fakeContext({ ntxId: "a" });
        setTabManager({ mainNoteContexts: [ first ] });
        renderInto(<TabSwitcher launcherNote={launcherNote()} />);
        expect(document.querySelector(".mobile-tab-switcher")?.getAttribute("data-tab-count")).toBe("1");

        // Mutate the manager to return more contexts, then fire the Trilium event the hook listens to.
        setTabManager({ mainNoteContexts: [ first, fakeContext({ ntxId: "b" }) ] });
        fireTriliumEvent("newNoteContextCreated", {});
        expect(document.querySelector(".mobile-tab-switcher")?.getAttribute("data-tab-count")).toBe("2");

        // And it reacts to removal too (a different event the hook also subscribes to).
        setTabManager({ mainNoteContexts: [ first ] });
        fireTriliumEvent("noteContextRemoved", {});
        expect(document.querySelector(".mobile-tab-switcher")?.getAttribute("data-tab-count")).toBe("1");
    });
});

describe("TabBarModal content", () => {
    function renderShown(opts: {
        mainNoteContexts: NoteContext[];
        activeContext?: NoteContext | null;
        recentlyClosedTabs?: unknown[];
    }) {
        const managed = setTabManager(opts);
        const root = renderInto(<TabSwitcher launcherNote={launcherNote()} />);
        act(() => { (document.querySelector(".mobile-tab-switcher") as HTMLElement).click(); });
        // Trigger onShown so the inner content marks itself as fully shown.
        act(() => { (document.querySelector(".mock-on-shown") as HTMLElement).click(); });
        return { root, managed };
    }

    it("renders a tab card per context, marks the active one, and selects on click", () => {
        const note = buildNote({ id: "n1", title: "Note One", "#iconClass": "bx bx-note" });
        const active = fakeContext({ ntxId: "a", note });
        active.getSubContexts = () => [ active ];
        const other = fakeContext({ ntxId: "b", note: null });
        other.getSubContexts = () => [ other ];
        const { managed } = renderShown({ mainNoteContexts: [ active, other ], activeContext: active });

        const cards = document.querySelectorAll(".tab-bar-modal .tab-card");
        expect(cards.length).toBe(2);
        expect(cards[0].classList.contains("active")).toBe(true);
        expect(cards[1].classList.contains("active")).toBe(false);

        act(() => { (cards[1] as HTMLElement).click(); });
        expect(managed.activate).toHaveBeenCalledWith("b");
    });

    it("renders a split tab with the with-split class for multiple sub-contexts", () => {
        const noteA = buildNote({ id: "sa", title: "Split A" });
        const noteB = buildNote({ id: "sb", title: "Split B" });
        const main = fakeContext({ ntxId: "main", note: noteA });
        const sub = fakeContext({ ntxId: "sub", note: noteB, mainNtxId: "main" });
        main.getSubContexts = () => [ main, sub ];
        renderShown({ mainNoteContexts: [ main ], activeContext: main });

        const card = document.querySelector(".tab-bar-modal .tab-card");
        expect(card?.classList.contains("with-split")).toBe(true);
        // Two headers rendered (one per sub-context).
        expect(document.querySelectorAll(".tab-bar-modal .tab-card header").length).toBe(2);
    });

    it("closes the tab via the header close button on a main context without selecting it", () => {
        const note = buildNote({ id: "cn", title: "Closable" });
        const ctx = fakeContext({ ntxId: "close-me", note });
        ctx.getSubContexts = () => [ ctx ];
        const { managed } = renderShown({ mainNoteContexts: [ ctx ], activeContext: ctx });

        const closeButton = document.querySelector(".tab-bar-modal .tab-card header button");
        expect(closeButton).toBeTruthy();
        act(() => { (closeButton as HTMLElement).click(); });
        expect(managed.remove).toHaveBeenCalledWith("close-me");
        // stopPropagation prevented tab selection.
        expect(managed.activate).not.toHaveBeenCalled();
    });

    it("does not render a close button for non-main sub-contexts", () => {
        const noteA = buildNote({ id: "ma", title: "Main" });
        const noteB = buildNote({ id: "mb", title: "Sub" });
        const main = fakeContext({ ntxId: "m", note: noteA });
        const sub = fakeContext({ ntxId: "s", note: noteB, mainNtxId: "m" });
        main.getSubContexts = () => [ main, sub ];
        renderShown({ mainNoteContexts: [ main ], activeContext: main });

        // Only the main context renders a close button → exactly one.
        expect(document.querySelectorAll(".tab-bar-modal .tab-card header button").length).toBe(1);
    });
});

describe("TabPreviewContent variants", () => {
    function renderShownWith(ctx: NoteContext) {
        setTabManager({ mainNoteContexts: [ ctx ], activeContext: ctx });
        renderInto(<TabSwitcher launcherNote={launcherNote()} />);
        act(() => { (document.querySelector(".mobile-tab-switcher") as HTMLElement).click(); });
        act(() => { (document.querySelector(".mock-on-shown") as HTMLElement).click(); });
    }

    it("renders the empty placeholder when the context has no note", () => {
        const ctx = fakeContext({ ntxId: "empty", note: null });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);

        const preview = document.querySelector(".tab-bar-modal .tab-preview");
        expect(preview?.classList.contains("type-empty")).toBe(true);
        expect(preview?.classList.contains("tab-preview-placeholder")).toBe(true);
        expect(preview?.querySelector(".preview-placeholder .bx-plus")).toBeTruthy();
    });

    it("renders a book placeholder using the viewType icon mapping", () => {
        const book = buildNote({ id: "book1", title: "Board", type: "book", "#viewType": "board" });
        const ctx = fakeContext({ ntxId: "book", note: book });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);

        const preview = document.querySelector(".tab-bar-modal .tab-preview");
        expect(preview?.classList.contains("type-book")).toBe(true);
        expect(preview?.querySelector(".bx-columns")).toBeTruthy();
    });

    it("falls back to the book icon when the book has no recognized viewType", () => {
        const book = buildNote({ id: "book2", title: "Plain Book", type: "book" });
        const ctx = fakeContext({ ntxId: "book2ctx", note: book });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);
        expect(document.querySelector(".tab-bar-modal .tab-preview .bx-book")).toBeTruthy();
    });

    it("renders a view-mode placeholder when not in default view", () => {
        const note = buildNote({ id: "vm", title: "Sourced" });
        const ctx = fakeContext({ ntxId: "vm", note, viewScope: { viewMode: "source" } });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);
        expect(document.querySelector(".tab-bar-modal .tab-preview .bx-code")).toBeTruthy();
    });

    it("falls back to the empty icon for an unmapped view mode", () => {
        const note = buildNote({ id: "vm2", title: "Weird" });
        const ctx = fakeContext({ ntxId: "vm2", note, viewScope: { viewMode: "totally-unknown" } });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);
        expect(document.querySelector(".tab-bar-modal .tab-preview .bx-empty")).toBeTruthy();
    });

    it("renders the actual note content for a normal text note", () => {
        const note = buildNote({ id: "tc", title: "Text Content" });
        const ctx = fakeContext({ ntxId: "tc", note });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);

        const preview = document.querySelector(".tab-bar-modal .tab-preview");
        expect(preview?.classList.contains("type-text")).toBe(true);
        expect(preview?.classList.contains("tab-preview-placeholder")).toBe(false);
        expect(preview?.querySelector(".mock-note-content")?.getAttribute("data-note-id")).toBe("tc");
    });
});

describe("TabHeader title resolution", () => {
    function renderShownWith(ctx: NoteContext) {
        setTabManager({ mainNoteContexts: [ ctx ], activeContext: ctx });
        renderInto(<TabSwitcher launcherNote={launcherNote()} />);
        act(() => { (document.querySelector(".mobile-tab-switcher") as HTMLElement).click(); });
        act(() => { (document.querySelector(".mock-on-shown") as HTMLElement).click(); });
    }

    it("uses the resolved navigation title when available", async () => {
        const note = buildNote({ id: "navn", title: "Raw Title" });
        const ctx = fakeContext({ ntxId: "navctx", note, getNavigationTitle: vi.fn(async () => "Resolved Nav") });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);
        await act(async () => { await Promise.resolve(); });

        expect(document.querySelector(".tab-bar-modal .tab-card header .title")?.textContent).toBe("Resolved Nav");
    });

    it("falls back to the note title when no navigation title resolves", async () => {
        const note = buildNote({ id: "fbn", title: "Fallback Title" });
        const ctx = fakeContext({ ntxId: "fbctx", note, getNavigationTitle: vi.fn(async () => null) });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);
        await act(async () => { await Promise.resolve(); });

        expect(document.querySelector(".tab-bar-modal .tab-card header .title")?.textContent).toBe("Fallback Title");
    });
});

describe("workspace tab background colour hue", () => {
    function renderShownWith(ctx: NoteContext) {
        setTabManager({ mainNoteContexts: [ ctx ], activeContext: ctx });
        renderInto(<TabSwitcher launcherNote={launcherNote()} />);
        act(() => { (document.querySelector(".mobile-tab-switcher") as HTMLElement).click(); });
        act(() => { (document.querySelector(".mock-on-shown") as HTMLElement).click(); });
    }

    it("applies the with-hue class when the hoisted note defines a coloured workspace background", () => {
        buildNote({ id: "hoisted-col", title: "Workspace", "#workspaceTabBackgroundColor": "#ff0000" });
        const note = buildNote({ id: "hued", title: "Hued" });
        const ctx = fakeContext({ ntxId: "hue", note, hoistedNoteId: "hoisted-col" });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);

        expect(document.querySelector(".tab-bar-modal .tab-card")?.classList.contains("with-hue")).toBe(true);
    });

    it("does not apply with-hue for a grayscale workspace colour", () => {
        buildNote({ id: "hoisted-gray", title: "Gray WS", "#workspaceTabBackgroundColor": "#808080" });
        const note = buildNote({ id: "gray", title: "Gray" });
        const ctx = fakeContext({ ntxId: "gray", note, hoistedNoteId: "hoisted-gray" });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);
        expect(document.querySelector(".tab-bar-modal .tab-card")?.classList.contains("with-hue")).toBe(false);
    });

    it("ignores the hue when there is no hoisted note", () => {
        const note = buildNote({ id: "noho", title: "No Hoist" });
        const ctx = fakeContext({ ntxId: "noho", note, hoistedNoteId: null });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);
        expect(document.querySelector(".tab-bar-modal .tab-card")?.classList.contains("with-hue")).toBe(false);
    });

    it("ignores the hue when the hoisted note is not in the cache", () => {
        const note = buildNote({ id: "missho", title: "Missing Hoist" });
        const ctx = fakeContext({ ntxId: "missho", note, hoistedNoteId: "does-not-exist" });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);
        expect(document.querySelector(".tab-bar-modal .tab-card")?.classList.contains("with-hue")).toBe(false);
    });

    it("swallows parse errors from an invalid workspace colour", () => {
        buildNote({ id: "hoisted-bad", title: "Bad WS", "#workspaceTabBackgroundColor": "not-a-color" });
        const note = buildNote({ id: "badcol", title: "Bad" });
        const ctx = fakeContext({ ntxId: "badcol", note, hoistedNoteId: "hoisted-bad" });
        ctx.getSubContexts = () => [ ctx ];
        renderShownWith(ctx);
        expect(document.querySelector(".tab-bar-modal .tab-card")?.classList.contains("with-hue")).toBe(false);
    });

    it("swallows errors thrown while computing the hue", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const hueSpy = getHue as ReturnType<typeof vi.fn>;
        const realGetHue = hueSpy.getMockImplementation();
        hueSpy.mockImplementation(() => { throw new Error("hue boom"); });
        try {
            buildNote({ id: "hoisted-throw", title: "Throwing WS", "#workspaceTabBackgroundColor": "#ff0000" });
            const note = buildNote({ id: "throwcol", title: "Throw" });
            const ctx = fakeContext({ ntxId: "throwcol", note, hoistedNoteId: "hoisted-throw" });
            ctx.getSubContexts = () => [ ctx ];
            renderShownWith(ctx);

            expect(warn).toHaveBeenCalled();
            expect(document.querySelector(".tab-bar-modal .tab-card")?.classList.contains("with-hue")).toBe(false);
        } finally {
            if (realGetHue) {
                hueSpy.mockImplementation(realGetHue);
            } else {
                hueSpy.mockReset();
            }
        }
    });
});

describe("modal footer and title bar actions", () => {
    function renderShown(opts: { recentlyClosedTabs?: unknown[] } = {}) {
        const ctx = fakeContext({ ntxId: "a" });
        ctx.getSubContexts = () => [ ctx ];
        const managed = setTabManager({ mainNoteContexts: [ ctx ], activeContext: ctx, recentlyClosedTabs: opts.recentlyClosedTabs });
        const trigger = vi.fn();
        Object.assign(appContext, { triggerCommand: trigger });
        renderInto(<TabSwitcher launcherNote={launcherNote()} />);
        act(() => { (document.querySelector(".mobile-tab-switcher") as HTMLElement).click(); });
        act(() => { (document.querySelector(".mock-on-shown") as HTMLElement).click(); });
        return { managed, trigger };
    }

    it("the footer new-tab link triggers openNewTab and hides the modal", () => {
        const { trigger } = renderShown();
        const link = document.querySelector(".tab-bar-modal .modal-footer .tn-link");
        expect(link).toBeTruthy();
        act(() => { (link as HTMLElement).click(); });
        expect(trigger).toHaveBeenCalledWith("openNewTab");
        expect(document.querySelector(".tab-bar-modal")?.getAttribute("data-shown")).toBe("false");
    });

    it("the more-options title bar button opens a context menu whose handler triggers commands", () => {
        renderShown({ recentlyClosedTabs: [ { contexts: [] } ] });
        const moreButton = document.querySelector(".tab-bar-modal .mock-title-bar-button");
        expect(moreButton).toBeTruthy();
        act(() => { (moreButton as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });

        expect(contextMenuShow).toHaveBeenCalledTimes(1);
        const config = contextMenuShow.mock.calls[0][0] as {
            items: { command?: string; enabled?: boolean; kind?: string }[];
            selectMenuItemHandler: (item: { command?: string }) => void;
        };
        // reopenLastTab is enabled because there is a recently closed tab.
        const reopen = config.items.find(i => i.command === "reopenLastTab");
        expect(reopen?.enabled).toBe(true);

        const trigger = appContext.triggerCommand as ReturnType<typeof vi.fn>;
        config.selectMenuItemHandler({ command: "openNewTab" });
        expect(trigger).toHaveBeenCalledWith("openNewTab");

        // No command → handler is a no-op.
        trigger.mockClear();
        config.selectMenuItemHandler({});
        expect(trigger).not.toHaveBeenCalled();
    });

    it("disables reopen-last-tab when there are no recently closed tabs", () => {
        renderShown({ recentlyClosedTabs: [] });
        const moreButton = document.querySelector(".tab-bar-modal .mock-title-bar-button");
        act(() => { (moreButton as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        const config = contextMenuShow.mock.calls[0][0] as { items: { command?: string; enabled?: boolean }[] };
        expect(config.items.find(i => i.command === "reopenLastTab")?.enabled).toBe(false);
    });

    it("the modal onHidden callback resets the shown state", () => {
        renderShown();
        expect(document.querySelector(".tab-bar-modal")?.getAttribute("data-shown")).toBe("true");
        act(() => { (document.querySelector(".tab-bar-modal .mock-on-hidden") as HTMLElement).click(); });
        expect(document.querySelector(".tab-bar-modal")?.getAttribute("data-shown")).toBe("false");
    });
});
