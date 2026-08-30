import { describe, expect, it } from "vitest";

import FAttribute from "../../../entities/fattribute";
import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import noteAttributeCache from "../../../services/note_attribute_cache";
import { buildNote } from "../../../test/easy-froca";
import {
    BOARD_TEMPLATE_ID,
    canStoreColumnsInDefinition,
    getStatusDefinition,
    resolveBoardColumns
} from "./columns";

describe("resolveBoardColumns", () => {
    it("lets the definition lead, then the attachment, then the notes", () => {
        expect(resolveBoardColumns(
            [ "Todo", "Doing" ],
            [ "Doing", "Archived" ],
            [ "Todo", "Blocked" ]
        )).toEqual([ "Todo", "Doing", "Archived", "Blocked" ]);
    });

    it("keeps a column the definition no longer offers rather than dropping its notes", () => {
        expect(resolveBoardColumns([ "Todo" ], [], [ "Renamed away" ]))
            .toEqual([ "Todo", "Renamed away" ]);
    });

    it("falls back to the board's own two sources when nothing is defined", () => {
        expect(resolveBoardColumns([], [ "Todo" ], [ "Done" ])).toEqual([ "Todo", "Done" ]);
    });

    it("drops blanks and treats columns differing only in case as distinct", () => {
        expect(resolveBoardColumns([ "", "  " ], [ " Todo " ], [ "todo" ]))
            .toEqual([ "Todo", "todo" ]);
    });

    it("drops a deleted column whichever source still offers it", () => {
        expect(resolveBoardColumns(
            [ "Todo", "Done" ],
            [ "Todo", "Done" ],
            [ "Todo", "Done" ],
            new Map([ [ "Done", undefined ] ])
        )).toEqual([ "Todo" ]);
    });

    /**
     * The definition is written a round trip after the config, so right after an insert or a
     * reorder it still holds the old order. Leading with it there would put the new column behind
     * every option it lists, and the refresh would persist that.
     */
    it("takes the order from the board's own list once that accounts for every column", () => {
        expect(resolveBoardColumns(
            [ "To Do", "Done" ],
            [ "To Do", "New column", "Done" ],
            [ "To Do", "Done" ]
        )).toEqual([ "To Do", "New column", "Done" ]);

        expect(resolveBoardColumns([ "To Do", "Done" ], [ "Done", "To Do" ], [ "To Do", "Done" ]))
            .toEqual([ "Done", "To Do" ]);
    });

    it("keeps a renamed column in the slot the old name held", () => {
        expect(resolveBoardColumns(
            [ "To Do", "Doing", "Done" ],
            [ "To Do", "In Progress", "Done" ],
            [ "To Do", "In Progress", "Done" ],
            new Map([ [ "Doing", "In Progress" ] ])
        )).toEqual([ "To Do", "In Progress", "Done" ]);
    });

    it("renames in place in a source that has caught up too, without listing it twice", () => {
        expect(resolveBoardColumns([ "Doing" ], [ "In Progress" ], [ "In Progress" ],
            new Map([ [ "Doing", "In Progress" ] ]))).toEqual([ "In Progress" ]);
    });

    it("substitutes by exact value, so a column differing only in case is untouched", () => {
        expect(resolveBoardColumns([ "Done", "done" ], [], [],
            new Map([ [ "Done", undefined ] ]))).toEqual([ "done" ]);
    });
});

describe("getStatusDefinition", () => {
    it("finds the definition for the label, however the group-by names it", () => {
        const board = buildBoard({ "#label:status": "promoted,single,select,options=Todo;Done" });

        for (const groupBy of [ "status", "#status" ]) {
            const found = getStatusDefinition(board, groupBy);
            expect(found?.isOwned).toBe(true);
            expect(found?.options).toEqual([ "Todo", "Done" ]);
        }
    });

    it("offers no choices for a definition that is not a select", () => {
        const board = buildBoard({ "#label:status": "promoted,single,text" });

        const found = getStatusDefinition(board, "status");
        expect(found?.definition.labelType).toBe("text");
        expect(found?.options).toEqual([]);
    });

    it("marks a definition reached through the template as not the board's own", () => {
        const board = buildBoard({}, [
            { noteId: BOARD_TEMPLATE_ID, name: "label:status", value: "promoted,single,text" }
        ]);

        expect(getStatusDefinition(board, "status")).toMatchObject({
            isOwned: false,
            options: []
        });
    });

    it("has nothing to offer for a relation, or for a label nobody defined", () => {
        const board = buildBoard({ "#label:status": "promoted,single,select,options=Todo" });

        expect(getStatusDefinition(board, "~status")).toBeUndefined();
        expect(getStatusDefinition(board, "#")).toBeUndefined();
        expect(getStatusDefinition(board, "priority")).toBeUndefined();
    });
});

describe("canStoreColumnsInDefinition", () => {
    it("may create one where nothing defines the label yet", () => {
        expect(canStoreColumnsInDefinition(undefined)).toBe(true);
    });

    it.each([
        [ "its own", "boardNote", "promoted,single,text", true ],
        [ "the template's, which it may copy", BOARD_TEMPLATE_ID, "promoted,single,text", true ],
        [ "its own, already a select", "boardNote", "promoted,single,select,options=Todo", true ],
        [ "an ancestor's", "someAncestor", "promoted,single,text", false ],
        [ "typed as something else", "boardNote", "promoted,single,date", false ],
        [ "multi-valued", "boardNote", "promoted,multi,text", false ]
    ])("is %s: %s", (_label, ownerNoteId, value, expected) => {
        const board = buildBoard({}, [ { noteId: ownerNoteId, name: "label:status", value } ]);

        expect(canStoreColumnsInDefinition(getStatusDefinition(board, "status"))).toBe(expected);
    });
});

/**
 * A board note, optionally reached by definitions it does not own.
 *
 * Froca's mock does not resolve templates, so an inherited definition is pushed onto the note's
 * attribute cache directly — after the owned ones, which is the order `__getCachedAttributes`
 * produces and which the nearest-wins deduplication depends on.
 */
function buildBoard(
    ownedAttributes: Record<string, string>,
    inheritedDefinitions: { noteId: string; name: string; value: string }[] = []
): FNote {
    // buildNote appends to whatever the cache already holds for the id, so the previous test's
    // definitions would otherwise still be on the note.
    delete noteAttributeCache.attributes["boardNote"];

    const board = buildNote({ id: "boardNote", title: "Board", "#viewType": "board", ...ownedAttributes });

    for (const [ index, { noteId, name, value } ] of inheritedDefinitions.entries()) {
        noteAttributeCache.attributes[board.noteId].push(new FAttribute(froca, {
            noteId,
            attributeId: `inherited${index}`,
            type: "label",
            name,
            value,
            position: index,
            isInheritable: true
        }));
    }

    return board;
}
