import { describe, expect, it } from "vitest";

import FBranch from "../../../entities/fbranch";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { applyCardMove, type ColumnMap, getBoardData } from "./data";

describe("applyCardMove", () => {
    /** Cards named by their note id, which is all this reads them for. */
    function board(columns: Record<string, string[]>): ColumnMap {
        return new Map(Object.entries(columns).map(([ column, ids ]) => [
            column,
            ids.map((noteId) => ({ note: { noteId }, branch: { branchId: `b_${noteId}` } }))
        ])) as unknown as ColumnMap;
    }

    const names = (map: ColumnMap, column: string) =>
        (map.get(column) ?? []).map((item) => item.note.noteId);

    it("takes a card out of one column and puts it in another", () => {
        const next = applyCardMove(board({ A: [ "a1", "a2", "a3" ], B: [ "b1", "b2" ] }),
            "a2", "A", "B", 1);

        expect(names(next, "A")).toEqual([ "a1", "a3" ]);
        expect(names(next, "B")).toEqual([ "b1", "a2", "b2" ]);
    });

    it("puts it at either end of the column it lands in", () => {
        const start = applyCardMove(board({ A: [ "a1" ], B: [ "b1", "b2" ] }), "a1", "A", "B", 0);
        expect(names(start, "B")).toEqual([ "a1", "b1", "b2" ]);

        const end = applyCardMove(board({ A: [ "a1" ], B: [ "b1", "b2" ] }), "a1", "A", "B", 2);
        expect(names(end, "B")).toEqual([ "b1", "b2", "a1" ]);
    });

    it("puts it in a column holding none", () => {
        const next = applyCardMove(board({ A: [ "a1" ], B: [] }), "a1", "A", "B", 0);

        expect(names(next, "A")).toEqual([]);
        expect(names(next, "B")).toEqual([ "a1" ]);
    });

    /**
     * The place counts the column as it stood, the card included, so a place beyond where the card
     * was names one card earlier once it has been taken out.
     */
    it("counts a move down its own column against the list it came from", () => {
        const start = board({ A: [ "a1", "a2", "a3" ] });

        expect(names(applyCardMove(start, "a1", "A", "A", 3), "A")).toEqual([ "a2", "a3", "a1" ]);
        expect(names(applyCardMove(start, "a1", "A", "A", 2), "A")).toEqual([ "a2", "a1", "a3" ]);
        expect(names(applyCardMove(start, "a3", "A", "A", 0), "A")).toEqual([ "a3", "a1", "a2" ]);
        expect(names(applyCardMove(start, "a3", "A", "A", 1), "A")).toEqual([ "a1", "a3", "a2" ]);
    });

    it("leaves the board alone for a card it does not hold", () => {
        const start = board({ A: [ "a1" ], B: [] });

        expect(applyCardMove(start, "nope", "A", "B", 0)).toBe(start);
    });
});

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
     * A template is what a card is made from, not a card. One made from the board's own properties
     * is filed under the board with no grouping value, which the inbox would otherwise collect.
     */
    it("leaves a template under the board out of the cards", async () => {
        const board = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "Card", "#status": "To Do" },
                { title: "A template", "#template": "" },
                { title: "Unassigned" }
            ]
        });

        const data = await getBoardData(
            board, "status", { columns: [ { value: "To Do" } ] }, false, [], new Map(), true);

        const titles = (column: string) =>
            (data.byColumn.get(column) ?? []).map((item) => item.note.title);
        expect(titles("To Do")).toEqual([ "Card" ]);
        // The one with no value is collected; the template is not.
        expect(titles("")).toEqual([ "Unassigned" ]);
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

describe("the inbox column", () => {
    const INBOX = { columns: [ { value: "" }, { value: "To Do" } ] };

    it("gathers the cards carrying no value, where the board keeps one", async () => {
        const board = buildNote({
            title: "Board",
            children: [
                { title: "Filed", "#status": "To Do" },
                { title: "Unfiled" }
            ]
        });

        const { byColumn, columns } = await getBoardData(
            board, "status", INBOX, false, [], new Map(), true);

        expect(columns).toEqual([ "", "To Do" ]);
        expect(byColumn.get("")?.map(item => item.note.title)).toEqual([ "Unfiled" ]);
    });

    it("leaves them off a board whose inbox is switched off", async () => {
        const board = buildNote({
            title: "Board",
            children: [
                { title: "Filed", "#status": "To Do" },
                { title: "Unfiled" }
            ]
        });

        const { byColumn, columns } = await getBoardData(
            board, "status", { columns: [ { value: "To Do" } ] }, false, [], new Map(), false);

        expect(columns).toEqual([ "To Do" ]);
        expect(byColumn.has("")).toBe(false);
    });


    /** Switching it on is what puts it on the board, at the head of it. */
    it("puts the column at the head of a board that has never had one", async () => {
        const board = buildNote({
            title: "Board",
            children: [ { title: "Filed", "#status": "To Do" }, { title: "Unfiled" } ]
        });

        const { columns, newPersistedData, byColumn } = await getBoardData(
            board, "status", { columns: [ { value: "To Do" } ] }, false, [], new Map(), true);

        expect(columns).toEqual([ "", "To Do" ]);
        expect(byColumn.get("")?.map(item => item.note.title)).toEqual([ "Unfiled" ]);
        // Written down, so what it is given from here on has somewhere to live.
        expect(newPersistedData?.columns?.map(column => column.value)).toEqual([ "", "To Do" ]);
    });

    /**
     * The toggle decides what is shown, not what is stored. Dropping the entry while the toggle is
     * off would rewrite the attachment without it, and its icon, colour and place would be gone by
     * the time it is switched back on.
     */
    it("keeps the stored entry while it gathers nothing", async () => {
        const board = buildNote({ title: "Board", children: [ { title: "Unfiled" } ] });
        const stored = { columns: [ { value: "", icon: "bx bx-inbox" }, { value: "To Do" } ] };

        const { byColumn, columns, newPersistedData } = await getBoardData(
            board, "status", stored, false, [], new Map(), false);

        // Still a column as far as the board is concerned, and empty.
        expect(columns).toEqual([ "", "To Do" ]);
        expect(byColumn.get("")).toEqual([]);
        // Nothing is rewritten, so what the entry carries is still there to come back to.
        expect(newPersistedData).toBeUndefined();
    });

    /**
     * A note below the board's own children is a card's child. The inbox reaches that far only
     * where it is told to, which is why the switch is off to begin with.
     */
    it("reaches past the board's own children only when told to", async () => {
        const board = buildNote({
            title: "Board",
            children: [
                { title: "Filed", "#status": "To Do", children: [ { title: "Deep" } ] },
                { title: "Unfiled" }
            ]
        });

        const shallow = await getBoardData(board, "status", INBOX, false, [], new Map(), true);
        expect(shallow.byColumn.get("")?.map(item => item.note.title)).toEqual([ "Unfiled" ]);

        const nested = await getBoardData(
            board, "status", { columns: [ { value: "", nested: true }, { value: "To Do" } ] },
            false, [], new Map(), true);
        expect(nested.byColumn.get("")?.map(item => item.note.title).sort())
            .toEqual([ "Deep", "Unfiled" ]);
    });
});
