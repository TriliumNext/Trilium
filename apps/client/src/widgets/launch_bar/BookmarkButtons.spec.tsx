import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto, resetFroca } from "../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Stub the heavy launcher children with light, identifiable markers so every BookmarkButtons branch
// runs without pulling in bootstrap dropdowns / link service / context menus. `launcherContextMenuHandler`
// and `useLauncherIconAndTitle` are kept real so the component's own wiring is exercised.
vi.mock("./GenericButtons", () => ({
    CustomNoteLauncher: ({ launcherNote, getTargetNoteId }: { launcherNote: { noteId: string }, getTargetNoteId: () => string }) => (
        <div data-widget="customLauncher" data-note-id={launcherNote.noteId} data-target={getTargetNoteId()} />
    ),
    launchCustomNoteLauncher: vi.fn()
}));
vi.mock("../react/NoteLink", () => ({
    default: ({ notePath }: { notePath: string }) => <span data-widget="noteLink" data-note-path={notePath} />
}));
vi.mock("../react/FormList", () => ({
    FormListItem: ({ children, icon, onClick }: { children: unknown, icon?: string, onClick?: (e: MouseEvent) => void }) => (
        <li data-widget="formListItem" data-icon={icon} onClick={onClick}>{children as never}</li>
    ),
    FormDropdownSubmenu: ({ children, icon, title }: { children: unknown, icon?: string, title?: unknown }) => (
        <div data-widget="formSubmenu" data-icon={icon} data-title={title as string}>{children as never}</div>
    )
}));
vi.mock("./launch_bar_widgets", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./launch_bar_widgets")>()),
    // Render a recognizable wrapper that still mounts `children` so the dropdown contents are asserted,
    // and surface the launcher note's icon for the desktop-folder branch.
    LaunchBarDropdownButton: ({ children, icon, launcherNote }: { children: unknown, icon: string, launcherNote?: { noteId: string } }) => (
        <div data-widget="dropdownButton" data-icon={icon} data-launcher={launcherNote?.noteId}>{children as never}</div>
    )
}));
vi.mock("../../menus/launcher_button_context_menu", () => ({
    showLauncherContextMenu: vi.fn()
}));
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: vi.fn(() => false),
    isDesktop: vi.fn(() => true)
}));

import Component from "../../components/component";
import { showLauncherContextMenu } from "../../menus/launcher_button_context_menu";
import froca from "../../services/froca";
import { isMobile } from "../../services/utils";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import BookmarkButtons from "./BookmarkButtons";
import { launchCustomNoteLauncher } from "./GenericButtons";
import { LaunchBarContext } from "./launch_bar_widgets";

// --- Harness -------------------------------------------------------------------------------------

const BOOKMARKS_ROOT_ID = "_lbBookmarks";
let parent: Component;

async function renderButtons(launcherNoteId: string, isHorizontalLayout = true) {
    const launcherNote = froca.notes[launcherNoteId];
    const root = renderInto((
        <ParentComponent.Provider value={parent}>
            <LaunchBarContext.Provider value={{ isHorizontalLayout }}>
                <BookmarkButtons launcherNote={launcherNote} />
            </LaunchBarContext.Provider>
        </ParentComponent.Provider>
    ));
    // The child-note resolution is an async froca effect; drain several microtask/render cycles.
    for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    }
    return root;
}

beforeEach(() => {
    parent = new Component();
    resetFroca();
    vi.clearAllMocks();
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

/** Builds the `_lbBookmarks` parent and a `launcher` note that points at it. */
function buildBookmarksRoot(children: Parameters<typeof buildNote>[0]["children"] = []) {
    buildNote({ id: BOOKMARKS_ROOT_ID, title: "Bookmarks", type: "launcher", children });
    return buildNote({ id: "launcher1", title: "Bookmarks launcher", type: "launcher" });
}

// --- Desktop rendering ----------------------------------------------------------------------------

describe("BookmarkButtons (desktop)", () => {
    it("renders a flex container in row direction with one launcher per non-folder bookmark", async () => {
        buildBookmarksRoot([
            { id: "bm1", title: "First" },
            { id: "bm2", title: "Second" }
        ]);
        const root = await renderButtons("launcher1", true);

        const flex = root.querySelector<HTMLElement>("div[style]");
        expect(flex).toBeTruthy();
        expect(flex?.style.flexDirection).toBe("row");
        // Two plain bookmarks → two CustomNoteLauncher stubs, each pointed at its own note.
        const launchers = Array.from(root.querySelectorAll<HTMLElement>("[data-widget='customLauncher']"));
        expect(launchers.map(el => el.getAttribute("data-note-id"))).toEqual([ "bm1", "bm2" ]);
        expect(launchers.map(el => el.getAttribute("data-target"))).toEqual([ "bm1", "bm2" ]);
    });

    it("uses column direction for vertical layout", async () => {
        buildBookmarksRoot([ { id: "bm1", title: "First" } ]);
        const root = await renderButtons("launcher1", false);
        const flex = root.querySelector<HTMLElement>("div[style]");
        expect(flex?.style.flexDirection).toBe("column");
    });

    it("renders a bookmark folder as a dropdown with parent + child note links", async () => {
        buildBookmarksRoot([
            {
                id: "folder1",
                title: "Folder",
                "#bookmarkFolder": "true",
                "#iconClass": "bx bx-folder-open",
                children: [
                    { id: "child1", title: "Child 1" },
                    { id: "child2", title: "Child 2" }
                ]
            }
        ]);
        const root = await renderButtons("launcher1", true);

        const dropdown = root.querySelector<HTMLElement>("[data-widget='dropdownButton']");
        expect(dropdown).toBeTruthy();
        // useLauncherIconAndTitle feeds the folder note's icon class onto the dropdown button.
        expect(dropdown?.getAttribute("data-icon")).toContain("bx-folder-open");
        expect(dropdown?.getAttribute("data-launcher")).toBe("folder1");

        // The parent link + one link per child.
        const links = Array.from(root.querySelectorAll<HTMLElement>("[data-widget='noteLink']"));
        expect(links.map(el => el.getAttribute("data-note-path"))).toEqual([ "folder1", "child1", "child2" ]);
        // The folder is not rendered as a plain CustomNoteLauncher.
        expect(root.querySelector("[data-widget='customLauncher']")).toBeNull();
    });

    it("triggers the launcher context menu only on the empty container area", async () => {
        buildBookmarksRoot([ { id: "bm1", title: "First" } ]);
        const root = await renderButtons("launcher1", true);
        const flex = root.querySelector<HTMLElement>("div[style]");
        expect(flex).toBeTruthy();

        // A right-click directly on the container (target === currentTarget) shows the menu.
        act(() => { flex?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
        expect(showLauncherContextMenu).toHaveBeenCalledTimes(1);

        // A right-click bubbling up from a child must NOT re-trigger the container handler.
        const child = root.querySelector<HTMLElement>("[data-widget='customLauncher']");
        act(() => { child?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
        expect(showLauncherContextMenu).toHaveBeenCalledTimes(1);
    });

    it("renders an empty container when there are no bookmarks", async () => {
        // `_lbBookmarks` exists but has no children.
        buildBookmarksRoot([]);
        const root = await renderButtons("launcher1", true);
        const flex = root.querySelector<HTMLElement>("div[style]");
        expect(flex).toBeTruthy();
        expect(root.querySelector("[data-widget='customLauncher']")).toBeNull();
        expect(root.querySelector("[data-widget='dropdownButton']")).toBeNull();
    });
});

// --- Mobile rendering -----------------------------------------------------------------------------

describe("BookmarkButtons (mobile)", () => {
    beforeEach(() => {
        (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
    });

    it("renders a top-level dropdown with one list item per plain bookmark, launching on click", async () => {
        buildBookmarksRoot([
            { id: "bm1", title: "First", "#iconClass": "bx bx-star" },
            { id: "bm2", title: "Second" }
        ]);
        const root = await renderButtons("launcher1", false);

        // The outer LaunchBarDropdownButton (bookmarks icon) wraps the per-bookmark items.
        const outer = root.querySelector<HTMLElement>("[data-widget='dropdownButton']");
        expect(outer?.getAttribute("data-icon")).toBe("bx bx-bookmark");

        const items = Array.from(root.querySelectorAll<HTMLElement>("[data-widget='formListItem']"));
        expect(items).toHaveLength(2);
        // The first item's icon comes from the note's iconClass via useNoteIcon.
        expect(items[0].getAttribute("data-icon")).toContain("bx-star");

        act(() => { items[0].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(launchCustomNoteLauncher).toHaveBeenCalledTimes(1);
    });

    it("renders a bookmark folder as a submenu listing its children, launching each on click", async () => {
        buildBookmarksRoot([
            {
                id: "folder1",
                title: "Folder",
                "#bookmarkFolder": "true",
                children: [
                    { id: "child1", title: "Child 1", "#iconClass": "bx bx-file" },
                    { id: "child2", title: "Child 2" }
                ]
            }
        ]);
        const root = await renderButtons("launcher1", false);

        const submenu = root.querySelector<HTMLElement>("[data-widget='formSubmenu']");
        expect(submenu).toBeTruthy();
        expect(submenu?.getAttribute("data-title")).toBe("Folder");

        const childItems = Array.from(root.querySelectorAll<HTMLElement>("[data-widget='formListItem']"));
        expect(childItems).toHaveLength(2);
        // Each child's icon is derived from getIcon() (the iconClass label here).
        expect(childItems[0].getAttribute("data-icon")).toContain("bx-file");

        act(() => { childItems[1].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(launchCustomNoteLauncher).toHaveBeenCalledTimes(1);
    });
});
