import { describe, expect, it } from "vitest";

import type { NotePathRecord } from "../../entities/fnote";
import { buildInverseNotePathTree, CompressedInverseTreeNode } from "./inverse_note_path_tree";

function record(notePath: string[], extra: Partial<NotePathRecord> = {}): NotePathRecord {
    return {
        notePath,
        isArchived: false,
        isInHoistedSubTree: true,
        isHidden: false,
        ...extra
    };
}

function shape(node: CompressedInverseTreeNode): object {
    return {
        segments: node.segments.map((s) => s.noteId),
        ancestorPaths: node.segments.map((s) => s.ancestorPath),
        pathToOpenNote: node.pathToOpenNote,
        isOnActiveTrail: node.isOnActiveTrail,
        archived: node.record?.isArchived ?? false,
        children: node.children.map(shape)
    };
}

describe("buildInverseNotePathTree", () => {
    it("returns null when there are no paths", () => {
        expect(buildInverseNotePathTree([])).toBeNull();
        expect(buildInverseNotePathTree([ record([]) ])).toBeNull();
    });

    it("compresses a single path into a single breadcrumb chain", () => {
        const tree = buildInverseNotePathTree(
            [ record(["root", "parent", "leaf"]) ],
            "root/parent/leaf"
        );
        expect(tree).not.toBeNull();
        if (!tree) return;

        expect(shape(tree)).toEqual({
            segments: [ "leaf", "parent", "root" ],
            ancestorPaths: [ "root/parent/leaf", "root/parent", "root" ],
            pathToOpenNote: "root/parent/leaf",
            isOnActiveTrail: true,
            archived: false,
            children: []
        });
    });

    it("compresses the common parent chain and forks into breadcrumbs at the divergence", () => {
        const tree = buildInverseNotePathTree([
            record(["rootA", "folderA", "parent", "leaf"]),
            record(["rootB", "folderB", "parent", "leaf"])
        ], "rootA/folderA/parent/leaf");

        expect(tree?.segments.map((s) => s.noteId)).toEqual([ "leaf", "parent" ]);
        expect(tree?.children).toHaveLength(2);
        expect(tree?.children[0]?.segments.map((s) => s.noteId)).toEqual([ "folderA", "rootA" ]);
        expect(tree?.children[0]?.isOnActiveTrail).toBe(true);
        expect(tree?.children[1]?.segments.map((s) => s.noteId)).toEqual([ "folderB", "rootB" ]);
        expect(tree?.children[1]?.isOnActiveTrail).toBe(false);
        expect(tree?.children[1]?.pathToOpenNote).toBe("rootB/folderB/parent/leaf");
    });

    it("activates ONLY ONE branch even when an ancestor matches a prefix of the active path", () => {
        // leaf has 3 parents: jdsfl, sjd;lkfafd (which itself contains jdsfl), and a direct clone
        const tree = buildInverseNotePathTree([
            record(["root", "15 - Tuesday", "jdsfl", "leaf"]),
            record(["root", "15 - Tuesday", "jdsfl", "sjd;lkfafd", "leaf"]),
            record(["root", "15 - Tuesday", "leaf"])
        ], "root/15 - Tuesday/jdsfl/leaf");

        expect(tree?.segments.map((s) => s.noteId)).toEqual([ "leaf" ]);
        expect(tree?.children).toHaveLength(3);

        const activeChildren = tree?.children.filter((child) => child.isOnActiveTrail) ?? [];
        expect(activeChildren).toHaveLength(1);
        expect(activeChildren[0]?.segments.map((s) => s.noteId)).toEqual([ "jdsfl", "15 - Tuesday", "root" ]);

        // The other 2 branches are NOT on the active trail
        const inactiveChildren = tree?.children.filter((child) => !child.isOnActiveTrail) ?? [];
        expect(inactiveChildren).toHaveLength(2);
        expect(inactiveChildren.map((c) => c.segments[0].noteId)).toEqual([ "sjd;lkfafd", "15 - Tuesday" ]);
    });

    it("keeps path-level flags on the leaf that represents that path", () => {
        const tree = buildInverseNotePathTree([
            record(["rootA", "leaf"]),
            record(["rootB", "leaf"], { isArchived: true })
        ], "rootA/leaf");

        expect(tree?.children[0]?.record?.isArchived).toBe(false);
        expect(tree?.children[1]?.record?.isArchived).toBe(true);
    });

    it("does not treat a note id that is a string prefix of another as being on the active trail", () => {
        const tree = buildInverseNotePathTree([
            record(["root", "p", "leaf"]),
            record(["root", "p2", "leaf"])
        ], "root/p2/leaf");

        expect(tree?.children[0]?.isOnActiveTrail).toBe(false);
        expect(tree?.children[1]?.isOnActiveTrail).toBe(true);
    });
});
