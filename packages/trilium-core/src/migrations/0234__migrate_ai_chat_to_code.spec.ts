import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import becca_loader from "../becca/becca_loader.js";
import * as cls from "../services/context.js";
import { getSql } from "../services/sql/index.js";
import migration from "./0234__migrate_ai_chat_to_code.js";

// Spec files only ever run under vitest (ESM via Vite), so import.meta.url is available here; the
// CLAUDE.md ban applies to production code that gets bundled to CJS.
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Migration 0234 retires the standalone `aiChat` note type: those notes become ordinary `code`
 * notes holding their chat JSON. Notes of any other type must be left untouched.
 */
describe("Migration 0234: migrate aiChat notes to code", () => {
    let sql: ReturnType<typeof getSql>;

    /** Inserts a note plus its blob straight into the DB, bypassing becca's type validation. */
    function insertNote(noteId: string, type: string, mime: string, content: string) {
        const blobId = `blob_${noteId}`;
        sql.execute(/*sql*/`
            INSERT INTO notes (noteId, title, type, mime, blobId, dateCreated, dateModified, utcDateCreated, utcDateModified)
            VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
        `, [noteId, `Note ${noteId}`, type, mime, blobId]);
        sql.execute(/*sql*/`
            INSERT INTO blobs (blobId, content, dateModified, utcDateModified)
            VALUES (?, ?, datetime('now'), datetime('now'))
        `, [blobId, content]);
    }

    beforeEach(async () => {
        // Resolved here rather than at describe-collection time: describe callbacks run before the
        // setup's beforeAll, so getSql() would throw "SQL not initialized".
        sql = getSql();

        // Reload the fixture per test so one test's migration doesn't leak into the next.
        sql.rebuildFromBuffer(readFileSync(join(__dirname, "../test/fixtures/document.db")));
        await new Promise<void>((resolve) => {
            cls.getContext().init(() => {
                becca_loader.load();
                resolve();
            });
        });
    });

    it("converts aiChat notes to code notes and leaves every other type alone", () => {
        const chatContent = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
        insertNote("aiChatNote001", "aiChat", "application/json", chatContent);
        insertNote("aiChatNote002", "aiChat", "text/plain", "{}");
        insertNote("plainTextNote1", "text", "text/html", "<p>untouched</p>");

        migration();

        const migrated = sql.getRows<{ noteId: string; type: string; mime: string }>(
            /*sql*/`SELECT noteId, type, mime FROM notes WHERE noteId IN ('aiChatNote001', 'aiChatNote002', 'plainTextNote1') ORDER BY noteId`
        );

        expect(migrated).toEqual([
            // Both aiChat notes become code notes, and the mime is normalised even when it wasn't JSON.
            { noteId: "aiChatNote001", type: "code", mime: "application/json" },
            { noteId: "aiChatNote002", type: "code", mime: "application/json" },
            { noteId: "plainTextNote1", type: "text", mime: "text/html" }
        ]);

        // The chat payload itself is carried over untouched — only the type/mime change.
        expect(sql.getValue(/*sql*/`SELECT content FROM blobs WHERE blobId = 'blob_aiChatNote001'`)).toBe(chatContent);
    });

    it("is a no-op when no aiChat notes are left, so it can be re-run safely", () => {
        insertNote("aiChatNote003", "aiChat", "application/json", "{}");

        migration();
        const afterFirst = sql.getValue(/*sql*/`SELECT utcDateModified FROM notes WHERE noteId = 'aiChatNote003'`);

        migration();

        expect(sql.getValue(/*sql*/`SELECT type FROM notes WHERE noteId = 'aiChatNote003'`)).toBe("code");
        // Nothing matched the second time, so the note wasn't saved again.
        expect(sql.getValue(/*sql*/`SELECT utcDateModified FROM notes WHERE noteId = 'aiChatNote003'`)).toBe(afterFirst);
    });
});
