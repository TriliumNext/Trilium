import { beforeEach, describe, expect, it, vi } from "vitest";
import { note, NoteBuilder } from "../test/becca_mocking.js";
import becca from "../becca/becca.js";
import BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import tree from "./tree.js";
import cls from "./cls.js";
import { buildNote } from "../test/becca_easy_mocking.js";

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

    it("custom sort order is idempotent", () => {
        rootNote.label("sorted", "order");

        // Add values which have a defined order.
        for (let i = 0; i <= 5; i++) {
            rootNote.child(note(String(i)).label("order", String(i)));
        }

        // Add a few values which have no defined order.
        for (let i = 6; i < 10; i++) {
            rootNote.child(note(String(i)));
        }

        const expectedOrder = [ "0", "1", "2", "3", "4", "5", "6", "7", "8", "9" ];

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
                { title: "bottom", "#bottom": "" },
                { title: "5" },
                { title: "3" },
                { title: "2" },
                { title: "1" },
                { title: "top", "#top": "" }
            ],
            "#sorted": ""
        });
        cls.init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual([ "top", "1", "2", "3", "5", "bottom" ]);
    });

    it("pins to the top and bottom in reverse order", () => {
        const note = buildNote({
            children: [
                { title: "bottom", "#bottom": "" },
                { title: "1" },
                { title: "2" },
                { title: "3" },
                { title: "5" },
                { title: "top", "#top": "" }
            ],
            "#sorted": "",
            "#sortDirection": "desc"
        });
        cls.init(() => {
            tree.sortNotesIfNeeded(note.noteId);
        });
        const orderedTitles = note.children.map((child) => child.title);
        expect(orderedTitles).toStrictEqual([ "top", "5", "3", "2", "1", "bottom" ]);
    });
});
