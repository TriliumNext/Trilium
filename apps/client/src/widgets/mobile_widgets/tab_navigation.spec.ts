import { describe, expect, it } from "vitest";

import { buildNotes } from "../../test/easy-froca";
import {
    enterHoistedNote, forgetTabs, getParentStack, getSpotlightedNoteId, getTabNavigation, getTreeStack,
    isSameStack, leaveHoistedNote, opensColumnNoteOnBack, setTabScreen, setTabTree
} from "./tab_navigation";

describe("tab navigation", () => {
    buildNotes([
        { id: "folder", title: "Folder", children: [
            { id: "inner", title: "Inner", children: [ { id: "leaf", title: "Leaf" } ] },
            { id: "page", title: "Page" }
        ] }
    ]);

    it("brings back the column a tab's tree was left on until the tab opens another note or hoists", () => {
        const drilled = [ "root", "root/folder", "root/folder/inner" ];
        setTabTree("tab", { notePath: "root/folder/page", hoistedNoteId: "root", stack: drilled });

        expect(getTreeStack("tab", "root/folder/page", "root")).toBe(drilled);
        // Another note: the column holding it.
        expect(getTreeStack("tab", "root/folder", "root")).toEqual([ "root", "root/folder" ]);
        expect(getTreeStack("tab", "root/folder/page", "folder")).toEqual([ "folder" ]);
        // A tab whose tree never moved: the column of its note, or a folder's own column.
        expect(getTreeStack("other", "root/folder/page", "root")).toEqual([ "root", "root/folder" ]);
        expect(getTreeStack("other", "root/folder/inner", "root")).toEqual(drilled);
    });

    it("rebuilds the column a tablet enters or goes back to when it opens the folder there, hoisted or not", () => {
        const entered = [ "root", "root/folder", "root/folder/inner" ];
        expect(isSameStack(getTreeStack("fresh", "root/folder/inner", "root"), entered)).toBe(true);
        expect(isSameStack(getTreeStack("fresh", "root/folder", "root"), [ "root", "root/folder" ])).toBe(true);
        expect(isSameStack(getTreeStack("fresh", "root", "root"), [ "root" ])).toBe(true);
        // A hoisted tree's columns start at the hoisted note, while the note's path starts at the root.
        expect(isSameStack(getTreeStack("fresh", "root/folder/inner", "folder"), [ "folder", "folder/inner" ])).toBe(true);
        expect(isSameStack(getTreeStack("fresh", "root/folder", "folder"), [ "folder" ])).toBe(true);
        expect(isSameStack(entered, [ "root", "root/folder" ])).toBe(false);
        expect(isSameStack(entered, [ "root", "root/folder", "root/folder/page" ])).toBe(false);
    });

    it("on a tablet, goes back from a child listed in the column to the column's note before going up", () => {
        function opensColumnNote(stack: string[], notePath: string, isStacked = false) {
            const activeNoteId = notePath.split("/").at(-1);
            const spotlightedNoteId = getSpotlightedNoteId(stack[stack.length - 1], notePath);
            return opensColumnNoteOnBack({ isStacked, stack, activeNoteId, spotlightedNoteId });
        }

        const column = [ "root", "root/folder", "root/folder/inner" ];
        expect(opensColumnNote(column, "root/folder/inner/leaf")).toBe(true);
        // The column's own note is open: back goes up a column.
        expect(opensColumnNote(column, "root/folder/inner")).toBe(false);
        // A note further down, or elsewhere, is not a child of the column's note.
        expect(opensColumnNote([ "root", "root/folder" ], "root/folder/inner/leaf")).toBe(false);
        expect(opensColumnNote(column, "root/folder/page")).toBe(false);
        // A stacked tree hides the note under it; the root column has no back.
        expect(opensColumnNote(column, "root/folder/inner/leaf", true)).toBe(false);
        expect(opensColumnNote([ "root" ], "root/folder")).toBe(false);
        // A hoisted tree's columns start at the hoisted note, while the note's path starts at the root.
        expect(opensColumnNote([ "folder", "folder/inner" ], "root/folder/inner/leaf")).toBe(true);
    });

    it("goes back from a note to the column listing it, even when the note has children", () => {
        expect(getParentStack("root/folder/page", "root")).toEqual([ "root", "root/folder" ]);
        expect(getParentStack("root/folder/inner", "root")).toEqual([ "root", "root/folder" ]);
        expect(getParentStack("root/folder", "root")).toEqual([ "root" ]);
        // A hoisted tree goes no higher than the hoisted note.
        expect(getParentStack("root/folder/inner/leaf", "folder")).toEqual([ "folder", "folder/inner" ]);
        expect(getParentStack("root/folder", "folder")).toEqual([ "folder" ]);
        expect(getParentStack(null, "root")).toEqual([ "root" ]);
    });

    it("keeps a tab's screen beside its tree and forgets both once the tab closes", () => {
        setTabTree("closing", { notePath: "root/folder", hoistedNoteId: "root", stack: [ "root" ] });
        setTabScreen("closing", "tree");
        expect(getTabNavigation("closing")).toEqual({
            screen: "tree",
            tree: { notePath: "root/folder", hoistedNoteId: "root", stack: [ "root" ] }
        });

        forgetTabs([ "closing" ]);
        expect(getTabNavigation("closing")).toBeUndefined();
    });

    it("spotlights the child of a column that leads to the tab's note", () => {
        expect(getSpotlightedNoteId("root/folder", "root/folder/inner/leaf")).toBe("inner");
        expect(getSpotlightedNoteId("root/folder", "root/folder/page")).toBe("page");
        expect(getSpotlightedNoteId("root/folder", "root/folder")).toBeUndefined();
        expect(getSpotlightedNoteId("root/folder", "root/folderish/page")).toBeUndefined();
        expect(getSpotlightedNoteId("root/folder", null)).toBeUndefined();
        // A hoisted tree's columns start at the hoisted note, while the note's path starts at the root.
        expect(getSpotlightedNoteId("folder", "root/folder/inner/leaf")).toBe("inner");
        expect(getSpotlightedNoteId("folder/inner", "root/folder/inner/leaf")).toBe("leaf");
        expect(getSpotlightedNoteId("folder/inner", "root/folder/page")).toBeUndefined();
    });

    it("leaves a hoisted note for the column holding it, whatever note the tab shows", () => {
        const notePath = "root/folder/inner/leaf";
        leaveHoistedNote("leaving", notePath, "inner");
        expect(getTreeStack("leaving", notePath, "root")).toEqual([ "root", "root/folder" ]);

        // A hoisted note right under the root leaves for the root.
        leaveHoistedNote("leaving", notePath, "folder");
        expect(getTreeStack("leaving", notePath, "root")).toEqual([ "root" ]);
    });

    it("enters a hoisted note on its own column, even with a note deep inside it open", () => {
        const notePath = "root/folder/inner/leaf";
        enterHoistedNote("entering", notePath, "folder");
        expect(getTreeStack("entering", notePath, "folder")).toEqual([ "folder" ]);
    });
});
