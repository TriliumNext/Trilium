import {
    type DraftFragment,
    EditedNotesResponse,
    EraseExcessRevisionsOptions,
    EraseExcessRevisionsResponse,
    isNoteType,
    RevisionItem,
    RevisionPojo,
    type SaveDraftRequest,
    type SaveDraftResponse,
    type SavedAttachmentRow
} from "@triliumnext/commons";
import { t } from "i18next";

import type { Request, Response } from "../../http_interface";

import becca from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import {
    remapAttachmentReferences, toAttachmentReferenceLinks
} from "../../becca/entities/bnote.js";
import type BRevision from "../../becca/entities/brevision.js";
import { ValidationError } from "../../errors.js";
import blobService from "../../services/blob.js";
import { replaceBlockRangeOnBase } from "../../services/block_ranges.js";
import eraseService from "../../services/erase.js";
import { saveLinks } from "../../services/notes.js";
import { NotePojo } from "../../becca/becca-interface.js";
import becca_service from "../../becca/becca_service.js";
import * as cls from "../../services/context.js";
import { getSql } from "../../services/sql/index.js";
import * as binary_utils from "../../services/utils/binary.js";
import { formatDownloadTitle, getContentDisposition } from "../../services/utils/index.js";
import { extname } from "../../services/utils/path.js";

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

function getRevisionBlob(req: Request<{ revisionId: string }>) {
    const preview = req.query.preview === "true";

    return blobService.getBlobPojo("revisions", req.params.revisionId, { preview });
}

function getRevisions(req: Request<{ noteId: string }>) {
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

function getRevision(req: Request<{ revisionId: string }>) {
    const revision = becca.getRevisionOrThrow(req.params.revisionId);

    if (revision.type === "file") {
        if (revision.hasStringContent()) {
            revision.content = (revision.getContent() as string).substr(0, 10000);
        }
    } else {
        revision.content = revision.getContent();

        // SVG is text-based and is rendered client-side from a UTF-8 (URL-encoded) data URI, so it is
        // returned as-is. Other (binary) image formats are base64-encoded for transport in the JSON response.
        if (revision.content && revision.type === "image" && revision.mime !== "image/svg+xml") {
            revision.content = binary_utils.encodeBase64(revision.content);
        }
    }

    return revision satisfies RevisionPojo;
}

function getRevisionFilename(revision: BRevision) {
    let filename = formatDownloadTitle(revision.title, revision.type, revision.mime);

    if (!revision.dateCreated) {
        throw new Error("Missing creation date for revision.");
    }

    const extension = extname(filename);
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

function downloadRevision(req: Request<{ revisionId: string }>, res: Response) {
    const revision = becca.getRevisionOrThrow(req.params.revisionId);

    if (!revision.isContentAvailable()) {
        return res.setHeader("Content-Type", "text/plain").status(401).send("Protected session not available");
    }

    const filename = getRevisionFilename(revision);

    res.setHeader("Content-Disposition", getContentDisposition(filename));
    res.setHeader("Content-Type", revision.mime);

    res.send(revision.getContent());
}

function eraseAllRevisions(req: Request<{ noteId: string }>) {
    const revisionIdsToErase = getSql().getColumn<string>("SELECT revisionId FROM revisions WHERE noteId = ?", [req.params.noteId]);

    eraseService.eraseRevisions(revisionIdsToErase);
}

function eraseRevision(req: Request<{ revisionId: string }>) {
    eraseService.eraseRevisions([req.params.revisionId]);
}

function updateRevisionDescription(req: Request<{ revisionId: string }>) {
    const revision = becca.getRevisionOrThrow(req.params.revisionId);
    const { description } = req.body;

    if (typeof description !== "string") {
        return [400, "Description must be a string."];
    }

    revision.description = description;
    revision.save();
}

function eraseAllExcessRevisions(req: Request) {
    const options = parseEraseExcessRevisionsOptions(req.body);

    if (typeof options === "string") {
        return [ 400, options ];
    }

    const allNoteIds = getSql().getRows("SELECT noteId FROM notes WHERE SUBSTRING(noteId, 1, 1) != '_'") as { noteId: string }[];
    let erasedCount = 0;

    for (const row of allNoteIds) {
        erasedCount += becca.getNote(row.noteId)?.eraseExcessRevisionSnapshots(options) ?? 0;
    }

    if (erasedCount > 0) {
        // Dropping the snapshots leaves their content behind, held by nothing. Purged here rather
        // than in the entity method, which also runs after every saved revision — a blob scan per
        // note save would be far too expensive for what it collects.
        eraseService.eraseUnusedBlobs();
    }

    return { erasedCount } satisfies EraseExcessRevisionsResponse;
}

/**
 * Reads the operation's options off the request body, or returns the message to answer 400 with.
 * Both are optional and an empty body is the configured behaviour, so only values that were sent
 * are checked — a wrong one must fail loudly rather than quietly erase by some other rule.
 */
function parseEraseExcessRevisionsOptions(body: unknown): EraseExcessRevisionsOptions | string {
    const { snapshotsToKeep, keepNamedSnapshots } = (body ?? {}) as EraseExcessRevisionsOptions;

    if (snapshotsToKeep !== undefined && (!Number.isInteger(snapshotsToKeep) || Number(snapshotsToKeep) < -1)) {
        return "snapshotsToKeep must be an integer of -1 (keep every snapshot) or above.";
    }

    if (keepNamedSnapshots !== undefined && typeof keepNamedSnapshots !== "boolean") {
        return "keepNamedSnapshots must be a boolean.";
    }

    return { snapshotsToKeep, keepNamedSnapshots };
}

function restoreRevision(req: Request<{ revisionId: string }>) {
    const revision = becca.getRevision(req.params.revisionId);
    if (!revision) {
        return;
    }
    if (revision.source === "fragment") {
        throw new ValidationError(`Revision '${revision.revisionId}' holds some blocks of its `
            + "note and cannot be restored.");
    }

    const note = revision.getNote();

    getSql().transactional(() => {
        note.saveRevision({ source: "restore" });

        for (const oldNoteAttachment of note.getAttachments()) {
            oldNoteAttachment.markAsDeleted();
        }

        const attachmentIds = new Map<string, string>();
        for (const revisionAttachment of revision.getAttachments()) {
            const noteAttachment = revisionAttachment.copy();
            noteAttachment.ownerId = note.noteId;
            noteAttachment.setContent(revisionAttachment.getContent(), { forceSave: true });
            // Both are saved, so both have an ID.
            attachmentIds.set(
                revisionAttachment.attachmentId as string, noteAttachment.attachmentId as string
            );
        }

        note.title = revision.title;
        note.mime = revision.mime;
        note.type = revision.type;

        let content = revision.getContent();
        if (typeof content === "string") {
            if (revision.type === "text") {
                content = toAttachmentReferenceLinks(content, note.noteId, attachmentIds);
            }
            content = remapAttachmentReferences(content, attachmentIds);
        }
        // The links and relations follow the restored content, as after a save.
        const linked = saveLinks(note, content);
        note.setContent(linked.content, {
            forceSave: true, forceFrontendReload: linked.forceFrontendReload
        });
    });
}

/**
 * Keeps the changes that an editor could not save as a revision of the note, in the format that
 * they were written in. A repeated request with the same `revisionId` makes one revision.
 */
function saveDraftRevision(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);
    const draft = parseDraftRequest(req.body);
    if (!note.isContentAvailable()) {
        throw new ValidationError(`Note '${note.noteId}' has no content available.`);
    }

    const { revisionId } = draft;
    const existing = becca.getRevision(revisionId);
    if (existing) {
        if (existing.noteId !== note.noteId) {
            throw new ValidationError(`Revision '${revisionId}' belongs to another note.`);
        }
        return {
            revisionId, isKept: true, isFragment: existing.source === "fragment"
        } satisfies SaveDraftResponse;
    }
    if (!note.isVersioned()) {
        return { revisionId, isKept: false, isFragment: false } satisfies SaveDraftResponse;
    }

    const { content, isFragment } = getDraftContent(draft);
    note.saveRevision({
        revisionId,
        source: isFragment ? "fragment" : "draft",
        description: isFragment
            ? t("revisions.fragment_description")
            : t("revisions.draft_description"),
        draft: { content, type: draft.type, mime: draft.mime, attachments: draft.attachments }
    });

    // `saveRevision()` erases the snapshots beyond the limit of the note at once.
    return {
        revisionId, isKept: !!becca.getRevision(revisionId), isFragment
    } satisfies SaveDraftResponse;
}

/**
 * The content of the revision of `draft`. The edited blocks of an excerpt go into the note that
 * they were read from, as a whole-note draft holds the note that its editor read. Without that
 * note, or where it does not hold the blocks as they were read, they are the whole revision.
 */
function getDraftContent(draft: ParsedDraft) {
    if (!draft.fragment) {
        return { content: draft.content, isFragment: false };
    }

    const { content: fragment, block, base } = draft.fragment;
    const replacement = base
        ? replaceBlockRangeOnBase(base.note, block, fragment, base.hash)
        : null;
    return replacement?.status === "replaced"
        ? { content: replacement.content, isFragment: false }
        : { content: fragment, isFragment: true };
}

/** A draft that {@link parseDraftRequest} accepts: one with either its content or its fragment. */
type ParsedDraft = SaveDraftRequest & (
    { content: string; fragment?: undefined } | { content?: undefined; fragment: DraftFragment }
);

function parseDraftRequest(body: unknown): ParsedDraft {
    const draft = (body ?? {}) as Partial<SaveDraftRequest>;
    const { revisionId, type, mime, content, fragment } = draft;
    const hasContent = typeof content === "string";
    const hasFragment = typeof fragment?.content === "string" && typeof fragment.block === "string"
        && (fragment.base === undefined || (typeof fragment.base?.note === "string"
            && typeof fragment.base.hash === "string"));
    if (typeof revisionId !== "string" || !REVISION_ID.test(revisionId)
        || typeof type !== "string" || !isNoteType(type) || typeof mime !== "string"
        || hasContent === hasFragment) {
        throw new ValidationError("Expected a 'revisionId', a 'type', a 'mime', "
            + "and either the 'content' or the 'fragment' of a draft.");
    }
    if (draft.attachments !== undefined && !isAttachmentRowList(draft.attachments)) {
        throw new ValidationError("Expected 'attachments' to be a list of attachments.");
    }
    return draft as ParsedDraft;
}

/** The ID of a revision that a client draws, of the characters of the IDs of entities. */
const REVISION_ID = /^[a-zA-Z0-9_]{1,32}$/;

function isAttachmentRowList(rows: unknown): rows is SavedAttachmentRow[] {
    return Array.isArray(rows) && rows.every((row: Partial<SavedAttachmentRow> | null) =>
        typeof row?.title === "string" && typeof row.role === "string"
        && typeof row.mime === "string" && typeof row.content === "string");
}

function getEditedNotesOnDate(req: Request) {
    const noteIds = getSql().getColumn<string>(/*sql*/`\
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
        const noteTitle = becca_service.getNoteTitleForPath(retPath);

        let branchId;

        if (note.isRoot()) {
            branchId = "none_root";
        } else {
            const parentNote = note.parents[0];
            branchId = becca.getBranchFromChildAndParent(note.noteId, parentNote.noteId)?.branchId;
        }

        return {
            noteId: note.noteId,
            branchId,
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
    restoreRevision,
    saveDraftRevision,
    updateRevisionDescription
};
