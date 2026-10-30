import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import type Component from "../../components/component";
import FBranch from "../../entities/fbranch";
import type FNote from "../../entities/fnote";
import content_renderer from "../../services/content_renderer";
import froca from "../../services/froca";
import type LoadResults from "../../services/load_results";
import search from "../../services/search";
import { buildNote, buildNotes } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import { BookmarkList, ForwardToNoteButton, getChevronIcon, getListedChildCount, getPreviewNoteIds, PreviewSlot, TitleWithIndicators, UnhoistButton, WorkspaceCards } from "./MobileNoteNavigator";

vi.mock("../../services/i18n", () => ({
    t: (key: string, options?: object) => (options ? `${key} ${JSON.stringify(options)}` : key),
    translationsInitializedPromise: Promise.resolve()
}));

/** A parent component that collects the `entitiesReloaded` handlers, and fires them with the `LoadResults` methods given. */
function reloadingParent(extra: object = {}) {
    const handlers: ((data: unknown) => void)[] = [];
    const parent = {
        componentId: "cid",
        registerHandler: (name: string, callback: (data: unknown) => void) => {
            if (name === "entitiesReloaded") handlers.push(callback);
        },
        removeHandler: () => {},
        ...extra
    } as unknown as Component;
    const reload = (loadResults: object) => act(() => {
        for (const handler of handlers) handler({ loadResults });
    });
    return { parent, reload };
}

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

describe("getChevronIcon", () => {
    it("points back toward the leading edge and forward toward the trailing one", () => {
        const { isRtl } = glob;
        try {
            glob.isRtl = false;
            expect([ getChevronIcon("back"), getChevronIcon("forward") ]).toEqual([ "bx bx-chevron-left", "bx bx-chevron-right" ]);
            glob.isRtl = true;
            expect([ getChevronIcon("back"), getChevronIcon("forward") ]).toEqual([ "bx bx-chevron-right", "bx bx-chevron-left" ]);
        } finally {
            glob.isRtl = isRtl;
        }
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
    it("lists the workspaces and enters the one tapped", async () => {
        const workspace = buildNote({
            title: "Work", "#workspace": "", "#workspaceIconClass": "bx bx-briefcase", "#workspaceTabBackgroundColor": "#1e3a8a"
        });
        const plain = buildNote({ title: "Plain", "#workspace": "" });
        const searchForNotes = vi.spyOn(search, "searchForNotes").mockResolvedValue([ workspace, plain ]);
        const onEnter = vi.fn();
        const parent = {
            componentId: "cid", registerHandler: () => {}, removeHandler: () => {}
        } as unknown as Component;

        let container = document.body;
        await act(async () => {
            container = renderInto(
                <ParentComponent.Provider value={parent}>
                    <WorkspaceCards onEnter={onEnter} />
                </ParentComponent.Provider>
            );
        });

        // The search resolves after the effect that starts it.
        await act(async () => {});
        expect(searchForNotes).toHaveBeenCalledWith("#workspace #!template");
        expect(container.querySelector(".mobile-navigator-workspaces-label")?.textContent).toBe("mobile_note_navigator.workspaces");
        const cards = [ ...container.querySelectorAll(".mobile-navigator-workspaces .mobile-navigator-workspace") ];
        expect(cards.map((card) => card.textContent)).toEqual([ "Work", "Plain" ]);
        expect(cards[0]?.tagName).toBe("BUTTON");
        // The workspace color tints the icon, with its lightness limited per theme, and fills nothing.
        const icon = cards[0]?.querySelector(".mobile-navigator-workspace-icon.bx-briefcase");
        expect(icon?.classList.contains("use-note-color")).toBe(true);
        expect(icon?.classList.contains("color-1E3A8A")).toBe(true);
        expect(icon?.getAttribute("style")).toBeNull();
        expect(cards[1]?.querySelector(".mobile-navigator-workspace-icon")?.classList.contains("use-note-color")).toBe(false);

        (cards[0] as HTMLElement | undefined)?.click();
        expect(onEnter).toHaveBeenCalledWith(workspace.noteId);
    });
});

describe("UnhoistButton", () => {
    afterEach(() => vi.restoreAllMocks());

    it("shows an exit with the hoisted note's title in the workspace color, and unhoists on a tap", () => {
        const unhoist = vi.fn();
        const workspace = buildNote({
            title: "Work", "#workspace": "", "#workspaceIconClass": "bx bx-briefcase", "#iconClass": "bx bx-folder",
            "#workspaceTabBackgroundColor": "#1e3a8a"
        });
        const plain = buildNote({ title: "Plain", "#iconClass": "bx bx-book" });

        const button = renderInto(<UnhoistButton hoistedNoteId={workspace.noteId} onUnhoist={unhoist} />).querySelector("button");
        expect(button?.getAttribute("aria-label")).toBe("note_tree.unhoist");
        // The exit alone, its arrow toward the leading edge as the back chevron points.
        expect(button?.querySelectorAll(".bx").length).toBe(1);
        expect(button?.querySelector(".bx.bx-exit.bx-flip-horizontal.mobile-navigator-unhoist-icon")).not.toBeNull();
        expect(button?.textContent).toBe("Work");
        // The color class limits the lightness per theme, as a note's `#color` does in the tree.
        expect(button?.classList.contains("use-note-color")).toBe(true);
        expect(button?.classList.contains("color-1E3A8A")).toBe(true);
        expect(button?.getAttribute("style")).toBeNull();
        button?.click();
        expect(unhoist).toHaveBeenCalledTimes(1);

        const plainButton = renderInto(<UnhoistButton hoistedNoteId={plain.noteId} onUnhoist={unhoist} />).querySelector("button");
        expect(plainButton?.textContent).toBe("Plain");
        expect(plainButton?.classList.contains("use-note-color")).toBe(false);
    });

    it("points the exit toward the leading edge in a right-to-left language as well", () => {
        const note = buildNote({ title: "Work" });
        const { isRtl } = glob;
        glob.isRtl = true;
        try {
            const icon = renderInto(<UnhoistButton hoistedNoteId={note.noteId} onUnhoist={() => {}} />).querySelector(".bx-exit");
            expect(icon).not.toBeNull();
            expect(icon?.classList.contains("bx-flip-horizontal")).toBe(false);
        } finally {
            glob.isRtl = isRtl;
        }
    });
});

describe("ForwardToNoteButton", () => {
    it("shows the open note's title before a forward chevron, and brings the note back on a tap", () => {
        buildNote({ id: "root", title: "root", children: [
            { id: "fwdFolder", title: "Folder", children: [ { id: "fwdLeaf", title: "Leaf" } ] }
        ] });
        const triggerCommand = vi.fn();
        const parent = {
            componentId: "cid", registerHandler: () => {}, removeHandler: () => {}, triggerCommand
        } as unknown as Component;

        const button = renderInto(
            <ParentComponent.Provider value={parent}>
                <ForwardToNoteButton notePath="root/fwdFolder/fwdLeaf" />
            </ParentComponent.Provider>
        ).querySelector("button");
        expect(button?.getAttribute("aria-label")).toBe("mobile_note_navigator.forward");
        expect(button?.textContent).toBe("Leaf");
        // The chevron follows the title, pointing toward the trailing edge.
        expect(button?.lastElementChild?.matches(".bx.bx-chevron-right")).toBe(true);

        button?.click();
        expect(triggerCommand).toHaveBeenCalledWith("setActiveScreen", { screen: "detail" });
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

    it("follows a bookmarked note moved elsewhere in the tree", async () => {
        buildNote({ id: "root", title: "root", children: [
            { id: "fromFolder", title: "From", children: [ { id: "moved", title: "Moved" } ] },
            { id: "toFolder", title: "To" }
        ] });
        const bookmarks = buildNote({ id: "_lbBookmarks", title: "Bookmarks" });
        const moved = froca.notes["moved"];
        const toFolder = froca.notes["toFolder"];
        if (!moved || !toFolder) throw new Error("expected the notes");
        const link = (parent: FNote, branchId: string) => {
            froca.branches[branchId] = new FBranch(froca, {
                branchId, noteId: "moved", parentNoteId: parent.noteId, notePosition: 0, fromSearchNote: false
            });
            parent.addChild("moved", branchId, false);
            moved.addParent(parent.noteId, branchId, false);
        };
        link(bookmarks, "_lbBookmarks_moved");
        const { parent, reload } = reloadingParent();

        let container = document.body;
        await act(async () => {
            container = renderInto(
                <ParentComponent.Provider value={parent}>
                    <BookmarkList renderRow={({ note, notePath }) => <div key={note.noteId} className="row">{notePath}</div>} />
                </ParentComponent.Provider>
            );
        });
        const rowPaths = () => [ ...container.querySelectorAll(".row") ].map((row) => row.textContent);
        await vi.waitFor(() => expect(rowPaths()).toEqual([ "root/fromFolder/moved" ]));

        moved.parents = moved.parents.filter((parentNoteId) => parentNoteId !== "fromFolder");
        delete moved.parentToBranch["fromFolder"];
        link(toFolder, "toFolder_moved");
        reload({ getBranchRows: () => [ { noteId: "moved", parentNoteId: "toFolder" } ] });
        await vi.waitFor(() => expect(rowPaths()).toEqual([ "root/toFolder/moved" ]));
    });
});

describe("PreviewSlot", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders the preview again once the note's content changes, keeping the old one until then", async () => {
        const note = buildNote({ title: "Previewed" });
        let finishRender = () => {};
        let version = 1;
        const getRenderedContent = vi.spyOn(content_renderer, "getRenderedContent").mockImplementation(() => {
            const $renderedContent = $("<div>").text(`Version ${version}`);
            const rendered = { $renderedContent, type: "text" };
            if (version === 1) return Promise.resolve(rendered);
            return new Promise((resolve) => {
                finishRender = () => resolve(rendered);
            });
        });
        const onReady = vi.fn();
        const { parent, reload } = reloadingParent();

        let container = document.body;
        await act(async () => {
            container = renderInto(
                <ParentComponent.Provider value={parent}>
                    <PreviewSlot note={note} shown hideArchived onReady={onReady} />
                </ParentComponent.Provider>
            );
        });
        const shownText = () => [ ...container.querySelectorAll(".mobile-navigator-preview-slot:not([hidden]) > .note-book-content") ]
            .map((content) => content.textContent);
        await vi.waitFor(() => expect(shownText()).toEqual([ "Version 1" ]));
        expect(onReady).toHaveBeenLastCalledWith(note.noteId, true);

        version = 2;
        reload({ isNoteContentReloaded: (noteId: string) => noteId === "other" });
        expect(getRenderedContent).toHaveBeenCalledTimes(1);
        reload({ isNoteContentReloaded: (noteId: string) => noteId === note.noteId });
        await vi.waitFor(() => expect(getRenderedContent).toHaveBeenCalledTimes(2));
        expect(shownText()).toEqual([ "Version 1" ]);
        expect(onReady).toHaveBeenLastCalledWith(note.noteId, false);

        await act(async () => finishRender());
        await vi.waitFor(() => expect(shownText()).toEqual([ "Version 2" ]));
        expect(onReady).toHaveBeenLastCalledWith(note.noteId, true);
    });
});
