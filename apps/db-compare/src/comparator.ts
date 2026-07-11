import type { Database as DatabaseType } from "better-sqlite3";

import sql, { type Row } from "./sql.js";

export interface Comparison {
    table: string;
    column: string;
    query: string;
}

export interface RowDifference {
    id: string;
    left: string;
    right: string;
}

export interface TableComparison {
    table: string;
    column: string;
    leftCount: number;
    rightCount: number;
    /** IDs present in the left database but absent from the right one. */
    missingFromRight: string[];
    /** IDs present in the right database but absent from the left one. */
    missingFromLeft: string[];
    differingRows: RowDifference[];
}

/**
 * The set of tables compared between two databases. Note that these queries currently target
 * the legacy (v214) database structure, see the README for details.
 */
export const COMPARISONS: Comparison[] = [
    {
        table: "branches",
        column: "branchId",
        query: "SELECT branchId, noteId, parentNoteId, notePosition, utcDateModified, isDeleted, prefix FROM branches"
    },
    {
        table: "notes",
        column: "noteId",
        query: "SELECT noteId, title, dateCreated, utcDateCreated, isProtected, isDeleted FROM notes WHERE isDeleted = 0"
    },
    {
        table: "note_contents",
        column: "noteId",
        query: "SELECT note_contents.noteId, note_contents.content FROM note_contents JOIN notes USING(noteId) WHERE isDeleted = 0"
    },
    {
        table: "note_revisions",
        column: "noteRevisionId",
        query: "SELECT noteRevisionId, noteId, title, dateCreated, dateLastEdited, utcDateCreated, utcDateLastEdited, isProtected FROM note_revisions"
    },
    {
        table: "note_revision_contents",
        column: "noteRevisionId",
        query: "SELECT noteRevisionId, content FROM note_revision_contents"
    },
    {
        table: "options",
        column: "name",
        query: "SELECT name, value, utcDateModified FROM options WHERE isSynced = 1"
    },
    {
        table: "attributes",
        column: "attributeId",
        query: "SELECT attributeId, noteId, type, name, value FROM attributes"
    },
    {
        table: "etapi_tokens",
        column: "etapiTokenId",
        query: "SELECT etapiTokenId, name, tokenHash, utcDateCreated, utcDateModified, isDeleted FROM etapi_tokens"
    },
    {
        table: "entity_changes",
        column: "uniqueId",
        query: "SELECT entityName || '-' || entityId AS uniqueId, hash, isErased, utcDateChanged FROM entity_changes WHERE isSynced = 1"
    }
];

/** Returns the items of `ids1` that are not present in `ids2`. */
export function findMissing(ids1: string[], ids2: string[]) {
    const present = new Set(ids2);
    return ids1.filter(item => !present.has(item));
}

/** Normalizes a row whose `content` column is a Buffer into a plain string so it can be compared. */
export function handleBuffer(obj: Row): Row {
    if (Buffer.isBuffer(obj.content)) {
        // Return a normalized copy rather than mutating the caller's row in place.
        return { ...obj, content: obj.content.toString() };
    }

    return obj;
}

/** Compares two indexed row sets belonging to a single table and returns a structured diff. */
export function compareRows(table: string, column: string, rsLeft: Record<string, Row>, rsRight: Record<string, Row>): TableComparison {
    const leftIds = Object.keys(rsLeft);
    const rightIds = Object.keys(rsRight);

    const rightIdSet = new Set(rightIds);
    const commonIds = leftIds.filter(item => rightIdSet.has(item));
    const differingRows: RowDifference[] = [];

    for (const id of commonIds) {
        const left = JSON.stringify(handleBuffer(rsLeft[id]), null, 2);
        const right = JSON.stringify(handleBuffer(rsRight[id]), null, 2);

        if (left !== right) {
            differingRows.push({ id, left, right });
        }
    }

    return {
        table,
        column,
        leftCount: leftIds.length,
        rightCount: rightIds.length,
        missingFromRight: findMissing(leftIds, rightIds),
        missingFromLeft: findMissing(rightIds, leftIds),
        differingRows
    };
}

/**
 * Compares a single table between two open databases. Throws if the query cannot run against
 * either database (e.g. the table does not exist because the two databases use different schema
 * versions); callers that compare across schema versions should handle that per table.
 */
export function compareTable(dbLeft: DatabaseType, dbRight: DatabaseType, comparison: Comparison): TableComparison {
    const { table, column, query } = comparison;

    const rsLeft = sql.getIndexed(dbLeft, column, query);
    const rsRight = sql.getIndexed(dbRight, column, query);

    return compareRows(table, column, rsLeft, rsRight);
}

/** Runs every comparison between two open databases and returns the structured results. */
export function compareDatabases(dbLeft: DatabaseType, dbRight: DatabaseType, comparisons: Comparison[] = COMPARISONS): TableComparison[] {
    return comparisons.map(comparison => compareTable(dbLeft, dbRight, comparison));
}
