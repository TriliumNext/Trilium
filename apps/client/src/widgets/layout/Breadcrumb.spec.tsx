import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static getOrCreateInstance() { return new Dropdown(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
        update() {}
        dispose() {}
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});
vi.mock("../../services/math", () => ({ default: { render: vi.fn() } }));
vi.mock("../../services/keyboard_actions", () => ({
    default: {
        getAction: vi.fn(async () => ({ effectiveShortcuts: [ "ctrl+k" ] })),
        setupActionsForElement: vi.fn(async () => [])
    }
}));

// Render the Dropdown's children eagerly so the inner content components are exercised.
vi.mock("../react/Dropdown", () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: ({ children, text, buttonClassName }: any) => (
        <div className={`dropdown ${buttonClassName ?? ""}`}>
            <button>{text}</button>
            <ul>{children}</ul>
        </div>
    )
}));

// NoteLink fires async link.createLink -> server; stub both NoteLink exports with simple anchors.
vi.mock("../react/NoteLink", () => ({
    default: ({ notePath }: { notePath: string | string[] }) => <span className="note-link" data-note-path={String(notePath)} />,
    NewNoteLink: ({ notePath, onContextMenu }: { notePath: string; onContextMenu?: (e: MouseEvent) => void }) => (
        <a className="new-note-link tn-link" data-note-path={notePath} onContextMenu={onContextMenu} />
    )
}));

vi.mock("../../menus/context_menu", () => ({ default: { show: vi.fn() } }));
vi.mock("../../menus/link_context_menu", () => ({
    default: {
        getItems: vi.fn(() => [ { title: "open", command: "openNoteInNewTab" } ]),
        handleLinkContextMenuItem: vi.fn(() => false),
        openContextMenu: vi.fn()
    }
}));
vi.mock("../../menus/custom-items/NoteColorPicker", () => ({ default: vi.fn(() => null) }));
vi.mock("../../services/hoisted_note", () => ({ default: { unhoist: vi.fn() } }));
vi.mock("../../services/note_create", () => ({ default: { createNote: vi.fn(async () => undefined), duplicateSubtree: vi.fn(async () => undefined) } }));
vi.mock("../../services/branches", () => ({ default: { deleteNotes: vi.fn(async () => undefined) } }));
vi.mock("../../services/clipboard_ext", () => ({ copyTextWithToast: vi.fn() }));
vi.mock("../../services/css_class_manager", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/css_class_manager")>()),
    getReadableTextColor: vi.fn(() => "#fff")
}));
vi.mock("../../services/attributes", () => ({ default: { addLabel: vi.fn(), removeOwnedLabelByName: vi.fn() } }));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import type NoteContext from "../../components/note_context";
import contextMenu from "../../menus/context_menu";
import link_context_menu from "../../menus/link_context_menu";
import attributes from "../../services/attributes";
import branches from "../../services/branches";
import { copyTextWithToast } from "../../services/clipboard_ext";
import froca from "../../services/froca";
import hoisted_note from "../../services/hoisted_note";
import note_create from "../../services/note_create";
import options from "../../services/options";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import Breadcrumb from "./Breadcrumb";

// --- Harness --------------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
const parent = new Component();

function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: "root",
        note: undefined,
        viewScope: { viewMode: "default", isReadOnly: false },
        setNote: vi.fn(),
        ...overrides
    } as unknown as NoteContext;
}

function setActiveContext(ctx: NoteContext | null) {
    Object.assign(appContext, {
        tabManager: {
            getActiveContext: () => ctx,
            getActiveContextNotePath: () => ctx?.notePath,
            activeNtxId: ctx?.ntxId
        }
    });
}

function renderBreadcrumb() {
    const current = document.createElement("div");
    container = current;
    document.body.appendChild(current);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <Breadcrumb />
            </ParentComponent.Provider>,
            current
        );
    });
    return current;
}

function setOptions(values: Record<string, string>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options.load(values as any);
}

async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => {
    setOptions({ hideArchivedNotes_main: "false" });
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    // root always exists in froca.
    buildNote({ id: "root", title: "root" });
});

afterEach(() => {
    const current = container;
    if (current) {
        act(() => render(null, current));
        current.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("Breadcrumb — basic path rendering", () => {
    it("renders root-only breadcrumb with the filler area", () => {
        setActiveContext(fakeNoteContext({ notePath: "root", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        expect(el.querySelector(".breadcrumb")).toBeTruthy();
        expect(el.querySelector(".filler")).toBeTruthy();
        // index 0 -> BreadcrumbRoot, which for "root" renders the icon-only root-note action button.
        expect(el.querySelector(".root-note")).toBeTruthy();
    });

    it("root-note button navigates to root on click and opens the link context menu on right-click", () => {
        const setNote = vi.fn();
        setActiveContext(fakeNoteContext({ notePath: "root", hoistedNoteId: "root", setNote }));
        const el = renderBreadcrumb();
        const rootBtn = el.querySelector(".root-note");
        expect(rootBtn).toBeTruthy();

        act(() => (rootBtn as HTMLElement).click());
        expect(setNote).toHaveBeenCalledWith("root");

        const evt = new MouseEvent("contextmenu", { bubbles: true });
        Object.assign(evt, { pageX: 3, pageY: 4 });
        act(() => { (rootBtn as HTMLElement).dispatchEvent(evt); });
        expect(link_context_menu.openContextMenu).toHaveBeenCalledWith("root", expect.anything());
    });

    it("renders a normal (non-collapsed) multi-level path: root + middle link + last item", () => {
        buildNote({ id: "a", title: "A" });
        buildNote({ id: "b", title: "B" });
        setActiveContext(fakeNoteContext({ notePath: "root/a/b", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        // root present
        expect(el.querySelector(".root-note")).toBeTruthy();
        // middle level "a" -> NewNoteLink (mocked .new-note-link)
        expect(el.querySelector('.new-note-link[data-note-path="root/a"]')).toBeTruthy();
        // last level "b" -> BreadcrumbLastItem anchor
        expect(el.querySelector(".breadcrumb-last-item")).toBeTruthy();
    });
});

describe("Breadcrumb — collapsed path (> COLLAPSE_THRESHOLD)", () => {
    it("renders initial items, a collapsed dropdown, and final items", () => {
        for (const id of [ "n1", "n2", "n3", "n4", "n5", "n6" ]) {
            buildNote({ id, title: id.toUpperCase() });
        }
        // 7 segments -> root,n1..n6 => length 7 > 5 -> collapsed.
        setActiveContext(fakeNoteContext({ notePath: "root/n1/n2/n3/n4/n5/n6", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        // The collapsed dropdown uses the dots icon.
        expect(el.querySelector(".bx-dots-horizontal-rounded")).toBeTruthy();
        // Last item still rendered.
        expect(el.querySelector(".breadcrumb-last-item")).toBeTruthy();
        // The collapsed middle notes appear as list items inside the dropdown.
        expect(el.querySelectorAll("li").length).toBeGreaterThan(0);
    });
});

describe("Breadcrumb — hoisted note root", () => {
    it("renders a hoisted (non-workspace) badge with chevrons-up icon", () => {
        buildNote({ id: "ws", title: "Workspace" });
        setActiveContext(fakeNoteContext({ notePath: "root/ws", hoistedNoteId: "ws" }));
        const el = renderBreadcrumb();
        // When hoisted, the path is sliced to start at the hoisted note; BreadcrumbRoot becomes the hoisted root.
        expect(el.querySelector(".badge-hoisted")).toBeTruthy();
        // Not a workspace -> chevrons-up icon.
        expect(el.querySelector(".bxs-chevrons-up")).toBeTruthy();
    });

    it("renders a workspace badge with custom color and workspace icon", () => {
        buildNote({
            id: "ws2",
            title: "WS2",
            "#workspace": "true",
            "#workspaceIconClass": "bx bx-briefcase",
            "#workspaceTabBackgroundColor": "#123456"
        });
        setActiveContext(fakeNoteContext({ notePath: "root/ws2", hoistedNoteId: "ws2" }));
        const el = renderBreadcrumb();
        const badge = el.querySelector(".badge-hoisted");
        expect(badge).toBeTruthy();
        // Workspace icon class is applied.
        expect(el.querySelector(".bx-briefcase")).toBeTruthy();
    });

    it("unhoists when the hoisted badge is clicked", () => {
        buildNote({ id: "ws3", title: "WS3" });
        setActiveContext(fakeNoteContext({ notePath: "root/ws3", hoistedNoteId: "ws3" }));
        const el = renderBreadcrumb();
        const badge = el.querySelector(".badge-hoisted");
        expect(badge).toBeTruthy();
        act(() => (badge as HTMLElement).click());
        expect(hoisted_note.unhoist).toHaveBeenCalled();
    });
});

describe("Breadcrumb — last item interactions", () => {
    it("scrolls the active scrolling container to top on click", () => {
        buildNote({ id: "leaf", title: "Leaf" });
        setActiveContext(fakeNoteContext({ notePath: "root/leaf", hoistedNoteId: "root", ntxId: "ntxScroll" }));

        // Provide the scrolling container the click handler queries.
        const scroller = document.createElement("div");
        scroller.className = "scrolling-container";
        const ntxWrapper = document.createElement("div");
        ntxWrapper.setAttribute("data-ntx-id", "ntxScroll");
        ntxWrapper.appendChild(scroller);
        document.body.appendChild(ntxWrapper);
        const scrollTo = vi.fn();
        scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;

        const el = renderBreadcrumb();
        const lastItem = el.querySelector(".breadcrumb-last-item");
        expect(lastItem).toBeTruthy();
        act(() => (lastItem as HTMLElement).click());
        expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
        ntxWrapper.remove();
    });

    it("applies the archived class to the last item when the note is archived", () => {
        buildNote({ id: "arch", title: "Arch", "#archived": "true" });
        setActiveContext(fakeNoteContext({ notePath: "root/arch", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        const lastItem = el.querySelector(".breadcrumb-last-item");
        expect(lastItem?.classList.contains("archived")).toBe(true);
    });
});

describe("Breadcrumb — separator dropdown content", () => {
    it("lists child notes, marks the active one strong, skips _hidden, and offers create", async () => {
        buildNote({
            id: "parent",
            title: "Parent",
            children: [
                { id: "child1", title: "Child 1" },
                { id: "child2", title: "Child 2" },
                { id: "_hidden", title: "Hidden" }
            ]
        });
        setActiveContext(fakeNoteContext({ notePath: "root/parent/child1", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        await flush();
        // The dropdown content is rendered eagerly (mocked Dropdown). The active child is bold.
        const strong = el.querySelector("strong");
        expect(strong?.textContent).toBe("Child 1");
        // _hidden child is not rendered as a span/strong entry.
        const allText = Array.from(el.querySelectorAll("li")).map((li) => li.textContent ?? "");
        expect(allText.some((t) => t.includes("Hidden"))).toBe(false);
    });

    it("navigates to a child when its list item is clicked", async () => {
        const setNote = vi.fn();
        buildNote({
            id: "p2",
            title: "P2",
            children: [ { id: "kid", title: "Kid" } ]
        });
        setActiveContext(fakeNoteContext({ notePath: "root/p2", hoistedNoteId: "root", setNote }));
        const el = renderBreadcrumb();
        await flush();
        // Find the list item whose text is "Kid" and click its clickable container.
        const kidItem = Array.from(el.querySelectorAll("li")).find((li) => (li.textContent ?? "").includes("Kid"));
        expect(kidItem).toBeTruthy();
        const clickable = kidItem?.querySelector("[class]") ?? kidItem;
        act(() => (clickable as HTMLElement).click());
        expect(setNote).toHaveBeenCalledWith("root/p2/kid");
    });

    it("hides archived children when hideArchivedNotes_main is on", async () => {
        setOptions({ hideArchivedNotes_main: "true" });
        buildNote({
            id: "p3",
            title: "P3",
            children: [
                { id: "visible", title: "Visible" },
                { id: "hiddenArch", title: "ArchivedKid", "#archived": "true" }
            ]
        });
        setActiveContext(fakeNoteContext({ notePath: "root/p3", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        await flush();
        const allText = Array.from(el.querySelectorAll("li")).map((li) => li.textContent ?? "");
        expect(allText.some((t) => t.includes("Visible"))).toBe(true);
        expect(allText.some((t) => t.includes("ArchivedKid"))).toBe(false);
    });

    it("renders no trailing separator when the last note has subtreeHidden", () => {
        buildNote({ id: "shNote", title: "SH", "#subtreeHidden": "true" });
        setActiveContext(fakeNoteContext({ notePath: "root/shNote", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        // Separators carry the chevron-right icon. With subtreeHidden on the last note and no active
        // path, the trailing separator returns null; only the inter-item separator remains.
        expect(el.querySelectorAll(".bxs-chevron-right").length).toBe(1);
    });

    it("creates a new note when the create item is clicked", async () => {
        buildNote({ id: "p4", title: "P4", children: [ { id: "k4", title: "K4" } ] });
        setActiveContext(fakeNoteContext({ notePath: "root/p4", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        await flush();
        // The last list item is the create-new-note entry.
        const items = Array.from(el.querySelectorAll("li"));
        const createItem = items[items.length - 1];
        const clickable = createItem?.querySelector("[class]") ?? createItem;
        act(() => (clickable as HTMLElement).click());
        expect(note_create.createNote).toHaveBeenCalled();
    });
});

describe("Breadcrumb — collapsed dropdown navigation", () => {
    it("navigates when a collapsed middle item is clicked", () => {
        const setNote = vi.fn();
        for (const id of [ "m1", "m2", "m3", "m4", "m5", "m6" ]) {
            buildNote({ id, title: id.toUpperCase() });
        }
        setActiveContext(fakeNoteContext({ notePath: "root/m1/m2/m3/m4/m5/m6", hoistedNoteId: "root", setNote }));
        const el = renderBreadcrumb();
        // The collapsed dropdown contains the middle items (m2 region). Click one.
        const dotsDropdown = el.querySelector(".bx-dots-horizontal-rounded")?.closest(".dropdown");
        const middleItem = dotsDropdown?.querySelector("li [class]") ?? dotsDropdown?.querySelector("li");
        expect(middleItem).toBeTruthy();
        act(() => (middleItem as HTMLElement).click());
        expect(setNote).toHaveBeenCalled();
    });
});

describe("Breadcrumb — empty-area context menu", () => {
    it("shows a context menu and copies the note path via the copy item", async () => {
        buildNote({ id: "leaf2", title: "Leaf2" });
        setActiveContext(fakeNoteContext({ notePath: "root/leaf2", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        const filler = el.querySelector(".filler");
        expect(filler).toBeTruthy();

        const evt = new MouseEvent("contextmenu", { bubbles: true });
        Object.assign(evt, { pageX: 5, pageY: 6 });
        act(() => { filler?.dispatchEvent(evt); });
        expect(contextMenu.show).toHaveBeenCalledTimes(1);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shownArgs = (contextMenu.show as any).mock.calls[0][0];
        // Toggle archived option handler persists the option.
        const saveSpy = vi.spyOn(options, "save").mockResolvedValue(undefined);
        await act(async () => { await shownArgs.items[0].handler(); });
        expect(saveSpy).toHaveBeenCalledWith("hideArchivedNotes_main", "true");

        // The copy-path item copies the note path.
        const copyItem = shownArgs.items.find((i: { command?: string }) => i?.command === "copyNotePathToClipboard");
        copyItem.handler();
        expect(copyTextWithToast).toHaveBeenCalledWith("#root/leaf2");
    });
});

describe("Breadcrumb — note context menu (buildContextMenu)", () => {
    it("builds the full context menu for a middle link and triggers commands", async () => {
        const target = buildNote({ id: "ctxChild", title: "CtxChild" });
        buildNote({ id: "ctxParent", title: "CtxParent", children: [ { id: "ctxChild2", title: "x" } ] });
        // Wire a branch so froca.getBranchId / getBranch resolve.
        vi.spyOn(froca, "getBranchId").mockResolvedValue("br-ctx");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const branch: any = { parentNoteId: "ctxParent", getNote: async () => target };
        vi.spyOn(froca, "getBranch").mockReturnValue(branch);
        vi.spyOn(froca, "getNote").mockResolvedValue(buildNote({ id: "ctxParent2", title: "PP" }));

        setActiveContext(fakeNoteContext({ notePath: "root/ctxParent/ctxChild", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        const link = el.querySelector('.new-note-link[data-note-path="root/ctxParent"]');
        expect(link).toBeTruthy();

        const evt = new MouseEvent("contextmenu", { bubbles: true });
        Object.assign(evt, { pageX: 1, pageY: 2 });
        await act(async () => { (link as HTMLElement).dispatchEvent(evt); await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });
        expect(contextMenu.show).toHaveBeenCalled();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = (contextMenu.show as any).mock.calls.at(-1)[0];
        // Archive handler adds an archived label (note not archived). The middle link is "root/ctxParent",
        // so the resolved noteId is "ctxParent".
        const archiveItem = args.items.find((i: { uiIcon?: string }) => i?.uiIcon === "bx bx-archive");
        archiveItem.handler();
        expect(attributes.addLabel).toHaveBeenCalledWith("ctxChild", "archived");

        // Delete handler deletes the branch.
        const deleteItem = args.items.find((i: { command?: string }) => i?.command === "deleteNotes");
        deleteItem.handler();
        expect(branches.deleteNotes).toHaveBeenCalledWith([ "br-ctx" ]);

        // Duplicate handler -> (noteId, branch.parentNoteId).
        const dupItem = args.items.find((i: { command?: string }) => i?.command === "duplicateSubtree");
        dupItem.handler();
        expect(note_create.duplicateSubtree).toHaveBeenCalledWith("ctxParent", "ctxParent");

        // Recent-changes handler triggers a command on the parent component.
        const triggerSpy = vi.spyOn(parent, "triggerCommand").mockResolvedValue(undefined as never);
        const recentItem = args.items.find((i: { uiIcon?: string }) => i?.uiIcon === "bx bx-history");
        recentItem.handler();
        expect(triggerSpy).toHaveBeenCalledWith("showRecentChanges", { ancestorNoteId: "ctxParent" });

        // The NoteColorPicker custom item exposes a componentFn that renders.
        const customItem = args.items.find((i: { kind?: string }) => i?.kind === "custom");
        expect(customItem).toBeTruthy();
        expect(() => customItem.componentFn()).not.toThrow();

        // selectMenuItemHandler with a command triggers it on the parent component.
        triggerSpy.mockClear();
        args.selectMenuItemHandler({ command: "moveNotesTo" });
        expect(triggerSpy).toHaveBeenCalled();

        // No command -> no trigger (after the link handler falls through).
        triggerSpy.mockClear();
        args.selectMenuItemHandler({ command: undefined });
        expect(triggerSpy).not.toHaveBeenCalled();

        // Link menu items are short-circuited (handleLinkContextMenuItem mock returns true -> early return).
        (link_context_menu.handleLinkContextMenuItem as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
        triggerSpy.mockClear();
        args.selectMenuItemHandler({ command: "openNoteInNewTab" });
        expect(triggerSpy).not.toHaveBeenCalled();
    });

    it("offers an unarchive action when the note is already archived", async () => {
        const target = buildNote({ id: "archChild", title: "ArchChild", "#archived": "true" });
        buildNote({ id: "archParent", title: "ArchParent", children: [ { id: "ac2", title: "x" } ] });
        vi.spyOn(froca, "getBranchId").mockResolvedValue("br-arch");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const branch: any = { parentNoteId: "archParent", getNote: async () => target };
        vi.spyOn(froca, "getBranch").mockReturnValue(branch);
        vi.spyOn(froca, "getNote").mockResolvedValue(buildNote({ id: "archParent2", title: "PP2" }));

        setActiveContext(fakeNoteContext({ notePath: "root/archParent/archChild", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        const link = el.querySelector('.new-note-link[data-note-path="root/archParent"]');
        const evt = new MouseEvent("contextmenu", { bubbles: true });
        Object.assign(evt, { pageX: 1, pageY: 2 });
        await act(async () => { (link as HTMLElement).dispatchEvent(evt); await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = (contextMenu.show as any).mock.calls.at(-1)[0];
        const unarchiveItem = args.items.find((i: { uiIcon?: string }) => i?.uiIcon === "bx bx-archive-out");
        expect(unarchiveItem).toBeTruthy();
        unarchiveItem.handler();
        expect(attributes.removeOwnedLabelByName).toHaveBeenCalledWith(target, "archived");
    });

    it("aborts the context menu when the branch cannot be resolved", async () => {
        buildNote({ id: "noBranchParent", title: "NBP", children: [ { id: "nbChild", title: "x" } ] });
        vi.spyOn(froca, "getBranchId").mockResolvedValue(undefined as unknown as string);
        setActiveContext(fakeNoteContext({ notePath: "root/noBranchParent/nbChild", hoistedNoteId: "root" }));
        const el = renderBreadcrumb();
        const link = el.querySelector('.new-note-link[data-note-path="root/noBranchParent"]');
        const evt = new MouseEvent("contextmenu", { bubbles: true });
        Object.assign(evt, { pageX: 1, pageY: 2 });
        await act(async () => { (link as HTMLElement).dispatchEvent(evt); await Promise.resolve(); });
        // contextMenu.show is not called because branchId was missing.
        expect(contextMenu.show).not.toHaveBeenCalled();
    });
});

describe("Breadcrumb — no active context", () => {
    it("renders nothing meaningful but does not crash when there is no active context", () => {
        setActiveContext(null);
        const el = renderBreadcrumb();
        expect(el.querySelector(".breadcrumb")).toBeTruthy();
    });
});
