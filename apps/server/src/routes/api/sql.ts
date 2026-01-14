import { ValidationError } from "@triliumnext/core";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import sql from "../../services/sql.js";
import { safeExtractMessageAndStackFromError } from "../../services/utils.js";

interface Table {
    name: string;
    columns: unknown[];
}

function getSchema() {
    const tableNames = sql.getColumn<string>(/*sql*/`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
    const tables: Table[] = [];

    for (const tableName of tableNames) {
        tables.push({
            name: tableName,
            columns: sql.getRows<{ name: string; type: string; }>(`PRAGMA table_info(${tableName})`)
        });
    }

    return tables;
}

function execute(req: Request) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    const content = note.getContent();
    if (typeof content !== "string") {
        throw new ValidationError("Invalid note type.");
    }

    const queries = content.split("\n---");

    try {
        const results: unknown[] = [];

        for (let query of queries) {
            query = query.trim();

            while (query.startsWith("-- ")) {
                // Query starts with one or more SQL comments, discard these before we execute.
                const pivot = query.indexOf("\n");
                query = pivot > 0 ? query.substr(pivot + 1).trim() : "";
            }

            if (!query) {
                continue;
            }

            if (query.toLowerCase().startsWith("select") || query.toLowerCase().startsWith("with")) {
                results.push(sql.getRows(query));
            } else {
                results.push(sql.execute(query));
            }
        }

        return {
            success: true,
            results
        };
    } catch (e: unknown) {
        const [errMessage] = safeExtractMessageAndStackFromError(e);
        return {
            success: false,
            error: errMessage
        };
    }
}

export default {
    getSchema,
    execute
};
