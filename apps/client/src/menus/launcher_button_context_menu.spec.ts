import type { ToggleInParentResponse } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FBranch from "../entities/fbranch";
import type FNote from "../entities/fnote";
import froca from "../services/froca";
import { buildNote } from "../test/easy-froca";
import { getBuiltinLabelSelectOptions } from "../services/attributes";
import type { ContextMenuEvent, ContextMenuOptions, MenuCommandItem, MenuItem } from "./context_menu";
import { BOOKMARK_OPEN_MODES, showLauncherContextMenu } from "./launcher_button_context_menu";

const mocks = vi.hoisted(() => ({
    show: vi.fn(),
    put: vi.fn(async (_url: string): Promise<ToggleInParentResponse> => ({ success: true })),
    moveToParentNote: vi.fn(),
    showError: vi.fn(),
    setBooleanWithInheritance: vi.fn(),
    setLabelValueWithInheritance: vi.fn()
}));

vi.mock("./context_menu", () => ({ default: { show: mocks.show } }));
vi.mock("../components/app_context", () => ({ default: {} }));
vi.mock("../services/server", () => ({ default: { put: mocks.put } }));
vi.mock("../services/toast", () => ({ default: { showError: mocks.showError } }));
vi.mock("../services/branches", () => ({ default: { moveToParentNote: mocks.moveToParentNote } }));
vi.mock("../services/attributes", async (importOriginal) => ({
    ...await importOriginal<typeof import("../services/attributes")>(),
    setBooleanWithInheritance: mocks.setBooleanWithInheritance,
    setLabelValueWithInheritance: mocks.setLabelValueWithInheritance
}));
vi.mock("../services/options", () => ({ default: { get: () => "vertical" } }));
vi.mock("../services/i18n", () => ({ t: (key: string) => key }));

const OPEN_MODE = "launcher_button_context_menu.open_mode";
const SHOW_AS_FOLDER = "launcher_button_context_menu.show_as_folder";
const REMOVE_FROM_LAUNCH_BAR = "launcher_button_context_menu.remove_from_launch_bar";
const event = { pageX: 0, pageY: 0, preventDefault: () => {} } as ContextMenuEvent;

beforeEach(() => {
    vi.clearAllMocks();
});

/** The items of the menu of `note`'s button, in the launch bar section `parentNoteId`. */
async function open(note: FNote, parentNoteId?: string) {
    await showLauncherContextMenu(note, event, { parentNoteId });
    const { items } = mocks.show.mock.lastCall?.[0] as ContextMenuOptions<string>;
    return items;
}

function itemTitled(items: MenuItem<string>[], title: string) {
    return items.find((item): item is MenuCommandItem<string> => (
        "title" in item && item.title === title
    ));
}

describe("Remove from launch bar", () => {
    /** A note dropped onto the launch bar that is also bookmarked. */
    function bookmarkedLauncher() {
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [ { id: "dropped", title: "Dropped" } ]
        });
        const note = froca.notes["dropped"];
        froca.branches["_lbBookmarks_dropped"] = new FBranch(froca, {
            branchId: "_lbBookmarks_dropped",
            noteId: "dropped",
            parentNoteId: "_lbBookmarks",
            notePosition: 0,
            fromSearchNote: false
        });
        note.addParent("_lbBookmarks", "_lbBookmarks_dropped", false);
        return note;
    }

    async function remove(note: FNote, parentNoteId?: string) {
        const event = { pageX: 0, pageY: 0, preventDefault: () => {} } as ContextMenuEvent;
        await showLauncherContextMenu(note, event, { parentNoteId });
        const { items, selectMenuItemHandler } = mocks.show.mock.lastCall?.[0] ?? {};
        const removeTitle = "launcher_button_context_menu.remove_from_launch_bar";
        const removeItem = (items as MenuItem<string>[])
            .find((item) => "title" in item && item.title === removeTitle);
        expect(removeItem).toBeDefined();
        selectMenuItemHandler(removeItem);
    }

    it("removes the placement of the button that was clicked", async () => {
        const note = bookmarkedLauncher();

        // A dropped note is a clone, so the clone goes instead of moving to the available launchers.
        await remove(note, "_lbVisibleLaunchers");
        await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledExactlyOnceWith(
            "notes/dropped/toggle-in-parent/_lbVisibleLaunchers/false"
        ));

        // A bookmark button names no section, so the bookmark goes.
        await remove(note);
        await vi.waitFor(() => expect(mocks.put).toHaveBeenLastCalledWith(
            "notes/dropped/toggle-in-parent/_lbBookmarks/false"
        ));
        expect(mocks.put).toHaveBeenCalledTimes(2);
        expect(mocks.moveToParentNote).not.toHaveBeenCalled();
    });

    it("moves a launcher or a note placed only there to the available launchers", async () => {
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [
                { id: "launcher", title: "Launcher", type: "launcher" },
                { id: "onlyHere", title: "Only here" }
            ]
        });

        await remove(froca.notes["launcher"], "_lbVisibleLaunchers");
        await vi.waitFor(() => expect(mocks.moveToParentNote).toHaveBeenCalledExactlyOnceWith(
            [ "_lbVisibleLaunchers_launcher" ], "_lbRoot__lbAvailableLaunchers"
        ));
        expect(mocks.put).not.toHaveBeenCalled();

        // The server refuses to remove the last placement of a note.
        mocks.put.mockResolvedValueOnce({ success: false, message: "would delete the note" });
        await remove(froca.notes["onlyHere"], "_lbVisibleLaunchers");
        await vi.waitFor(() => expect(mocks.moveToParentNote).toHaveBeenLastCalledWith(
            [ "_lbVisibleLaunchers_onlyHere" ], "_lbRoot__lbAvailableLaunchers"
        ));
        expect(mocks.put).toHaveBeenCalledExactlyOnceWith(
            "notes/onlyHere/toggle-in-parent/_lbVisibleLaunchers/false"
        );
        expect(mocks.showError).not.toHaveBeenCalled();
    });
});

describe("Show as a folder", () => {
    function pick(items: MenuItem<string>[]) {
        const item = itemTitled(items, SHOW_AS_FOLDER);
        expect(item).toBeDefined();
        item?.handler?.(item, new MouseEvent("click"));
    }

    it("toggles #bookmarkFolder on a bookmark or a dropped note, in a group above the removal", async () => {
        buildNote({
            id: "_lbBookmarks",
            title: "Bookmarks",
            children: [ { id: "folder", title: "Folder", "#bookmarkFolder": "" } ]
        });
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [ { id: "dropped", title: "Dropped" } ]
        });

        const bookmarkItems = await open(froca.notes["folder"]);
        expect(bookmarkItems.slice(-5)).toMatchObject([
            { kind: "separator" },
            { title: OPEN_MODE },
            { title: SHOW_AS_FOLDER, checked: true },
            { kind: "separator" },
            { title: REMOVE_FROM_LAUNCH_BAR }
        ]);
        pick(bookmarkItems);
        expect(mocks.setBooleanWithInheritance).toHaveBeenLastCalledWith(
            froca.notes["folder"], "bookmarkFolder", false
        );

        const droppedItems = await open(froca.notes["dropped"], "_lbVisibleLaunchers");
        expect(droppedItems.slice(-3)).toMatchObject([
            { title: SHOW_AS_FOLDER, checked: false },
            { kind: "separator" },
            { title: REMOVE_FROM_LAUNCH_BAR }
        ]);
        pick(droppedItems);
        expect(mocks.setBooleanWithInheritance).toHaveBeenLastCalledWith(
            froca.notes["dropped"], "bookmarkFolder", true
        );
    });

    it("is not offered for a launcher", async () => {
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [ { id: "launcher", title: "Launcher", type: "launcher" } ]
        });

        const items = await open(froca.notes["launcher"], "_lbVisibleLaunchers");
        expect(itemTitled(items, SHOW_AS_FOLDER)).toBeUndefined();
        expect(items.at(-1)).toMatchObject({ title: REMOVE_FROM_LAUNCH_BAR });
    });
});

describe("Open mode", () => {
    /** The rows of the _Open mode_ submenu of `note`'s button, as their titles and checks. */
    async function openModes(note: FNote, parentNoteId?: string) {
        const rows = itemTitled(await open(note, parentNoteId), OPEN_MODE)?.items ?? [];
        return rows.filter((row): row is MenuCommandItem<string> => "title" in row);
    }

    it("lists the modes above Folder, checking the one the note opens in", async () => {
        buildNote({
            id: "_lbBookmarks",
            title: "Bookmarks",
            children: [
                { id: "split", title: "Split", "#bookmarkOpenMode": "newSplit" },
                { id: "typo", title: "Typo", "#bookmarkOpenMode": "newtab" }
            ]
        });
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [ { id: "dropped", title: "Dropped" } ]
        });

        const items = await open(froca.notes["split"]);
        expect(items.slice(-5)).toMatchObject([
            { kind: "separator" },
            { title: OPEN_MODE },
            { title: SHOW_AS_FOLDER },
            { kind: "separator" },
            { title: REMOVE_FROM_LAUNCH_BAR }
        ]);

        const modes = await openModes(froca.notes["split"]);
        expect(modes.map(({ title, checked }) => [ title, checked ])).toEqual([
            [ "launcher_button_context_menu.open_mode_current_tab", false ],
            [ "launcher_button_context_menu.open_mode_new_tab", false ],
            [ "launcher_button_context_menu.open_mode_new_split", true ],
            [ "launcher_button_context_menu.open_mode_new_window", false ],
            [ "launcher_button_context_menu.open_mode_quick_edit", false ]
        ]);
        // A row with an icon of its own shows its check at the trailing edge.
        expect(modes.filter((mode) => mode.uiIcon)).toHaveLength(5);
        expect(BOOKMARK_OPEN_MODES.map((mode) => mode.value))
            .toEqual(getBuiltinLabelSelectOptions("bookmarkOpenMode"));

        modes[1].handler?.(modes[1], new MouseEvent("click"));
        expect(mocks.setLabelValueWithInheritance).toHaveBeenCalledExactlyOnceWith(
            froca.notes["split"], "bookmarkOpenMode", "newTab", "currentTab", false
        );

        // A note without the label, or with a value nothing knows, opens in the current tab.
        const typoModes = await openModes(froca.notes["typo"]);
        const droppedModes = await openModes(froca.notes["dropped"], "_lbVisibleLaunchers");
        for (const rows of [ typoModes, droppedModes ]) {
            expect(rows.map((row) => row.checked)).toEqual([ true, false, false, false, false ]);
        }
    });

    it("sets a folder's mode inheritable, checking the mode its notes follow", async () => {
        buildNote({
            id: "_lbBookmarks",
            title: "Bookmarks",
            children: [
                { id: "shared", title: "Shared", "#bookmarkFolder": "",
                    "#bookmarkOpenMode(inheritable)": "newWindow" },
                // Its own row opens in a new tab, its notes in the current one.
                { id: "own", title: "Own", "#bookmarkFolder": "", "#bookmarkOpenMode": "newTab" }
            ]
        });

        const shared = await openModes(froca.notes["shared"]);
        expect(shared.map((row) => row.checked)).toEqual([ false, false, false, true, false ]);
        const own = await openModes(froca.notes["own"]);
        expect(own.map((row) => row.checked)).toEqual([ true, false, false, false, false ]);

        own[2].handler?.(own[2], new MouseEvent("click"));
        expect(mocks.setLabelValueWithInheritance).toHaveBeenCalledExactlyOnceWith(
            froca.notes["own"], "bookmarkOpenMode", "newSplit", "currentTab", true
        );
    });

    it("is not offered for a launcher", async () => {
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [ { id: "launcher", title: "Launcher", type: "launcher" } ]
        });

        const launcherItems = await open(froca.notes["launcher"], "_lbVisibleLaunchers");
        expect(itemTitled(launcherItems, OPEN_MODE)).toBeUndefined();
    });
});
