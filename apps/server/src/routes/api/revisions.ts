"use strict";

import beccaService from "../../becca/becca_service.js";
import utils from "../../services/utils.js";
import sql from "../../services/sql.js";
import cls from "../../services/cls.js";
import path from "path";
import becca from "../../becca/becca.js";
import blobService from "../../services/blob.js";
import eraseService from "../../services/erase.js";
import type { Request, Response } from "express";
import type BRevision from "../../becca/entities/brevision.js";
import type BNote from "../../becca/entities/bnote.js";
import type { NotePojo } from "../../becca/becca-interface.js";
import { EditedNotesResponse, RevisionItem, RevisionPojo, RevisionRow } from "@triliumnext/commons";

interface NotePath {
    noteId: string;
    branchId?: string;
    title: string;
    notePath: string[];
    path: string;
}

interface NotePojoWithNotePath extends NotePojo {
    notePath?: string[] | null;
}

function getRevisionBlob(req: Request) {
    const preview = req.query.preview === "true";

    return blobService.getBlobPojo("revisions", req.params.revisionId, { preview });
}

function getRevisions(req: Request) {
    return becca.getRevisionsFromQuery(
        `
        SELECT revisions.*,
                LENGTH(blobs.content) AS contentLength
        FROM revisions
        JOIN blobs ON revisions.blobId = blobs.blobId
        WHERE revisions.noteId = ?
        ORDER BY revisions.utcDateCreated DESC`,
        [req.params.noteId]
    ) satisfies RevisionItem[];
}

function getRevision(req: Request) {
    const revision = becca.getRevisionOrThrow(req.params.revisionId);

    if (revision.type === "file") {
        if (revision.hasStringContent()) {
            revision.content = (revision.getContent() as string).substr(0, 10000);
        }
    } else {
        revision.content = revision.getContent();

        if (revision.content && revision.type === "image") {
            revision.content = revision.content.toString("base64");
        }
    }

    return revision satisfies RevisionPojo;
}

function getRevisionFilename(revision: BRevision) {
    let filename = utils.formatDownloadTitle(revision.title, revision.type, revision.mime);

    if (!revision.dateCreated) {
        throw new Error("Missing creation date for revision.");
    }

    const extension = path.extname(filename);
    const date = revision.dateCreated
        .substr(0, 19)
        .replace(" ", "_")
        .replace(/[^0-9_]/g, "");

    if (extension) {
        filename = `${filename.substr(0, filename.length - extension.length)}-${date}${extension}`;
    } else {
        filename += `-${date}`;
    }

    return filename;
}

function downloadRevision(req: Request, res: Response) {
    const revision = becca.getRevisionOrThrow(req.params.revisionId);

    if (!revision.isContentAvailable()) {
        return res.setHeader("Content-Type", "text/plain").status(401).send("Protected session not available");
    }

    const filename = getRevisionFilename(revision);

    res.setHeader("Content-Disposition", utils.getContentDisposition(filename));
    res.setHeader("Content-Type", revision.mime);

    res.send(revision.getContent());
}

function eraseAllRevisions(req: Request) {
    const revisionIdsToErase = sql.getColumn<string>("SELECT revisionId FROM revisions WHERE noteId = ?", [req.params.noteId]);

    eraseService.eraseRevisions(revisionIdsToErase);
}

function eraseRevision(req: Request) {
    eraseService.eraseRevisions([req.params.revisionId]);
}

function eraseAllExcessRevisions() {
    const allNoteIds = sql.getRows("SELECT noteId FROM notes WHERE SUBSTRING(noteId, 1, 1) != '_'") as { noteId: string }[];
    allNoteIds.forEach((row) => {
        becca.getNote(row.noteId)?.eraseExcessRevisionSnapshots();
    });
}

function restoreRevision(req: Request) {
    const revision = becca.getRevision(req.params.revisionId);

    if (revision) {
        const note = revision.getNote();

        sql.transactional(() => {
            note.saveRevision();

            for (const oldNoteAttachment of note.getAttachments()) {
                oldNoteAttachment.markAsDeleted();
            }

            let revisionContent = revision.getContent();

            for (const revisionAttachment of revision.getAttachments()) {
                const noteAttachment = revisionAttachment.copy();
                noteAttachment.ownerId = note.noteId;
                noteAttachment.setContent(revisionAttachment.getContent(), { forceSave: true });

                // content is rewritten to point to the restored revision attachments
                if (typeof revisionContent === "string") {
                    revisionContent = revisionContent.replaceAll(`attachments/${revisionAttachment.attachmentId}`, `attachments/${noteAttachment.attachmentId}`);
                }
            }

            note.title = revision.title;
            note.mime = revision.mime;
            note.type = revision.type;
            note.setContent(revisionContent, { forceSave: true });
        });
    }
}

function getEditedNotesOnDate(req: Request) {
    const noteIds = sql.getColumn<string>(/*sql*/`\
        SELECT notes.*
        FROM notes
        WHERE noteId IN (
                SELECT noteId FROM notes
                WHERE
                    (notes.dateCreated LIKE :date OR notes.dateModified LIKE :date)
                    AND (notes.noteId NOT LIKE  '\\_%' ESCAPE '\\')
            UNION ALL
                SELECT noteId FROM revisions
                WHERE revisions.dateCreated LIKE :date
        )
        ORDER BY isDeleted
        LIMIT 50`,
        { date: `${req.params.date}%` }
    );

    let notes = becca.getNotes(noteIds, true);

    // Narrow down the results if a note is hoisted, similar to "Jump to note".
    const hoistedNoteId = cls.getHoistedNoteId();
    if (hoistedNoteId !== "root") {
        notes = notes.filter((note) => note.hasAncestor(hoistedNoteId));
    }

    return notes.map((note) => {
        const notePath = getNotePathData(note);

        const notePojo: NotePojoWithNotePath = note.getPojo();
        notePojo.notePath = notePath ? notePath.notePath : null;

        return notePojo;
    }) satisfies EditedNotesResponse;
}

function getNotePathData(note: BNote): NotePath | undefined {
    const retPath = note.getBestNotePath();

    if (retPath) {
        const noteTitle = beccaService.getNoteTitleForPath(retPath);

        let branchId;

        if (note.isRoot()) {
            branchId = "none_root";
        } else {
            const parentNote = note.parents[0];
            branchId = becca.getBranchFromChildAndParent(note.noteId, parentNote.noteId)?.branchId;
        }

        return {
            noteId: note.noteId,
            branchId: branchId,
            title: noteTitle,
            notePath: retPath,
            path: retPath.join("/")
        };
    }
}

export default {
    getRevisionBlob,
    getRevisions,
    getRevision,
    downloadRevision,
    getEditedNotesOnDate,
    eraseAllRevisions,
    eraseAllExcessRevisions,
    eraseRevision,
    restoreRevision
};
