import { describe, expect, it } from "vitest";

import { buildNotes } from "../../test/easy-froca";
import { enterHoistedNote, forgetTabs, getSpotlightedNoteId, getTabNavigation, getTreeStack, leaveHoistedNote, setTabScreen, setTabTree } from "./tab_navigation";

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
