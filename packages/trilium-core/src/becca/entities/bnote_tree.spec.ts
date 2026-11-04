import { afterEach, describe, expect, it, vi } from "vitest";

import becca from "../becca.js";
import attributeService from "../../services/attributes.js";
import cloningService from "../../services/cloning.js";
import { getContext } from "../../services/context.js";
import noteService from "../../services/notes.js";
import searchService from "../../services/search/services/search.js";
import { buildNote } from "../../test/becca_easy_mocking.js";
import type BBranch from "./bbranch.js";
import type BNote from "./bnote.js";
import { compareNotePathRecords } from "./bnote.js";

let counter = 0;

/**
 * Creates a fresh note under the given parent in the real in-memory DB.
 * Each call uses a unique title since the same fixture DB is shared between
 * the `it()`s in this file.
 */
function createNote(
    parentNoteId: string,
    type: "text" | "search" = "text",
    content = "<p>hello</p>"
): { note: BNote; branch: BBranch } {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId,
            title: `bnote-tree-spec-${counter}`,
            content: type === "search" ? "" : content,
            type
        })
    );
}

describe("BNote tree / note-path / subtree methods (real DB)", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("getBranches (deprecated alias)", () => {
        it("returns the same parent branches as getParentBranches()", () => {
            const { note } = createNote("root");

            // Lines 180-181: deprecated alias returns the raw parentBranches array.
            expect(note.getBranches()).toBe(note.getParentBranches());
            expect(note.getBranches().some((b) => b.parentNoteId === "root")).toBe(true);
        });
    });

    describe("isArchived / areAllNotePathsArchived / hasInheritableArchivedLabel", () => {
        it("reports a directly archived note and resolves the best note path as archived", () => {
            const { note } = createNote("root");
            getContext().init(() => attributeService.createLabel(note.noteId, "archived", ""));

            expect(note.isArchived).toBe(true);
            // Lines 713-725: best note path record exists and is flagged archived.
            expect(note.areAllNotePathsArchived()).toBe(true);
        });

        it("reports a non-archived note as not having all paths archived", () => {
            const { note } = createNote("root");

            expect(note.isArchived).toBe(false);
            expect(note.areAllNotePathsArchived()).toBe(false);
        });

        it("throws when the note has no available note path", () => {
            // An orphan in-memory note (no parent branch) yields no note paths,
            // so getSortedNotePathRecords()[0] is undefined and the guard throws.
            const orphan = buildNote({ id: `bnote-tree-orphan-${++counter}`, title: "orphan" });
            expect(orphan.getParentBranches().length).toBe(0);
            // Lines 721-723: missing best note path record throws.
            expect(() => orphan.areAllNotePathsArchived()).toThrow();
        });

        it("detects an inheritable archived label and skips a non-inheritable one", () => {
            const inheritable = createNote("root").note;
            getContext().init(() =>
                attributeService.createAttribute({
                    noteId: inheritable.noteId,
                    type: "label",
                    name: "archived",
                    value: "",
                    isInheritable: true
                })
            );
            // Lines 730-731: inheritable archived label found.
            expect(inheritable.hasInheritableArchivedLabel()).toBe(true);

            const plain = createNote("root").note;
            getContext().init(() => attributeService.createLabel(plain.noteId, "archived", ""));
            // Non-inheritable archived label: loop completes without an early return.
            expect(plain.hasInheritableArchivedLabel()).toBe(false);
        });
    });

    describe("sortParents", () => {
        it("orders archived and hidden-completely parents after a normal parent", () => {
            const child = createNote("root").note;

            const normalParent = createNote("root").note;
            const archivedParent = createNote("root").note;
            getContext().init(() => attributeService.createLabel(archivedParent.noteId, "archived", ""));

            // A parent that is hidden completely: create it under root, clone it
            // into _hidden and drop the root branch so its only path is via _hidden.
            const hiddenParent = createNote("root");
            getContext().init(() => {
                cloningService.cloneNoteToParentNote(hiddenParent.note.noteId, "_hidden");
                cloningService.ensureNoteIsAbsentFromParent(hiddenParent.note.noteId, "root");
            });
            expect(hiddenParent.note.isHiddenCompletely()).toBe(true);

            getContext().init(() => {
                cloningService.cloneNoteToParentNote(child.noteId, normalParent.noteId);
                cloningService.cloneNoteToParentNote(child.noteId, archivedParent.noteId);
                cloningService.cloneNoteToParentNote(child.noteId, hiddenParent.note.noteId);
            });

            child.sortParents();

            // Lines 742-746: the comparator pushes archived / hidden-completely
            // parents toward the end. The first parent must not be archived nor
            // hidden-completely.
            const first = child.parents[0];
            expect(first).toBeDefined();
            expect(first?.isArchived).toBe(false);
            expect(first?.isHiddenCompletely()).toBe(false);
            // The archived and hidden parents are still present, just reordered.
            const parentIds = child.parents.map((p) => p.noteId);
            expect(parentIds).toContain(archivedParent.noteId);
            expect(parentIds).toContain(hiddenParent.note.noteId);
        });
    });

    describe("getFlatText", () => {
        it("includes the branch prefix in the flattened text", () => {
            const parent = createNote("root").note;
            const child = createNote("root").note;

            getContext().init(() =>
                cloningService.cloneNoteToParentNote(child.noteId, parent.noteId, "MYPREFIX")
            );
            child.invalidateThisCache();

            // Lines 780-781: branch prefix contributes to the flat text.
            expect(child.getFlatText()).toContain("myprefix");
        });
    });

    describe("invalidateSubTree", () => {
        it("walks children and template/inherit target relations without infinite recursion", () => {
            const parent = createNote("root").note;
            const child = createNote(parent.noteId).note;
            createNote(child.noteId);

            const template = createNote("root").note;
            const instance = createNote("root").note;
            // instance ~template-> template, so template has a target relation.
            getContext().init(() =>
                attributeService.createRelation(instance.noteId, "template", template.noteId)
            );

            // Lines 815-838: descends into children and target relations.
            expect(() => parent.invalidateSubTree()).not.toThrow();
            expect(() => template.invalidateSubTree()).not.toThrow();

            // Re-entrancy guard (line 816-817): calling with this note already in
            // the path returns immediately.
            expect(() => parent.invalidateSubTree([parent.noteId])).not.toThrow();
        });
    });

    describe("getSubtreeNotesIncludingTemplated", () => {
        it("descends into children, follows template/inherit targets, dedups, and skips _hidden", () => {
            const subtreeRoot = createNote("root").note;
            const child = createNote(subtreeRoot.noteId).note;
            const grandchild = createNote(child.noteId).note;

            // An instance whose ~template relation targets `child`; walking `child`'s
            // targetRelations therefore reaches `instance`.
            const instance = createNote("root").note;
            getContext().init(() => attributeService.createRelation(instance.noteId, "template", child.noteId));

            // Walking from subtreeRoot: recurses into child (line 866-867) and
            // grandchild, then follows child's target relation to instance.
            const notes = subtreeRoot.getSubtreeNotesIncludingTemplated();
            expect(notes).toContain(subtreeRoot);
            expect(notes).toContain(child);
            expect(notes).toContain(grandchild);
            // Lines 870-874: template target relation followed to the instance.
            expect(notes).toContain(instance);

            // Dedup (line 860): calling again yields the same set size.
            const again = subtreeRoot.getSubtreeNotesIncludingTemplated();
            expect(again.length).toBe(notes.length);

            // _hidden short-circuit (line 860): _hidden is never included in its
            // own templated subtree.
            const hidden = becca.getNoteOrThrow("_hidden");
            expect(hidden.getSubtreeNotesIncludingTemplated()).not.toContain(hidden);
        });

        it("follows ~inherit targets and ignores non-template/inherit target relations", () => {
            const root = createNote("root").note;
            const viaInherit = createNote("root").note;
            const viaOther = createNote("root").note;
            getContext().init(() => {
                // Line 871 right operand: name === "inherit".
                attributeService.createRelation(viaInherit.noteId, "inherit", root.noteId);
                // Line 871 false side: a target relation that is neither template nor inherit.
                attributeService.createRelation(viaOther.noteId, "internalLink", root.noteId);
            });

            const notes = root.getSubtreeNotesIncludingTemplated();
            expect(notes).toContain(viaInherit);
            expect(notes).not.toContain(viaOther);
        });
    });

    describe("getSearchResultNotes", () => {
        it("returns [] for a non-search note", () => {
            const { note } = createNote("root");
            // Lines 884-887: early return for non-search notes.
            expect(note.getSearchResultNotes()).toEqual([]);
        });

        it("resolves results for a search note via the search service", () => {
            const target = createNote("root").note;

            const search = createNote("root", "search").note;
            getContext().init(() =>
                attributeService.createLabel(search.noteId, "searchString", `note.title = "${target.title}"`)
            );

            // Lines 889-896: searchFromNote runs and result ids map to becca notes.
            const results = search.getSearchResultNotes();
            expect(Array.isArray(results)).toBe(true);
            expect(results.some((n) => n.noteId === target.noteId)).toBe(true);
        });

        it("returns [] and logs when the search service throws", () => {
            const search = createNote("root", "search").note;
            vi.spyOn(searchService, "searchFromNote").mockImplementation(() => {
                throw new Error("boom");
            });

            // Lines 893-896: the catch block swallows the error and returns [].
            expect(search.getSearchResultNotes()).toEqual([]);
        });
    });

    describe("getSubtree", () => {
        it("collects the subtree with relationships and dedups clones", () => {
            const root = createNote("root").note;
            const a = createNote(root.noteId).note;
            const b = createNote(root.noteId).note;
            // Clone `a` under `b` so we get two relationships to the same note.
            getContext().init(() => cloningService.cloneNoteToParentNote(a.noteId, b.noteId));

            const { notes, relationships } = root.getSubtree();
            const noteIds = notes.map((n) => n.noteId);
            expect(noteIds).toContain(root.noteId);
            expect(noteIds).toContain(a.noteId);
            expect(noteIds).toContain(b.noteId);
            // `a` appears once in notes (dedup) but is referenced by two relationships.
            expect(noteIds.filter((id) => id === a.noteId).length).toBe(1);
            expect(
                relationships.filter((r) => r.childNoteId === a.noteId).length
            ).toBeGreaterThanOrEqual(2);
        });

        it("skips the _hidden subtree by default but includes it when requested", () => {
            const root = becca.getNoteOrThrow("root");

            // Default (includeHidden: false) skips _hidden (line 917-920).
            const withoutHidden = root.getSubtree().notes.map((n) => n.noteId);
            expect(withoutHidden).not.toContain("_hidden");

            // includeHidden: true keeps _hidden in the walk.
            const withHidden = root.getSubtree({ includeHidden: true }).notes.map((n) => n.noteId);
            expect(withHidden).toContain("_hidden");
        });

        it("skips archived children when includeArchived is false", () => {
            const root = createNote("root").note;
            const normal = createNote(root.noteId).note;
            const archived = createNote(root.noteId).note;
            getContext().init(() => attributeService.createLabel(archived.noteId, "archived", ""));

            const noteIds = root
                .getSubtree({ includeArchived: false })
                .notes.map((n) => n.noteId);
            // Lines 933-934: archived child is skipped.
            expect(noteIds).toContain(normal.noteId);
            expect(noteIds).not.toContain(archived.noteId);
        });

        it("resolves a search note's results into the subtree when resolveSearch is set", () => {
            const target = createNote("root").note;

            const parent = createNote("root").note;
            const search = createNote(parent.noteId, "search").note;
            getContext().init(() =>
                attributeService.createLabel(search.noteId, "searchString", `note.title = "${target.title}"`)
            );

            // Lines 906-910 / 939-942: resolveSearch walks the search results.
            const { notes } = parent.getSubtree({ resolveSearch: true });
            const noteIds = notes.map((n) => n.noteId);
            expect(noteIds).toContain(search.noteId);
            expect(noteIds).toContain(target.noteId);
        });

        it("swallows errors while resolving a search note during subtree walk", () => {
            const parent = createNote("root").note;
            const search = createNote(parent.noteId, "search").note;

            // Force the inner resolveSearchNote try-block to throw (line 912 catch).
            vi.spyOn(search, "getSearchResultNotes").mockImplementation(() => {
                throw new Error("boom");
            });

            const { notes } = parent.getSubtree({ resolveSearch: true });
            const noteIds = notes.map((n) => n.noteId);
            // The walk still completes and includes the parent and the search note.
            expect(noteIds).toContain(parent.noteId);
            expect(noteIds).toContain(search.noteId);
        });
    });

    describe("getAncestors", () => {
        it("dedups a shared ancestor reached via two parents", () => {
            const ancestor = createNote("root").note;
            const left = createNote(ancestor.noteId).note;
            const right = createNote(ancestor.noteId).note;
            const leaf = createNote(left.noteId).note;
            // Clone leaf under `right` too: now leaf reaches `ancestor` via both
            // `left` and `right`.
            getContext().init(() => cloningService.cloneNoteToParentNote(leaf.noteId, right.noteId));

            const ancestorIds = leaf.getAncestorNoteIds();
            // ancestor must appear exactly once despite two paths.
            expect(ancestorIds.filter((id) => id === ancestor.noteId).length).toBe(1);
            expect(ancestorIds).toContain("root");
        });

        it("skips a direct parent that is also an ancestor of an earlier parent", () => {
            // grandparent -> parent -> leaf, and leaf is ALSO cloned directly under
            // grandparent. So `leaf.parents` contains both `parent` and `grandparent`,
            // and `grandparent` is reached via `parent`'s ancestor walk first. The
            // outer loop then hits the dedup `continue` for `grandparent`.
            const grandparent = createNote("root").note;
            const parent = createNote(grandparent.noteId).note;
            const leaf = createNote(parent.noteId).note;
            getContext().init(() => cloningService.cloneNoteToParentNote(leaf.noteId, grandparent.noteId));

            const ancestorIds = leaf.getAncestorNoteIds();
            expect(ancestorIds.filter((id) => id === grandparent.noteId).length).toBe(1);
            expect(ancestorIds).toContain(parent.noteId);
        });
    });

    describe("getInheritingNotes", () => {
        it("includes notes whose template/inherit relation targets this note", () => {
            const template = createNote("root").note;
            const instance = createNote("root").note;
            getContext().init(() =>
                attributeService.createRelation(instance.noteId, "template", template.noteId)
            );

            const inheriting = template.getInheritingNotes();
            expect(inheriting).toContain(template);
            // Line 1069-1074: the templated instance is included.
            expect(inheriting.some((n) => n.noteId === instance.noteId)).toBe(true);
        });

        it("follows ~inherit relations and ignores non-template/inherit target relations", () => {
            const template = createNote("root").note;
            const viaInherit = createNote("root").note;
            const viaOther = createNote("root").note;
            getContext().init(() => {
                // Line 1071 right operand: name === "inherit".
                attributeService.createRelation(viaInherit.noteId, "inherit", template.noteId);
                // Line 1071 false side: a non-template/inherit target relation is skipped.
                attributeService.createRelation(viaOther.noteId, "internalLink", template.noteId);
            });

            const inheriting = template.getInheritingNotes();
            expect(inheriting.some((n) => n.noteId === viaInherit.noteId)).toBe(true);
            expect(inheriting.some((n) => n.noteId === viaOther.noteId)).toBe(false);
        });
    });

    describe("getSortedNotePathRecords / getBestNotePath", () => {
        it("sorts visible paths before archived and hidden ones", () => {
            const visibleParent = createNote("root").note;
            const archivedParent = createNote("root").note;
            getContext().init(() => attributeService.createLabel(archivedParent.noteId, "archived", ""));

            const leaf = createNote(visibleParent.noteId).note;
            getContext().init(() => {
                cloningService.cloneNoteToParentNote(leaf.noteId, archivedParent.noteId);
                cloningService.cloneNoteToParentNote(leaf.noteId, "_hidden");
            });

            const records = leaf.getSortedNotePathRecords();
            expect(records.length).toBeGreaterThanOrEqual(3);

            // Lines 1167-1183: comparators evaluate hoisted / archived / hidden.
            // The best (first) path goes through the visible, non-archived parent.
            const best = leaf.getBestNotePath();
            expect(best).toContain(visibleParent.noteId);
            expect(best).not.toContain("_hidden");

            const bestString = leaf.getBestNotePathString();
            expect(bestString).toBe(best.join("/"));

            // At least one path is flagged hidden and one archived.
            expect(records.some((r) => r.isHidden)).toBe(true);
            expect(records.some((r) => r.isArchived)).toBe(true);
        });

        it("prefers the path inside the hoisted subtree", () => {
            const hoisted = createNote("root").note;
            const outside = createNote("root").note;
            const leaf = createNote(hoisted.noteId).note;
            getContext().init(() => cloningService.cloneNoteToParentNote(leaf.noteId, outside.noteId));

            // Lines 1169 / 1175-1176: isInHoistedSubTree comparator wins.
            const best = leaf.getBestNotePath(hoisted.noteId);
            expect(best).toContain(hoisted.noteId);
        });

        it("evaluates both arms of the hoisted / archived / hidden comparators", () => {
            // Many diverse paths so the sort comparator is invoked in both orderings,
            // exercising the `? -1 : 1` / `? 1 : -1` arms (lines 1176-1184).
            const hoisted = createNote("root").note;
            const out1 = createNote("root").note;
            const out2 = createNote("root").note;
            const archivedParent = createNote("root").note;
            getContext().init(() => attributeService.createLabel(archivedParent.noteId, "archived", ""));

            const leaf = createNote(hoisted.noteId).note;
            getContext().init(() => {
                cloningService.cloneNoteToParentNote(leaf.noteId, out1.noteId);
                cloningService.cloneNoteToParentNote(leaf.noteId, out2.noteId);
                cloningService.cloneNoteToParentNote(leaf.noteId, archivedParent.noteId);
                cloningService.cloneNoteToParentNote(leaf.noteId, "_hidden");
            });

            // Hoisted: one path is inside the hoisted subtree, the rest are outside,
            // so the isInHoistedSubTree comparator returns both -1 and 1.
            const hoistedRecords = leaf.getSortedNotePathRecords(hoisted.noteId);
            expect(hoistedRecords[0].isInHoistedSubTree).toBe(true);
            expect(hoistedRecords.some((r) => !r.isInHoistedSubTree)).toBe(true);

            // Default (root) hoist: all paths are in-hoist, so the comparator falls
            // through to the archived and hidden arms.
            const rootRecords = leaf.getSortedNotePathRecords();
            expect(rootRecords[0].isArchived).toBe(false);
            expect(rootRecords[0].isHidden).toBe(false);
            expect(rootRecords.some((r) => r.isArchived)).toBe(true);
            expect(rootRecords.some((r) => r.isHidden)).toBe(true);
        });
    });

    describe("compareNotePathRecords (pure ordering)", () => {
        const npr = (o: { isInHoistedSubTree?: boolean; isArchived?: boolean; isHidden?: boolean; notePath?: string[] }) => ({
            notePath: o.notePath ?? ["root", "x"],
            isInHoistedSubTree: o.isInHoistedSubTree ?? true,
            isArchived: o.isArchived ?? false,
            isHidden: o.isHidden ?? false
        });

        it("ranks hoisted, then non-archived, then non-hidden, then shorter paths (both arg orders)", () => {
            // isInHoistedSubTree comparator, both arms (lines 1177-1178).
            expect(compareNotePathRecords(npr({ isInHoistedSubTree: true }), npr({ isInHoistedSubTree: false }))).toBeLessThan(0);
            expect(compareNotePathRecords(npr({ isInHoistedSubTree: false }), npr({ isInHoistedSubTree: true }))).toBeGreaterThan(0);

            // isArchived comparator, both arms (lines 1179-1180).
            expect(compareNotePathRecords(npr({ isArchived: true }), npr({ isArchived: false }))).toBeGreaterThan(0);
            expect(compareNotePathRecords(npr({ isArchived: false }), npr({ isArchived: true }))).toBeLessThan(0);

            // isHidden comparator, both arms (lines 1181-1182).
            expect(compareNotePathRecords(npr({ isHidden: true }), npr({ isHidden: false }))).toBeGreaterThan(0);
            expect(compareNotePathRecords(npr({ isHidden: false }), npr({ isHidden: true }))).toBeLessThan(0);

            // All flags equal: fall back to path length (line 1184).
            expect(compareNotePathRecords(npr({ notePath: ["root", "x"] }), npr({ notePath: ["root", "a", "x"] }))).toBeLessThan(0);
            expect(compareNotePathRecords(npr({}), npr({}))).toBe(0);
        });
    });

    describe("getFilteredChildBranches / visible children", () => {
        it("returns child branches and reports folder status", () => {
            const parent = createNote("root").note;
            createNote(parent.noteId);

            // Lines 1722-1735: returns the child branches array.
            const filtered = parent.getFilteredChildBranches();
            expect(filtered.length).toBeGreaterThanOrEqual(1);
            expect(parent.isFolder()).toBe(true);
        });

        it("returns [] and logs when child branches are unexpectedly absent", () => {
            const parent = createNote("root").note;
            // Defensive guard (lines 1725-1727): getChildBranches() always returns
            // an array in practice, so force the falsy case to exercise the guard.
            vi.spyOn(parent, "getChildBranches").mockReturnValue(
                undefined as unknown as ReturnType<BNote["getChildBranches"]>
            );

            expect(parent.getFilteredChildBranches()).toEqual([]);
        });

        it("filters out shareHiddenFromTree and underscore-prefixed notes from visible children", () => {
            const parent = createNote("root").note;
            const visible = createNote(parent.noteId).note;
            const hiddenLabelled = createNote(parent.noteId).note;
            getContext().init(() =>
                attributeService.createLabel(hiddenLabelled.noteId, "shareHiddenFromTree", "true")
            );

            // Lines 1742-1746: visible branches exclude shareHiddenFromTree notes.
            const visibleNotes = parent.getVisibleChildNotes();
            const visibleIds = visibleNotes.map((n) => n.noteId);
            expect(visibleIds).toContain(visible.noteId);
            expect(visibleIds).not.toContain(hiddenLabelled.noteId);

            // Lines 1749-1754: hasVisibleChildren reflects the filtered set.
            expect(parent.hasVisibleChildren()).toBe(true);

            // The "_"-prefixed branch of the filter (line 1745): every visible
            // child branch under _hidden must be a non-underscore note, since all
            // of _hidden's system children are filtered out.
            const hidden = becca.getNoteOrThrow("_hidden");
            expect(hidden.getVisibleChildBranches().every((b) => !b.noteId.startsWith("_"))).toBe(true);

            // A note whose only child is underscore-prefixed has no visible
            // children: clone a system "_"-note into a fresh parent.
            const emptyParent = createNote("root").note;
            getContext().init(() =>
                cloningService.cloneNoteToParentNote("_globalNoteMap", emptyParent.noteId)
            );
            expect(emptyParent.getChildNotes().length).toBeGreaterThanOrEqual(1);
            expect(emptyParent.getVisibleChildBranches().length).toBe(0);
            expect(emptyParent.hasVisibleChildren()).toBe(false);
        });
    });
});
