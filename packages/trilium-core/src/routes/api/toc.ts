import type { Request } from "../../http_interface";

import becca from "../../becca/becca.js";
import { findReferenceTargets } from "../../services/references/index.js";
import {
    buildToc, readCachedToc, saveClientToc, type TocDocumentRef
} from "../../services/toc/index.js";
import { answerConflict, answerUnavailable } from "../helpers.js";

/** The ToC cache of a note as it is, without building it. */
function getNoteToc(req: Request<{ noteId: string }>) {
    return answerUnavailable(() => readCachedToc(toNoteRef(req)));
}

/** Builds the ToC cache of a note, unless only its viewer can read it. */
function buildNoteToc(req: Request<{ noteId: string }>) {
    return answerUnavailable(() => buildToc(toNoteRef(req)));
}

/** Saves the table of contents that the viewer of a note read. */
function saveNoteToc(req: Request<{ noteId: string }>) {
    return answerConflict(() => saveClientToc(toNoteRef(req), req.body));
}

/** The ToC cache of an attachment as it is, without building it. */
function getAttachmentToc(req: Request<{ attachmentId: string }>) {
    return answerUnavailable(() => readCachedToc(toAttachmentRef(req)));
}

/** Builds the ToC cache of an attachment, unless only its viewer can read it. */
function buildAttachmentToc(req: Request<{ attachmentId: string }>) {
    return answerUnavailable(() => buildToc(toAttachmentRef(req)));
}

/** Saves the table of contents that the viewer of an attachment read. */
function saveAttachmentToc(req: Request<{ attachmentId: string }>) {
    return answerConflict(() => saveClientToc(toAttachmentRef(req), req.body));
}

/** The places inside an attachment that a link can point at, such as the headings of a PDF. */
async function getAttachmentReferences(req: Request<{ attachmentId: string }>) {
    const attachment = becca.getAttachmentOrThrow(req.params.attachmentId);
    return await findReferenceTargets(attachment);
}

function toNoteRef(req: Request<{ noteId: string }>): TocDocumentRef {
    return { kind: "note", noteId: req.params.noteId };
}

function toAttachmentRef(req: Request<{ attachmentId: string }>): TocDocumentRef {
    return { kind: "attachment", attachmentId: req.params.attachmentId };
}

export default {
    getNoteToc,
    buildNoteToc,
    saveNoteToc,
    getAttachmentToc,
    buildAttachmentToc,
    saveAttachmentToc,
    getAttachmentReferences
};
