import { describe, expect, it } from "vitest";

import { getBecca } from "./becca.js";
import beccaService from "./becca_service.js";
import BAttribute from "./entities/battribute.js";
import BBranch from "./entities/bbranch.js";
import { buildNote } from "../test/becca_easy_mocking.js";

let counter = 0;

/**
 * Returns a unique note id so the process-wide becca singleton does not get
 * polluted by leftovers from previous `it()`s in this file.
 */
function uniqueId(prefix: string) {
    counter++;
    return `${prefix}_${counter}`;
}

/**
 * Creates an in-memory branch (registered in becca) linking child to parent,
 * optionally with a prefix. The note graph helpers don't set prefixes, so we
 * build the branch directly here.
 */
function linkBranch(childNoteId: string, parentNoteId: string, prefix: string | null = null) {
    return new BBranch({
        branchId: `${parentNoteId}_${childNoteId}`,
        noteId: childNoteId,
        parentNoteId,
        prefix,
        notePosition: 0,
        isExpanded: false,
        utcDateModified: ""
    });
}

describe("becca_service", () => {
    describe("isNotePathArchived", () => {
        it("returns true when the last note in the path is itself archived", () => {
            const id = uniqueId("archivedLeaf");
            buildNote({ id, title: "leaf", "#archived": "" });

            expect(beccaService.isNotePathArchived([id])).toBe(true);
        });

        it("returns true when an ancestor has an inheritable archived label", () => {
            const ancestorId = uniqueId("inheritAncestor");
            const leafId = uniqueId("inheritLeaf");

            const ancestor = buildNote({ id: ancestorId, title: "ancestor" });
            buildNote({ id: leafId, title: "leaf" });

            // Inheritable archived label on the ancestor (not on the leaf itself).
            new BAttribute({
                noteId: ancestorId,
                attributeId: uniqueId("attr"),
                type: "label",
                name: "archived",
                value: "",
                position: 0,
                isInheritable: true
            });
            expect(ancestor.hasInheritableArchivedLabel()).toBe(true);

            expect(beccaService.isNotePathArchived([ancestorId, leafId])).toBe(true);
        });

        it("returns false when neither the leaf nor any ancestor is archived", () => {
            const ancestorId = uniqueId("plainAncestor");
            const leafId = uniqueId("plainLeaf");

            buildNote({ id: ancestorId, title: "ancestor" });
            buildNote({ id: leafId, title: "leaf" });

            expect(beccaService.isNotePathArchived([ancestorId, leafId])).toBe(false);
        });
    });

    describe("getNoteTitle", () => {
        it("returns the plain title when no parent prefix is involved", () => {
            const id = uniqueId("plainTitle");
            buildNote({ id, title: "Hello World" });

            expect(beccaService.getNoteTitle(id)).toBe("Hello World");
        });

        it("returns an error placeholder when the note is missing", () => {
            const title = beccaService.getNoteTitle(uniqueId("missing"));

            expect(title).toBe("[error fetching title]");
        });

        it("prepends the branch prefix when the parent branch has one", () => {
            const parentId = uniqueId("prefixParent");
            const childId = uniqueId("prefixChild");

            buildNote({ id: parentId, title: "parent" });
            buildNote({ id: childId, title: "child" });
            linkBranch(childId, parentId, "PFX");

            expect(beccaService.getNoteTitle(childId, parentId)).toBe("PFX - child");
        });

        it("returns just the title when the parent branch has no prefix", () => {
            const parentId = uniqueId("noPrefixParent");
            const childId = uniqueId("noPrefixChild");

            buildNote({ id: parentId, title: "parent" });
            buildNote({ id: childId, title: "child" });
            linkBranch(childId, parentId, null);

            expect(beccaService.getNoteTitle(childId, parentId)).toBe("child");
        });
    });

    describe("getNoteTitleAndIcon", () => {
        it("returns both the icon and the title for an existing note", () => {
            const id = uniqueId("iconTitle");
            buildNote({ id, title: "With Icon" });

            const result = beccaService.getNoteTitleAndIcon(id);

            expect(result.title).toBe("With Icon");
            expect(typeof result.icon).toBe("string");
        });

        it("returns an error placeholder and no icon when the note is missing", () => {
            const result = beccaService.getNoteTitleAndIcon(uniqueId("missingIcon"));

            expect(result.title).toBe("[error fetching title]");
            expect(result.icon).toBeUndefined();
        });

        it("prepends the branch prefix when the parent branch has one", () => {
            const parentId = uniqueId("iconPrefixParent");
            const childId = uniqueId("iconPrefixChild");

            buildNote({ id: parentId, title: "parent" });
            buildNote({ id: childId, title: "child" });
            linkBranch(childId, parentId, "PFX");

            const result = beccaService.getNoteTitleAndIcon(childId, parentId);

            expect(result.title).toBe("PFX - child");
            expect(typeof result.icon).toBe("string");
        });
    });

    describe("getNoteTitleForPath", () => {
        it("returns the single title for a one-element path", () => {
            const id = uniqueId("singlePath");
            buildNote({ id, title: "Only Note" });

            expect(beccaService.getNoteTitleForPath([id])).toBe("Only Note");
        });

        it("joins multiple titles with the separator, starting after the hoisted root", () => {
            // The default hoisted note is "root", so the path must start with it
            // for the collected titles to begin at the first real child.
            const childId = uniqueId("multiChild");
            const grandChildId = uniqueId("multiGrandChild");

            const child = buildNote({ id: childId, title: "Child" });
            const grandChild = buildNote({ id: grandChildId, title: "Grandchild" });

            const root = getBecca().notes["root"];
            expect(root).toBeDefined();
            linkBranch(childId, "root");
            linkBranch(grandChildId, childId);

            // sanity: both notes are registered
            expect(child.noteId).toBe(childId);
            expect(grandChild.noteId).toBe(grandChildId);

            const result = beccaService.getNoteTitleForPath(["root", childId, grandChildId]);

            expect(result).toBe("Child › Grandchild");
        });

        it("collects titles after the first segment when the path is outside the hoisted subtree", () => {
            // No element of this path equals the hoisted note ("root"), so the
            // path is treated as outside the hoisted subtree. The flag flips on
            // the first element (after its skipped push), so collection begins
            // from the second segment onwards.
            const outerId = uniqueId("outsideOuter");
            const innerId = uniqueId("outsideInner");

            buildNote({ id: outerId, title: "Outer" });
            buildNote({ id: innerId, title: "Inner" });
            linkBranch(innerId, outerId);

            const result = beccaService.getNoteTitleForPath([outerId, innerId]);

            expect(result).toBe("Inner");
        });

        it("throws when the argument is not an array", () => {
            // @ts-expect-error deliberately passing a non-array to hit the guard
            expect(() => beccaService.getNoteTitleForPath("not-an-array")).toThrow();
        });
    });
});
