import {
    type AttributeRow, type BlocksConflictResponse, type CreateChildrenResponse,
    type CreateReferenceRequest, type CreateReferenceResponse, type DeleteNotesPreview, isNoteType,
    type MetadataResponse, type NoteBlocksResponse, type NoteSaveBase, REFERENCE_KINDS,
    type ReferenceKind, type SaveConflictResponse, type SavedAttachmentBase,
    type SaveNoteBlocksRequest, type SaveNoteBlocksResponse, type SaveNoteDataRequest,
    type SaveNoteDataResponse
} from "@triliumnext/commons";
import { t } from "i18next";

import type { Request } from "../../http_interface";

import blobService from "../../services/blob";
import {
    getBlockRangeContent, replaceBlockRangeContent, replaceBlockRangeOnBase
} from "../../services/block_ranges";
import eraseService from "../../services/erase.js";
import { DetailedConflictError, NotFoundError, ValidationError } from "../../errors.js";
import { answerConflict } from "../helpers.js";
import becca from "../../becca/becca.js";
import type BBranch from "../../becca/entities/bbranch.js";
import type BNote from "../../becca/entities/bnote.js";
import { getLog } from "../../services/log.js";
import noteFormatConversionService from "../../services/note_format_conversion.js";
import noteService from "../../services/notes.js";
import {
    createReference, findMarkedHeadings, findReferenceTargets
} from "../../services/references/index.js";
import { getSql } from "../../services/sql/index";
import TaskContext from "../../services/task_context.js";
import treeService from "../../services/tree.js";
import { hashedBlobId, randomString } from "../../services/utils/index";

function getNote(req: Request<{ noteId: string }>) {
    return becca.getNoteOrThrow(req.params.noteId);
}

function getNoteBlob(req: Request<{ noteId: string }>) {
    return blobService.getBlobPojo("notes", req.params.noteId);
}

function getNoteMetadata(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    return {
        dateCreated: note.dateCreated,
        utcDateCreated: note.utcDateCreated,
        dateModified: note.dateModified,
        utcDateModified: note.utcDateModified
    } satisfies MetadataResponse;
}

function getNotesMetadata(req: Request) {
    const { noteIds } = req.body as { noteIds?: unknown };
    if (!Array.isArray(noteIds) || noteIds.some((noteId) => typeof noteId !== "string")) {
        throw new ValidationError("Expected 'noteIds' to be an array of note IDs.");
    }

    const metadata: Record<string, MetadataResponse> = {};

    for (const noteId of noteIds as string[]) {
        // Unknown notes are skipped rather than refused: a caller asks about the notes it holds,
        // and one of them can be deleted before the request lands.
        const note = becca.notes[noteId];
        if (!note) {
            continue;
        }

        metadata[noteId] = {
            dateCreated: note.dateCreated,
            utcDateCreated: note.utcDateCreated,
            dateModified: note.dateModified,
            utcDateModified: note.utcDateModified
        };
    }

    return metadata;
}

function createNote(req: Request) {
    const params = Object.assign({}, req.body); // clone
    params.parentNoteId = req.params.parentNoteId;

    const { target, targetBranchId } = req.query;

    if (target !== "into" && target !== "after" && target !== "before") {
        throw new ValidationError("Invalid target type.");
    }

    /* v8 ignore if -- Express can parse a repeated query param into an array; the string-only
       test harness cannot */
    if (targetBranchId && typeof targetBranchId !== "string") {
        throw new ValidationError("Missing or incorrect type for target branch ID.");
    }

    const { note, branch } = noteService.createNewNoteWithTarget(target, String(targetBranchId), params);

    // Content handed to us at creation gets the same pass a save gives it — `createNewNote`
    // deliberately does none of it itself, so every caller taking content from outside runs it (see
    // `import/single.ts`). Without it, content that came from another note keeps pointing at that
    // note's attachments: "cut selection into sub-note" hands the new note the selected HTML,
    // picture URLs and all, and then removes the selection from the source, which schedules the very
    // attachments the sub-note shows for erasure. The copying step lives here, in the same
    // transaction (`scanForLinks` runs before this promise's first await), so the note is right
    // before the response leaves.
    if (typeof params.content === "string" && params.content) {
        void noteService.asyncPostProcessContent(note, params.content);
    }

    return {
        note,
        branch
    } satisfies CreateChildrenResponse;
}

/**
 * Saves the content of a note. With a `base`, the save is refused with 409 when the note has
 * another format or version, and the answer is what the next save is based on. Without it, the
 * save is unconditional, with an empty answer.
 */
function updateNoteData(req: Request<{ noteId: string }>) {
    const { content, attachments, base, keepOther } = req.body as SaveNoteDataRequest;
    const { noteId } = req.params;
    if (base === undefined) {
        refuseKeepingWithoutBase(keepOther);
        noteService.updateNoteData(noteId, content, attachments);
        return;
    }
    if (!isSaveBase(base)) {
        throw new ValidationError("Expected the 'blobId', the 'type' and the 'mime' of the base.");
    }

    const precondition = { base, isKeepingOther: keepOther === true };
    return answerConflict(() =>
        noteService.updateNoteData(noteId, content, attachments, precondition));
}

/** The blocks of a text note that the `block` query parameter points at, to edit apart. */
function getNoteBlocks(req: Request<{ noteId: string }>) {
    const { note, block } = getBlockRangeRequest(req);
    const content = getTextContent(note);
    const blocks = getBlockRangeContent(content, block);
    if (blocks === null) {
        throw new NotFoundError(getBlockRangeError(note.noteId, block));
    }

    return {
        content: blocks, hash: hashedBlobId(blocks), note: content
    } satisfies NoteBlocksResponse;
}

/**
 * Replaces the blocks of a text note that the `block` query parameter points at. With a `base`,
 * the save is refused with 409 when the blocks changed since they were read, or can no longer be
 * saved apart; a change elsewhere in the note goes through.
 */
function updateNoteBlocks(req: Request<{ noteId: string }>) {
    const { note, block } = getBlockRangeRequest(req);
    const { content: blocks, attachments, base, keepOther, block: savedBlock } =
        req.body as SaveNoteBlocksRequest;
    if (typeof blocks !== "string") {
        throw new ValidationError("Missing the content of the blocks.");
    }

    if (base === undefined) {
        refuseKeepingWithoutBase(keepOther);
        const newContent = replaceBlockRangeContent(getTextContent(note), block, blocks);
        if (newContent === null) {
            throw new NotFoundError(getBlockRangeError(note.noteId, block));
        }
        noteService.updateNoteData(note.noteId, newContent, attachments);
        return;
    }
    if (typeof base?.hash !== "string") {
        throw new ValidationError("Expected the 'hash' of the base.");
    }

    return answerConflict(() => saveBlocksOnBase(note, block, {
        blocks, attachments, hash: base.hash, isKeepingOther: keepOther === true, savedBlock
    }));
}

/**
 * Saves `blocks` in place of the blocks of `note` that `block` points at, when those are still as
 * `hash` names them. Throws a {@link DetailedConflictError} otherwise.
 */
function saveBlocksOnBase(note: BNote, block: string, save: {
    blocks: string;
    attachments: SaveNoteBlocksRequest["attachments"];
    hash: string;
    isKeepingOther: boolean;
    savedBlock: unknown;
}) {
    const gone = (reason: "format" | "range") => {
        const message = getBlockRangeError(note.noteId, block);
        return new DetailedConflictError<BlocksConflictResponse>(message, { reason, message });
    };
    if (note.type !== "text") {
        throw gone("format");
    }
    const replacement =
        replaceBlockRangeOnBase(getTextContent(note), block, save.blocks, save.hash);
    if (replacement.status === "missing") {
        throw gone("range");
    }

    const { hash } = replacement;
    const rows = save.attachments ?? [];
    const changed = (message: string, attachments: SavedAttachmentBase[]) =>
        new DetailedConflictError<BlocksConflictResponse>(message, {
            reason: "version", message, hash, attachments, isVersioned: note.isVersioned()
        });
    if (replacement.status === "changed") {
        const message =
            `Blocks '${block}' of note '${note.noteId}' have changed since they were read.`;
        throw changed(message, noteService.getNamedAttachments(note, rows));
    }
    const newContent = replacement.content;

    // A change outside the blocks goes through: the precondition is the note as it is now, which
    // still checks the attachment rows.
    const precondition = {
        base: { blobId: note.blobId as string, type: note.type, mime: note.mime },
        isKeepingOther: save.isKeepingOther
    };
    let saved: SaveNoteDataResponse;
    try {
        saved = noteService.updateNoteData(note.noteId, newContent, rows, precondition);
    } catch (e) {
        if (e instanceof DetailedConflictError) {
            const { message, attachments = [] } = e.details as SaveConflictResponse;
            throw changed(message, attachments);
        }
        throw e;
    }
    const savedNote = saved.content ?? newContent;
    const savedBlocks = getBlockRangeContent(
        savedNote, typeof save.savedBlock === "string" ? save.savedBlock : block
    );
    return {
        hash: savedBlocks === null ? null : hashedBlobId(savedBlocks),
        note: savedNote,
        attachments: saved.attachments
    } satisfies SaveNoteBlocksResponse;
}

/** Refuses `keepOther` in a save without a base: it would save over a version it never saw. */
function refuseKeepingWithoutBase(keepOther: unknown) {
    if (keepOther !== undefined && keepOther !== false) {
        throw new ValidationError("A save that keeps its version needs the base it is based on.");
    }
}

/** The places inside a note that a link can point at, such as its headings and anchors. */
async function getNoteReferences(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);
    return await findReferenceTargets(note);
}

/** Gives a target of a note a reference, unless it has one, and returns its link parameters. */
function createNoteReference(req: Request<{ noteId: string }>) {
    const request = parseReferenceRequest(req.body);
    const note = becca.getNoteOrThrow(req.params.noteId);
    return answerConflict(() => (
        { params: createReference(note, request) } satisfies CreateReferenceResponse
    ));
}

/** The headings of a note with the content marked by their positions, for a read-only view. */
function getMarkedNoteHeadings(req: Request<{ noteId: string }>) {
    return findMarkedHeadings(becca.getNoteOrThrow(req.params.noteId));
}

function parseReferenceRequest(body: unknown): CreateReferenceRequest {
    const { kind, index, line, title, blobId } = (body ?? {}) as Record<string, unknown>;
    if (isReferenceKind(kind) && typeof title === "string" && title) {
        if (isIntegerFrom(index, 0) && line === undefined
            && (blobId === undefined || typeof blobId === "string")) {
            return { kind, index, title, blobId };
        }
        if (isIntegerFrom(line, 1) && index === undefined && typeof blobId === "string" && blobId) {
            return { kind, line, title, blobId };
        }
    }
    throw new ValidationError("Expected the 'kind' and the 'title' of a target, and either its "
        + "'index' or its 'line' and 'blobId'.");
}

function isIntegerFrom(value: unknown, min: number): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

function isSaveBase(base: unknown): base is NoteSaveBase {
    const { blobId, type, mime } = (base ?? {}) as Record<string, unknown>;
    return typeof blobId === "string" && typeof type === "string" && isNoteType(type)
        && typeof mime === "string";
}

function isReferenceKind(value: unknown): value is ReferenceKind {
    return REFERENCE_KINDS.some((kind) => kind === value);
}

function getBlockRangeRequest(req: Request<{ noteId: string }>) {
    const { block } = req.query;
    if (typeof block !== "string") {
        throw new ValidationError("Missing the 'block' parameter.");
    }

    return { note: becca.getNoteOrThrow(req.params.noteId), block };
}

function getBlockRangeError(noteId: string, block: string) {
    return `Blocks '${block}' of note '${noteId}' do not exist or cannot be edited apart.`;
}

/** The HTML of `note`, which must be a text note whose content is available. */
function getTextContent(note: BNote) {
    const content = note.type === "text" && note.isContentAvailable() ? note.getContent() : null;
    if (typeof content !== "string") {
        throw new ValidationError(`Note '${note.noteId}' has no text content available.`);
    }
    return content;
}

function deleteNote(req: Request<{ noteId: string }>) {
    const noteId = req.params.noteId;
    const taskId = req.query.taskId;
    const eraseNotes = req.query.eraseNotes === "true";
    const last = req.query.last === "true";

    // note how deleteId is separate from taskId - single taskId produces separate deleteId for each "top level" deleted note
    const deleteId = randomString(10);

    const note = becca.getNoteOrThrow(noteId);

    if (typeof taskId !== "string") {
        throw new ValidationError("Missing or incorrect type for task ID.");
    }
    const taskContext = TaskContext.getInstance(taskId, "deleteNotes", null);

    note.deleteNote(deleteId, taskContext);

    if (eraseNotes) {
        taskContext.scheduleErase(deleteId);
    }

    if (last) {
        eraseService.eraseNotesWithDeleteIds(taskContext.takeScheduledErases());
        taskContext.taskSucceeded(null);
    }
}

function undeleteNote(req: Request<{ noteId: string }>) {
    const taskContext = TaskContext.getInstance(randomString(10), "undeleteNotes", null);

    // A note whose original parent is gone can only be restored by giving it a new home. The caller
    // opts into that by naming a fallback parent (the client uses the inbox / default new-note
    // location, after telling the user the original location no longer exists).
    const { fallbackParentNoteId } = req.body ?? {};

    if (fallbackParentNoteId !== undefined && typeof fallbackParentNoteId !== "string") {
        throw new ValidationError("'fallbackParentNoteId' must be a note id.");
    }

    // Report whether the note was actually restored (and where): it may fail if the note was already
    // erased, so the client can give feedback instead of navigating to a note that was never brought back.
    const result = noteService.undeleteNote(req.params.noteId, taskContext, { fallbackParentNoteId });

    taskContext.taskSucceeded(null);

    return result;
}

function sortChildNotes(req: Request<{ noteId: string }>) {
    const noteId = req.params.noteId;
    const { sortBy, sortDirection, foldersFirst, sortNatural, sortLocale } = req.body;

    getLog().info(`Sorting '${noteId}' children with ${sortBy} ${sortDirection}, foldersFirst=${foldersFirst}, sortNatural=${sortNatural}, sortLocale=${sortLocale}`);

    const reverse = sortDirection === "desc";

    treeService.sortNotes(noteId, sortBy, reverse, foldersFirst, sortNatural, sortLocale);
}

function protectNote(req: Request<{ noteId: string; isProtected: string }>) {
    const noteId = req.params.noteId;
    const note = becca.notes[noteId];
    const protect = !!parseInt(req.params.isProtected);
    const includingSubTree = !!parseInt(req.query?.subtree as string);

    const taskContext = new TaskContext(randomString(10), "protectNotes", { protect });

    noteService.protectNoteRecursively(note, protect, includingSubTree, taskContext);

    taskContext.taskSucceeded(null);
}

function setNoteTypeMime(req: Request<{ noteId: string }>) {
    // can't use [] destructuring because req.params is not iterable
    const { noteId } = req.params;
    const { type, mime } = req.body;

    if (!isNoteType(type)) {
        throw new ValidationError(`'${type}' is not a valid note type`);
    }

    const note = becca.getNoteOrThrow(noteId);
    note.type = type;
    note.mime = mime;
    note.save();
}

function changeTitle(req: Request<{ noteId: string }>) {
    const noteId = req.params.noteId;
    const title = req.body.title;

    const note = becca.getNoteOrThrow(noteId);

    if (!note.isContentAvailable()) {
        throw new ValidationError(`Note '${noteId}' is not available for change`);
    }

    const noteTitleChanged = note.title !== title;

    if (noteTitleChanged) {
        noteService.saveRevisionIfNeeded(note);
    }

    note.title = title;

    note.save();

    if (noteTitleChanged) {
        noteService.triggerNoteTitleChanged(note);
    }

    return note;
}

function duplicateSubtree(req: Request<{ noteId: string; parentNoteId: string }>) {
    const { noteId, parentNoteId } = req.params;
    const { withChildren } = (req.body ?? {}) as { withChildren?: unknown };

    return noteService.duplicateSubtree(noteId, parentNoteId, { withChildren: withChildren !== false });
}

function eraseDeletedNotesNow() {
    eraseService.eraseDeletedNotesNow();
}

function eraseUnusedAttachmentsNow() {
    eraseService.eraseUnusedAttachmentsNow();
}

function getDeleteNotesPreview(req: Request) {
    const { branchIdsToDelete, deleteAllClones } = req.body;

    const noteIdsToBeDeleted = new Set<string>();
    const strongBranchCountToDelete: Record<string, number> = {}; // noteId => count

    function branchPreviewDeletion(branch: BBranch) {
        if (branch.isWeak || !branch.branchId) {
            return;
        }

        strongBranchCountToDelete[branch.branchId] = strongBranchCountToDelete[branch.branchId] || 0;
        strongBranchCountToDelete[branch.branchId]++;

        const note = branch.getNote();

        if (deleteAllClones || note.getStrongParentBranches().length <= strongBranchCountToDelete[branch.branchId]) {
            noteIdsToBeDeleted.add(note.noteId);

            for (const childBranch of note.getChildBranches()) {
                branchPreviewDeletion(childBranch);
            }
        }
    }

    for (const branchId of branchIdsToDelete) {
        const branch = becca.getBranch(branchId);

        if (!branch) {
            getLog().error(`Branch ${branchId} was not found and delete preview can't be calculated for this note.`);

            continue;
        }

        branchPreviewDeletion(branch);
    }

    let brokenRelations: AttributeRow[] = [];

    if (noteIdsToBeDeleted.size > 0) {
        const sql = getSql();
        sql.fillParamList(noteIdsToBeDeleted);

        // FIXME: No need to do this in database, can be done with becca data
        brokenRelations = sql
            .getRows<AttributeRow>(
                `
            SELECT attr.noteId, attr.name, attr.value
            FROM attributes attr
                    JOIN param_list ON param_list.paramId = attr.value
            WHERE attr.isDeleted = 0
            AND attr.type = 'relation'`
            )
            .filter((attr) => attr.noteId && !noteIdsToBeDeleted.has(attr.noteId));
    }

    return {
        noteIdsToBeDeleted: Array.from(noteIdsToBeDeleted),
        brokenRelations
    } satisfies DeleteNotesPreview;
}

/**
 * Deletes a whole selection of branches, which is what the delete-notes dialog carries out.
 *
 * Takes the selection in one request so it deletes in one transaction, and the commit hook
 * broadcasts one frontend update for the whole batch rather than one per note.
 *
 * Each branch gets a deleteId of its own, so Recent Changes can undelete one note of the selection
 * without bringing the rest back.
 */
function deleteNotes(req: Request) {
    const { branchIdsToDelete, deleteAllClones, eraseNotes, totalCount, taskId } = req.body ?? {};

    if (!Array.isArray(branchIdsToDelete)) {
        throw new ValidationError("'branchIdsToDelete' must be an array of branch IDs.");
    }

    if (typeof taskId !== "string") {
        throw new ValidationError("Missing or incorrect type for task ID.");
    }

    const taskContext = new TaskContext(taskId, "deleteNotes", null);

    // What getDeleteNotesPreview told the caller the deletion costs. A caller that did not ask gets
    // a bare running count instead of a bar.
    if (typeof totalCount === "number" && totalCount > 0) {
        taskContext.setTotalCount(totalCount);
    }

    try {
        for (const branchId of branchIdsToDelete) {
            const branch = becca.getBranch(branchId);

            if (!branch) {
                // Either a stale id, or a branch an earlier one of the selection took down with
                // its subtree.
                getLog().info(`Branch '${branchId}' was not found, skipping its deletion.`);
                continue;
            }

            const deleteId = randomString(10);

            // Erasing one branch would leave the note's other clones pointing at erased content, so
            // eraseNotes deletes the note everywhere it hangs.
            if (deleteAllClones || eraseNotes) {
                branch.getNote().deleteNote(deleteId, taskContext);
            } else {
                branch.deleteBranch(deleteId, taskContext);
            }

            if (eraseNotes) {
                taskContext.scheduleErase(deleteId);
            }
        }

        const deleteIdsToErase = taskContext.takeScheduledErases();

        if (deleteIdsToErase.length > 0) {
            // Erasing is bulk SQL over the whole batch with no per-note step to count, so it
            // reports a phase rather than letting the bar sit at its last value.
            taskContext.reportPhase("erasing");
            eraseService.eraseNotesWithDeleteIds(deleteIdsToErase);
        }

        taskContext.taskSucceeded(null);
    } catch (e: unknown) {
        // The progress toast has no close button, so a failure the task system never hears about
        // leaves it on screen until the page is reloaded. Rethrown rather than answered with a
        // status, because the surrounding transaction rolls back on the throw — returning here
        // would commit a half-deleted selection.
        const message = e instanceof Error ? e.message : String(e);
        getLog().error(`Deleting notes failed: ${message}`);
        taskContext.reportError(t("notes.delete-notes-failed", { message }));
        throw e;
    }
}

function forceSaveRevision(req: Request<{ noteId: string }>) {
    const { noteId } = req.params;
    const note = becca.getNoteOrThrow(noteId);

    if (!note.isContentAvailable()) {
        throw new ValidationError(`Note revision of a protected note cannot be created outside of a protected session.`);
    }

    const description = typeof req.body?.description === "string" ? req.body.description : "";
    const revision = note.saveRevision({ description, source: "manual" });

    return {
        revisionId: revision.revisionId
    };
}

function convertNoteToAttachment(req: Request<{ noteId: string }>) {
    const { noteId } = req.params;
    const note = becca.getNoteOrThrow(noteId);

    return {
        attachment: note.convertToParentAttachment()
    };
}

function convertNoteFormat(req: Request<{ noteId: string }>) {
    const { noteId } = req.params;
    const note = becca.getNoteOrThrow(noteId);

    return noteFormatConversionService.convertNoteFormat(note);
}

export default {
    getNote,
    getNoteBlob,
    getNoteMetadata,
    getNotesMetadata,
    updateNoteData,
    getNoteBlocks,
    updateNoteBlocks,
    getNoteReferences,
    createNoteReference,
    getMarkedNoteHeadings,
    deleteNote,
    undeleteNote,
    createNote,
    sortChildNotes,
    protectNote,
    setNoteTypeMime,
    changeTitle,
    duplicateSubtree,
    eraseDeletedNotesNow,
    eraseUnusedAttachmentsNow,
    getDeleteNotesPreview,
    deleteNotes,
    forceSaveRevision,
    convertNoteToAttachment,
    convertNoteFormat
};
