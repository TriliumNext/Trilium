import { describe, expect, it } from "vitest";

import { buildResources, ResourceSourceNote } from "./resources";

function tree(children: Record<string, string[]>) {
    return (noteId: string): ResourceSourceNote => ({
        title: `Title ${noteId}`,
        getIcon: () => `bx bx-${noteId}`,
        getChildNoteIds: () => children[noteId] ?? []
    });
}

describe("buildResources", () => {
    it("nests rows by the tree, in branch order, skipping notes outside the collection", () => {
        const getNote = tree({
            root: [ "b", "a", "excluded" ],
            a: [ "a2", "a1" ],
            excluded: [ "orphan" ]
        });

        const resources = buildResources("root", [ "a", "a1", "a2", "b", "orphan" ], getNote);

        expect(resources.map(({ id, parentId, order }) => ({ id, parentId, order }))).toEqual([
            { id: "b", parentId: undefined, order: 0 },
            { id: "a", parentId: undefined, order: 1 },
            { id: "a2", parentId: "a", order: 2 },
            { id: "a1", parentId: "a", order: 3 },
            // Its parent is not in the collection, so it is a top-level row after the tree.
            { id: "orphan", parentId: undefined, order: 4 }
        ]);
        expect(resources[0]).toMatchObject({ title: "Title b", iconClass: "bx bx-b" });
        const topLevel = resources.filter(r => [ "a", "b", "orphan" ].includes(String(r.id)));
        for (const resource of topLevel) {
            expect(resource, resource.id).not.toHaveProperty("parentId");
        }
    });

    it("gives a cloned note one row, under the first parent reached", () => {
        const getNote = tree({
            root: [ "x", "y" ],
            x: [ "clone" ],
            y: [ "clone" ]
        });

        const resources = buildResources("root", [ "x", "y", "clone" ], getNote);

        expect(resources.filter(r => r.id === "clone")).toEqual([
            expect.objectContaining({ parentId: "x" })
        ]);
    });
});
