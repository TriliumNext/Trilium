import { type DefinitionObject } from "@triliumnext/commons";

import type FAttribute from "../../../entities/fattribute";
import type FNote from "../../../entities/fnote";

/**
 * The template every board is created from. It no longer defines the status label — it is shared by
 * every board in the document, so its options would be everyone's options — but documents that have
 * not yet had the hidden subtree re-checked, and peers syncing from an older instance, can still be
 * carrying the definition it used to hold. A board is allowed to copy that one into its own.
 */
export const BOARD_TEMPLATE_ID = "_template_board";

/** The label a board groups by when `#board:groupBy` does not name one. */
export const DEFAULT_GROUP_BY = "status";

/** The icon a column shows until one is picked for it. */
export const DEFAULT_COLUMN_ICON = "bx bx-circle";

export interface BoardStatusDefinition {
    /** The definition attribute, wherever it is owned. */
    attribute: FAttribute;
    definition: DefinitionObject;
    /** Whether the board itself owns it, and so may have its columns written straight into it. */
    isOwned: boolean;
    /** The choices it offers, empty unless it declares a select. */
    options: string[];
}

/**
 * The definition the board groups by, or `undefined` when it groups by something no definition
 * describes — a relation, or a plain label nobody ever defined.
 *
 * @param parentNote the board note.
 * @param groupBy the value of `#board:groupBy`, with the `#`/`~` prefix it may carry.
 */
export function getStatusDefinition(parentNote: FNote, groupBy: string): BoardStatusDefinition | undefined {
    if (groupBy.startsWith("~")) {
        return undefined;
    }

    const name = groupBy.replace(/^#/, "").trim();
    if (!name) {
        return undefined;
    }

    // Nearest-wins, so a board that owns a definition is described by its own rather than by the
    // template's (see FNote#getAttributeDefinitions).
    const attribute = parentNote.getAttributeDefinitions()
        .find((attr) => attr.name === `label:${name}`);
    if (!attribute) {
        return undefined;
    }

    const definition = attribute.getDefinition();
    return {
        attribute,
        definition,
        isOwned: attribute.noteId === parentNote.noteId,
        options: definition.labelType === "select" ? (definition.selectOptions ?? []) : []
    };
}

/**
 * Whether the board may keep its columns in the definition, creating one or taking a copy of the
 * template's where it has none of its own.
 *
 * A definition owned by an ancestor, or by a template the user shares between notes, describes more
 * than this board: a copy here would quietly change the field for everything under the board. One
 * that says its values are dates, or that a note may hold several at once, is not describing
 * something a column list can stand in for. Those boards keep their columns in the attachment alone.
 *
 * Having none at all is the ordinary case for a board created now, and the answer is yes: the
 * definition the board writes is its own from the start.
 */
export function canStoreColumnsInDefinition(statusDefinition: BoardStatusDefinition | undefined): boolean {
    if (!statusDefinition) {
        // Nothing defines the label yet, so a definition the board creates is its own.
        return true;
    }

    const { attribute, definition, isOwned } = statusDefinition;
    if (!isOwned && attribute.noteId !== BOARD_TEMPLATE_ID) {
        return false;
    }
    if (definition.multiplicity === "multi") {
        return false;
    }

    // `undefined` is the parser's way of saying the type token was absent, which means text.
    return !definition.labelType
        || definition.labelType === "text"
        || definition.labelType === "select";
}

/**
 * The columns to show, from the choices the definition offers, the columns the board persisted, and
 * the values its notes actually carry.
 *
 * The definition leads on membership because it is the shared answer — the same list the promoted
 * field and the table view offer — and the other two follow so that a column can never disappear:
 * one the board arranged before it had a definition, or a value a note still holds after the option
 * behind it was renamed away, both keep their place rather than taking their notes with them. Blank
 * entries are dropped and the comparison is exact, since two columns differing only in case are two
 * columns.
 *
 * On order the attachment leads instead, wherever it already lists every column (see below).
 *
 * @param pendingRenames what the board has just renamed each column to, or `undefined` where it
 *                       deleted one. The three sources are written one at a time, and a refresh in
 *                       between would otherwise resolve the old value back and persist it, past
 *                       which nothing here can drop it again. Substituted rather than skipped, so a
 *                       renamed column keeps the slot the old name holds in a source still carrying
 *                       it, rather than dropping behind every option the definition leads with.
 */
export function resolveBoardColumns(
    definitionOptions: string[],
    persistedColumns: string[],
    discoveredValues: string[],
    pendingRenames: ReadonlyMap<string, string | undefined> = new Map()
): string[] {
    const resolve = (candidates: string[]) => {
        const columns: string[] = [];
        const seen = new Set<string>();

        for (const candidate of candidates) {
            const trimmed = candidate.trim();
            const value = pendingRenames.has(trimmed) ? pendingRenames.get(trimmed) : trimmed;
            if (!value || seen.has(value)) continue;
            seen.add(value);
            columns.push(value);
        }

        return columns;
    };

    const columns = resolve([ ...definitionOptions, ...persistedColumns, ...discoveredValues ]);
    const persisted = resolve(persistedColumns);

    // The definition leads on which columns there are, but not on the order once the board's own
    // list holds every one of them: that list is the arrangement made here, which a definition
    // shared with other notes cannot express, and which it lags by a round trip after every insert
    // and reorder. Equal lengths are enough to tell, the attachment being one of the sources above.
    return persisted.length === columns.length ? persisted : columns;
}
