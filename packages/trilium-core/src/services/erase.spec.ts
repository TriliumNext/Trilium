import { describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import { getContext } from "./context.js";
import eraseService from "./erase.js";
import noteService from "./notes.js";
import optionService from "./options.js";
import { getSql } from "./sql/index.js";
import { dbReady } from "./sql_init.js";

let counter = 0;

/**
 * Creates a fresh text note under the given parent in the real in-memory DB.
 * Each call uses a unique title since the same fixture DB is shared between
 * the `it()`s in this file.
 */
function createNote(content = "<p>hello</p>"): BNote {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId: "root",
            title: `erase-spec-${counter}`,
            content,
            type: "text"
        })
    ).note;
}

function rowCount(table: string, idColumn: string, id: string): number {
    return getSql().getValue<number>(`SELECT COUNT(1) FROM ${table} WHERE ${idColumn} = ?`, [id]);
}

function entityChangeFor(entityName: string, entityId: string) {
    return getSql().getRowOrNull<{ isErased: number }>(
        "SELECT isErased FROM entity_changes WHERE entityName = ? AND entityId = ?",
        [entityName, entityId]
    );
}

describe("erase service (real DB)", () => {
    describe("eraseNotesWithDeleteIds", () => {
        it("erases a soft-deleted note plus its dependent branch and attribute, marking entity_changes as erased", () => {
            const note = createNote();
            const noteId = note.noteId;
            const branch = note.getParentBranches()[0];
            const branchId = branch.branchId!;
            const attribute = getContext().init(() => note.addLabel("eraseMe", "v"));
            const attributeId = attribute.attributeId;

            const deleteId = `del-${counter}`;
            getContext().init(() => {
                attribute.markAsDeleted(deleteId);
                branch.markAsDeleted(deleteId);
                note.markAsDeleted(deleteId);
            });

            // Sanity: rows still physically present after a soft delete.
            expect(rowCount("notes", "noteId", noteId)).toBe(1);

            getContext().init(() => eraseService.eraseNotesWithDeleteIds([ deleteId ]));

            // The physical rows are gone.
            expect(rowCount("notes", "noteId", noteId)).toBe(0);
            expect(rowCount("branches", "branchId", branchId)).toBe(0);
            expect(rowCount("attributes", "attributeId", attributeId)).toBe(0);

            // The entity_changes records survive but are flagged as erased so the
            // erasure propagates to sync peers.
            expect(entityChangeFor("notes", noteId)?.isErased).toBe(1);
            expect(entityChangeFor("branches", branchId)?.isErased).toBe(1);
            expect(entityChangeFor("attributes", attributeId)?.isErased).toBe(1);
        });

        it("erases a soft-deleted attachment carrying a matching deleteId", () => {
            const note = createNote();
            const attachment = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "att", content: "data" })
            );
            const attachmentId = attachment.attachmentId;

            const deleteId = `del-att-${counter}`;
            getContext().init(() => attachment.markAsDeleted(deleteId));

            expect(rowCount("attachments", "attachmentId", attachmentId)).toBe(1);

            getContext().init(() => eraseService.eraseNotesWithDeleteIds([ deleteId ]));

            expect(rowCount("attachments", "attachmentId", attachmentId)).toBe(0);
            expect(entityChangeFor("attachments", attachmentId)?.isErased).toBe(1);
        });

        it("does nothing for a deleteId that matches no soft-deleted entities", () => {
            const note = createNote();
            const noteId = note.noteId;

            getContext().init(() =>
                eraseService.eraseNotesWithDeleteIds([ "nonexistent-delete-id" ])
            );

            // The live note is untouched.
            expect(rowCount("notes", "noteId", noteId)).toBe(1);
        });

        it("erases every deletion of a batch, and does nothing for an empty batch", () => {
            const first = createNote();
            const second = createNote();
            const firstDeleteId = `del-batch-a-${counter}`;
            const secondDeleteId = `del-batch-b-${counter}`;

            getContext().init(() => {
                first.markAsDeleted(firstDeleteId);
                second.markAsDeleted(secondDeleteId);
            });

            getContext().init(() => eraseService.eraseNotesWithDeleteIds([]));
            expect(rowCount("notes", "noteId", first.noteId)).toBe(1);

            getContext().init(() =>
                eraseService.eraseNotesWithDeleteIds([ firstDeleteId, secondDeleteId ])
            );

            expect(rowCount("notes", "noteId", first.noteId)).toBe(0);
            expect(rowCount("notes", "noteId", second.noteId)).toBe(0);
            expect(entityChangeFor("notes", first.noteId)?.isErased).toBe(1);
            expect(entityChangeFor("notes", second.noteId)?.isErased).toBe(1);
        });
    });

    describe("eraseDeletedNotesNow", () => {
        it("erases entities deleted in the past (cutoff 0 seconds)", () => {
            const note = createNote();
            const noteId = note.noteId;
            const branchId = note.getParentBranches()[0].branchId!;

            // deleteNote soft-deletes the note, its branch and attributes.
            getContext().init(() => note.deleteNote());

            expect(rowCount("notes", "noteId", noteId)).toBe(1);

            getContext().init(() => eraseService.eraseDeletedNotesNow());

            expect(rowCount("notes", "noteId", noteId)).toBe(0);
            expect(rowCount("branches", "branchId", branchId)).toBe(0);
            expect(entityChangeFor("notes", noteId)?.isErased).toBe(1);
        });

        it("leaves a live (non-deleted) note alone", () => {
            const note = createNote();
            const noteId = note.noteId;

            getContext().init(() => eraseService.eraseDeletedNotesNow());

            expect(rowCount("notes", "noteId", noteId)).toBe(1);
        });
    });

    describe("eraseUnusedBlobs", () => {
        it("purges a blob that is no longer referenced and deletes its entity_changes row entirely", () => {
            // Insert an orphan blob with a matching entity_changes record. It is
            // referenced by nothing, so it qualifies as unused.
            const blobId = `orphanBlob-${++counter}`;
            getContext().init(() => {
                getSql().execute(
                    "INSERT INTO blobs (blobId, content, dateModified, utcDateModified) VALUES (?, ?, ?, ?)",
                    [blobId, "junk", "2020-01-01 00:00:00.000+0000", "2020-01-01 00:00:00.000Z"]
                );
                getSql().execute(
                    `INSERT INTO entity_changes
                        (entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
                        VALUES ('blobs', ?, 'h', 0, 'c', 'comp', 'inst', 1, '2020-01-01 00:00:00.000Z')`,
                    [blobId]
                );
            });

            getContext().init(() => eraseService.eraseUnusedBlobs());

            // Blobs are purged completely rather than marked erased.
            expect(rowCount("blobs", "blobId", blobId)).toBe(0);
            expect(entityChangeFor("blobs", blobId)).toBeNull();
        });

        it("keeps a blob that is still referenced by a live note", () => {
            const note = createNote("<p>referenced content</p>");
            const blobId = getSql().getValue<string>("SELECT blobId FROM notes WHERE noteId = ?", [
                note.noteId
            ]);
            expect(blobId).toBeTruthy();

            getContext().init(() => eraseService.eraseUnusedBlobs());

            expect(rowCount("blobs", "blobId", blobId)).toBe(1);
        });
    });

    describe("eraseUnusedAttachmentsNow", () => {
        it("erases an attachment scheduled for erasure in the past", () => {
            const note = createNote();
            const attachment = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "sched", content: "x" })
            );
            const attachmentId = attachment.attachmentId;

            // Mark the attachment as scheduled for erasure well in the past so it
            // falls before the now-based cutoff.
            getContext().init(() =>
                getSql().execute(
                    "UPDATE attachments SET utcDateScheduledForErasureSince = ? WHERE attachmentId = ?",
                    ["2000-01-01 00:00:00.000Z", attachmentId]
                )
            );

            getContext().init(() => eraseService.eraseUnusedAttachmentsNow());

            expect(rowCount("attachments", "attachmentId", attachmentId)).toBe(0);
            expect(entityChangeFor("attachments", attachmentId)?.isErased).toBe(1);
        });

        it("purges the content the erased attachment held, rather than leaving it for later", () => {
            const note = createNote();
            const content = `erase-spec-orphan-${Math.random()}`;
            const attachment = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "orphan", content })
            );
            const blobId = attachment.blobId ?? "";
            expect(rowCount("blobs", "blobId", blobId)).toBe(1);

            getContext().init(() =>
                getSql().execute(
                    "UPDATE attachments SET utcDateScheduledForErasureSince = ? WHERE attachmentId = ?",
                    ["2000-01-01 00:00:00.000Z", attachment.attachmentId]
                )
            );

            getContext().init(() => eraseService.eraseUnusedAttachmentsNow());

            // Dropping the row alone would leave this held by nothing and still on disk until some
            // later sweep happened to collect it.
            expect(rowCount("blobs", "blobId", blobId)).toBe(0);
        });

        it("does not erase an attachment that is not scheduled for erasure", () => {
            const note = createNote();
            const attachment = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "keep", content: "x" })
            );
            const attachmentId = attachment.attachmentId;

            getContext().init(() => eraseService.eraseUnusedAttachmentsNow());

            expect(rowCount("attachments", "attachmentId", attachmentId)).toBe(1);
        });
    });

    describe("empty-input no-ops", () => {
        it("eraseAttachments and eraseRevisions are no-ops for an empty id list", () => {
            const note = createNote();
            const noteId = note.noteId;

            getContext().init(() => {
                eraseService.eraseAttachments([]);
                eraseService.eraseRevisions([]);
            });

            // Nothing was touched; the note (and everything else) is intact.
            expect(becca.notes[noteId]).toBeDefined();
            expect(rowCount("notes", "noteId", noteId)).toBe(1);
        });
    });

    describe("startScheduledCleanup", () => {
        // Kept last in the file: it erases everything already soft-deleted in the shared
        // fixture DB, which would otherwise pull the ground out from under the tests above.
        it("erases due notes and scheduled attachments once the periodic timers fire", async () => {
            const note = createNote();
            const noteId = note.noteId;
            getContext().init(() => note.deleteNote());

            const attachmentOwner = createNote();
            const attachment = getContext().init(() =>
                attachmentOwner.saveAttachment({ role: "file", mime: "text/plain", title: "cron", content: "x" })
            );
            getContext().init(() =>
                getSql().execute(
                    "UPDATE attachments SET utcDateScheduledForErasureSince = ? WHERE attachmentId = ?",
                    ["2000-01-01 00:00:00.000Z", attachment.attachmentId]
                )
            );

            const previousEraseAfter = optionService.getOption("eraseEntitiesAfterTimeInSeconds");
            getContext().init(() => optionService.setOption("eraseEntitiesAfterTimeInSeconds", "0"));
            vi.useFakeTimers();

            try {
                eraseService.startScheduledCleanup();
                // The timers are only registered once the DB is ready.
                await dbReady;
                // Long enough for both kickoff timeouts (5/6 min) and the first tick of the
                // 4-hour note interval and the 1-hour attachment interval.
                await vi.advanceTimersByTimeAsync(4 * 3600 * 1000);

                expect(rowCount("notes", "noteId", noteId)).toBe(0);
                expect(rowCount("attachments", "attachmentId", attachment.attachmentId)).toBe(0);
            } finally {
                // Dropping the fake clock also discards the intervals, so nothing keeps running.
                vi.useRealTimers();
                getContext().init(() =>
                    optionService.setOption("eraseEntitiesAfterTimeInSeconds", previousEraseAfter)
                );
            }
        });
    });
});
