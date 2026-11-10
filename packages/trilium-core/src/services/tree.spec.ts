import { beforeEach, describe, expect, it } from "vitest";
import {note, NoteBuilder} from "../test/becca_mocking.js";
import becca from "../becca/becca.js";
import BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import tree from "./tree.js";
import {buildNote} from "../test/becca_easy_mocking.js";
import { getContext } from "./context.js";
import noteService from "./notes.js";
import { getSql } from "./sql/index.js";

describe("Tree (real DB)", () => {
    function createNote(parentNoteId: string, title: string, type: "text" | "launcher" = "text") {
        return getContext().init(() => noteService.createNewNote({
            parentNoteId, title, content: type === "text" ? "<p></p>" : "", type
        }));
    }

    function activeBranchesOf(noteId: string) {
        return getSql().getRows<{ parentNoteId: string; prefix: string | null }>(
            "SELECT parentNoteId, prefix FROM branches WHERE noteId = ? AND isDeleted = 0", [ noteId ]);
    }

    it("rejects a 'none' parent, a virtual parent and a launcher parent", () => {
        const { note: child } = createNote("root", "tree-child");
        const { note: launcher } = createNote("root", "tree-launcher", "launcher");
        const { note: virtualParent } = createNote("root", "tree-virtual");
        Object.defineProperty(virtualParent, "isVirtual", { value: true });

        expect(tree.validateParentChild("none", child.noteId).message).toContain("'none'");
        expect(tree.validateParentChild(virtualParent.noteId, child.noteId).message)
            .toContain("cannot receive children");
        expect(tree.validateParentChild(launcher.noteId, child.noteId)).toMatchObject({
            success: false, message: "Launcher note cannot have any children."
        });
        expect(tree.validateParentChild("_lbBookmarks", child.noteId).success).toBe(true);
        // A missing child cannot close a cycle.
        expect(tree.validateParentChild("root", "missingNote123").success).toBe(true);
    });

    it("throws when sorting a missing note and ignores it when sorting if needed", () => {
        expect(() => getContext().init(() => tree.sortNotes("missingNote123"))).toThrow("Unable to find note");
        expect(() => tree.sortNotesIfNeeded("missingNote123")).not.toThrow();
    });

    it("setNoteToParent moves, removes and re-prefixes branches", () => {
        const { note: parentA } = createNote("root", "tree-parent-a");
        const { note: parentB } = createNote("root", "tree-parent-b");
        const { note: child } = createNote(parentA.noteId, "tree-moved");
        getContext().init(() => {
            const branch = becca.getBranchFromChildAndParent(child.noteId, parentA.noteId);
            if (!branch) throw new Error("missing branch");
            branch.prefix = "p";
            branch.save();
        });

        // A branch with the prefix moves to the new parent.
        getContext().init(() => tree.setNoteToParent(child.noteId, "p", parentB.noteId));
        expect(activeBranchesOf(child.noteId)).toStrictEqual([ { parentNoteId: parentB.noteId, prefix: "p" } ]);

        // An existing branch to the parent gets the new prefix.
        getContext().init(() => tree.setNoteToParent(child.noteId, "q", parentB.noteId));
        expect(activeBranchesOf(child.noteId)).toStrictEqual([ { parentNoteId: parentB.noteId, prefix: "q" } ]);

        // Without a branch to the parent, one is created.
        getContext().init(() => tree.setNoteToParent(child.noteId, "r", parentA.noteId));
        expect(activeBranchesOf(child.noteId)).toHaveLength(2);

        // An empty parent removes the branch with the prefix; without such a branch nothing happens.
        getContext().init(() => tree.setNoteToParent(child.noteId, "r", ""));
        getContext().init(() => tree.setNoteToParent(child.noteId, "none-such", ""));
        expect(activeBranchesOf(child.noteId)).toStrictEqual([ { parentNoteId: parentB.noteId, prefix: "q" } ]);
    });

    it("setNoteToParent rejects a missing parent, a missing note and a deleted note", () => {
        const { note } = createNote("root", "tree-deleted");
        expect(() => tree.setNoteToParent(note.noteId, "x", "missingNote123")).toThrow("missing parent");
        expect(() => tree.setNoteToParent("missingNote123", "x", "root")).toThrow("Cannot find note");
        // The note is still in becca while its deletion is in progress.
        note.isBeingDeleted = true;
        try {
            expect(() => tree.setNoteToParent(note.noteId, "x", "root")).toThrow("which is deleted");
        } finally {
            note.isBeingDeleted = false;
        }
    });
});

describe("Tree", () => {
    let rootNote!: NoteBuilder;

    beforeEach(() => {
        becca.reset();

        rootNote = new NoteBuilder(
            new BNote({
                noteId: "root",
                title: "root",
                type: "text"
            })
        );
        new BBranch({
            branchId: "none_root",
            noteId: "root",
            parentNoteId: "none",
            notePosition: 10
        });
    });
    it("sorts notes by title (base case)", () => {

            const note = buildNote({
                children: [
                    {title: "1"},
                    {title: "2"},
                    {title: "3"},
                ],
                "#sorted": "",
            });
            getContext().init(() => {
                tree.sortNotesIfNeeded(note.noteId);
            });
            const orderedTitles = note.children.map((child) => child.title);
            expect(orderedTitles).toStrictEqual(["1", "2", "3"]);
        }
    )

    it("custom sort order is idempotent", () => {
        rootNote.label("sorted", "order");

        // Add values which have a defined order.
        for (let i = 0; i <= 5; i++) {
            rootNote.child(note(String(i)).label("order", String(i)));
        }
        rootNote.child(note("top").label("top"));
        rootNote.child(note("bottom").label("bottom"));

        // Add a few values which have no defined order.
        for (let i = 6; i < 10; i++) {
            rootNote.child(note(String(i)));
        }

        const expectedOrder = ["top", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "bottom"];

        // Sort a few times to ensure that the resulting order is the same.
        for (let i = 0; i < 5; i++) {
            getContext().init(() => {
                tree.sortNotesIfNeeded(rootNote.note.noteId);
            });

            const order = rootNote.note.children.map((child) => child.title);
            expect(order).toStrictEqual(expectedOrder);
        }
    });

    it("pins to the top and bottom", () => {
        const note = buildNote({
            children: [
                {title: "bottom", "#bottom": ""},
                {title: "5"},
                {title: "3"},
                {title: "2"},
                {title: "1"},
                {title: "top", "#top": ""}
            ],
            "#sorted": ""
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual(["top", "1", "2", "3", "5", "bottom"]);
    });

    it("pins to the top and bottom in reverse order", () => {
        const note = buildNote({
            children: [
                {title: "bottom", "#bottom": ""},
                {title: "1"},
                {title: "2"},
                {title: "3"},
                {title: "5"},
                {title: "top", "#top": ""}
            ],
            "#sorted": "",
            "#sortDirection": "desc"
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual(["top", "5", "3", "2", "1", "bottom"]);
    });

    it("keeps folder notes on top when #sortFolderFirst is set, but not above #top", () => {
        const note = buildNote({
            children: [
                {title: "bottom", "#bottom": ""},
                {title: "1"},
                {title: "2"},
                {title: "p1", children: [{title: "1.1"}, {title: "1.2"}]},
                {title: "p2", children: [{title: "2.1"}, {title: "2.2"}]},
                {title: "3"},
                {title: "5"},
                {title: "top", "#top": ""}
            ],
            "#sorted": "",
            "#sortFoldersFirst": ""
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual(["top", "p1", "p2", "1", "2", "3", "5", "bottom"]);
    });

    it("sorts notes accordingly when #sortNatural is set", () => {
            const note = buildNote({
                children: [
                    {title: "bottom", "#bottom": ""},
                    {title: "1"},
                    {title: "2"},
                    {title: "10"},
                    {title: "20"},
                    {title: "3"},
                    {title: "top", "#top": ""}
                ],
                "#sorted": "",
                "#sortNatural": ""
            });
            getContext().init(() => {
                tree.sortNotesIfNeeded(note.noteId);
            });
            const orderedTitles = note.children.map((child) => child.title);
            expect(orderedTitles).toStrictEqual(["top", "1", "2", "3", "10", "20", "bottom"]);
        }
    )

    it("sorts by several levels, each with its own direction", () => {
        const note = buildNote({
            children: [
                {title: "c", "#priority": "1", "#area": "home"},
                {title: "b", "#priority": "2", "#area": "work"},
                {title: "a", "#priority": "2", "#area": "home"},
                {title: "d", "#priority": "1", "#area": "work"},
                {title: "e", "#priority": "1", "#area": "home"}
            ],
            "#sorted": "#priority desc, #area, title desc"
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual(["a", "b", "e", "c", "d"]);
    });

    it("applies #sortDirection to the levels without their own and to the title tiebreak", () => {
        const note = buildNote({
            children: [
                {title: "a", "#priority": "1", "#area": "home"},
                {title: "b", "#priority": "2", "#area": "home"},
                {title: "c", "#priority": "2", "#area": "work"},
                {title: "d", "#priority": "2", "#area": "work"},
                {title: "top", "#top": ""},
                {title: "bottom", "#bottom": ""}
            ],
            "#sorted": "#priority asc, #area",
            "#sortDirection": "desc"
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        // priority ascending as written; area and the title tiebreak follow #sortDirection.
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual(["top", "a", "d", "c", "b", "bottom"]);
    });

    it("groups folders last under #sortDirection=desc", () => {
        const note = buildNote({
            children: [
                {title: "a"},
                {title: "p1", children: [{title: "1.1"}]},
                {title: "b"},
                {title: "p2", children: [{title: "2.1"}]}
            ],
            "#sorted": "",
            "#sortDirection": "desc",
            "#sortFoldersFirst": ""
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual(["b", "a", "p2", "p1"]);
    });

    it("orders several #top and #bottom notes by their values, whatever the direction", () => {
        const note = buildNote({
            children: [
                {title: "bottom2", "#bottom": "2"},
                {title: "top2", "#top": "2"},
                {title: "b"},
                {title: "top1", "#top": "1"},
                {title: "bottom1", "#bottom": "1"},
                {title: "a"}
            ],
            "#sorted": "",
            "#sortDirection": "desc"
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual(["top1", "top2", "b", "a", "bottom2", "bottom1"]);
    });

    it("sorts a child missing the label last in either direction; the next level breaks a double miss", () => {
        const children: Parameters<typeof buildNote>[0]["children"] = [
            {title: "m", "#order": "z"},
            {title: "unlabelled", "#area": "b"},
            {title: "also", "#area": "a"},
            {title: "a", "#order": "b"}
        ];
        // Descending reverses the two notes that carry #order, and reverses the #area level that
        // separates the two that do not, but leaves both of those after the ones that carry it.
        for (const [direction, expected] of [
            ["asc", ["a", "m", "also", "unlabelled"]],
            ["desc", ["m", "a", "unlabelled", "also"]]
        ] as const) {
            const note = buildNote({
                children, "#sorted": "#order, #area", "#sortDirection": direction
            });
            getContext().init(() => {
                tree.sortNotesIfNeeded(note.noteId);
            });
            expect(note.children.map((child) => child.title)).toStrictEqual([...expected]);
        }
    });

    it("compares every level as text, as a single-key #sorted does", () => {
        const note = buildNote({
            children: [
                {title: "ten", "#priority": "10", "#due": "2026-02-01"},
                {title: "two", "#priority": "2", "#due": "2026-02-01"},
                {title: "one", "#priority": "1", "#due": "2026-01-15"},
                {title: "nine", "#priority": "9", "#due": "2026-01-15"}
            ],
            "#sorted": "#due, #priority desc"
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        // Within each due date, "9" sorts after "1" and "2" after "10", descending to nine, one
        // and two, ten. #sortNatural is what orders a level's numbers by their value.
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual(["nine", "one", "two", "ten"]);
    });

    it("groups the children that have a label, whatever its value or the direction", () => {
        const children: Parameters<typeof buildNote>[0]["children"] = [
            {title: "b", "#archived": ""},
            {title: "c"},
            {title: "d", "#archived": "false"},
            {title: "a", "#archived": "", "#pinned": ""},
            {title: "e", "#pinned": "yes"}
        ];
        for (const [sorted, direction, expected] of [
            ["#archived last", "asc", ["c", "e", "a", "b", "d"]],
            ["#archived last", "desc", ["e", "c", "d", "b", "a"]],
            ["#pinned first, #archived last", "asc", ["e", "a", "c", "b", "d"]]
        ] as const) {
            const note = buildNote({children, "#sorted": sorted, "#sortDirection": direction});
            getContext().init(() => {
                tree.sortNotesIfNeeded(note.noteId);
            });
            expect(note.children.map((child) => child.title)).toStrictEqual([...expected]);
        }
    });

    it("sorts by a label for `#name` and by a property for a bare name", () => {
        const children: Parameters<typeof buildNote>[0]["children"] = [
            {title: "b", "#title": "1", "#area": "x"},
            {title: "a", "#title": "2", "#area": "y"}
        ];
        for (const [sorted, expected] of [
            ["#title", ["b", "a"]],
            ["title desc", ["b", "a"]],
            ["#title desc", ["a", "b"]],
            // A bare word that names no property ties every child, so the title decides.
            ["area desc", ["a", "b"]]
        ] as const) {
            const note = buildNote({children, "#sorted": sorted});
            getContext().init(() => {
                tree.sortNotesIfNeeded(note.noteId);
            });
            expect(note.children.map((child) => child.title)).toStrictEqual([...expected]);
        }
    });

    it("keeps #top and #bottom outside a grouping level unless #sorted names them", () => {
        const children: Parameters<typeof buildNote>[0]["children"] = [
            {title: "archived bottom", "#bottom": "", "#archived": ""},
            {title: "archived top", "#top": "", "#archived": ""},
            {title: "a", "#archived": ""},
            {title: "bottom", "#bottom": ""},
            {title: "b"},
            {title: "top", "#top": ""}
        ];
        for (const [sorted, expected] of [
            ["#archived last", [
                "top", "archived top", "b", "a", "bottom", "archived bottom"
            ]],
            // A #bottom left unnamed still applies before every level.
            ["#archived last, #top first", [
                "top", "b", "archived top", "a", "bottom", "archived bottom"
            ]],
            ["#archived last, #top first, #bottom last, title", [
                "top", "b", "bottom", "archived top", "a", "archived bottom"
            ]]
        ] as const) {
            const note = buildNote({children, "#sorted": sorted});
            getContext().init(() => {
                tree.sortNotesIfNeeded(note.noteId);
            });
            expect(note.children.map((child) => child.title)).toStrictEqual([...expected]);
        }
    });

    it("orders #top and #bottom by their values where #sorted names them", () => {
        const note = buildNote({
            children: [
                {title: "top1", "#top": "1"},
                {title: "top2", "#top": "2"},
                {title: "a"},
                {title: "bottom1", "#bottom": "1"},
                {title: "bottom2", "#bottom": "2"}
            ],
            "#sorted": "#top desc, #bottom last, #bottom, title"
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual(["top2", "top1", "a", "bottom1", "bottom2"]);
    });

    it("groups folders right after #top and #bottom, wherever #sorted puts them", () => {
        const note = buildNote({
            children: [
                {title: "archived folder", "#archived": "", children: [{title: "1.1"}]},
                {title: "archived", "#archived": ""},
                {title: "folder", children: [{title: "2.1"}]},
                {title: "leaf"},
                {title: "bottom", "#bottom": ""},
                {title: "top", "#top": ""}
            ],
            "#sorted": "#archived last, #top first, #bottom last, title",
            "#sortFoldersFirst": ""
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual([
            "top", "folder", "leaf", "bottom", "archived folder", "archived"
        ]);
    });

    it("groups folders with `folders first` or `folders last`, overriding #sortFoldersFirst", () => {
        const children: Parameters<typeof buildNote>[0]["children"] = [
            {title: "b"},
            {title: "p2", children: [{title: "2.1"}]},
            {title: "a"},
            {title: "p1", children: [{title: "1.1"}]}
        ];
        for (const [sorted, direction, expected] of [
            ["folders first, title", "desc", ["p2", "p1", "b", "a"]],
            // A bare `folders` puts the notes without children last, as any level does.
            ["folders, title", "desc", ["p2", "p1", "b", "a"]],
            ["folders last, title", "asc", ["a", "b", "p1", "p2"]]
        ] as const) {
            const note = buildNote({
                children, "#sorted": sorted, "#sortDirection": direction, "#sortFoldersFirst": ""
            });
            getContext().init(() => {
                tree.sortNotesIfNeeded(note.noteId);
            });
            expect(note.children.map((child) => child.title)).toStrictEqual([...expected]);
        }
    });

    it("places a folders level where #sorted writes it", () => {
        const note = buildNote({
            children: [
                {title: "archived folder", "#archived": "", children: [{title: "1.1"}]},
                {title: "archived", "#archived": ""},
                {title: "folder", children: [{title: "2.1"}]},
                {title: "leaf"},
                {title: "bottom folder", "#bottom": "", children: [{title: "3.1"}]},
                {title: "top", "#top": ""}
            ],
            "#sorted": "#archived last, #top first, #bottom last, folders first, title"
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual([
            "top", "folder", "leaf", "bottom folder", "archived folder", "archived"
        ]);
    });

    it("orders the same children the same way whatever order they start in", () => {
        const titles = Array.from({length: 53}, (_, index) => `Week ${index + 1}`);
        const orders = [titles, [...titles].reverse()].map((startingOrder) => {
            const note = buildNote({
                children: startingOrder.map((title) => ({title})),
                "#sorted": ""
            });
            getContext().init(() => {
                tree.sortNotesIfNeeded(note.noteId);
            });
            return note.children.map((child) => child.title);
        });
        expect(orders[0]).toStrictEqual(orders[1]);
        expect(orders[0].slice(0, 4)).toStrictEqual(["Week 1", "Week 10", "Week 11", "Week 12"]);
    });

    it("sorts by dateModified, keeps _hidden last and sorts titles with their prefix", () => {
        const note = buildNote({
            "children": [
                { id: "_hidden", title: "a hidden" },
                { title: "late" },
                { title: "early" }
            ],
            "#sorted": "dateModified"
        });
        const [ , late, early ] = note.children;
        late.dateModified = "2024-02-01 00:00:00.000+0000";
        early.dateModified = "2024-01-01 00:00:00.000+0000";
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        expect(note.children.map((child) => child.title)).toStrictEqual([ "early", "late", "a hidden" ]);
        expect(becca.getBranchFromChildAndParent("_hidden", note.noteId)?.notePosition).toBe(999_999_999);

        const prefixed = buildNote({ "children": [ { title: "a" }, { title: "b" } ], "#sorted": "" });
        const [ a, b ] = prefixed.children;
        const branchOfA = becca.getBranchFromChildAndParent(a.noteId, prefixed.noteId);
        if (branchOfA) {
            branchOfA.prefix = "z";
        }
        getContext().init(() => {
            tree.sortNotesIfNeeded(prefixed.noteId);
        });
        expect(prefixed.children).toStrictEqual([ b, a ]);
    });
});
