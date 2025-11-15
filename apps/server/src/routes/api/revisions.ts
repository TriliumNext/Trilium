"use strict";

import utils from "../../services/utils.js";
import sql from "../../services/sql.js";
import path from "path";
import becca from "../../becca/becca.js";
import blobService from "../../services/blob.js";
import eraseService from "../../services/erase.js";
import type { Request, Response } from "express";
import type BRevision from "../../becca/entities/brevision.js";
import { RevisionItem, RevisionPojo } from "@triliumnext/commons";

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

export default {
    getRevisionBlob,
    getRevisions,
    getRevision,
    downloadRevision,
    eraseAllRevisions,
    eraseAllExcessRevisions,
    eraseRevision,
    restoreRevision
};
