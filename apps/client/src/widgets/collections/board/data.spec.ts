import { describe, expect, it } from "vitest";

import FBranch from "../../../entities/fbranch";
import froca from "../../../services/froca";
import LoadResults from "../../../services/load_results";
import type { EntityChange } from "../../../server_types";
import { buildNote } from "../../../test/easy-froca";
import type { PromotedAttribute } from "../promoted_attributes";
import type { SortContext, SortKey } from "../sorting";
import { INBOX_COLUMN } from "./columns";
import {
    affectsSortOrder, applyCardMoves, type ColumnMap, type ColumnSort, filterColumnMap,
    getBoardData, resolveColumnSorts, resolveSortWatch, sortColumnMap, unfilteredCardIndex
} from "./data";

describe("applyCardMoves", () => {
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
        const next = applyCardMoves(board({ A: [ "a1", "a2", "a3" ], B: [ "b1", "b2" ] }),
            [ "a2" ], "B", 1);

        expect(names(next, "A")).toEqual([ "a1", "a3" ]);
        expect(names(next, "B")).toEqual([ "b1", "a2", "b2" ]);
    });

    it("puts it at either end of the column it lands in", () => {
        const start = applyCardMoves(board({ A: [ "a1" ], B: [ "b1", "b2" ] }), [ "a1" ], "B", 0);
        expect(names(start, "B")).toEqual([ "a1", "b1", "b2" ]);

        const end = applyCardMoves(board({ A: [ "a1" ], B: [ "b1", "b2" ] }), [ "a1" ], "B", 2);
        expect(names(end, "B")).toEqual([ "b1", "b2", "a1" ]);
    });

    it("puts it in a column holding none", () => {
        const next = applyCardMoves(board({ A: [ "a1" ], B: [] }), [ "a1" ], "B", 0);

        expect(names(next, "A")).toEqual([]);
        expect(names(next, "B")).toEqual([ "a1" ]);
    });

    /**
     * The place counts the column as it stood, the card included, so a place beyond where the card
     * was names one card earlier once it has been taken out.
     */
    it("counts a move down its own column against the list it came from", () => {
        const start = board({ A: [ "a1", "a2", "a3" ] });

        expect(names(applyCardMoves(start, [ "a1" ], "A", 3), "A")).toEqual([ "a2", "a3", "a1" ]);
        expect(names(applyCardMoves(start, [ "a1" ], "A", 2), "A")).toEqual([ "a2", "a1", "a3" ]);
        expect(names(applyCardMoves(start, [ "a3" ], "A", 0), "A")).toEqual([ "a3", "a1", "a2" ]);
        expect(names(applyCardMoves(start, [ "a3" ], "A", 1), "A")).toEqual([ "a1", "a3", "a2" ]);
    });

    it("moves several cards from several columns, keeping the order they are given in", () => {
        const next = applyCardMoves(
            board({ A: [ "a1", "a2", "a3" ], B: [ "b1", "b2" ], C: [] }),
            [ "a1", "b2", "a3" ], "C", 0);

        expect(names(next, "A")).toEqual([ "a2" ]);
        expect(names(next, "B")).toEqual([ "b1" ]);
        expect(names(next, "C")).toEqual([ "a1", "b2", "a3" ]);
    });

    it("counts a move of several down their own column against the cards staying put", () => {
        const start = board({ A: [ "a1", "a2", "a3", "a4" ] });

        expect(names(applyCardMoves(start, [ "a1", "a2" ], "A", 4), "A"))
            .toEqual([ "a3", "a4", "a1", "a2" ]);
        expect(names(applyCardMoves(start, [ "a1", "a4" ], "A", 2), "A"))
            .toEqual([ "a2", "a1", "a4", "a3" ]);
    });

    it("leaves the board alone for a card it does not hold", () => {
        const start = board({ A: [ "a1" ], B: [] });

        expect(applyCardMoves(start, [ "nope" ], "B", 0)).toBe(start);
    });

    describe("filterColumnMap", () => {
        it("keeps only the matched cards, in the order the column holds them", () => {
            // The set is built in reversed order to prove it carries membership, not order.
            const matched = new Set([ "a4", "a2", "a1" ]);
            const filtered = filterColumnMap(
                board({ A: [ "a1", "a2", "a3", "a4" ], B: [ "b1" ] }), matched);

            expect(names(filtered, "A")).toEqual([ "a1", "a2", "a4" ]);
            expect(names(filtered, "B")).toEqual([]);
        });

        it("keeps every column, emptied ones included", () => {
            const filtered = filterColumnMap(board({ A: [ "a1" ], B: [] }), new Set([ "nothing" ]));

            expect([ ...filtered.keys() ]).toEqual([ "A", "B" ]);
            expect(names(filtered, "A")).toEqual([]);
        });

        it("hands the map back untouched while no filter is active", () => {
            const start = board({ A: [ "a1" ] });

            expect(filterColumnMap(start, null)).toBe(start);
        });
    });

    describe("unfilteredCardIndex", () => {
        const items = (ids: string[]) => board({ A: ids }).get("A") ?? [];

        it("puts the card where the card it was dropped before stands", () => {
            const all = items([ "hidden1", "hidden2", "a1", "hidden3", "a2" ]);
            const shown = items([ "a1", "a2" ]);

            // Before the first card on screen, which stands after two hidden ones.
            expect(unfilteredCardIndex(shown, all, 0)).toBe(2);
            // Between the two on screen, which is where `a2` stands rather than where `hidden3` does.
            expect(unfilteredCardIndex(shown, all, 1)).toBe(4);
        });

        it("puts a card dropped past the last one on screen right after it", () => {
            const all = items([ "a1", "hidden1", "hidden2" ]);
            const shown = items([ "a1" ]);

            expect(unfilteredCardIndex(shown, all, 1)).toBe(1);
        });

        it("counts against the column itself when nothing is filtered out", () => {
            const all = items([ "a1", "a2", "a3" ]);

            for (const index of [ 0, 1, 2 ]) {
                expect(unfilteredCardIndex(all, all, index)).toBe(index);
            }
            expect(unfilteredCardIndex(all, all, 3)).toBe(3);
        });

        it("puts the card at the end of a column showing none of its own", () => {
            expect(unfilteredCardIndex([], items([ "hidden1" ]), 0)).toBe(1);
            expect(unfilteredCardIndex([], [], 0)).toBe(0);
        });
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

describe("sorting the cards of a column", () => {
    describe("resolveColumnSorts", () => {
        it("reads the columns that sort, and leaves out the ones that do not", () => {
            const sorts = resolveColumnSorts([
                { value: "To Do", orderBy: "title" },
                { value: "Doing" },
                { value: "Done", orderBy: "attr:dueDate", descendingOrder: true },
                { value: "Later", orderBy: "dateModified" }
            ]);

            expect([ ...sorts.keys() ]).toEqual([ "To Do", "Done" ]);
            expect(sorts.get("To Do")).toEqual({ orderBy: "title", isDescending: false });
            expect(sorts.get("Done")).toEqual({ orderBy: "attr:dueDate", isDescending: true });
        });

        it("reads a board with no stored columns as one that sorts nothing", () => {
            expect(resolveColumnSorts(undefined).size).toBe(0);
        });

        it("gives a column stored as default the order the board holds", () => {
            const columns = [
                { value: "To Do", orderBy: "default" },
                { value: "Doing", orderBy: "title", descendingOrder: true }
            ];
            const sorts = resolveColumnSorts(
                columns, { orderBy: "attr:dueDate", isDescending: true });

            expect(sorts.get("To Do")).toEqual({ orderBy: "attr:dueDate", isDescending: true });
            // A column with an order of its own keeps it.
            expect(sorts.get("Doing")).toEqual({ orderBy: "title", isDescending: true });

            // The board holding none leaves such a column in the manual order.
            expect([ ...resolveColumnSorts(columns).keys() ]).toEqual([ "Doing" ]);
        });
    });

    describe("sortColumnMap", () => {
        it("orders only the columns that ask for it, in the direction they ask for", () => {
            const board = cards({ A: [ "Beta", "Alpha" ], B: [ "Delta", "Charlie" ] });
            const sorted = sortColumnMap(board, sortedBy({ A: "title" }), context());

            expect(titles(sorted, "A")).toEqual([ "Alpha", "Beta" ]);
            expect(titles(sorted, "B")).toEqual([ "Delta", "Charlie" ]);

            const descending = sortColumnMap(board, sortedBy({ A: "title" }, true), context());
            expect(titles(descending, "A")).toEqual([ "Beta", "Alpha" ]);
        });

        /**
         * The identities are what keeps a sorted board as cheap as an unsorted one: `Column` reads
         * a fresh array as its cards having moved and measures every one of them.
         */
        it("hands back the same map when no column sorts", () => {
            const board = cards({ A: [ "Beta", "Alpha" ] });

            expect(sortColumnMap(board, new Map(), context())).toBe(board);
        });

        it("hands back the same map when every sorted column is already in order", () => {
            const board = cards({ A: [ "Alpha", "Beta" ] });

            expect(sortColumnMap(board, sortedBy({ A: "title" }), context())).toBe(board);
        });

        it("keeps the array of every column it does not reorder", () => {
            const board = cards({ A: [ "Beta", "Alpha" ], B: [ "Delta", "Charlie" ] });
            const sorted = sortColumnMap(board, sortedBy({ A: "title" }), context());

            expect(sorted).not.toBe(board);
            expect(sorted.get("A")).not.toBe(board.get("A"));
            expect(sorted.get("B")).toBe(board.get("B"));
        });

        it("leaves a column the board no longer holds alone", () => {
            const board = cards({ A: [ "Alpha" ] });

            expect(sortColumnMap(board, sortedBy({ Gone: "title" }), context())).toBe(board);
        });
    });

    describe("resolveSortWatch", () => {
        it("watches the cards of the sorted columns and the attributes they sort by", () => {
            const board = cards({ A: [ "Alpha", "Beta" ], B: [ "Charlie" ] });
            const watch = resolveSortWatch(board, sortedBy({ A: "attr:dueDate" }), new Map());

            expect(watch.noteIds).toEqual(new Set(noteIdsOf(board, "A")));
            expect(watch.attributeNames).toEqual(new Set([ "dueDate" ]));
            expect(watch.targetNoteIds.size).toBe(0);
        });

        it("watches the note a relation points at, whose title the sort reads", () => {
            const owner = buildNote({ title: "Owner" });
            const board = cards({ A: [ { title: "Alpha", "~owner": owner.noteId } ] });
            const watch = resolveSortWatch(
                board, sortedBy({ A: "attr:owner" }), definitions("owner", "relation"));

            expect(watch.targetNoteIds).toEqual(new Set([ owner.noteId ]));
        });

        it("watches nothing while no column sorts", () => {
            const watch = resolveSortWatch(cards({ A: [ "Alpha" ] }), new Map(), new Map());

            expect(watch.noteIds.size).toBe(0);
            expect(watch.attributeNames.size).toBe(0);
        });
    });

    describe("affectsSortOrder", () => {
        it("answers for a note the sort reads, and for one it does not", () => {
            const board = cards({ A: [ "Alpha" ], B: [ "Beta" ] });
            const watch = resolveSortWatch(board, sortedBy({ A: "title" }), new Map());
            const [ sorted ] = noteIdsOf(board, "A");
            const [ unsorted ] = noteIdsOf(board, "B");

            expect(affectsSortOrder(changes({ notes: [ sorted ] }), watch)).toBe(true);
            expect(affectsSortOrder(changes({ notes: [ unsorted ] }), watch)).toBe(false);
        });

        it("answers for the note a sorted relation points at", () => {
            const owner = buildNote({ title: "Owner" });
            const board = cards({ A: [ { title: "Alpha", "~owner": owner.noteId } ] });
            const watch = resolveSortWatch(
                board, sortedBy({ A: "attr:owner" }), definitions("owner", "relation"));

            expect(affectsSortOrder(changes({ notes: [ owner.noteId ] }), watch)).toBe(true);
        });

        it("answers for the attribute a column sorts by, and for no other", () => {
            const board = cards({ A: [ "Alpha" ] });
            const watch = resolveSortWatch(board, sortedBy({ A: "attr:dueDate" }), new Map());
            const [ card ] = noteIdsOf(board, "A");

            expect(affectsSortOrder(changes({ attributes: [ [ "dueDate", card ] ] }), watch))
                .toBe(true);
            expect(affectsSortOrder(changes({ attributes: [ [ "owner", card ] ] }), watch))
                .toBe(false);
            expect(affectsSortOrder(changes({ attributes: [ [ "dueDate", "stranger" ] ] }), watch))
                .toBe(false);
        });

        it("answers no for every change while nothing is sorted", () => {
            const board = cards({ A: [ "Alpha" ] });
            const watch = resolveSortWatch(board, new Map(), new Map());
            const [ card ] = noteIdsOf(board, "A");

            expect(affectsSortOrder(changes({ notes: [ card ] }), watch)).toBe(false);
        });
    });
});

/** One card, either by title alone or with the single attribute a test gives it. */
type CardDraft = string | { title: string, "#field"?: string, "~owner"?: string };

function cards(columns: Record<string, CardDraft[]>): ColumnMap {
    return new Map(Object.entries(columns).map(([ column, drafts ]) => [
        column,
        drafts.map((draft) => {
            const note = buildNote(typeof draft === "string" ? { title: draft } : draft);
            return { note, branch: { branchId: `b_${note.noteId}` } as FBranch };
        })
    ]));
}

function sortedBy(byColumn: Record<string, string>, isDescending = false) {
    return new Map<string, ColumnSort>(Object.entries(byColumn)
        .map(([ column, orderBy ]) => [ column, { orderBy: orderBy as SortKey, isDescending } ]));
}

function definitions(name: string, type: "label" | "relation") {
    return new Map<string, PromotedAttribute>([ [ name, {
        name,
        definitionName: `${type}:${name}`,
        type,
        title: name,
        hidden: false,
        definitionValue: "",
        isOwned: true,
        isInheritable: true
    } ] ]);
}

function context(): SortContext {
    return {
        definitions: new Map(),
        creationDate: () => undefined,
        noteTitle: (noteId) => froca.notes[noteId]?.title
    };
}

function titles(map: ColumnMap, column: string) {
    return (map.get(column) ?? []).map(({ note }) => note.title);
}

describe("getBoardData column storage", () => {
    /** A board whose cards carry both a `status` and a `priority`. */
    function twoGroupings() {
        return buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "First", "#status": "To Do", "#priority": "High", "#severity": "Minor" },
                { title: "Second", "#status": "Done", "#priority": "Low", "#severity": "Major" }
            ]
        });
    }

    const config = {
        columns: [ { value: "Done" }, { value: "To Do" } ],
        priorityViewColumns: [ { value: "Low", icon: "bx bx-down-arrow" }, { value: "High" } ]
    };

    it("takes the order and the icons of the grouping it is reading", async () => {
        const board = twoGroupings();

        const byStatus = await getBoardData(board, "status", config, false);
        const byPriority = await getBoardData(board, "priority", config, false);

        expect(byStatus.columns).toEqual([ "Done", "To Do" ]);
        expect(byPriority.columns).toEqual([ "Low", "High" ]);
    });

    it("writes a resolved list under its key, keeping the other grouping's", async () => {
        const board = twoGroupings();

        // Nothing is stored for `severity`, so the values the cards carry make the columns.
        const { newPersistedData } = await getBoardData(
            board, "severity", config, false);

        expect(newPersistedData?.severityViewColumns)
            .toEqual([ { value: "Minor" }, { value: "Major" } ]);
        expect(newPersistedData?.columns).toEqual(config.columns);
        expect(newPersistedData?.priorityViewColumns).toEqual(config.priorityViewColumns);
    });

    /**
     * The inbox collects the cards carrying no value, which is a different set under every
     * grouping. Only the board's own list can name it, so a grouping the definition leads would
     * put it behind every option that definition offers.
     */
    it("puts the inbox first under a grouping the board has never been on", async () => {
        const board = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            "#label:priority(inheritable)": "promoted,single,select,options=High;Low",
            children: [
                { title: "First", "#priority": "High" },
                { title: "Unassigned" }
            ]
        });

        const { columns, byColumn } = await getBoardData(
            board, "priority", {}, false, [ "High", "Low" ], new Map(), true);

        expect(columns).toEqual([ INBOX_COLUMN, "High", "Low" ]);
        expect((byColumn.get(INBOX_COLUMN) ?? []).map(({ note }) => note.title))
            .toEqual([ "Unassigned" ]);
    });

    it("keeps a column's icon across a rewrite of its own grouping", async () => {
        const board = twoGroupings();

        const { newPersistedData } = await getBoardData(
            board,
            "priority",
            { ...config, priorityViewColumns: [ { value: "Low", icon: "bx bx-down-arrow" } ] },
            false,
            [ "Low", "High" ]);

        expect(newPersistedData?.priorityViewColumns).toEqual([
            { value: "Low", icon: "bx bx-down-arrow" }, { value: "High" }
        ]);
    });
});

function noteIdsOf(map: ColumnMap, column: string) {
    return (map.get(column) ?? []).map(({ note }) => note.noteId);
}

/** Builds the `LoadResults` a websocket message would produce. See `refresh_reason.spec.ts`. */
function changes({ notes = [], attributes = [] }: {
    notes?: string[];
    /** `[ name, noteId ]` pairs. */
    attributes?: [ string, string ][];
}) {
    const entityChanges = attributes.map(([ name, noteId ], index) => entityChange(
        `attr${index}`, { attributeId: `attr${index}`, name, noteId }));

    const results = new LoadResults(entityChanges);
    for (const noteId of notes) {
        results.addNote(noteId, "componentId");
    }
    for (const [ index ] of attributes.entries()) {
        results.addAttribute(`attr${index}`, "componentId");
    }

    return results;
}

function entityChange(entityId: string, entity: object): EntityChange {
    return {
        entityName: "attributes", entityId, entity, hash: "", isSynced: true, isErased: false
    };
}
