import becca from "../becca/becca.js";
import sql from "../services/sql.js";
import eu from "./etapi_utils.js";
import mappers from "./mappers.js";
import noteService from "../services/notes.js";
import TaskContext from "../services/task_context.js";
import protectedSessionService from "../services/protected_session.js";
import utils from "../services/utils.js";
import type { Router } from "express";
import type { NoteRow, RecentChangeRow } from "@triliumnext/commons";

function register(router: Router) {
    // GET /etapi/notes/history - must be registered before /etapi/notes/:noteId routes
    eu.route(router, "get", "/etapi/notes/history", (req, res, next) => {
        const ancestorNoteId = (req.query.ancestorNoteId as string) || "root";

        let recentChanges: RecentChangeRow[];

        if (ancestorNoteId === "root") {
            // Optimized path: no ancestor filtering needed, fetch directly from DB
            recentChanges = sql.getRows<RecentChangeRow>(`
                SELECT
                    notes.noteId,
                    notes.isDeleted AS current_isDeleted,
                    notes.deleteId AS current_deleteId,
                    notes.title AS current_title,
                    notes.isProtected AS current_isProtected,
                    revisions.title,
                    revisions.utcDateCreated AS utcDate,
                    revisions.dateCreated AS date
                FROM revisions
                JOIN notes USING(noteId)
                UNION ALL
                SELECT
                    notes.noteId,
                    notes.isDeleted AS current_isDeleted,
                    notes.deleteId AS current_deleteId,
                    notes.title AS current_title,
                    notes.isProtected AS current_isProtected,
                    notes.title,
                    notes.utcDateCreated AS utcDate,
                    notes.dateCreated AS date
                FROM notes
                UNION ALL
                SELECT
                    notes.noteId,
                    notes.isDeleted AS current_isDeleted,
                    notes.deleteId AS current_deleteId,
                    notes.title AS current_title,
                    notes.isProtected AS current_isProtected,
                    notes.title,
                    notes.utcDateModified AS utcDate,
                    notes.dateModified AS date
                FROM notes
                WHERE notes.isDeleted = 1
                ORDER BY utcDate DESC
                LIMIT 500`);
        } else {
            // Use recursive CTE to find all descendants, then filter at DB level
            // This pushes filtering to the database for much better performance
            recentChanges = sql.getRows<RecentChangeRow>(`
                WITH RECURSIVE descendants(noteId) AS (
                    SELECT ?
                    UNION
                    SELECT branches.noteId
                    FROM branches
                    JOIN descendants ON branches.parentNoteId = descendants.noteId
                )
                SELECT
                    notes.noteId,
                    notes.isDeleted AS current_isDeleted,
                    notes.deleteId AS current_deleteId,
                    notes.title AS current_title,
                    notes.isProtected AS current_isProtected,
                    revisions.title,
                    revisions.utcDateCreated AS utcDate,
                    revisions.dateCreated AS date
                FROM revisions
                JOIN notes USING(noteId)
                WHERE notes.noteId IN (SELECT noteId FROM descendants)
                UNION ALL
                SELECT
                    notes.noteId,
                    notes.isDeleted AS current_isDeleted,
                    notes.deleteId AS current_deleteId,
                    notes.title AS current_title,
                    notes.isProtected AS current_isProtected,
                    notes.title,
                    notes.utcDateCreated AS utcDate,
                    notes.dateCreated AS date
                FROM notes
                WHERE notes.noteId IN (SELECT noteId FROM descendants)
                UNION ALL
                SELECT
                    notes.noteId,
                    notes.isDeleted AS current_isDeleted,
                    notes.deleteId AS current_deleteId,
                    notes.title AS current_title,
                    notes.isProtected AS current_isProtected,
                    notes.title,
                    notes.utcDateModified AS utcDate,
                    notes.dateModified AS date
                FROM notes
                WHERE notes.isDeleted = 1 AND notes.noteId IN (SELECT noteId FROM descendants)
                ORDER BY utcDate DESC
                LIMIT 500`, [ancestorNoteId]);
        }

        for (const change of recentChanges) {
            if (change.current_isProtected) {
                if (protectedSessionService.isProtectedSessionAvailable()) {
                    change.title = protectedSessionService.decryptString(change.title) || "[protected]";
                    change.current_title = protectedSessionService.decryptString(change.current_title) || "[protected]";
                } else {
                    change.title = change.current_title = "[protected]";
                }
            }

            if (change.current_isDeleted) {
                const deleteId = change.current_deleteId;

                const undeletedParentBranchIds = noteService.getUndeletedParentBranchIds(change.noteId, deleteId);

                // note (and the subtree) can be undeleted if there's at least one undeleted parent (whose branch would be undeleted by this op)
                change.canBeUndeleted = undeletedParentBranchIds.length > 0;
            }
        }

        res.json(recentChanges);
    });

    // GET /etapi/notes/:noteId/revisions - List all revisions for a note
    eu.route(router, "get", "/etapi/notes/:noteId/revisions", (req, res, next) => {
        const note = eu.getAndCheckNote(req.params.noteId);

        const revisions = becca.getRevisionsFromQuery(
            `SELECT revisions.*, LENGTH(blobs.content) AS contentLength
             FROM revisions
             JOIN blobs USING (blobId)
             WHERE noteId = ?
             ORDER BY utcDateCreated DESC`,
            [note.noteId]
        );

        res.json(revisions.map((revision) => mappers.mapRevisionToPojo(revision)));
    });

    // POST /etapi/notes/:noteId/undelete - Restore a deleted note
    eu.route(router, "post", "/etapi/notes/:noteId/undelete", (req, res, next) => {
        const { noteId } = req.params;

        const noteRow = sql.getRow<NoteRow | null>("SELECT * FROM notes WHERE noteId = ?", [noteId]);

        if (!noteRow) {
            throw new eu.EtapiError(404, "NOTE_NOT_FOUND", `Note '${noteId}' not found.`);
        }

        if (!noteRow.isDeleted || !noteRow.deleteId) {
            throw new eu.EtapiError(400, "NOTE_NOT_DELETED", `Note '${noteId}' is not deleted.`);
        }

        const undeletedParentBranchIds = noteService.getUndeletedParentBranchIds(noteId, noteRow.deleteId);

        if (undeletedParentBranchIds.length === 0) {
            throw new eu.EtapiError(400, "CANNOT_UNDELETE", `Cannot undelete note '${noteId}' - no undeleted parent found.`);
        }

        const taskContext = new TaskContext("no-progress-reporting", "undeleteNotes", null);
        noteService.undeleteNote(noteId, taskContext);

        res.json({ success: true });
    });

    // GET /etapi/revisions/:revisionId - Get revision metadata
    eu.route(router, "get", "/etapi/revisions/:revisionId", (req, res, next) => {
        const revision = eu.getAndCheckRevision(req.params.revisionId);

        if (revision.isProtected) {
            throw new eu.EtapiError(400, "REVISION_IS_PROTECTED", `Revision '${req.params.revisionId}' is protected and cannot be read through ETAPI.`);
        }

        res.json(mappers.mapRevisionToPojo(revision));
    });

    // GET /etapi/revisions/:revisionId/content - Get revision content
    eu.route(router, "get", "/etapi/revisions/:revisionId/content", (req, res, next) => {
        const revision = eu.getAndCheckRevision(req.params.revisionId);

        if (revision.isProtected) {
            throw new eu.EtapiError(400, "REVISION_IS_PROTECTED", `Revision '${req.params.revisionId}' is protected and content cannot be read through ETAPI.`);
        }

        const filename = utils.formatDownloadTitle(revision.title, revision.type, revision.mime);

        res.setHeader("Content-Disposition", utils.getContentDisposition(filename));
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Content-Type", revision.mime);

        res.send(revision.getContent());
    });
}

export default {
    register
};
