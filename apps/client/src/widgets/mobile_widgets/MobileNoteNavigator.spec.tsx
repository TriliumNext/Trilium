import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../test/mocks";

// --- Module mocks (hoisted above the component import) -------------------------------------------

// Render NoteContent as a trivial element that synchronously invokes onReady, since the navigator
// gates visibility (and the pending-stack commit) on the preview reporting "ready".
const previewControl = vi.hoisted(() => ({ fireReady: true }));
vi.mock("../collections/legacy/ListOrGridView", () => ({
    NoteContent: ({ onReady }: { onReady?: () => void }) => {
        if (onReady && previewControl.fireReady) onReady();
        return <div className="mock-note-content" />;
    }
}));
vi.mock("bootstrap", () => bootstrapMock());
vi.mock("../../services/note_create", () => ({
    default: { createNote: vi.fn(async () => undefined) }
}));
vi.mock("../../services/hoisted_note", () => ({
    default: { unhoist: vi.fn(async () => undefined) }
}));
vi.mock("../../menus/context_menu", () => ({
    default: { show: vi.fn(async () => undefined) }
}));
vi.mock("../../menus/tree_context_menu", () => ({
    buildTreeContextMenuItems: vi.fn(async () => []),
    handleTreeContextMenuSelect: vi.fn()
}));
vi.mock("../../services/css_class_manager", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/css_class_manager")>()),
    getReadableTextColor: vi.fn(() => "#ffffff")
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import type NoteContext from "../../components/note_context";
import contextMenu from "../../menus/context_menu";
import { buildTreeContextMenuItems, handleTreeContextMenuSelect } from "../../menus/tree_context_menu";
import froca from "../../services/froca";
import hoisted_note from "../../services/hoisted_note";
import note_create from "../../services/note_create";
import options from "../../services/options";
import tree from "../../services/tree";
import utils from "../../services/utils";
import { buildNote } from "../../test/easy-froca";
import { flush, makeLoadResults, renderComponent, resetFroca } from "../../test/render";
import MobileNoteNavigator from "./MobileNoteNavigator";
import FBranch from "../../entities/fbranch";
import type { OptionNames } from "@triliumnext/commons";

// --- Render harness ------------------------------------------------------------------------------

let parent: Component;

/** Render the navigator inside the ParentComponent provider (the same wiring react_utils uses). */
function renderNavigator() {
    return renderComponent(<MobileNoteNavigator />, { parent }).container;
}

/** Dispatch a Trilium event to the navigator's `useTriliumEvent` handlers. */
function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
    });
}

/** Drain several async effect/commit cycles (drill/back go through a pending-stack handshake). */
async function flushAll() {
    for (let i = 0; i < 4; i++) await flush();
}

function setActiveContext(ctx: NoteContext | null) {
    Object.assign(appContext, { tabManager: { getActiveContext: () => ctx } });
}

/** Add a child to an existing cached FNote in place, mirroring what froca_updater does on sync. */
function appendChildInPlace(parentId: string, childId: string, childTitle: string) {
    const child = buildNote({ id: childId, title: childTitle });
    const parentNote = froca.notes[parentId];
    if (!parentNote) throw new Error(`parent ${parentId} not cached`);
    const branchId = `${parentId}_${childId}`;
    const branch = new FBranch(froca, {
        branchId,
        noteId: childId,
        parentNoteId: parentId,
        notePosition: parentNote.children.length * 10,
        fromSearchNote: false
    });
    froca.branches[branchId] = branch;
    parentNote.addChild(childId, branchId, false);
    child.addParent(parentId, branchId, false);
    return child;
}

function fakeContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: undefined,
        note: undefined,
        viewScope: { viewMode: "default" },
        setNote: vi.fn(async () => undefined),
        ...overrides
    } as unknown as NoteContext;
}

beforeEach(() => {
    previewControl.fireReady = true;
    parent = new Component();
    parent.triggerCommand = vi.fn();

    options.load({} as Record<OptionNames, string>);
    resetFroca();

    // Async froca methods the navigator drives — make them resolve against the easy-froca cache.
    vi.spyOn(froca, "loadSubTree").mockResolvedValue([] as never);
    vi.spyOn(froca, "getNotes").mockImplementation(async (ids) =>
        (ids as string[]).map((id) => froca.notes[id]).filter((n) => !!n)
    );
    vi.spyOn(tree, "getNoteTitle").mockImplementation(async (noteId: string) =>
        froca.notes[noteId]?.title ?? noteId
    );

    setActiveContext(null);
});

// --- Tests ---------------------------------------------------------------------------------------

describe("MobileNoteNavigator", () => {
    it("shows the initial loader when nothing is ready yet", async () => {
        // No active context, root not in cache → parentNote undefined, loadSubTree never resolves a body.
        const el = renderNavigator();
        expect(el.querySelector(".mobile-note-navigator")).toBeTruthy();
        expect(el.querySelector(".mobile-navigator-placeholder")).toBeTruthy();
        expect(el.querySelector(".mobile-navigator-scroll.is-pending")).toBeTruthy();
        // No toolbar at the root with no hoisting.
        expect(el.querySelector(".mobile-navigator-toolbar")).toBeNull();
    });

    it("renders the current tile and children once loaded", async () => {
        buildNote({
            id: "root",
            title: "Root",
            children: [
                { id: "child1", title: "Child 1" },
                { id: "child2", title: "Child 2", children: [ { id: "grand", title: "Grand" } ] }
            ]
        });
        const el = renderNavigator();
        await flush();

        // The current tile renders for the root note with its icon, title and the two action buttons.
        expect(el.querySelector(".mobile-navigator-current-tile")).toBeTruthy();
        expect(el.querySelectorAll(".mobile-navigator-current-action").length).toBe(2);
        // Children label + rows.
        expect(el.querySelector(".mobile-navigator-children-label")).toBeTruthy();
        const rows = el.querySelectorAll(".mobile-navigator-row");
        expect(rows.length).toBe(2);
        // The note with children gets a drill chevron + has-children class.
        const childWithKids = Array.from(rows).find((r) => r.classList.contains("has-children"));
        expect(childWithKids).toBeTruthy();
        expect(childWithKids?.querySelector(".bx-chevron-right")).toBeTruthy();
        // Initial loader gone.
        expect(el.querySelector(".mobile-navigator-placeholder")).toBeNull();
    });

    it("renders an empty state when the parent has no children", async () => {
        buildNote({ id: "root", title: "Root" });
        const el = renderNavigator();
        await flush();
        expect(el.querySelector(".no-items")).toBeTruthy();
        expect(el.querySelector(".mobile-navigator-children-label")).toBeNull();
    });

    it("opens the current note tile and switches to the detail screen", async () => {
        const setNote = vi.fn(async () => undefined);
        setActiveContext(fakeContext({ setNote, notePath: "root", note: undefined }));
        buildNote({ id: "root", title: "Root", children: [ { id: "c", title: "C" } ] });
        const el = renderNavigator();
        await flush();

        const tile = el.querySelector(".mobile-navigator-current-tile");
        if (!(tile instanceof HTMLElement)) throw new Error("tile missing");
        await act(async () => { tile.click(); });
        await flush();
        expect(setNote).toHaveBeenCalledWith("root");
        expect(parent.triggerCommand).toHaveBeenCalledWith("setActiveScreen", { screen: "detail" });
    });

    it("creates a child note from the tile '+' action without opening the note", async () => {
        buildNote({ id: "root", title: "Root", children: [ { id: "c", title: "C" } ] });
        const setNote = vi.fn(async () => undefined);
        setActiveContext(fakeContext({ setNote }));
        const el = renderNavigator();
        await flush();

        const addBtn = el.querySelector(".mobile-navigator-current-action");
        if (!(addBtn instanceof HTMLElement)) throw new Error("add button missing");
        await act(async () => { addBtn.click(); });
        expect(note_create.createNote).toHaveBeenCalledWith("root");
        // stopPropagation means the tile open handler did not fire.
        expect(setNote).not.toHaveBeenCalled();
    });

    it("opens the context menu from the tile 'more' action", async () => {
        // Drill into a folder first so the current path resolves to a real branch (root/folder),
        // rather than root's special "none_root" branch which has no cached FBranch.
        buildNote({
            id: "root",
            title: "Root",
            children: [ { id: "folderM", title: "FolderM", children: [ { id: "deep", title: "Deep" } ] } ]
        });
        const el = renderNavigator();
        await flushAll();
        const folderRow = el.querySelector(".mobile-navigator-row");
        if (!(folderRow instanceof HTMLElement)) throw new Error("folder row missing");
        await act(async () => { folderRow.click(); });
        await flushAll();

        const actions = el.querySelectorAll(".mobile-navigator-current-action");
        const moreBtn = actions[1];
        if (!(moreBtn instanceof HTMLElement)) throw new Error("more button missing");
        await act(async () => { moreBtn.click(); });
        await flush();
        expect(buildTreeContextMenuItems).toHaveBeenCalled();
        expect(contextMenu.show).toHaveBeenCalled();

        // Exercise the menu's onBeforeCommand (mobile → setActiveScreen) and selectMenuItemHandler.
        vi.spyOn(utils, "isMobile").mockReturnValue(true);
        const ctxArg = (buildTreeContextMenuItems as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
            { onBeforeCommand: () => void } | undefined;
        ctxArg?.onBeforeCommand();
        expect(parent.triggerCommand).toHaveBeenCalledWith("setActiveScreen", { screen: "detail" });

        const showArg = (contextMenu.show as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
            { selectMenuItemHandler: (item: unknown) => void } | undefined;
        const item = { command: "deleteNotes" };
        showArg?.selectMenuItemHandler(item);
        expect(handleTreeContextMenuSelect).toHaveBeenCalledWith(item, expect.anything());
    });

    it("drills into a folder child and exposes a back button, then goes back", async () => {
        buildNote({
            id: "root",
            title: "Root",
            children: [
                { id: "folder", title: "Folder", children: [ { id: "leaf", title: "Leaf" } ] }
            ]
        });
        const el = renderNavigator();
        await flushAll();

        const folderRow = Array.from(el.querySelectorAll(".mobile-navigator-row"))
            .find((r) => r.classList.contains("has-children"));
        if (!(folderRow instanceof HTMLElement)) throw new Error("folder row missing");
        await act(async () => { folderRow.click(); });
        await flushAll();

        // Stack advanced → toolbar with an enabled back button is shown.
        const back = el.querySelector(".mobile-navigator-back");
        expect(back).toBeTruthy();
        expect(el.querySelector(".mobile-navigator-back.invisible")).toBeNull();
        // Now showing the folder's own children.
        expect(el.querySelector(".mobile-navigator-current-title")?.textContent).toBe("Folder");

        if (!(back instanceof HTMLElement)) throw new Error("back missing");
        await act(async () => { back.click(); });
        await flushAll();
        // Back to root.
        expect(el.querySelector(".mobile-navigator-current-title")?.textContent).toBe("Root");
    });

    it("drills synchronously before the first preview has committed", async () => {
        // The preview never reports ready → hasCommittedOnce stays false, but rows still render
        // (they're gated only on isLoaded). Drilling then takes the synchronous setStack path.
        previewControl.fireReady = false;
        buildNote({
            id: "root",
            title: "Root",
            children: [ { id: "folderS", title: "FolderS", children: [ { id: "deepS", title: "DeepS" } ] } ]
        });
        const el = renderNavigator();
        await flushAll();
        // Body not yet committed → the initial loader overlay is present.
        expect(el.querySelector(".mobile-navigator-scroll.is-pending")).toBeTruthy();

        const folderRow = el.querySelector(".mobile-navigator-row");
        if (!(folderRow instanceof HTMLElement)) throw new Error("folder row missing");
        await act(async () => { folderRow.click(); });
        await flushAll();
        // Stack advanced immediately to the folder's column.
        expect(el.querySelector(".mobile-navigator-current-title")?.textContent).toBe("FolderS");
    });

    it("opens a leaf child directly on tap", async () => {
        const setNote = vi.fn(async () => undefined);
        setActiveContext(fakeContext({ setNote }));
        buildNote({ id: "root", title: "Root", children: [ { id: "leaf", title: "Leaf" } ] });
        const el = renderNavigator();
        await flush();

        const leafRow = el.querySelector(".mobile-navigator-row");
        if (!(leafRow instanceof HTMLElement)) throw new Error("leaf row missing");
        // A leaf has no drill chevron.
        expect(leafRow.querySelector(".bx-chevron-right")).toBeNull();
        await act(async () => { leafRow.click(); });
        await flush();
        expect(setNote).toHaveBeenCalledWith("root/leaf");
    });

    it("treats a #subtreeHidden note as a leaf and shows a hidden-count badge", async () => {
        buildNote({
            id: "root",
            title: "Root",
            children: [
                { id: "hiddenSub", title: "Options", "#subtreeHidden": "true", children: [ { id: "opt1", title: "O1" } ] }
            ]
        });
        const el = renderNavigator();
        await flush();

        const row = el.querySelector(".mobile-navigator-row");
        expect(row?.classList.contains("has-children")).toBe(false);
        const badge = el.querySelector(".mobile-navigator-row-hidden-badge");
        expect(badge?.textContent).toBe("1");
    });

    it("hides archived children when hideArchivedNotes_main is set", async () => {
        options.load({ hideArchivedNotes_main: "true" } as Record<OptionNames, string>);
        buildNote({
            id: "root",
            title: "Root",
            children: [
                { id: "normal", title: "Normal" },
                { id: "arch", title: "Archived", "#archived": "true" }
            ]
        });
        const el = renderNavigator();
        await flush();
        const rows = el.querySelectorAll(".mobile-navigator-row");
        expect(rows.length).toBe(1);
        expect(el.querySelector(".mobile-navigator-row-title")?.textContent).toBe("Normal");
    });

    it("renders an empty parent column when the parent itself is #subtreeHidden", async () => {
        buildNote({
            id: "root",
            title: "Root",
            "#subtreeHidden": "true",
            children: [ { id: "kid", title: "Kid" } ]
        });
        const el = renderNavigator();
        await flush();
        // Parent subtree hidden → children list reports empty.
        expect(el.querySelectorAll(".mobile-navigator-row").length).toBe(0);
        expect(el.querySelector(".no-items")).toBeTruthy();
    });

    it("syncs the stack to the active note path so a deep note shows its parent column", async () => {
        buildNote({
            id: "root",
            title: "Root",
            children: [
                { id: "parentB", title: "Parent B", children: [ { id: "leafB", title: "Leaf B" } ] }
            ]
        });
        setActiveContext(fakeContext({
            notePath: "root/parentB/leafB",
            note: froca.notes["leafB"]
        }));
        const el = renderNavigator();
        await flush();
        // Active note is a leaf → the column shows its parent (Parent B).
        expect(el.querySelector(".mobile-navigator-current-title")?.textContent).toBe("Parent B");
        // The active leaf row is marked active.
        const activeRow = el.querySelector(".mobile-navigator-row.is-active");
        expect(activeRow?.querySelector(".mobile-navigator-row-title")?.textContent).toBe("Leaf B");
    });

    it("falls back to the hoisted root when the active note is a single-segment leaf", async () => {
        // A one-segment path to a non-folder note → parentSegments empties out, so the stack
        // collapses to just the hoisted root column.
        buildNote({ id: "root", title: "Root", children: [ { id: "topLeaf", title: "Top Leaf" } ] });
        setActiveContext(fakeContext({
            notePath: "topLeaf",
            note: froca.notes["topLeaf"]
        }));
        const el = renderNavigator();
        await flush();
        expect(el.querySelector(".mobile-navigator-current-title")?.textContent).toBe("Root");
        // No drilled-in toolbar since we collapsed back to root.
        expect(el.querySelector(".mobile-navigator-toolbar")).toBeNull();
    });

    it("shows the active marker on the current tile when the active note is a folder", async () => {
        buildNote({
            id: "root",
            title: "Root",
            children: [ { id: "folderA", title: "Folder A", children: [ { id: "x", title: "X" } ] } ]
        });
        setActiveContext(fakeContext({
            notePath: "root/folderA",
            note: froca.notes["folderA"]
        }));
        const el = renderNavigator();
        await flush();
        expect(el.querySelector(".mobile-navigator-current-tile.is-active")).toBeTruthy();
        expect(el.querySelector(".mobile-navigator-current-title")?.textContent).toBe("Folder A");
    });

    it("rebuilds the column when entitiesReloaded reports a branch under the current parent", async () => {
        buildNote({ id: "root", title: "Root", children: [ { id: "c1", title: "C1" } ] });
        const el = renderNavigator();
        await flushAll();
        expect(el.querySelectorAll(".mobile-navigator-row").length).toBe(1);

        // Mutate the cached note in place (as froca_updater does), then fire the event the navigator listens for.
        appendChildInPlace("root", "c2", "C2");
        fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ branchRows: [ { parentNoteId: "root" } ] })
        });
        await flushAll();
        expect(el.querySelectorAll(".mobile-navigator-row").length).toBe(2);
    });

    it("ignores entitiesReloaded for branches under a different parent", async () => {
        buildNote({ id: "root", title: "Root", children: [ { id: "c1", title: "C1" } ] });
        const el = renderNavigator();
        await flushAll();
        fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ branchRows: [ { parentNoteId: "somethingElse" } ] })
        });
        await flushAll();
        expect(el.querySelectorAll(".mobile-navigator-row").length).toBe(1);
    });

    it("shows and dismisses the hoisted-note badge", async () => {
        buildNote({ id: "root", title: "Root" });
        buildNote({ id: "ws", title: "Workspace", children: [ { id: "wsChild", title: "WS Child" } ] });
        setActiveContext(fakeContext({ hoistedNoteId: "ws" }));
        const el = renderNavigator();
        await flush();

        // Toolbar visible because hoisted below root.
        expect(el.querySelector(".mobile-navigator-toolbar")).toBeTruthy();
        const badge = el.querySelector(".mobile-navigator-hoisted-badge");
        expect(badge).toBeTruthy();
        expect(el.querySelector(".mobile-navigator-hoisted-title")?.textContent).toBe("Workspace");

        if (!(badge instanceof HTMLElement)) throw new Error("badge missing");
        await act(async () => { badge.click(); });
        expect(hoisted_note.unhoist).toHaveBeenCalled();
    });

    it("renders a workspace-styled hoisted badge with custom icon and color", async () => {
        buildNote({ id: "root", title: "Root" });
        buildNote({
            id: "ws2",
            title: "WS2",
            "#workspace": "true",
            "#workspaceIconClass": "bx bx-briefcase",
            "#workspaceTabBackgroundColor": "#112233",
            children: [ { id: "ws2Child", title: "C" } ]
        });
        setActiveContext(fakeContext({ hoistedNoteId: "ws2" }));
        const el = renderNavigator();
        await flush();
        const badge = el.querySelector(".mobile-navigator-hoisted-badge");
        expect(badge).toBeTruthy();
        // Custom workspace icon used.
        expect(badge?.querySelector(".bx-briefcase")).toBeTruthy();
    });
});
