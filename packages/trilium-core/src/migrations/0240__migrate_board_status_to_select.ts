import { type DefinitionObject, promotedAttributeDefinitionParser } from "@triliumnext/commons";

import becca from "../becca/becca";
import becca_loader from "../becca/becca_loader";
import BAttribute from "../becca/entities/battribute";
import type BNote from "../becca/entities/bnote";
import { getContext } from "../services/context";
import { md5 } from "../services/utils/index";
import { unwrapStringOrBuffer } from "../services/utils/binary";

/**
 * Gives every board its own `select` definition for the label it groups by, seeded with the columns
 * the board already shows, so the column list stops living only in the `board.json` attachment.
 *
 * Boards reaching this migration were created from `_template_board` and inherit their `label:status`
 * definition from it, which every board in the document shares — one option list there would be
 * everyone's option list. The copy this migration writes is owned by the board, so the options are the
 * board's own; the template no longer declares the definition at all, so `enforceAttributes` deletes
 * the inherited one from `_template_board` on the next startup. That ordering is automatic: the hidden
 * subtree is not checked until the migrations have finished, so the copies are taken first.
 *
 * A board is left exactly as it is whenever the copy would be wrong or unsafe — see
 * {@link SkipReason} — and the board view keeps reading `board.json` for those.
 *
 * This runs once, against the boards that exist when the document is upgraded. Boards created
 * afterwards get their definition from the board view instead, which writes the columns it resolves
 * into one (see `BoardApi#syncColumnsToDefinition`).
 */
export default () => {
    getContext().init(() => {
        becca_loader.load();

        for (const note of Object.values(becca.notes)) {
            if (note.getLabelValue("viewType") !== "board") {
                continue;
            }

            const plan = planBoardMigration(collectBoardInput(note));
            if (plan.action === "skip") {
                console.log(`Leaving board '${note.noteId}' as it is: ${plan.reason}.`);
                continue;
            }

            console.log(`Migrating board '${note.noteId}': '${plan.name}' becomes a select of ${plan.optionCount} option(s).`);
            writeDefinition(plan);
        }
    });
};

/** The label a board groups by when it does not name one itself, mirroring the board view's default. */
export const DEFAULT_GROUP_BY = "status";

/** The definition a template-created board inherits is owned by this note, and only by this note. */
export const BOARD_TEMPLATE_ID = "_template_board";

const VIEW_CONFIG_ROLE = "viewConfig";
const BOARD_VIEW_CONFIG_TITLE = "board.json";

/** Why a board was left alone, logged so a support question can be answered from the startup log. */
export type SkipReason =
    /** A hidden-subtree note — `_template_board` is itself a board, and is the one that must not own options. */
    | "system-note"
    /** The columns live in an encrypted attachment, which a migration has no key for. */
    | "protected"
    /** The columns are target notes, which a label definition cannot describe. */
    | "relation-mode"
    /** A search board's results are not its subtree, so an inheritable definition would not reach them. */
    | "search-note"
    /** `#board:groupBy` is set to an empty value. */
    | "no-group-by"
    /** Already migrated — the board owns a select definition. */
    | "already-select"
    /** The definition says the values are dates, numbers, … — the board groups by something typed. */
    | "incompatible-type"
    /** A note may hold several values at once, which a single-choice column list cannot express. */
    | "multi-value"
    /** The definition is owned by an ancestor or a template shared beyond this board. */
    | "foreign-definition"
    /** Nothing to offer: no columns are persisted and no note carries the label. */
    | "no-columns";

export interface ExistingDefinition {
    attributeId: string;
    /** Which note carries the definition — the board itself, a template, or an ancestor. */
    ownerNoteId: string;
    isInheritable: boolean;
    definition: DefinitionObject;
}

export interface BoardMigrationInput {
    noteId: string;
    /** The label name to group by, without the `#` prefix it may have been written with. */
    name: string;
    /** Whether the note belongs to the hidden subtree, whose ids are all prefixed with `_`. */
    isSystemNote: boolean;
    isProtected: boolean;
    isRelationMode: boolean;
    isSearchNote: boolean;
    /** The definition the board can already see for {@link name}, wherever it is owned. */
    existingDefinition?: ExistingDefinition;
    /** The columns held in `board.json`, in the order the board shows them. */
    persistedColumns: string[];
    /** The values the board's descendants actually carry, in tree order. */
    discoveredValues: string[];
}

export type BoardMigrationPlan =
    | { action: "skip"; reason: SkipReason }
    | {
        action: "write";
        /** Reused when the board already owns the definition, derived otherwise. */
        attributeId: string;
        noteId: string;
        /** The full definition attribute name, e.g. `label:status`. */
        name: string;
        value: string;
        isInheritable: boolean;
        /** Only for the log line — the value already carries the options. */
        optionCount: number;
    };

/**
 * Decides what a single board needs, from plain data only, so the whole decision table can be
 * exercised without a database.
 *
 * The definition that is written keeps everything the existing one said — its alias, and whether it
 * was promoted — and only changes the type to `select` and attaches the options. A board with no
 * definition at all gets one that is *not* promoted: it never showed a Status field on its notes,
 * and gaining the column must not also make one appear.
 */
export function planBoardMigration(input: BoardMigrationInput): BoardMigrationPlan {
    if (input.isSystemNote) return { action: "skip", reason: "system-note" };
    if (input.isProtected) return { action: "skip", reason: "protected" };
    if (input.isRelationMode) return { action: "skip", reason: "relation-mode" };
    if (input.isSearchNote) return { action: "skip", reason: "search-note" };
    if (!input.name) return { action: "skip", reason: "no-group-by" };

    const existing = input.existingDefinition;
    const isOwnedByBoard = existing?.ownerNoteId === input.noteId;

    if (existing) {
        // An ancestor's definition, or a user template shared with other notes, describes more than
        // this board; a copy here would shadow nothing and merely duplicate the field.
        if (!isOwnedByBoard && existing.ownerNoteId !== BOARD_TEMPLATE_ID) {
            return { action: "skip", reason: "foreign-definition" };
        }
        if (existing.definition.labelType === "select") {
            return { action: "skip", reason: "already-select" };
        }
        // `undefined` is the parser's way of saying the type token was absent, which means text.
        if (existing.definition.labelType && existing.definition.labelType !== "text") {
            return { action: "skip", reason: "incompatible-type" };
        }
        if (existing.definition.multiplicity === "multi") {
            return { action: "skip", reason: "multi-value" };
        }
    }

    const options = resolveStatusColumns(input.persistedColumns, input.discoveredValues);
    if (!options.length) {
        return { action: "skip", reason: "no-columns" };
    }

    const name = `label:${input.name}`;
    return {
        action: "write",
        // Reusing the id when the board owns the definition updates it in place; otherwise the id is
        // derived so that every instance migrating this document writes the same row (see
        // deriveDefinitionAttributeId).
        attributeId: isOwnedByBoard && existing
            ? existing.attributeId
            : deriveDefinitionAttributeId(input.noteId, name),
        noteId: input.noteId,
        name,
        value: promotedAttributeDefinitionParser.serialize({
            ...existing?.definition,
            labelType: "select",
            selectOptions: options
        }, "label"),
        // The template's definition is inheritable, and a definition that is not would not reach the
        // notes on the board at all.
        isInheritable: existing?.isInheritable ?? true,
        optionCount: options.length
    };
}

/**
 * The options to offer, from the columns the board persisted and the values its notes actually carry.
 *
 * Persisted columns come first and in their stored order — that is the order the user arranged — and
 * anything only a note knows about is appended, so a column can never be lost by migrating. Blank
 * entries are dropped (the board has no blank column) and the comparison is exact, since two columns
 * differing only in case are two columns to the board view as well.
 */
export function resolveStatusColumns(persistedColumns: string[], discoveredValues: string[]): string[] {
    const options: string[] = [];
    const seen = new Set<string>();

    for (const candidate of [ ...persistedColumns, ...discoveredValues ]) {
        const value = candidate.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        options.push(value);
    }

    return options;
}

/**
 * Reads the column list out of a `board.json` attachment, tolerating anything that is not one.
 *
 * The attachment is written by the client and may predate the current shape, be truncated, or have
 * been edited by hand; none of that is worth failing a migration over, and an unreadable attachment
 * simply contributes no columns — the values on the notes still do.
 */
export function parseBoardColumns(content: string): string[] {
    if (!content.trim()) {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return [];
    }

    const columns = (parsed as { columns?: unknown } | null)?.columns;
    if (!Array.isArray(columns)) {
        return [];
    }

    return columns
        .map((column) => (column as { value?: unknown } | null)?.value)
        .filter((value): value is string => typeof value === "string");
}

/**
 * The id to write the definition under, derived from the note and the definition name rather than
 * generated.
 *
 * `dbVersion` is a not-synced option, so every instance sharing a document runs this migration
 * against its own copy. With a generated id each would write a different row and the sync would leave
 * the note carrying two definitions of the same name — exactly the duplicated field this migration
 * exists to avoid. Deriving the id makes the two writes the same row, which converges.
 */
export function deriveDefinitionAttributeId(noteId: string, definitionName: string): string {
    return md5(`${noteId}|${definitionName}`).substring(0, 12);
}

/** Gathers everything {@link planBoardMigration} needs, reading nothing a protected note would deny. */
function collectBoardInput(note: BNote): BoardMigrationInput {
    const groupBy = (note.getLabelValue("board:groupBy") ?? DEFAULT_GROUP_BY).trim();
    const isRelationMode = groupBy.startsWith("~");
    const name = groupBy.replace(/^[#~]/, "").trim();

    const base = {
        noteId: note.noteId,
        name,
        // The hidden subtree gives its notes ids of their own, all starting with an underscore.
        isSystemNote: note.noteId.startsWith("_"),
        isProtected: !!note.isProtected,
        isRelationMode,
        isSearchNote: note.type === "search"
    };

    // The attachment of a protected note is encrypted, and a search note's results are not its
    // subtree; in every skipped case below, neither is read.
    if (base.isSystemNote || base.isProtected || isRelationMode || base.isSearchNote || !name) {
        return { ...base, persistedColumns: [], discoveredValues: [] };
    }

    return {
        ...base,
        existingDefinition: findExistingDefinition(note, name),
        persistedColumns: readPersistedColumns(note),
        discoveredValues: readDiscoveredValues(note, name)
    };
}

/** The definition the board can see for the label, owned or inherited, whichever comes first. */
function findExistingDefinition(note: BNote, name: string): ExistingDefinition | undefined {
    // Owned attributes are listed before inherited ones, so a board that has already been migrated
    // finds its own copy rather than the template's.
    const attribute = note.getAttributes()
        .find((attr) => attr.isDefinition() && attr.name === `label:${name}`);
    if (!attribute) {
        return undefined;
    }

    return {
        attributeId: attribute.attributeId,
        ownerNoteId: attribute.noteId,
        isInheritable: attribute.isInheritable,
        definition: attribute.getDefinition()
    };
}

function readPersistedColumns(note: BNote): string[] {
    const attachment = note.getAttachmentsByRole(VIEW_CONFIG_ROLE)
        .find((candidate) => candidate.title === BOARD_VIEW_CONFIG_TITLE);
    if (!attachment) {
        return [];
    }

    try {
        return parseBoardColumns(unwrapStringOrBuffer(attachment.getContent()));
    } catch (e) {
        console.log(`Could not read '${BOARD_VIEW_CONFIG_TITLE}' of board '${note.noteId}':`, e);
        return [];
    }
}

/**
 * The values the board's notes carry, read the way the board view reads them: the whole subtree
 * rather than the direct children, archived notes included so that a column does not disappear with
 * the last note that was filed under it.
 */
function readDiscoveredValues(note: BNote, name: string): string[] {
    const values: string[] = [];

    for (const descendant of note.getSubtree({ includeArchived: true, includeHidden: false }).notes) {
        if (descendant.noteId === note.noteId) continue;

        const value = descendant.getLabelValue(name);
        if (value) {
            values.push(value);
        }
    }

    return values;
}

function writeDefinition(plan: Extract<BoardMigrationPlan, { action: "write" }>) {
    const existing = becca.attributes[plan.attributeId];

    // Constructing a second BAttribute for an id becca already holds would push a duplicate onto the
    // note's owned attributes, so an existing row — the board's own definition, or this migration's
    // own earlier write — is edited rather than replaced.
    if (existing) {
        existing.value = plan.value;
        existing.isInheritable = plan.isInheritable;
        existing.save();
        return;
    }

    new BAttribute({
        attributeId: plan.attributeId,
        noteId: plan.noteId,
        type: "label",
        name: plan.name,
        value: plan.value,
        isInheritable: plan.isInheritable
    }).save();
}
