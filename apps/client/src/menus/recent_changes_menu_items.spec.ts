import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandNames } from "../components/app_context";
import froca from "../services/froca";
import { buildNote } from "../test/easy-froca";
import type { MenuItem } from "./context_menu";
import {
    getRecentChangesMenuItems, getRecentlyChangedNotesMenuItems
} from "./recent_changes_menu_items";

const mocks = vi.hoisted(() => ({
    get: vi.fn(async (_url: string): Promise<string[]> => []),
    openTabWithNoteWithHoisting: vi.fn(),
    noteContexts: [] as { noteId: string | null }[],
    hoistedNoteId: "root"
}));

vi.mock("../services/server", () => ({ default: { get: mocks.get } }));
vi.mock("../services/hoisted_note", () => ({
    default: { getHoistedNoteId: () => mocks.hoistedNoteId }
}));
vi.mock("../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../components/app_context", () => ({
    default: {
        tabManager: {
            getNoteContexts: () => mocks.noteContexts,
            openTabWithNoteWithHoisting: mocks.openTabWithNoteWithHoisting
        }
    }
}));

const SHOW_ALL = {
    title: "tab_row.show_all_recent_changes",
    command: "showRecentChanges",
    uiIcon: "bx bx-history",
    keyboardShortcut: "showRecentChanges"
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.noteContexts = [];
    mocks.hoistedNoteId = "root";
    buildNote({
        id: "root",
        title: "root",
        children: [
            { id: "html", title: "<b>Bold</b>" },
            { id: "open", title: "Open" },
            {
                id: "work",
                title: "Work",
                children: Array.from({ length: 20 }, (_, i) => ({
                    id: `plan${i}`,
                    title: `Plan ${i}`
                }))
            }
        ]
    });
});

describe("getRecentChangesMenuItems", () => {
    it("lists changed notes without an open tab, newest first, then the dialog entry", async () => {
        mocks.noteContexts = [ { noteId: "open" }, { noteId: null }, { noteId: "open" } ];
        mocks.get.mockResolvedValueOnce([ "plan3", "open", "html" ]);

        const items = await getRecentChangesMenuItems();

        expect(mocks.get).toHaveBeenCalledWith("recent-changes/root/note-ids?limit=16");
        expect(items.map(describeItem)).toEqual([
            [ "header", "tab_row.recently_changed_notes" ],
            [ "Plan 3", "Work" ],
            [ "&lt;b&gt;Bold&lt;&#x2F;b&gt;", undefined ],
            [ "separator" ],
            [ SHOW_ALL.title, undefined ]
        ]);
        expect(items[1]).toMatchObject({ uiIcon: froca.getNoteFromCache("plan3")?.getIcon() });
        expect(items.at(-1)).toEqual(SHOW_ALL);

        select(items[1]);
        expect(mocks.openTabWithNoteWithHoisting)
            .toHaveBeenCalledWith("root/work/plan3", { activate: true });
    });

    it("lists at most 15 notes of the hoisted subtree", async () => {
        mocks.hoistedNoteId = "work";
        mocks.get.mockResolvedValueOnce(Array.from({ length: 20 }, (_, i) => `plan${i}`));

        const items = await getRecentChangesMenuItems();

        expect(mocks.get).toHaveBeenCalledWith("recent-changes/work/note-ids?limit=15");
        expect(items.filter((item) => "handler" in item)).toHaveLength(15);
        expect(items.map(describeItem).slice(-3)).toEqual([
            [ "Plan 14", "Work" ],
            [ "separator" ],
            [ SHOW_ALL.title, undefined ]
        ]);
    });

    it("keeps only the dialog entry when no note qualifies or the request fails", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const onlyShowAll = [
            { kind: "header", title: "tab_row.recently_changed_notes" },
            SHOW_ALL
        ];

        mocks.noteContexts = [ { noteId: "html" } ];
        mocks.get.mockResolvedValueOnce([ "html" ]);
        expect(await getRecentChangesMenuItems()).toEqual(onlyShowAll);

        const error = new Error("Offline");
        mocks.get.mockRejectedValueOnce(error);
        expect(await getRecentChangesMenuItems()).toEqual(onlyShowAll);
        expect(consoleError).toHaveBeenCalledWith(expect.any(String), error);
        consoleError.mockRestore();
    });
});

describe("getRecentlyChangedNotesMenuItems", () => {
    it("lists the heading and the notes without the dialog entry, or nothing", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        mocks.get.mockResolvedValueOnce([ "plan3" ]);
        expect((await getRecentlyChangedNotesMenuItems()).map(describeItem)).toEqual([
            [ "header", "tab_row.recently_changed_notes" ],
            [ "Plan 3", "Work" ]
        ]);

        mocks.get.mockResolvedValueOnce([]);
        expect(await getRecentlyChangedNotesMenuItems()).toEqual([]);

        mocks.get.mockRejectedValueOnce(new Error("Offline"));
        expect(await getRecentlyChangedNotesMenuItems()).toEqual([]);
        consoleError.mockRestore();
    });
});

function describeItem(item: MenuItem<CommandNames>) {
    if ("kind" in item) {
        return item.kind === "header" ? [ item.kind, item.title ] : [ item.kind ];
    }
    return [ item.title, item.trailingText ];
}

function select(item: MenuItem<CommandNames> | undefined) {
    if (!item || !("handler" in item) || !item.handler) {
        throw new Error("The menu item has no handler.");
    }
    (item.handler as () => void)();
}
