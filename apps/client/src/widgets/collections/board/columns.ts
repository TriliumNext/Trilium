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
 * The definition leads because it is the shared answer — the same list the promoted field and the
 * table view offer — and the other two follow so that a column can never disappear: one the board
 * arranged before it had a definition, or a value a note still holds after the option behind it was
 * renamed away, both keep their place rather than taking their notes with them. Blank entries are
 * dropped and the comparison is exact, since two columns differing only in case are two columns.
 */
export function resolveBoardColumns(
    definitionOptions: string[],
    persistedColumns: string[],
    discoveredValues: string[]
): string[] {
    const columns: string[] = [];
    const seen = new Set<string>();

    for (const candidate of [ ...definitionOptions, ...persistedColumns, ...discoveredValues ]) {
        const value = candidate.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        columns.push(value);
    }

    return columns;
}

/**
 * How long a removal mark can veto a persisted column. The delete race it
 * exists for (#11100) resolves in seconds — the definition write's entity
 * change arrives, or its failure has surfaced — so anything still vetoed
 * after this window is far more likely a deliberate recreation from another
 * surface (a synced client, the attribute panel) than the tail of a race.
 */
const REMOVED_COLUMN_MARK_TTL_MS = 60_000;

const removedColumnsByNote = new Map<string, Map<string, number>>();

export function noteColumnRemoved(
    noteId: string,
    value: string,
    now: number = Date.now()
): void {
    let values = removedColumnsByNote.get(noteId);
    if (!values) {
        values = new Map();
        removedColumnsByNote.set(noteId, values);
    }
    values.set(value, now);
}

export function unnoteColumnRemoved(noteId: string, value: string): void {
    removedColumnsByNote.get(noteId)?.delete(value);
}

export function isRecentlyRemovedColumn(
    noteId: string,
    value: string,
    now: number = Date.now()
): boolean {
    const markedAt = removedColumnsByNote.get(noteId)?.get(value);
    if (markedAt === undefined) {
        return false;
    }
    if (now - markedAt > REMOVED_COLUMN_MARK_TTL_MS) {
        // Expired: drop it so the map cannot grow unbounded across a session.
        unnoteColumnRemoved(noteId, value);
        return false;
    }
    return true;
}


