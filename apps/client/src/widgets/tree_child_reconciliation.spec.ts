import { describe, expect, it } from "vitest";

import { diffTreeChildren, shouldShowReconciledChildren } from "./tree_child_reconciliation.js";

describe("diffTreeChildren", () => {
    it("reports ghosts left at the old parent and children still missing at the new one", () => {
        expect(diffTreeChildren(
            ["oldParent_noteA", "oldParent_noteB", "oldParent_noteC"],
            ["oldParent_noteA", "oldParent_noteC"]
        )).toEqual({
            toRemove: ["oldParent_noteB"],
            toAdd: []
        });

        expect(diffTreeChildren(
            ["newParent_noteA"],
            ["newParent_noteA", "newParent_noteB"]
        )).toEqual({
            toRemove: [],
            toAdd: ["newParent_noteB"]
        });
    });

    it("is a no-op when the tree already matches froca, including both empty", () => {
        expect(diffTreeChildren(["p_a", "p_b"], ["p_a", "p_b"])).toEqual({
            toRemove: [],
            toAdd: []
        });
        expect(diffTreeChildren([], [])).toEqual({ toRemove: [], toAdd: [] });
    });
});

describe("shouldShowReconciledChildren", () => {
    it("keeps a collapsed unloaded folder lazy, but fills one froca already expanded", () => {
        expect(shouldShowReconciledChildren({
            isFolder: true,
            treeIsLoaded: false,
            treeIsExpanded: false,
            frocaIsExpanded: false
        })).toBe(false);

        expect(shouldShowReconciledChildren({
            isFolder: true,
            treeIsLoaded: false,
            treeIsExpanded: false,
            frocaIsExpanded: true
        })).toBe(true);
    });

    it("syncs a loaded or expanded folder and never a leaf", () => {
        expect(shouldShowReconciledChildren({
            isFolder: true,
            treeIsLoaded: true,
            treeIsExpanded: false,
            frocaIsExpanded: false
        })).toBe(true);

        expect(shouldShowReconciledChildren({
            isFolder: true,
            treeIsLoaded: false,
            treeIsExpanded: true,
            frocaIsExpanded: false
        })).toBe(true);

        expect(shouldShowReconciledChildren({
            isFolder: false,
            treeIsLoaded: true,
            treeIsExpanded: false,
            frocaIsExpanded: false
        })).toBe(false);
    });
});
