import { describe, expect, it } from "vitest";

import LoadResults from "../../../services/load_results";
import type { EntityChange, EntityType } from "../../../server_types";
import { findRefreshReason } from ".";

const BOARD_ID = "boardNote";
const STATUS = "status";
/** The notes the board has cards for. */
const CARDS = [ "cardA", "cardB" ];
const COMPONENT_ID = "componentId";

describe("findRefreshReason", () => {
    it("ignores a note-row change, which is what an autosave of a card's content produces", () => {
        // The regression this exists for: getNoteIds() reports every note in the change set whatever
        // changed about it, so typing in a card rebuilt the whole board on every autosave. Nothing a
        // card renders comes off the note row -- a card keeps its own title and icon in step.
        expect(reasonFor({ notes: [ "cardA" ] })).toBeNull();
    });

    it("redraws when a card's status attribute changes, which is a card moving column", () => {
        expect(reasonFor({ attributes: [ [ STATUS, "cardA" ] ] })).toBe("status-attribute");
    });

    it("redraws for a branch change, which is how cards are added, removed and reordered", () => {
        expect(reasonFor({ branches: [ "cardB" ] })).toBe("branch");
    });

    it("redraws for an icon or colour change on a card", () => {
        expect(reasonFor({ attributes: [ [ "iconClass", "cardA" ] ] })).toBe("icon-or-color");
        expect(reasonFor({ attributes: [ [ "color", "cardA" ] ] })).toBe("icon-or-color");
    });

    it("redraws when the board's own grouping changes", () => {
        expect(reasonFor({ attributes: [ [ "board:groupBy", BOARD_ID ] ] })).toBe("group-by");
    });

    it("ignores changes to notes and branches outside the board", () => {
        expect(reasonFor({
            notes: [ "strangerNote" ],
            attributes: [ [ STATUS, "strangerNote" ] ],
            branches: [ "strangerNote" ]
        })).toBeNull();
    });

    it("ignores a groupBy change on some other note, which is another board's business", () => {
        expect(reasonFor({ attributes: [ [ "board:groupBy", "otherBoard" ] ] })).toBeNull();
    });

    it("reports the status attribute ahead of a branch when a move produces both", () => {
        // A card dragged to another column writes its status and may reorder its branch. The winner
        // only decides what gets logged, so this pins the documented order rather than a behaviour.
        expect(reasonFor({ attributes: [ [ STATUS, "cardA" ] ], branches: [ "cardA" ] }))
            .toBe("status-attribute");
    });
});

/**
 * Builds the `LoadResults` a websocket message would produce and asks it for a reason.
 *
 * Attributes and branches have to be registered twice over, because `getAttributeRows()` and
 * `getBranchRows()` merge a tracked row with the entity behind it and drop rows missing either half.
 * The entity goes in through the constructor, the row through `add*()`.
 */
function reasonFor({ notes = [], attributes = [], branches = [] }: {
    notes?: string[];
    /** `[ name, noteId ]` pairs. */
    attributes?: [ string, string ][];
    /** The note each changed branch points at. */
    branches?: string[];
}) {
    const changes: EntityChange[] = [
        ...attributes.map(([ name, noteId ], index) => entityChange("attributes", `attr${index}`, {
            attributeId: `attr${index}`, name, noteId
        })),
        ...branches.map((noteId, index) => entityChange("branches", `branch${index}`, {
            branchId: `branch${index}`, noteId
        }))
    ];

    const results = new LoadResults(changes);
    notes.forEach((noteId) => results.addNote(noteId, COMPONENT_ID));
    attributes.forEach((_, index) => results.addAttribute(`attr${index}`, COMPONENT_ID));
    branches.forEach((_, index) => results.addBranch(`branch${index}`, COMPONENT_ID));

    return findRefreshReason(results, STATUS, CARDS, BOARD_ID);
}

function entityChange(entityName: EntityType, entityId: string, entity: object): EntityChange {
    return { entityName, entityId, entity, hash: "", isSynced: true, isErased: false };
}
