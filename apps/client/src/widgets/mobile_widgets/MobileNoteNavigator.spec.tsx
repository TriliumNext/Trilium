import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import type Component from "../../components/component";
import FBranch from "../../entities/fbranch";
import type FNote from "../../entities/fnote";
import froca from "../../services/froca";
import type LoadResults from "../../services/load_results";
import search from "../../services/search";
import { buildNote, buildNotes } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import { BookmarkList, getListedChildCount, getPreviewNoteIds, TitleWithIndicators, WorkspaceCards } from "./MobileNoteNavigator";

vi.mock("../../services/i18n", () => ({
    t: (key: string, options?: object) => (options ? `${key} ${JSON.stringify(options)}` : key),
    translationsInitializedPromise: Promise.resolve()
}));

describe("getListedChildCount", () => {
    buildNotes([
        { id: "parent", title: "Parent", children: [
            { id: "plain", title: "Plain" },
            { id: "archived", title: "Archived", "#archived": "" },
            { id: "_hidden", title: "Hidden" }
        ] }
    ]);
    const parent = froca.getNoteFromCache("parent");
    parent?.children.push("notLoaded");

    it("counts the children the navigator lists", () => {
        expect(parent).toBeDefined();
        if (!parent) return;

        expect(getListedChildCount(parent, true)).toBe(2);
        expect(getListedChildCount(parent, false)).toBe(3);
    });
});

describe("getPreviewNoteIds", () => {
    it("keeps the previews of the columns shown last, and the one about to be shown", () => {
        expect(getPreviewNoteIds([], "a")).toEqual([ "a" ]);
        expect(getPreviewNoteIds([ "a", "b" ], "b")).toEqual([ "b", "a" ]);
        expect(getPreviewNoteIds([ "a", "b", "c", "d", "e" ], "f")).toEqual([ "f", "a", "b", "c", "d" ]);
        expect(getPreviewNoteIds([ "a", "b", "c", "d", "e" ], "a", "f")).toEqual([ "a", "f", "b", "c", "d" ]);
        expect(getPreviewNoteIds([ "a" ], undefined)).toEqual([ "a" ]);
    });
});

describe("TitleWithIndicators", () => {
    function addParent(parent: FNote, child: FNote) {
        const branchId = `${parent.noteId}_${child.noteId}`;
        froca.branches[branchId] = new FBranch(froca, {
            branchId, noteId: child.noteId, parentNoteId: parent.noteId, notePosition: 0, fromSearchNote: false
        });
        parent.addChild(child.noteId, branchId, false);
        child.addParent(parent.noteId, branchId, false);
    }

    /** Renders the title under a parent component that collects the reload handlers. */
    function mount(note: FNote) {
        const handlers: ((data: unknown) => void)[] = [];
        const parent = {
            componentId: "cid",
            registerHandler: (name: string, callback: (data: unknown) => void) => {
                if (name === "entitiesReloaded") handlers.push(callback);
            },
            removeHandler: () => {}
        } as unknown as Component;
        let container = document.body;
        act(() => {
            container = renderInto(
                <ParentComponent.Provider value={parent}>
                    <TitleWithIndicators note={note} title={note.title} className="title" />
                </ParentComponent.Provider>
            );
        });
        const reloadBranchOf = (noteId: string) => {
            const loadResults = { getBranchRows: () => [ { noteId } ] } as unknown as LoadResults;
            act(() => {
                for (const handler of handlers) handler({ loadResults });
            });
        };
        return { container, reloadBranchOf };
    }

    it("marks a clone and a shared note, and follows a clone made elsewhere", () => {
        buildNote({ title: "First", children: [ { id: "indicated", title: "Indicated" } ] });
        const note = froca.notes["indicated"];
        if (!note) throw new Error("expected the note");

        const { container, reloadBranchOf } = mount(note);
        expect(container.querySelector(".title")?.textContent).toBe("Indicated");
        expect(container.querySelector(".clone-indicator")).toBeNull();
        expect(container.querySelector(".shared-indicator")).toBeNull();

        addParent(buildNote({ title: "Second" }), note);
        addParent(buildNote({ id: "_share", title: "Share" }), note);
        reloadBranchOf(note.noteId);

        const clone = container.querySelector(".clone-indicator");
        expect(clone).not.toBeNull();
        expect(clone?.getAttribute("aria-label")).toContain("Second");
        expect(container.querySelector(".shared-indicator")).not.toBeNull();
    });
});

describe("WorkspaceCards", () => {
    it("lists the workspaces and hoists the tab into the one tapped", async () => {
        const workspace = buildNote({ title: "Work", "#workspace": "", "#workspaceIconClass": "bx bx-briefcase" });
        const searchForNotes = vi.spyOn(search, "searchForNotes").mockResolvedValue([ workspace ]);
        const triggerCommand = vi.fn();
        const parent = {
            componentId: "cid", registerHandler: () => {}, removeHandler: () => {}, triggerCommand
        } as unknown as Component;

        let container = document.body;
        await act(async () => {
            container = renderInto(
                <ParentComponent.Provider value={parent}>
                    <WorkspaceCards />
                </ParentComponent.Provider>
            );
        });

        // The search resolves after the effect that starts it.
        await act(async () => {});
        expect(searchForNotes).toHaveBeenCalledWith("#workspace #!template");
        expect(container.querySelector(".mobile-navigator-workspaces-label")?.textContent).toBe("mobile_note_navigator.workspaces");
        const cards = [ ...container.querySelectorAll(".mobile-navigator-workspaces .mobile-navigator-workspace") ];
        expect(cards.map((card) => card.textContent)).toEqual([ "Work" ]);
        expect(cards[0]?.querySelector(".mobile-navigator-workspace-icon.bx-briefcase")).not.toBeNull();

        (cards[0] as HTMLElement | undefined)?.click();
        expect(triggerCommand).toHaveBeenCalledWith("hoistNote", { noteId: workspace.noteId });
    });
});

describe("BookmarkList", () => {
    // `tree.resolveNotePath()` reads the active note path from the tab manager.
    const { tabManager } = appContext;
    beforeEach(() => {
        appContext.tabManager = { getActiveContextNotePath: () => null } as unknown as typeof tabManager;
    });
    afterEach(() => {
        appContext.tabManager = tabManager;
    });

    it("lists the bookmarks under their path in the tree, and nothing without any", async () => {
        buildNote({ id: "root", title: "root", children: [
            { id: "bmFolder", title: "Folder", children: [ { id: "bookmarked", title: "Bookmarked" } ] }
        ] });
        const bookmarks = buildNote({ id: "_lbBookmarks", title: "Bookmarks" });
        const renderRow = ({ note, notePath }: { note: FNote, notePath: string }) => (
            <div key={note.noteId} className="row">{notePath}</div>
        );
        const mount = async () => {
            let container = document.body;
            await act(async () => {
                container = renderInto(<BookmarkList renderRow={renderRow} />);
            });
            // The paths resolve after the bookmarks load.
            await act(async () => {});
            return container;
        };

        expect((await mount()).querySelector(".mobile-navigator-bookmarks-label")).toBeNull();

        const bookmarked = froca.notes["bookmarked"];
        if (!bookmarked) throw new Error("expected the bookmarked note");
        const branchId = "_lbBookmarks_bookmarked";
        froca.branches[branchId] = new FBranch(froca, {
            branchId, noteId: "bookmarked", parentNoteId: "_lbBookmarks", notePosition: 0, fromSearchNote: false
        });
        bookmarks.addChild("bookmarked", branchId, false);
        bookmarked.addParent("_lbBookmarks", branchId, false);

        const container = await mount();
        await vi.waitFor(() => {
            expect([ ...container.querySelectorAll(".mobile-navigator-list .row") ].map((row) => row.textContent))
                .toEqual([ "root/bmFolder/bookmarked" ]);
        });
        expect(container.querySelector(".mobile-navigator-bookmarks-label")?.textContent).toBe("mobile_note_navigator.bookmarks");
    });
});
