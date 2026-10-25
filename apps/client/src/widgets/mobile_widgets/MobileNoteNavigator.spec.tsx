import { describe, expect, it } from "vitest";

import froca from "../../services/froca";
import { buildNotes } from "../../test/easy-froca";
import { getListedChildCount } from "./MobileNoteNavigator";

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
