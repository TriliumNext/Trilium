import { beforeEach, describe, expect, it } from "vitest";

import { buildShareNote } from "../../../test/shaca_mocking.js";
import shaca from "../shaca.js";
import SBranch from "./sbranch.js";

describe("SBranch", () => {
    beforeEach(() => {
        shaca.reset();
    });

    it("links its notes once, however many branches join them", () => {
        const parent = buildShareNote({ id: "parent" });
        const child = buildShareNote({ id: "child" });

        const first = new SBranch([ "first", "child", "parent", "", "", false ]);
        const second = new SBranch([ "second", "child", "parent", "prefix", "1", false ]);

        expect(first.getNote()).toBe(child);
        expect(first.childNote).toBe(child);
        expect(first.getParentNote()).toBe(parent);
        expect(first.parentNote).toBe(parent);
        expect(child.getParentNotes()).toEqual([ parent ]);
        expect(parent.getChildNotes()).toEqual([ child ]);
        expect(child.getParentBranches()).toEqual([ first, second ]);
        expect(child.getBranches()).toEqual([ first, second ]);
        expect(shaca.getBranch("first")).toBe(first);
        expect(shaca.getBranchFromChildAndParent("child", "parent")).toBe(second);
    });
});
