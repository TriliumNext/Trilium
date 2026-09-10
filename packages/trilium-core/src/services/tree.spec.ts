import {beforeEach, describe, expect, it, vi} from "vitest";
import {note, NoteBuilder} from "../test/becca_mocking.js";
import becca from "../becca/becca.js";
import BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import tree from "./tree.js";
import {buildNote} from "../test/becca_easy_mocking.js";
import { getContext } from "./context.js";

vi.mock("./sql.js", () => {
    return {
        default: {
            transactional: (cb: Function) => {
                cb();
            },
            execute: () => {},
            replace: () => {},
            getMap: () => {}
        }
    };
});

vi.mock("./sql_init.js", () => {
    const mock = {
        initializeDb: () => {},
        dbReady: Promise.resolve()
    };
    return { default: mock, ...mock };
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
            "#sorted": "priority desc, area, title desc"
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
            "#sorted": "priority asc, area",
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

    it("sorts a child without the level's label by its title in the label's place", () => {
        const note = buildNote({
            children: [
                {title: "m", "#order": "z"},
                {title: "unlabelled"},
                {title: "a", "#order": "b"}
            ],
            "#sorted": "order"
        });
        getContext().init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual(["a", "unlabelled", "m"]);
    });
});
