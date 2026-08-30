import { describe, expect, it } from "vitest";

import FBranch from "../../../entities/fbranch";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { getBoardData } from "./data";

describe("Board data", () => {
    it("deduplicates cloned notes", async () => {
        const parentNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "note1", title: "First note", "#status": "To Do" },
                { id: "note2", title: "Second note", "#status": "In progress" },
                { id: "note3", title: "Third note", "#status": "Done" }
            ]
        });
        const branch = new FBranch(froca, {
            branchId: "note1_note2",
            notePosition: 10,
            fromSearchNote: false,
            noteId: "note2",
            parentNoteId: "note1"
        });
        froca.branches["note1_note2"] = branch;
        froca.getNoteFromCache("note1")!.addChild("note2", "note1_note2", false);
        const data = await getBoardData(parentNote, "status", {}, false);
        const noteIds = [...data.byColumn.values()].flat().map(item => item.note.noteId);
        expect(noteIds.length).toBe(3);
    });
    /**
     * A column inserted or dragged is written to the attachment at once and to the definition a
     * round trip later. The refresh in between must not put it back where the definition says.
     */
    it("leaves a column just placed where the board put it, writing nothing back", async () => {
        const board = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "Done" }
            ]
        });

        const data = await getBoardData(
            board,
            "status",
            { columns: [ { value: "To Do" }, { value: "New column" }, { value: "Done" } ] },
            false,
            [ "To Do", "Done" ]
        );

        expect(data.columns).toEqual([ "To Do", "New column", "Done" ]);
        expect(data.newPersistedData).toBeUndefined();
    });

    /**
     * The notes, the view config and the definition are written one at a time, so a refresh in
     * between reads a source that still offers the old value. Resolution being additive, what it
     * picks up there is persisted and can never be dropped again, leaving an empty column behind.
     */
    describe("a column being renamed or deleted", () => {
        function buildBoard() {
            return buildNote({
                title: "Board",
                "#collection": "",
                "#viewType": "board",
                children: [
                    { title: "First", "#status": "To Do" },
                    { title: "Second", "#status": "Shipped" }
                ]
            });
        }

        it("is not resolved back from a definition that has not caught up", async () => {
            const pending = new Map([ [ "Done", "Shipped" ] ]);
            const data = await getBoardData(
                buildBoard(),
                "status",
                { columns: [ { value: "To Do" }, { value: "Shipped" } ] },
                false,
                [ "To Do", "Done" ],
                pending
            );

            expect(data.columns).toEqual([ "To Do", "Shipped" ]);
            expect(data.newPersistedData).toBeUndefined();
            expect(data.settledRenames).toEqual([]);
        });

        it("is not resolved back from a view config that has not caught up", async () => {
            const pending = new Map([ [ "Done", "Shipped" ] ]);
            const data = await getBoardData(
                buildBoard(),
                "status",
                { columns: [ { value: "To Do" }, { value: "Done" }, { value: "Shipped" } ] },
                false,
                [],
                pending
            );

            expect(data.columns).toEqual([ "To Do", "Shipped" ]);
            expect(data.newPersistedData?.columns?.map(c => c.value))
                .toEqual([ "To Do", "Shipped" ]);
        });

        it("keeps the renamed column where the old name stood", async () => {
            const board = buildNote({
                title: "Board",
                "#collection": "",
                "#viewType": "board",
                children: [
                    { title: "First", "#status": "To Do" },
                    { title: "Second", "#status": "In Progress" },
                    { title: "Third", "#status": "Done" }
                ]
            });

            const data = await getBoardData(
                board,
                "status",
                { columns: [ { value: "To Do" }, { value: "In Progress" }, { value: "Done" } ] },
                false,
                [ "To Do", "Doing", "Done" ],
                new Map([ [ "Doing", "In Progress" ] ])
            );

            expect(data.columns).toEqual([ "To Do", "In Progress", "Done" ]);
        });

        it("files a card the bulk action has not reached under its new column", async () => {
            const board = buildNote({
                title: "Board",
                "#collection": "",
                "#viewType": "board",
                children: [
                    { title: "First", "#status": "Shipped" },
                    { title: "Second", "#status": "Done" }
                ]
            });

            const data = await getBoardData(
                board, "status", { columns: [ { value: "Shipped" } ] }, false, [],
                new Map([ [ "Done", "Shipped" ] ])
            );

            expect(data.columns).toEqual([ "Shipped" ]);
            expect(data.byColumn.get("Shipped")?.map(item => item.note.title))
                .toEqual([ "First", "Second" ]);
        });

        it("does not fold the cards of a deleted column into another one", async () => {
            const board = buildNote({
                title: "Board",
                "#collection": "",
                "#viewType": "board",
                children: [
                    { title: "First", "#status": "Shipped" },
                    { title: "Second", "#status": "Done" }
                ]
            });

            const data = await getBoardData(
                board, "status", { columns: [ { value: "Shipped" } ] }, false, [],
                new Map([ [ "Done", undefined ] ])
            );

            expect(data.columns).toEqual([ "Shipped" ]);
            expect(data.byColumn.get("Shipped")?.map(item => item.note.title)).toEqual([ "First" ]);
        });

        it("keeps the icon of a column whose entry the rewrite moves to its new name", async () => {
            const board = buildNote({
                title: "Board",
                "#collection": "",
                "#viewType": "board",
                children: [
                    { title: "First", "#status": "To Do" },
                    { title: "Second", "#status": "Shipped" }
                ]
            });

            // The config still names the column as it was, the window the rewrite lands in.
            const data = await getBoardData(
                board,
                "status",
                { columns: [ { value: "To Do" }, { value: "Done", icon: "bx bx-check" } ] },
                false,
                [],
                new Map([ [ "Done", "Shipped" ] ])
            );

            expect(data.newPersistedData?.columns).toEqual([
                { value: "To Do" },
                { value: "Shipped", icon: "bx bx-check" }
            ]);
        });

        it("is reported as settled once every source has caught up, freeing the name", async () => {
            const pending = new Map([ [ "Done", "Shipped" ] ]);
            const data = await getBoardData(
                buildBoard(),
                "status",
                { columns: [ { value: "To Do" }, { value: "Shipped" } ] },
                false,
                [ "To Do", "Shipped" ],
                pending
            );

            // Reported rather than dropped here: only the caller knows whether the board it asked
            // about is still the one on screen.
            expect(data.settledRenames).toEqual([ "Done" ]);
            expect(pending.size).toBe(1);
        });
    });
});
