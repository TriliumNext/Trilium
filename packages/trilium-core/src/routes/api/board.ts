import {
    type BoardColumnsKey, boardColumnsKey, promotedAttributeDefinitionParser
} from "@triliumnext/commons";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import { ValidationError } from "../../errors.js";

/** The title of the attachment a collection keeps its view configuration in. */
const CONFIG_ATTACHMENT = "board.json";

interface RenameColumnRequest {
    /** The label or relation the board groups by, without the `#` or `~` it is written with. */
    attribute: string;
    /** Whether the board groups by a relation, whose value is a note rather than a name. */
    isRelation?: boolean;
    oldValue: string;
    newValue: string;
}

/** One column as the board stores it, which holds what it is drawn with as well as its value. */
interface StoredColumn {
    value: string;
    [key: string]: unknown;
}

/**
 * Renames a board column, everywhere it is named, in one write.
 *
 * A column is three things at once: the value its cards carry, an entry in the board's stored
 * configuration, and an option of the definition the board groups by. Renaming them one at a time
 * leaves a window in which they disagree, and a client that reads the board during it resolves the
 * old name back from whichever of the three still carries it and writes that back. Written together
 * under one transaction, there is no such window for anyone to read.
 */
function renameColumn(req: Request<{ noteId: string }>) {
    const noteId = req.params.noteId;
    const { attribute, isRelation, oldValue, newValue } = req.body as RenameColumnRequest;

    if (!attribute?.trim()) {
        throw new ValidationError("The attribute the board groups by is required.");
    }

    // A column is its value, so a blank name would leave its cards with nothing to group by.
    if (!newValue?.trim()) {
        throw new ValidationError("A column's new name cannot be empty.");
    }

    if (oldValue === newValue) {
        return { cards: 0 };
    }

    const board = becca.getNoteOrThrow(noteId);
    const type = isRelation ? "relation" : "label";

    let cards = 0;
    for (const note of board.getSubtree({ includeArchived: true }).notes) {
        for (const owned of note.getOwnedAttributes(type, attribute)) {
            if (owned.value === oldValue) {
                owned.value = newValue;
                owned.save();
                cards++;
            }
        }
    }

    renameInDefinition(board, attribute, oldValue, newValue);

    // The board keeps a column list per grouping, so the rename lands in the list of the grouping
    // it was made on.
    const columnsKey = boardColumnsKey(isRelation ? `~${attribute}` : attribute);

    // Answered with, so the client that asked has the configuration as it now stands rather than
    // the one it read before the rename. Writing that stale one back is what used to bring the old
    // name to the board again a moment after it left.
    return { cards, config: renameInConfig(board, columnsKey, oldValue, newValue) };
}

/**
 * Renames the column in the list of values the board's own definition offers.
 *
 * Only its own: a definition the board merely inherits describes every board under that note, and
 * is not this board's to rewrite.
 */
function renameInDefinition(board: BNote, attribute: string, oldValue: string, newValue: string) {
    const definition = board.getOwnedAttributes("label", `label:${attribute}`)[0];
    if (!definition) {
        return;
    }

    const parsed = promotedAttributeDefinitionParser.parse(definition.value);
    if (parsed.labelType !== "select" || !parsed.selectOptions?.includes(oldValue)) {
        return;
    }

    definition.value = promotedAttributeDefinitionParser.serialize({
        ...parsed,
        // In place, so the column keeps the position it is drawn in.
        selectOptions: parsed.selectOptions.map(option => option === oldValue ? newValue : option)
    }, "label");
    definition.save();
}

/**
 * Renames the column in the board's stored configuration, keeping everything else it holds.
 *
 * @param columnsKey which grouping's column list the rename was made on.
 * @returns the configuration as it now stands, or nothing where the board keeps none.
 */
function renameInConfig(
    board: BNote, columnsKey: BoardColumnsKey, oldValue: string, newValue: string
) {
    const attachment = board.getAttachmentByTitle(CONFIG_ATTACHMENT);
    if (!attachment) {
        return undefined;
    }

    let config: Partial<Record<BoardColumnsKey, StoredColumn[]>>;
    try {
        config = JSON.parse(attachment.getContent().toString());
    } catch {
        // A configuration that cannot be read is left as it is: the cards and the definition
        // already name the column, and the board writes this one out again as it draws.
        return undefined;
    }

    const columns = config[columnsKey];
    if (!columns?.some(column => column.value === oldValue)) {
        return config;
    }

    const renamed = {
        ...config,
        [columnsKey]: columns.map(column =>
            column.value === oldValue ? { ...column, value: newValue } : column)
    };

    board.saveAttachment({
        title: CONFIG_ATTACHMENT,
        role: attachment.role,
        mime: attachment.mime,
        position: attachment.position,
        content: JSON.stringify(renamed)
    }, "title");

    return renamed;
}

export default {
    renameColumn
};
