import { describe, expect, it } from "vitest";

import { planSelectionAfterMerge, type MergeTreeNode } from "./note_merge";

const target: MergeTreeNode = { branchId: "root_target", noteId: "target" };
const source: MergeTreeNode = { branchId: "root_source", noteId: "source" };
const other: MergeTreeNode = { branchId: "root_other", noteId: "other" };

describe("planSelectionAfterMerge", () => {
    it("keeps the selected note when the merge did not consume it", () => {
        const plan = planSelectionAfterMerge([ target, other ], target, "target", [ "source" ]);
        expect(plan).toEqual({
            branchIds: [ "root_target", "root_other" ],
            selectTarget: false,
            activeNoteId: "target"
        });
    });

    it("selects the note that remains when the selected note was merged away", () => {
        const plan = planSelectionAfterMerge([ source ], source, "target", [ "source" ]);
        expect(plan).toEqual({
            branchIds: [],
            selectTarget: true,
            activeNoteId: "target"
        });
    });

    it("keeps the other selected notes and adds the note that remains", () => {
        const plan = planSelectionAfterMerge(
            [ source, other ], source, "target", [ "source" ]
        );
        expect(plan).toEqual({
            branchIds: [ "root_other" ],
            selectTarget: true,
            activeNoteId: "target"
        });
    });

    it("uses the open note when nothing in the tree is multi-selected", () => {
        const plan = planSelectionAfterMerge([], other, "target", [ "source" ]);
        expect(plan.activeNoteId).toBe("other");
        expect(plan.branchIds).toEqual([ "root_other" ]);
        expect(plan.selectTarget).toBe(false);
    });
});
