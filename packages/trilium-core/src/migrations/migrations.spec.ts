import { HANDWRITING_MIME } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { getSql } from "../services/sql/index.js";
import { MIGRATIONS } from "./migrations.js";

describe("migrations", () => {
    it("should have unique version numbers", () => {
        const versions = MIGRATIONS.map((m) => m.version);
        const uniqueVersions = new Set(versions);
        expect(versions.length).toBe(uniqueVersions.size);
    });

    it("turns the notes and revisions of the handwriting type into code notes (243)", () => {
        const sql = getSql();
        const migration = MIGRATIONS.find((m) => m.version === 243);
        const script = migration && "sql" in migration ? migration.sql : "";
        const [ sheetId, otherId ] = sql.getColumn<string>(
            "SELECT noteId FROM notes WHERE type = 'text' AND isDeleted = 0 AND noteId != 'root' LIMIT 2");
        const revisionId = sql.getValue<string>("SELECT revisionId FROM revisions LIMIT 1");
        expect(sheetId && otherId && revisionId).toBeTruthy();
        sql.execute("UPDATE notes SET type = 'handwriting', mime = 'application/json' WHERE noteId = ?", [ sheetId ]);
        sql.execute("UPDATE revisions SET type = 'handwriting', mime = 'application/json' WHERE revisionId = ?", [ revisionId ]);

        sql.executeScript(script);

        const row = (table: string, key: string, id: string) =>
            sql.getRow<{ type: string, mime: string }>(`SELECT type, mime FROM ${table} WHERE ${key} = ?`, [ id ]);
        const code = { type: "code", mime: HANDWRITING_MIME };
        expect(row("notes", "noteId", sheetId)).toEqual(code);
        expect(row("revisions", "revisionId", revisionId)).toEqual(code);
        expect(row("notes", "noteId", otherId)).toEqual({ type: "text", mime: "text/html" });
    });

    it("should be sorted in descending order by version", () => {
        for (let i = 1; i < MIGRATIONS.length; i++) {
            expect(MIGRATIONS[i - 1].version, `migration at index ${i - 1} (v${MIGRATIONS[i - 1].version}) should be greater than migration at index ${i} (v${MIGRATIONS[i].version})`).toBeGreaterThan(MIGRATIONS[i].version);
        }
    });
});
