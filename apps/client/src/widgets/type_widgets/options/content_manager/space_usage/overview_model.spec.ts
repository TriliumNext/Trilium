import type { SpaceUsageOverviewNote, SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import type { TreemapItem } from "../../../../react/charts/Treemap";
import { buildOverviewModel, hueOf, type OverviewCell } from "./overview_model";

function entry(noteId: string, notePath: string[], sizes: Partial<SpaceUsageOverviewNote> = {}): SpaceUsageOverviewNote {
    return { noteId, notePath, ownSize: 0, attachmentsSize: 0, revisionsSize: 0, ...sizes };
}

function response(notes: SpaceUsageOverviewNote[], overrides: Partial<SpaceUsageOverviewResponse> = {}): SpaceUsageOverviewResponse {
    return {
        content: { size: 0, noteCount: 0, attachmentsSize: 0, revisionsSize: 0 },
        notes,
        otherNotes: { size: 0, revisionsSize: 0, noteCount: 0 },
        hiddenNotes: { size: 0, revisionsSize: 0, noteCount: 0 },
        deletedNotes: { size: 0, noteCount: 0, attachmentCount: 0 },
        unusedAttachments: { size: 0, attachmentCount: 0 },
        total: { size: 0, revisionsSize: 0, noteCount: 0 },
        ...overrides
    };
}

function build(overview: SpaceUsageOverviewResponse, includeRevisions = false) {
    return buildOverviewModel(overview, {
        otherNotesLabel: "Other notes",
        hiddenNotesLabel: "Hidden notes",
        revisionsLabel: "Revisions",
        deletedNotesLabel: "Deleted notes",
        includeRevisions,
        makeSizeDetail: (size, attachmentsSize) => `size:${size}/att:${attachmentsSize}`
    });
}

function childById(parent: TreemapItem<OverviewCell>, id: string) {
    const child = (parent.children ?? []).find((candidate) => candidate.id === id);
    if (!child) throw new Error(`No child '${id}' under '${parent.id}'`);
    return child;
}

describe("buildOverviewModel", () => {
    it("nests entries at their tree location; ancestors shape the layout but carry nothing", () => {
        const model = build(response([
            entry("leaf", [ "folder", "leaf" ], { ownSize: 100, attachmentsSize: 20 })
        ]));

        const folder = childById(model, "folder");
        expect(folder.value).toBeUndefined();
        expect(folder.attributes).toBeUndefined();
        expect(folder.data).toBeUndefined();

        const leaf = childById(folder, "leaf");
        expect(leaf.value).toBe(120);
        // The path the cell's actions need, rooted — unlike the server's, which omits the root.
        expect(leaf.data).toEqual({ noteId: "leaf", notePath: [ "root", "folder", "leaf" ] });
        // The size rides along in the note preview tooltip rather than a second tooltip of its own.
        expect(leaf.attributes).toEqual({
            "data-href": "#root/folder/leaf",
            "data-tooltip-detail": "size:120/att:20"
        });
    });

    it("states the size its area encodes and how much of it is attachments, or stays silent", () => {
        const overview = response([ entry("a", [ "a" ], { ownSize: 5, revisionsSize: 7 }) ]);
        const detailOf = (model: TreemapItem<OverviewCell>) =>
            childById(model, "a").attributes?.["data-tooltip-detail"];

        expect(detailOf(build(overview, true))).toBe("size:12/att:0");

        // The attachment share is the note's own figure, whatever the weight happens to cover.
        const withAttachments = response([ entry("a", [ "a" ], { ownSize: 5, attachmentsSize: 30 }) ]);
        expect(detailOf(build(withAttachments))).toBe("size:35/att:30");

        const silent = buildOverviewModel(overview, {
            otherNotesLabel: "Other notes",
            hiddenNotesLabel: "Hidden notes",
            revisionsLabel: "Revisions",
            deletedNotesLabel: "Deleted notes",
            includeRevisions: true
        });
        expect(childById(silent, "a").attributes).toEqual({ "data-href": "#root/a" });
    });

    it("colors cells by their parent: siblings share a hue, other groups get their own", () => {
        const model = build(response([
            entry("a1", [ "parentA", "a1" ], { ownSize: 1 }),
            entry("a2", [ "parentA", "a2" ], { ownSize: 1 }),
            entry("b1", [ "parentB", "b1" ], { ownSize: 1 }),
            entry("top", [ "top" ], { ownSize: 1 })
        ]));

        const parentA = childById(model, "parentA");
        expect(childById(parentA, "a1").hue).toBe(hueOf("parentA"));
        expect(childById(parentA, "a2").hue).toBe(hueOf("parentA"));
        expect(childById(childById(model, "parentB"), "b1").hue).toBe(hueOf("parentB"));
        expect(childById(model, "top").hue).toBe(hueOf("root"));
    });

    it("dresses both a plain cell and a self-cell in the note's icon, leaving unknown notes plain", () => {
        const model = buildOverviewModel(
            response([ entry("parent", [ "parent" ], { ownSize: 50 }), entry("child", [ "parent", "child" ], { ownSize: 10 }) ]),
            {
                otherNotesLabel: "Other notes",
                hiddenNotesLabel: "Hidden notes",
                revisionsLabel: "Revisions",
                deletedNotesLabel: "Deleted notes",
                includeRevisions: false,
                getIcon: (noteId) => noteId === "parent" ? "tn-icon bx bx-folder" : undefined
            }
        );

        const parent = childById(model, "parent");
        expect(childById(parent, "parent/own").icon).toBe("tn-icon bx bx-folder");
        // Not yet loaded (or already gone): the cell simply keeps its color and nothing else.
        expect(childById(parent, "child").icon).toBeUndefined();
    });

    it("gives an entry that is also an ancestor a nested self-cell wearing its children's hue", () => {
        const model = build(response([
            entry("parent", [ "parent" ], { ownSize: 50 }),
            entry("child", [ "parent", "child" ], { ownSize: 10 })
        ]));

        const parent = childById(model, "parent");
        expect(parent.value).toBeUndefined();

        const selfCell = childById(parent, "parent/own");
        expect(selfCell.value).toBe(50);
        expect(selfCell.hue).toBe(hueOf("parent"));
        expect(selfCell.data).toEqual({ noteId: "parent", notePath: [ "root", "parent" ] });
        expect(selfCell.attributes).toEqual({
            "data-href": "#root/parent",
            "data-tooltip-detail": "size:50/att:0"
        });
        expect(childById(parent, "child").value).toBe(10);
    });

    it("counts revisions into the weights only when asked to", () => {
        const notes = [ entry("a", [ "a" ], { ownSize: 5, revisionsSize: 7 }) ];
        const buckets = {
            otherNotes: { size: 30, revisionsSize: 4, noteCount: 9 },
            hiddenNotes: { size: 2, revisionsSize: 3, noteCount: 5 }
        };

        const without = build(response(notes, buckets));
        expect(childById(without, "a").value).toBe(5);
        expect(childById(without, "/other-notes").value).toBe(30);
        expect(childById(without, "/hidden-notes").value).toBe(2);

        const withRevisions = build(response(notes, buckets), true);
        expect(childById(withRevisions, "a").value).toBe(12);
        expect(childById(withRevisions, "/other-notes").value).toBe(34);
        expect(childById(withRevisions, "/hidden-notes").value).toBe(5);
    });

    it("appends inert bucket cells, identified by the chart tooltip rather than a note preview", () => {
        const model = build(response([], {
            otherNotes: { size: 11, revisionsSize: 0, noteCount: 3 },
            hiddenNotes: { size: 7, revisionsSize: 5, noteCount: 40 },
            deletedNotes: { size: 22, noteCount: 2, attachmentCount: 0 }
        }));

        const other = childById(model, "/other-notes");
        expect(other.value).toBe(11);
        expect(other.hue).toBeUndefined();
        // Named rather than empty: a bucket's own actions key off which crowd it stands for.
        expect(other.data).toEqual({ bucket: "other" });
        expect(other.tooltip).toBe("Other notes");
        // No `data-href`: a crowd of notes has no note preview to show.
        expect(other.attributes).toBeUndefined();
        // A bucket names no note, so it wears what it stands for.
        expect(other.icon).toBe("bx bx-dots-horizontal-rounded");

        // Hidden space gets a cell too — every byte the status line counts is on the map.
        const hidden = childById(model, "/hidden-notes");
        expect(hidden.value).toBe(7);
        expect(hidden.className).toBe("treemap-cell-hidden");
        expect(hidden.tooltip).toBe("Hidden notes");
        expect(hidden.icon).toBe("bx bx-hide");

        const deleted = childById(model, "/deleted-notes");
        expect(deleted.value).toBe(22);
        expect(deleted.className).toBe("treemap-cell-deleted");
        expect(deleted.tooltip).toBe("Deleted notes");
        expect(deleted.icon).toBe("bx bx-trash-alt");
        expect(deleted.data).toEqual({ bucket: "deleted" });
    });

    it("sizes the revisions bucket from the deduplicated content tier, not the per-note figures", () => {
        const model = build(response(
            // Per-note revision sizes count each blob again at every entity sharing it, so they add
            // up to far more than the database spent — the bucket must ignore them entirely.
            [ entry("a", [ "a" ], { ownSize: 5, revisionsSize: 900 }) ],
            {
                content: { size: 60, noteCount: 1, attachmentsSize: 0, revisionsSize: 40 },
                hiddenNotes: { size: 0, revisionsSize: 700, noteCount: 2 }
            }
        ));

        const revisions = childById(model, "/revisions");
        expect(revisions.value).toBe(40);
        expect(revisions.className).toBe("treemap-cell-revisions");
        expect(revisions.icon).toBe("bx bx-history");
        expect(revisions.tooltip).toBe("Revisions");
        // Inert like the other buckets: history is not a note to preview or open.
        expect(revisions.data).toEqual({ bucket: "revisions" });
        expect(revisions.attributes).toBeUndefined();
    });

    it("places an entry for the root itself as a top-level cell", () => {
        const model = build(response([ entry("root", [], { ownSize: 9 }) ]));

        expect(childById(model, "root").value).toBe(9);
    });

    it("leaves a zero-weight entry as an empty cell rather than a zero-sized one", () => {
        const model = build(response([ entry("empty", [ "empty" ]) ]));

        const empty = childById(model, "empty");
        expect(empty.value).toBeUndefined();
        expect(empty.attributes).toBeUndefined();
    });
});

describe("hueOf", () => {
    it("is stable and stays within the hue circle", () => {
        expect(hueOf("someNoteId")).toBe(hueOf("someNoteId"));
        for (const id of [ "", "root", "a", "0123456789abcdef" ]) {
            expect(hueOf(id)).toBeGreaterThanOrEqual(0);
            expect(hueOf(id)).toBeLessThan(360);
        }
    });
});
