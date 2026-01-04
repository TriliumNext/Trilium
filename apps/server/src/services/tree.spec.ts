import {beforeEach, describe, expect, it, vi} from "vitest";
import {note, NoteBuilder} from "../test/becca_mocking.js";
import becca from "../becca/becca.js";
import BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import tree from "./tree.js";
import cls from "./cls.js";
import {buildNote} from "../test/becca_easy_mocking.js";

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
            return {
                dbReady: () => {
                    console.log("Hello world");
                }
            };
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
            cls.init(() => {
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
            cls.init(() => {
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
        cls.init(() => {
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
        cls.init(() => {
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
        cls.init(() => {
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
            cls.init(() => {
                tree.sortNotesIfNeeded(note.noteId);
            });
            const orderedTitles = note.children.map((child) => child.title);
            expect(orderedTitles).toStrictEqual(["top", "1", "2", "3", "10", "20", "bottom"]);
        }
    )
});
