import type { Request } from "../../http_interface";

import becca from "../../becca/becca.js";
import { findReferenceTargets } from "../../services/references/index.js";
import { readCachedToc, saveClientToc } from "../../services/toc/index.js";
import { answerConflict } from "../helpers.js";

/** The ToC cache of a note as it is, without building it. */
function getNoteToc(req: Request<{ noteId: string }>) {
    return readCachedToc({ kind: "note", noteId: req.params.noteId });
}

/** Saves the table of contents that the viewer of a note read. */
function saveNoteToc(req: Request<{ noteId: string }>) {
    const ref = { kind: "note", noteId: req.params.noteId } as const;
    return answerConflict(() => saveClientToc(ref, req.body));
}

/** The ToC cache of an attachment as it is, without building it. */
function getAttachmentToc(req: Request<{ attachmentId: string }>) {
    return readCachedToc({ kind: "attachment", attachmentId: req.params.attachmentId });
}

/** Saves the table of contents that the viewer of an attachment read. */
function saveAttachmentToc(req: Request<{ attachmentId: string }>) {
    const ref = { kind: "attachment", attachmentId: req.params.attachmentId } as const;
    return answerConflict(() => saveClientToc(ref, req.body));
}

/** The places inside an attachment that a link can point at, such as the headings of a PDF. */
async function getAttachmentReferences(req: Request<{ attachmentId: string }>) {
    const attachment = becca.getAttachmentOrThrow(req.params.attachmentId);
    return await findReferenceTargets(attachment);
}

export default {
    getNoteToc,
    saveNoteToc,
    getAttachmentToc,
    saveAttachmentToc,
    getAttachmentReferences
};
