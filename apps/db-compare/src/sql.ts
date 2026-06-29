import type { Database } from "better-sqlite3";

/** A single database row, keyed by column name. */
export type Row = Record<string, unknown>;

function getResults(db: Database, query: string): Row[] {
    return db.prepare(query).all() as Row[];
}

function getIndexed(db: Database, column: string, query: string): Record<string, Row> {
    const results = getResults(db, query);

    const map: Record<string, Row> = {};

    for (const row of results) {
        map[String(row[column])] = row;
    }

    return map;
}

export default {
    getResults,
    getIndexed
};
