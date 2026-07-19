import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import becca from "../becca/becca.js";
import becca_loader from "../becca/becca_loader.js";
import { getContext } from "./context.js";
import dataEncryption from "./encryption/data_encryption.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import notesService from "./notes.js";
import protectedSessionService from "./protected_session.js";
import { getSql } from "./sql/index.js";
import TaskContext from "./task_context.js";
import { encodeUtf8 } from "./utils/binary.js";

// Resolve fixture path relative to this spec file. Spec files only ever run
// under vitest (which uses ESM via Vite), so import.meta.url is available;
// the CLAUDE.md restriction against import.meta.url applies to production
// code that gets bundled to CJS, not to test files.
const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Migration", () => {
    it("migrates from v214", async () => {
        await new Promise<void>((resolve) => {
            getContext().init(async () => {
                const dbBytes = readFileSync(join(__dirname, "../test/fixtures/document_v214.db"));
                getSql().rebuildFromBuffer(dbBytes);

                const migration = (await import("./migration.js")).default;
                await migration.migrateIfNecessary();
                expect(getSql().getValue("SELECT count(*) FROM blobs")).toBe(118);
                resolve();
            });
        });
    }, 60_000);

    it("migrates from v214 with all notes protected", async () => {
        // The fixture is document_v214.db with every note (including the hidden subtree) protected:
        // titles and contents encrypted with a known data key. See generate-protected-fixture.mts.
        interface Manifest {
            password: string;
            dataKeyUtf8: string;
            noteCount: number;
            notes: Record<string, { title: string; contentSha256: string; contentLength: number }>;
        }
        const manifest: Manifest = JSON.parse(readFileSync(join(__dirname, "../test/fixtures/document_v214_protected.manifest.json"), "utf-8"));
        const dataKey = encodeUtf8(manifest.dataKeyUtf8);

        await new Promise<void>((resolve, reject) => {
            getContext().init(async () => {
                try {
                    const dbBytes = readFileSync(join(__dirname, "../test/fixtures/document_v214_protected.db"));
                    getSql().rebuildFromBuffer(dbBytes);

                    // Stage 1: the whole boot sequence — migration, becca load, hidden subtree check —
                    // must survive without a protected session, as it does on a real server start.
                    protectedSessionService.resetDataKey();

                    const migration = (await import("./migration.js")).default;
                    await migration.migrateIfNecessary();

                    becca_loader.load();
                    expect(() => hiddenSubtreeService.checkHiddenSubtree()).not.toThrow();

                    // Every original note survived the migration, still protected and with a content
                    // blob. The only permitted exceptions are hidden system notes that the current
                    // version deliberately deletes (enforceDeleted, e.g. _optionsImages) — a user
                    // note must never vanish.
                    const survivingNoteIds: string[] = [];
                    for (const noteId of Object.keys(manifest.notes)) {
                        const note = becca.notes[noteId];
                        if (!note) {
                            expect(noteId.startsWith("_"), `non-hidden note ${noteId} vanished after migration`).toBe(true);
                            expect(getSql().getValue("SELECT isDeleted FROM notes WHERE noteId = ?", [noteId]), `hidden note ${noteId} is gone but not marked deleted`).toBe(1);
                            continue;
                        }
                        expect(note.isProtected, `note ${noteId} lost protection`).toBe(true);
                        expect(note.blobId, `note ${noteId} has no content blob`).toBeTruthy();
                        survivingNoteIds.push(noteId);
                    }

                    // Stage 2: with the session key every title and every content decrypts to the
                    // exact pre-migration plaintext recorded in the manifest.
                    protectedSessionService.setDataKey(dataKey);
                    for (const noteId of survivingNoteIds) {
                        const expected = manifest.notes[noteId];
                        const note = becca.getNoteOrThrow(noteId);

                        const rawTitle = getSql().getValue<string>("SELECT title FROM notes WHERE noteId = ?", [noteId]);
                        expect(dataEncryption.decryptString(dataKey, rawTitle), `title of ${noteId}`).toBe(expected.title);

                        const content = note.getContent();
                        const contentBytes = typeof content === "string" ? encodeUtf8(content) : content;
                        expect(createHash("sha256").update(contentBytes).digest("hex"), `content of ${noteId} (${expected.contentLength} bytes)`)
                            .toBe(expected.contentSha256);
                    }

                    // Stage 3 (#10549): the boot created the built-in templates unprotected. Protect the
                    // whole tree again — as the affected user did — then restart-check without a session.
                    const rootNote = becca.getNoteOrThrow("root");
                    notesService.protectNoteRecursively(rootNote, true, true, new TaskContext("test-protect-all", "protectNotes", { protect: true }));
                    expect(getSql().getValue("SELECT count(*) FROM notes WHERE isProtected = 0 AND isDeleted = 0")).toBe(0);

                    protectedSessionService.resetDataKey();
                    expect(() => hiddenSubtreeService.checkHiddenSubtree()).not.toThrow();

                    resolve();
                } catch (e) {
                    reject(e);
                } finally {
                    protectedSessionService.resetDataKey();
                }
            });
        });
    }, 120_000);
});
