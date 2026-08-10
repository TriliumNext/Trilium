import { SpaceUsageSizes } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { buildCanonicalForest, buildNotePath, collectSubtreeNoteIds, computeSubtreeTotals } from "./space_usage.js";

/** Builds a forest from a plain parent → ordered children map; extras model orphan roots. */
function forestOf(edges: Record<string, string[]>, extraNoteIds: string[] = []) {
    const allNoteIds = new Set<string>(extraNoteIds);

    for (const [ parentId, childIds ] of Object.entries(edges)) {
        allNoteIds.add(parentId);
        childIds.forEach((childId) => allNoteIds.add(childId));
    }

    return buildCanonicalForest((noteId) => edges[noteId] ?? [], allNoteIds);
}

function sizeLookup(sizes: Record<string, Partial<SpaceUsageSizes>>) {
    return (noteId: string): SpaceUsageSizes => ({
        ownSize: sizes[noteId]?.ownSize ?? 0,
        attachmentsSize: sizes[noteId]?.attachmentsSize ?? 0,
        revisionsSize: sizes[noteId]?.revisionsSize ?? 0
    });
}

describe("buildCanonicalForest", () => {
    it("mirrors a plain tree: breadth-first order, parents and ordered children", () => {
        const forest = forestOf({ root: [ "a", "b" ], a: [ "c" ] });

        expect(forest.userNoteIds).toEqual([ "root", "a", "b", "c" ]);
        expect(forest.hiddenNoteIds).toEqual([]);
        expect(forest.childrenByNoteId.get("root")).toEqual([ "a", "b" ]);
        expect(forest.childrenByNoteId.get("a")).toEqual([ "c" ]);
        expect(forest.parentByNoteId.get("c")).toBe("a");
        expect(forest.parentByNoteId.has("root")).toBe(false);
    });

    it("adopts a note cloned under two same-depth parents at the earlier sibling", () => {
        const forest = forestOf({ root: [ "a", "b" ], a: [ "x" ], b: [ "x" ] });

        expect(forest.parentByNoteId.get("x")).toBe("a");
        expect(forest.childrenByNoteId.get("b")).toBeUndefined();
    });

    it("adopts a note cloned at several depths at the shallowest one", () => {
        const forest = forestOf({ root: [ "a", "y" ], a: [ "y" ] });

        expect(forest.parentByNoteId.get("y")).toBe("root");
        expect(forest.childrenByNoteId.get("a")).toBeUndefined();
    });

    it("handles a root whose only child is the hidden subtree", () => {
        const forest = forestOf({ root: [ "_hidden" ], _hidden: [ "h1" ] });

        expect(forest.userNoteIds).toEqual([ "root" ]);
        expect(forest.hiddenNoteIds).toEqual([ "_hidden", "h1" ]);
        expect(forest.childrenByNoteId.get("root")).toEqual([ "_hidden" ]);
    });

    it("walks the hidden subtree last, so a note cloned into both worlds stays a user note", () => {
        // `bm` models a bookmark: a user note cloned under the hidden bookmarks folder.
        const forest = forestOf({
            root: [ "_hidden", "a" ],
            _hidden: [ "h1", "bm" ],
            a: [ "bm" ]
        });

        expect(forest.userNoteIds).toEqual([ "root", "a", "bm" ]);
        expect(forest.hiddenNoteIds).toEqual([ "_hidden", "h1" ]);
        expect(forest.parentByNoteId.get("bm")).toBe("a");
        // The hidden subtree lists after the visible children, whatever the branch order was.
        expect(forest.childrenByNoteId.get("root")).toEqual([ "a", "_hidden" ]);
        expect(forest.parentByNoteId.get("_hidden")).toBe("root");
    });

    it("sweeps unreachable notes and their subtrees into the hidden collection", () => {
        const forest = forestOf({ root: [ "a" ], lost: [ "lostChild" ] }, [ "lost" ]);

        expect(forest.userNoteIds).toEqual([ "root", "a" ]);
        expect(forest.hiddenNoteIds).toEqual([ "lost", "lostChild" ]);
        expect(forest.parentByNoteId.get("lostChild")).toBe("lost");
        expect(forest.parentByNoteId.has("lost")).toBe(false);
    });

    it("terminates on a detached cycle, adopting each note once", () => {
        const forest = forestOf({ root: [], one: [ "two" ], two: [ "one" ] }, [ "one", "two" ]);

        expect([ ...forest.hiddenNoteIds ].sort()).toEqual([ "one", "two" ]);
        expect(forest.hiddenNoteIds.length).toBe(2);
    });
});

describe("computeSubtreeTotals", () => {
    // The per-entity revision sizes are fed in and deliberately ignored: a subtree's history is
    // measured deduplicated instead, which no sum of per-note figures can produce.
    it("sums bodies with attachments and counts notes, leaving revisions out", () => {
        const forest = forestOf({ root: [ "a", "b" ], a: [ "c" ] });
        const totals = computeSubtreeTotals(forest, sizeLookup({
            a: { ownSize: 10, attachmentsSize: 5, revisionsSize: 2 },
            b: { ownSize: 3 },
            c: { ownSize: 1, revisionsSize: 1 }
        }));

        expect(totals.get("c")).toEqual({ size: 1, noteCount: 1 });
        expect(totals.get("a")).toEqual({ size: 16, noteCount: 2 });
        expect(totals.get("root")).toEqual({ size: 19, noteCount: 4 });
    });

    it("counts a note cloned into the hidden subtree in its user placement only", () => {
        const forest = forestOf({
            root: [ "_hidden", "a" ],
            _hidden: [ "bm" ],
            a: [ "bm" ]
        });
        const totals = computeSubtreeTotals(forest, sizeLookup({ bm: { ownSize: 7 } }));

        expect(totals.get("a")?.size).toBe(7);
        expect(totals.get("_hidden")).toEqual({ size: 0, noteCount: 1 });
        // The hidden subtree still folds into the root, so the root total covers everything.
        expect(totals.get("root")).toEqual({ size: 7, noteCount: 4 });
    });

    it("survives a pathologically deep chain without recursing", () => {
        const edges: Record<string, string[]> = {};
        let current = "root";
        for (let i = 0; i < 2000; i++) {
            const next = `n${i}`;
            edges[current] = [ next ];
            current = next;
        }

        const forest = forestOf(edges);
        const totals = computeSubtreeTotals(forest, () => ({ ownSize: 1, attachmentsSize: 0, revisionsSize: 0 }));

        expect(totals.get("root")).toEqual({ size: 2001, noteCount: 2001 });
    });
});

describe("collectSubtreeNoteIds", () => {
    it("collects the canonical subtree only — a cloned-in child counts elsewhere", () => {
        const forest = forestOf({ root: [ "a", "b" ], a: [ "x" ], b: [ "x" ] });

        expect(collectSubtreeNoteIds(forest, "a")).toEqual([ "a", "x" ]);
        expect(collectSubtreeNoteIds(forest, "b")).toEqual([ "b" ]);
        expect([ ...collectSubtreeNoteIds(forest, "root") ].sort()).toEqual([ "a", "b", "root", "x" ]);
    });
});

describe("buildNotePath", () => {
    it("walks canonical parents from a top-level note down, omitting the root", () => {
        const forest = forestOf({ root: [ "a" ], a: [ "b" ], b: [ "c" ] });

        expect(buildNotePath(forest.parentByNoteId, "c")).toEqual([ "a", "b", "c" ]);
        expect(buildNotePath(forest.parentByNoteId, "a")).toEqual([ "a" ]);
        expect(buildNotePath(forest.parentByNoteId, "root")).toEqual([]);
    });

    it("gives an orphan a path of itself", () => {
        const forest = forestOf({ root: [] }, [ "lost" ]);

        expect(buildNotePath(forest.parentByNoteId, "lost")).toEqual([ "lost" ]);
    });
});
