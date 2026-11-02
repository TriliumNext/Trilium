import {
    escapeHtml, isMarkdownMime, isMergeHistoryRole, type MergeHistoryEntry
} from "@triliumnext/commons";
import { t } from "i18next";

import becca from "../becca/becca.js";
import type BAttribute from "../becca/entities/battribute.js";
import BAttachment from "../becca/entities/battachment.js";
import BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import { ValidationError } from "../errors.js";
import { getHoistedNoteId } from "./context.js";
import { getLog } from "./log.js";
import noteService, { saveLinks } from "./notes.js";
import { getSql } from "./sql/index.js";
import TaskContext from "./task_context.js";
import treeService from "./tree.js";
import { decodeUtf8 } from "./utils/binary.js";
import dateUtils from "./utils/date.js";
import { randomString } from "./utils/index.js";

const BLANK_HTML = /^(?:<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>|<br\s*\/?>|\s)*$/i;

/**
 * Role of the attachment that stores one record per note still waiting to be restored.
 *
 * The deleted note still holds its own text, so the record keeps only ids, titles and the structural
 * changes. {@link MERGE_UNDO_BLOB_ROLE} is the older copy of that text and is still ignored when one
 * turns up. Neither role is one of `ATTACHMENT_ROLES`. The attachment list leaves both out.
 */
const MERGE_UNDO_ROLE = "mergeUndo";

/** Role of one pre-merge text copy owned by a merge record. */
const MERGE_UNDO_BLOB_ROLE = "mergeUndoBlob";

interface DeletedRelation {
    noteId: string;
    name: string;
    value: string;
    isInheritable: boolean;
    position: number;
}

/**
 * What merging one note changed, so that note can be brought back on its own.
 *
 * The merged note keeps the appended text. Restoring this note does not rewrite it.
 */
interface MergeUndo {
    id: string;
    utcDate: string;
    sourceTitle: string;
    sourceNoteId: string;
    /** Branches created for this note's children, so they can move back with it. */
    createdBranchIds: string[];
    prefixRestores: { branchId: string; prefix: string | null }[];
    createdAttributeIds: string[];
    inheritableReverts: string[];
    relationRestores: { attributeId: string; value: string }[];
    deletedRelations: DeletedRelation[];
    /**
     * Where another note's text mentioned this note. The indexes point at the merged note's id,
     * which has the same length, so a later edit that leaves those characters alone can be reversed.
     */
    linkPatches: { noteId: string; indices: number[] }[];
}

interface Placement {
    parentNoteId: string;
    prefix: string | null;
    notePosition: number;
    isExpanded: boolean;
}

type PlaceOutcome = "placed" | "exists" | "skipped" | "rejected";

/** Ids of branches and attributes a previous merge copied, rewritten onto this merge's copies. */
interface CarriedIds {
    attributes: Map<string, string>;
    branches: Map<string, string>;
}

/**
 * Replaces `targetNoteId` and every source with a new note whose text is theirs, appended in order.
 *
 * Both notes are deleted. The new note keeps a separate record for each of them, so either can be
 * restored or forgotten on its own. Restoring one does not change the new note's text. One
 * transaction (the route's) wraps the whole merge. Each note whose text is about to change keeps a
 * revision from before the merge.
 */
function mergeNotes(targetNoteId: string, sourceNoteIds: string[], title?: string) {
    const first = becca.getNoteOrThrow(targetNoteId);
    const sources = loadSources(targetNoteId, sourceNoteIds);
    const notes = [ first, ...sources ];
    const noteIds = new Set(notes.map((note) => note.noteId));

    for (const note of notes) {
        assertMergeNote(first, note, noteIds);
    }

    const trimmedTitle = title?.trim();
    if (title !== undefined && !trimmedTitle) {
        throw new ValidationError(t("merge.empty-title"));
    }

    const placements = outsidePlacements(notes, noteIds);
    const primary = placements.find((item) => !isWeakParent(item.parentNoteId));
    if (!primary) {
        throw new ValidationError(t("merge.target-lost"));
    }

    // Depth is read before any branch moves, so a parent note cannot take a nested one with it.
    const deleteOrder = notes
        .map((note) => ({ note, depth: note.getAncestorNoteIds().length }))
        .sort((a, b) => b.depth - a.depth)
        .map((item) => item.note);

    const { note: merged } = noteService.createNewNote({
        parentNoteId: primary.parentNoteId,
        title: trimmedTitle || first.getTitleOrProtected(),
        type: first.type,
        mime: first.mime,
        content: "",
        isProtected: !!first.isProtected,
        notePosition: primary.notePosition,
        prefix: primary.prefix ?? "",
        isExpanded: primary.isExpanded
    });

    const journals = new Map<string, MergeUndo>();
    const carriedIds: CarriedIds = { attributes: new Map(), branches: new Map() };
    for (const note of notes) {
        journals.set(note.noteId, emptyJournal(note));
    }

    const revised = new Set<string>();
    for (const note of notes) {
        revise(note, revised);
    }

    for (const note of notes) {
        const journal = journals.get(note.noteId);
        /* v8 ignore next 3 -- `journals` is filled for every note above */
        if (!journal) {
            continue;
        }
        for (const branch of note.getParentBranches()) {
            if (noteIds.has(branch.parentNoteId)) {
                continue;
            }
            if (branch.parentNoteId === primary.parentNoteId && note.noteId === first.noteId) {
                continue;
            }
            const outcome = placeNote(merged.noteId, placementOf(branch), journal, false);
            if (outcome === "rejected") {
                const parent = becca.getNote(branch.parentNoteId);
                throw new ValidationError(t("merge.cannot-place", {
                    note: merged.getTitleOrProtected(),
                    parent: parent ? parent.getTitleOrProtected() : branch.parentNoteId
                }));
            }
        }
    }

    for (const note of notes) {
        const journal = journals.get(note.noteId);
        /* v8 ignore next 3 -- `journals` is filled for every note above */
        if (!journal) {
            continue;
        }
        reparentChildren(merged, note, noteIds, journal, carriedIds);
        copyAttributes(merged, note, noteIds, journal, carriedIds);
        retargetIncoming(note, merged, noteIds, revised, journal);
        appendContent(merged, note, noteIds);
    }

    const carried: MergeUndo[] = [];
    for (const note of notes) {
        const journal = journals.get(note.noteId);
        /* v8 ignore next 3 -- `journals` is filled for every note above */
        if (!journal) {
            continue;
        }
        for (const entry of readUndoStack(note)) {
            remapCarriedEntry(entry, carriedIds);
            // The copies now belong to the note that was merged earlier, not to this note's record.
            journal.createdBranchIds = journal.createdBranchIds
                .filter((id) => !entry.createdBranchIds.includes(id));
            journal.createdAttributeIds = journal.createdAttributeIds
                .filter((id) => !entry.createdAttributeIds.includes(id));
            journal.inheritableReverts = journal.inheritableReverts
                .filter((id) => !entry.inheritableReverts.includes(id));
            journal.prefixRestores = journal.prefixRestores.filter((change) =>
                !entry.prefixRestores.some((carried) => carried.branchId === change.branchId));
            carried.push(entry);
        }
    }
    for (const note of notes) {
        const journal = journals.get(note.noteId);
        /* v8 ignore next 3 -- `journals` is filled for every note above */
        if (!journal) {
            continue;
        }
        carried.push(journal);
    }
    writeUndoStack(merged, carried);

    for (const note of deleteOrder) {
        if (!note.isDeleted) {
            note.deleteNote();
        }
    }

    getLog().info(`Merged ${notes.length} notes into '${merged.noteId}'.`);
    return { noteId: merged.noteId, mergedCount: notes.length };
}

/**
 * Brings back the note recorded as `entryId` on `mergedNoteId`.
 *
 * The note returns with its own text, clones, children, links and attributes. The merged note's
 * text and title stay as they are, and the merged note itself is left in place. With no `entryId`,
 * the most recently merged note that still exists is the one restored. A note that has been erased
 * can no longer be restored.
 */
function undoMerge(mergedNoteId: string, entryId?: string) {
    const merged = becca.getNoteOrThrow(mergedNoteId);
    const stack = readUndoStack(merged);
    const index = entryId
        ? stack.findIndex((entry) => entry.id === entryId)
        : newestRestorableIndex(stack);
    const record = index >= 0 ? stack[index] : undefined;
    if (!record) {
        if (entryId) {
            throw new ValidationError(t("merge.unknown-entry"));
        }
        throw new ValidationError(stack.length > 0
            ? t("merge.undo-expired")
            : t("merge.nothing-to-undo"));
    }
    if (!sourceNoteRemains(record.sourceNoteId)) {
        throw new ValidationError(t("merge.undo-expired"));
    }

    restoreMergedNote(merged, record, stack);
    stack.splice(index, 1);
    writeUndoStack(merged, stack);
    getLog().info(`Restored '${record.sourceNoteId}' from '${merged.noteId}'.`);
}

/** The notes that can still be restored from `mergedNoteId`, newest first. */
function getMergeHistory(mergedNoteId: string) {
    const merged = becca.getNoteOrThrow(mergedNoteId);
    const stack = readUndoStack(merged);
    const entries: MergeHistoryEntry[] = [];
    for (let index = stack.length - 1; index >= 0; index--) {
        const entry = stack[index];
        /* v8 ignore next 3 -- the journal is a dense array */
        if (!entry) {
            continue;
        }
        entries.push({
            id: entry.id,
            utcDate: entry.utcDate,
            sourceTitle: entry.sourceTitle,
            sourceNoteId: entry.sourceNoteId,
            undoable: sourceNoteRemains(entry.sourceNoteId)
        });
    }
    return { entries };
}

/**
 * Forgets `entryId` only.
 *
 * The note stays deleted, and every other note that can still be restored stays available.
 * Deleting the merged note itself is left to the user.
 */
function forgetMerges(mergedNoteId: string, entryId: string) {
    const merged = becca.getNoteOrThrow(mergedNoteId);
    const stack = readUndoStack(merged);
    const index = stack.findIndex((entry) => entry.id === entryId);
    if (index < 0) {
        throw new ValidationError(t("merge.unknown-entry"));
    }

    stack.splice(index, 1);
    writeUndoStack(merged, stack);
}

export default {
    mergeNotes,
    undoMerge,
    getMergeHistory,
    forgetMerges
};

function loadSources(targetNoteId: string, sourceNoteIds: string[]) {
    const seen = new Set<string>();
    const sources: BNote[] = [];
    for (const noteId of sourceNoteIds) {
        if (noteId === targetNoteId || seen.has(noteId)) {
            continue;
        }
        seen.add(noteId);
        sources.push(becca.getNoteOrThrow(noteId));
    }

    if (sources.length === 0) {
        throw new ValidationError(t("merge.no-sources"));
    }
    return sources;
}

function assertUserNote(note: BNote) {
    if (note.noteId === "root" || note.noteId.startsWith("_") || note.isVirtual) {
        throw new ValidationError(t("merge.system-note"));
    }

    if (note.type === "search" || note.type === "launcher") {
        throw new ValidationError(t("merge.unsupported-type"));
    }
}

function assertMergeNote(first: BNote, note: BNote, noteIds: Set<string>) {
    assertUserNote(note);
    // Every merged note is deleted, including the one the merge was started from.
    if (note.noteId === getHoistedNoteId()) {
        throw new ValidationError(t("merge.hoisted"));
    }

    if (!note.isContentAvailable()) {
        throw new ValidationError(t("merge.protected"));
    }

    if (!!first.isProtected !== !!note.isProtected) {
        throw new ValidationError(t("merge.protection-mismatch"));
    }

    // A file or image that still holds bytes cannot be the note the merge starts from. The check
    // below misses that when every other note is blank, and the new note would already exist.
    if (note.noteId === first.noteId && hasPayload(note) && typeof note.getContent() !== "string") {
        throw new ValidationError(t("merge.incompatible-content"));
    }

    // A note that still holds content of a different kind is refused even when the first note is
    // blank, so an empty text note cannot swallow a file.
    if (note.noteId !== first.noteId && hasPayload(note) && !canCombineContent(first, note)) {
        throw new ValidationError(t("merge.incompatible-content"));
    }

    for (const rel of note.getTargetRelations()) {
        if (!rel.isAutoLink()) {
            continue;
        }
        const owner = rel.note;
        if (!owner || noteIds.has(owner.noteId)) {
            continue;
        }
        if (!owner.isContentAvailable()) {
            throw new ValidationError(t("merge.protected-reference", {
                title: owner.getTitleOrProtected()
            }));
        }
    }
}

function outsidePlacements(notes: BNote[], noteIds: Set<string>) {
    const seen = new Set<string>();
    const placements: Placement[] = [];
    for (const note of notes) {
        for (const branch of note.getParentBranches()) {
            if (noteIds.has(branch.parentNoteId) || seen.has(branch.parentNoteId)) {
                continue;
            }
            seen.add(branch.parentNoteId);
            placements.push(placementOf(branch));
        }
    }
    return placements;
}

function isWeakParent(parentNoteId: string) {
    return parentNoteId === "_share" || parentNoteId === "_lbBookmarks";
}

function canCombineContent(target: BNote, source: BNote) {
    if (target.type === "text" && source.type === "text") {
        return true;
    }
    return target.type === "code" && source.type === "code" && target.mime === source.mime;
}

function hasPayload(note: BNote) {
    const content = note.getContent();
    if (typeof content === "string") {
        return !isBlankStringContent(content, note.type);
    }
    return content.byteLength > 0;
}

function isBlankStringContent(content: string, type: string) {
    const trimmed = content.trim();
    if (!trimmed) {
        return true;
    }
    return type === "text" && BLANK_HTML.test(trimmed);
}

function placementOf(branch: BBranch): Placement {
    return {
        parentNoteId: branch.parentNoteId,
        prefix: branch.prefix,
        notePosition: branch.notePosition,
        isExpanded: branch.isExpanded
    };
}

/**
 * Puts `noteId` where `placement` says.
 *
 * A cycle means that place is already inside the note, and an existing branch is left in place
 * (taking the source's prefix when the note has none). Search results and virtual parents are not
 * real locations. Anything else refuses the merge.
 */
function placeNote(
    noteId: string,
    placement: Placement,
    journal: MergeUndo | null,
    recordBranch: boolean
): PlaceOutcome {
    const parent = becca.getNote(placement.parentNoteId);
    if (!parent || parent.type === "search" || parent.isVirtual) {
        return "skipped";
    }

    const validation = treeService.validateParentChild(placement.parentNoteId, noteId);
    if (!validation.success) {
        if (validation.message === "Moving/cloning note here would create cycle.") {
            return "skipped";
        }
        if (validation.branch) {
            if (journal && !validation.branch.prefix && placement.prefix && validation.branch.branchId) {
                journal.prefixRestores.push({
                    branchId: validation.branch.branchId,
                    prefix: validation.branch.prefix
                });
                validation.branch.prefix = placement.prefix;
                validation.branch.save();
            }
            if (recordBranch && journal && validation.branch.branchId) {
                rememberId(journal.createdBranchIds, validation.branch.branchId);
            }
            return "exists";
        }
        return "rejected";
    }

    const branch = new BBranch({
        noteId,
        parentNoteId: placement.parentNoteId,
        prefix: placement.prefix,
        notePosition: placement.notePosition,
        isExpanded: placement.isExpanded
    }).save();
    if (recordBranch && journal && branch.branchId) {
        rememberId(journal.createdBranchIds, branch.branchId);
    }
    return "placed";
}

function reparentChildren(
    target: BNote,
    source: BNote,
    sourceIds: Set<string>,
    journal: MergeUndo,
    carriedIds: CarriedIds
) {
    for (const childBranch of source.getChildBranches()) {
        if (!childBranch) {
            continue;
        }
        const child = childBranch.getNote();
        if (!child || child.noteId === target.noteId || sourceIds.has(child.noteId)) {
            continue;
        }

        const marked = journal.createdBranchIds.length;
        const underTarget = placeNote(child.noteId, {
            parentNoteId: target.noteId,
            prefix: childBranch.prefix,
            notePosition: childBranch.notePosition,
            isExpanded: childBranch.isExpanded
        }, journal, true);
        if (underTarget === "placed" || underTarget === "exists") {
            const createdId = journal.createdBranchIds[marked];
            if (childBranch.branchId && createdId) {
                carriedIds.branches.set(childBranch.branchId, createdId);
            }
            continue;
        }

        let saved = false;
        for (const parentBranch of source.getParentBranches()) {
            const outcome = placeNote(child.noteId, placementOf(parentBranch), journal, true);
            if (outcome === "placed" || outcome === "exists") {
                saved = true;
            }
        }
        if (saved) {
            continue;
        }

        const outside = child.getStrongParentBranches().filter((branch) =>
            branch.parentNoteId !== source.noteId && !sourceIds.has(branch.parentNoteId));
        if (outside.length === 0) {
            throw new ValidationError(t("merge.child-stranded", {
                title: child.getTitleOrProtected()
            }));
        }
    }
}

function copyAttributes(
    target: BNote,
    source: BNote,
    sourceIds: Set<string>,
    journal: MergeUndo,
    carriedIds: CarriedIds
) {
    for (const attr of source.getOwnedAttributes()) {
        // Auto links are rebuilt from the appended content. A relation aimed at a note in this
        // merge would point at the note that remains.
        if (attr.isAutoLink()) {
            continue;
        }
        if (attr.type === "relation"
            && (attr.value === target.noteId || sourceIds.has(attr.value))) {
            continue;
        }

        const existing = target.getOwnedAttributes(attr.type, attr.name, attr.value);
        if (existing.length > 0) {
            const kept = existing[0];
            if (kept) {
                // Every original that supplied the attribute has to be restored before it goes.
                rememberId(journal.createdAttributeIds, kept.attributeId);
                carriedIds.attributes.set(attr.attributeId, kept.attributeId);
                if (attr.isInheritable && !existing.some((item) => item.isInheritable)) {
                    journal.inheritableReverts.push(kept.attributeId);
                    kept.isInheritable = true;
                    kept.save();
                }
            }
            continue;
        }

        const created = target.addAttribute(
            attr.type, attr.name, attr.value, attr.isInheritable, attr.position
        );
        rememberId(journal.createdAttributeIds, created.attributeId);
        carriedIds.attributes.set(attr.attributeId, created.attributeId);
    }
}

function retargetIncoming(
    source: BNote,
    target: BNote,
    sourceIds: Set<string>,
    revised: Set<string>,
    journal: MergeUndo
) {
    for (const rel of source.getTargetRelations().slice()) {
        const owner = rel.note;
        if (!owner || owner.isDeleted || sourceIds.has(owner.noteId)) {
            continue;
        }

        if (rel.isAutoLink()) {
            if (!rewriteNoteContent(owner, source.noteId, target, revised, journal)) {
                retargetOne(rel, target, journal);
            }
            continue;
        }

        retargetOne(rel, target, journal);
    }
}

function retargetOne(rel: BAttribute, target: BNote, journal: MergeUndo) {
    const owner = rel.note;
    /* v8 ignore next 3 -- relations reach here with a live owner */
    if (!owner || rel.isDeleted) {
        return;
    }
    /* v8 ignore next 4 -- the new note's own links are rewritten in its text */
    if (owner.noteId === target.noteId) {
        rememberDeletedRelation(rel, journal);
        rel.markAsDeleted();
        return;
    }

    const existing = owner.getOwnedAttributes(rel.type, rel.name, target.noteId);
    if (existing.length > 0) {
        const kept = existing[0];
        if (kept && rel.isInheritable && !existing.some((item) => item.isInheritable)) {
            journal.inheritableReverts.push(kept.attributeId);
            kept.isInheritable = true;
            kept.save();
        }
        rememberDeletedRelation(rel, journal);
        rel.markAsDeleted();
        return;
    }

    journal.relationRestores.push({ attributeId: rel.attributeId, value: rel.value });

    // `targetRelations` is filled when the attribute is created and is not moved when the value
    // changes, so a later delete of the old target would erase this relation.
    const previous = becca.getNote(rel.value);
    if (previous) {
        previous.targetRelations = previous.targetRelations
            .filter((item) => item.attributeId !== rel.attributeId);
    }
    rel.value = target.noteId;
    rel.save();
    if (!target.targetRelations.includes(rel)) {
        target.targetRelations.push(rel);
    }
}

function rewriteNoteContent(
    note: BNote,
    sourceNoteId: string,
    target: BNote,
    revised: Set<string>,
    journal: MergeUndo
) {
    const targetId = target.noteId;
    /* v8 ignore next 5 -- a protected note that links here is refused before this rewrite */
    if (!note.isContentAvailable()) {
        throw new ValidationError(t("merge.protected-reference", {
            title: note.getTitleOrProtected()
        }));
    }

    const content = note.getContent();
    /* v8 ignore next 3 -- an auto link is stored on a note whose content is a string */
    if (typeof content !== "string") {
        return false;
    }

    const replaced = replaceBoundedId(content, sourceNoteId, targetId);
    let updated = replaced.content;
    // An embed of the merged note is removed only from the merged note itself.
    if (note.type === "text" && note.noteId === targetId) {
        updated = removeSelfEmbeds(updated, targetId);
    }
    if (updated === content) {
        return false;
    }

    revise(note, revised);
    const saved = saveLinks(note, updated);
    const savedContent = typeof saved.content === "string" ? saved.content : updated;
    note.setContent(savedContent, { forceFrontendReload: saved.forceFrontendReload });
    // The merged note's own text stays when this note is restored, so its links are not recorded.
    if (note.noteId !== targetId) {
        const indices = replaced.indices.filter((index) =>
            savedContent.slice(index, index + targetId.length) === targetId);
        rememberLinkPatch(journal, note.noteId, indices);
    }
    return true;
}

function appendContent(target: BNote, source: BNote, sourceIds: Set<string>) {
    const sourceContent = source.getContent();
    if (typeof sourceContent !== "string") {
        if (hasPayload(source)) {
            throw new ValidationError(t("merge.incompatible-content"));
        }
        copyAttachments(source, target, "");
        return;
    }

    let fragment = replaceNoteIds(sourceContent, sourceIds, target.noteId);
    if (target.type === "text") {
        fragment = removeSelfEmbeds(fragment, target.noteId);
    }
    // A blank note can still hold files. Copy them even when there is no text to append.
    fragment = copyAttachments(source, target, fragment);

    const targetContent = target.getContent();
    if (typeof targetContent !== "string") {
        return;
    }

    let base = replaceNoteIds(targetContent, sourceIds, target.noteId);
    if (target.type === "text") {
        base = removeSelfEmbeds(base, target.noteId);
    }

    const combined = joinContent(target, source, base, fragment);
    if (combined === targetContent) {
        return;
    }

    const saved = saveLinks(target, combined);
    target.setContent(saved.content, { forceFrontendReload: saved.forceFrontendReload });
}

function joinContent(target: BNote, source: BNote, base: string, fragment: string) {
    if (isBlankStringContent(fragment, source.type)) {
        return base;
    }
    if (isBlankStringContent(base, target.type)) {
        return fragment;
    }
    if (target.type === "text") {
        return `${base}<hr><h2>${escapeHtml(source.title)}</h2>${fragment}`;
    }
    if (isMarkdownMime(target.mime)) {
        const heading = source.title.replace(/\s+/g, " ").trim();
        return `${base}\n\n## ${heading}\n\n${fragment}`;
    }
    return `${base}\n\n${fragment}`;
}

function copyAttachments(source: BNote, target: BNote, fragment: string) {
    let result = fragment;
    for (const attachment of source.getAttachments()) {
        // The history belongs to the merged note. A note created from this one does not inherit it,
        // and the copy the merged text points at stays even after the original note is restored.
        if (isMergeHistoryRole(attachment.role)) {
            continue;
        }
        const copy = attachment.copy();
        copy.ownerId = target.noteId;
        copy.setContent(attachment.getContent(), { forceSave: true });
        /* v8 ignore next 3 -- saving the copy assigns an id */
        if (!attachment.attachmentId || !copy.attachmentId) {
            continue;
        }

        result = result.replaceAll(
            `attachments/${attachment.attachmentId}`,
            `attachments/${copy.attachmentId}`
        );
        result = result.replaceAll(
            `attachmentId=${attachment.attachmentId}`,
            `attachmentId=${copy.attachmentId}`
        );
        result = result.replaceAll(
            `data-attachment-id="${attachment.attachmentId}"`,
            `data-attachment-id="${copy.attachmentId}"`
        );
    }
    return result;
}

function replaceNoteIds(content: string, fromIds: Iterable<string>, toId: string) {
    let result = content;
    for (const fromId of fromIds) {
        result = replaceBoundedId(result, fromId, toId).content;
    }
    return result;
}

/** Replaces `fromId` and reports where `toId` now stands in the result. */
function replaceBoundedId(content: string, fromId: string, toId: string) {
    /* v8 ignore next 3 -- a source id and the new note's id differ */
    if (fromId === toId) {
        return { content, indices: [] as number[] };
    }
    const pattern = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(fromId)}(?![A-Za-z0-9_])`, "g");
    const indices: number[] = [];
    let cursor = 0;
    let result = "";
    for (const match of content.matchAll(pattern)) {
        const start = match.index;
        result += content.slice(cursor, start);
        indices.push(result.length);
        result += toId;
        cursor = start + match[0].length;
    }
    result += content.slice(cursor);
    return { content: result, indices };
}

function removeSelfEmbeds(content: string, noteId: string) {
    const id = escapeRegExp(noteId);
    const pattern = new RegExp(
        "<(figure|section)\\b"
        + `(?=[^>]*\\bclass="[^"]*\\binclude-note\\b)`
        + `(?=[^>]*\\bdata-note-id="${id}")[^>]*>[\\s\\S]*?<\\/\\1>`,
        "gi"
    );
    return content.replace(pattern, "");
}

function revise(note: BNote, revised: Set<string>, description = t("merge.revision-description")) {
    if (revised.has(note.noteId)) {
        return;
    }
    revised.add(note.noteId);
    if (note.type === "file" || note.type === "image" || note.isLabelTruthy("disableVersioning")) {
        return;
    }
    note.saveRevision({ description, source: "manual" });
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The newest history entry whose original note still has a row, or -1 when none do. */
function newestRestorableIndex(stack: MergeUndo[]) {
    for (let index = stack.length - 1; index >= 0; index--) {
        const entry = stack[index];
        if (entry && sourceNoteRemains(entry.sourceNoteId)) {
            return index;
        }
    }
    return -1;
}

/** A soft-deleted note can be restored. An erased one, whose row is gone, cannot. */
function sourceNoteRemains(noteId: string) {
    return !!getSql().getRowOrNull<{ noteId: string }>(
        "SELECT noteId FROM notes WHERE noteId = ?",
        [ noteId ]
    );
}

function anotherEntryClaims(
    stack: MergeUndo[],
    record: MergeUndo,
    field: "createdBranchIds" | "createdAttributeIds",
    id: string
) {
    for (const entry of stack) {
        if (entry === record) {
            continue;
        }
        if (entry[field].includes(id)) {
            return true;
        }
    }
    return false;
}

function rememberId(ids: string[], id: string) {
    if (!ids.includes(id)) {
        ids.push(id);
    }
}

function remapCarriedEntry(entry: MergeUndo, carriedIds: CarriedIds) {
    entry.createdBranchIds = remapIdList(entry.createdBranchIds, carriedIds.branches);
    entry.createdAttributeIds = remapIdList(entry.createdAttributeIds, carriedIds.attributes);
    entry.inheritableReverts = remapIdList(entry.inheritableReverts, carriedIds.attributes);
    entry.prefixRestores = entry.prefixRestores.map((change) => ({
        branchId: carriedIds.branches.get(change.branchId) ?? change.branchId,
        prefix: change.prefix
    }));
}

function remapIdList(ids: string[], map: Map<string, string>) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const id of ids) {
        const next = map.get(id) ?? id;
        if (seen.has(next)) {
            continue;
        }
        seen.add(next);
        result.push(next);
    }
    return result;
}

function emptyJournal(note: BNote): MergeUndo {
    return {
        id: randomString(12),
        utcDate: dateUtils.utcNowDateTime(),
        sourceTitle: note.getTitleOrProtected(),
        sourceNoteId: note.noteId,
        createdBranchIds: [],
        prefixRestores: [],
        createdAttributeIds: [],
        inheritableReverts: [],
        relationRestores: [],
        deletedRelations: [],
        linkPatches: []
    };
}

function rememberLinkPatch(journal: MergeUndo, noteId: string, indices: number[]) {
    if (indices.length === 0) {
        return;
    }
    const existing = journal.linkPatches.find((patch) => patch.noteId === noteId);
    /* v8 ignore next 4 -- each source has its own journal and rewrites a note once */
    if (existing) {
        existing.indices.push(...indices);
        return;
    }
    journal.linkPatches.push({ noteId, indices });
}

/**
 * Puts `record`'s note back beside `merged`.
 *
 * `merged` keeps its text, title and place. Children, copied attributes and links that came from
 * the restored note move back with it. A copied attachment stays, because the merged text still
 * points at it.
 */
function restoreMergedNote(merged: BNote, record: MergeUndo, stack: MergeUndo[]) {
    const row = getSql().getRowOrNull<{ isDeleted: number }>(
        "SELECT isDeleted FROM notes WHERE noteId = ?",
        [ record.sourceNoteId ]
    );
    if (!row) {
        throw new ValidationError(t("merge.undo-expired"));
    }

    if (row.isDeleted) {
        const taskContext = new TaskContext("no-progress-reporting", "undeleteNotes", null);
        const fallback = merged.getStrongParentBranches()[0]?.parentNoteId;
        const result = noteService.undeleteNote(
            record.sourceNoteId,
            taskContext,
            fallback ? { fallbackParentNoteId: fallback } : {}
        );
        /* v8 ignore next 3 -- undelete is given the merged note's parent as a fallback */
        if (!result.undeleted) {
            throw new ValidationError(t("merge.undo-expired"));
        }
    }

    const restored = becca.getNote(record.sourceNoteId);
    for (const branchId of record.createdBranchIds) {
        const branch = becca.getBranch(branchId);
        if (!branch || branch.isDeleted) {
            continue;
        }
        const child = branch.getNote();
        if (!child || child.isDeleted) {
            continue;
        }
        if (restored && !child.getParentBranches()
            .some((item) => item.parentNoteId === restored.noteId)) {
            new BBranch({
                noteId: child.noteId,
                parentNoteId: restored.noteId,
                prefix: branch.prefix,
                notePosition: branch.notePosition,
                isExpanded: branch.isExpanded
            }).save();
        }
        // Another original that is still merged also supplied this child, so the child stays.
        if (anotherEntryClaims(stack, record, "createdBranchIds", branchId)) {
            continue;
        }
        const others = child.getStrongParentBranches()
            .filter((item) => item.branchId !== branch.branchId);
        if (!branch.isWeak && others.length === 0) {
            continue;
        }
        branch.deleteBranch();
    }

    for (const change of record.prefixRestores) {
        const branch = becca.getBranch(change.branchId);
        if (!branch || branch.isDeleted) {
            continue;
        }
        branch.prefix = change.prefix;
        branch.save();
    }

    for (const attributeId of record.createdAttributeIds) {
        if (anotherEntryClaims(stack, record, "createdAttributeIds", attributeId)) {
            continue;
        }
        const attribute = becca.getAttribute(attributeId);
        if (attribute && !attribute.isDeleted) {
            attribute.markAsDeleted();
        }
    }

    for (const attributeId of record.inheritableReverts) {
        const attribute = becca.getAttribute(attributeId);
        if (!attribute || attribute.isDeleted) {
            continue;
        }
        attribute.isInheritable = false;
        attribute.save();
    }

    for (const change of record.relationRestores) {
        restoreRelationValue(change.attributeId, change.value);
    }

    for (const deleted of record.deletedRelations) {
        const owner = becca.getNote(deleted.noteId);
        if (!owner || owner.isDeleted) {
            continue;
        }
        owner.addAttribute(
            "relation", deleted.name, deleted.value, deleted.isInheritable, deleted.position
        );
    }

    for (const patch of record.linkPatches) {
        if (patch.noteId === merged.noteId) {
            continue;
        }
        const note = becca.getNote(patch.noteId);
        if (!note || note.isDeleted || !note.isContentAvailable()) {
            continue;
        }
        const content = note.getContent();
        if (typeof content !== "string") {
            continue;
        }
        const updated = revertIdAt(content, patch.indices, merged.noteId, record.sourceNoteId);
        if (updated === content) {
            continue;
        }
        const saved = saveLinks(note, updated);
        note.setContent(saved.content, { forceFrontendReload: saved.forceFrontendReload });
    }
}

function revertIdAt(content: string, indices: number[], fromId: string, toId: string) {
    const ordered = [ ...indices ].sort((left, right) => right - left);
    let result = content;
    for (const index of ordered) {
        if (result.slice(index, index + fromId.length) !== fromId) {
            continue;
        }
        result = result.slice(0, index) + toId + result.slice(index + fromId.length);
    }
    return result;
}

function rememberDeletedRelation(rel: BAttribute, journal: MergeUndo) {
    journal.deletedRelations.push({
        noteId: rel.noteId,
        name: rel.name,
        value: rel.value,
        isInheritable: rel.isInheritable,
        position: rel.position
    });
}

/**
 * `targetRelations` is filled when the attribute is created and is not moved when the value
 * changes, so the value has to be moved back by hand.
 */
function restoreRelationValue(attributeId: string, value: string) {
    const rel = becca.getAttribute(attributeId);
    if (!rel || rel.isDeleted) {
        return;
    }
    const current = becca.getNote(rel.value);
    if (current) {
        current.targetRelations = current.targetRelations
            .filter((item) => item.attributeId !== rel.attributeId);
    }
    rel.value = value;
    rel.save();
    const next = becca.getNote(value);
    if (next && !next.targetRelations.includes(rel)) {
        next.targetRelations.push(rel);
    }
}

function readUndoStack(target: BNote): MergeUndo[] {
    const existing = target.getAttachments().find((item) => item.role === MERGE_UNDO_ROLE);
    if (!existing) {
        return [];
    }
    if (!existing.isContentAvailable()) {
        throw new ValidationError(t("merge.protected"));
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(decodeUtf8(existing.getContent()));
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) {
        return [];
    }

    const stack: MergeUndo[] = [];
    for (const item of parsed) {
        if (isMergeUndo(item)) {
            stack.push(item);
        }
    }
    return stack;
}

function writeUndoStack(target: BNote, stack: MergeUndo[]) {
    const existing = target.getAttachments().find((item) => item.role === MERGE_UNDO_ROLE);
    if (stack.length === 0) {
        if (existing) {
            existing.markAsDeleted();
        }
        return;
    }

    const content = JSON.stringify(stack);
    if (existing) {
        existing.setContent(content, { forceSave: true });
        return;
    }

    const attachment = new BAttachment({
        ownerId: target.noteId,
        role: MERGE_UNDO_ROLE,
        mime: "application/json",
        title: "Merge undo",
        isProtected: target.isProtected
    });
    attachment.setContent(content, { forceSave: true });
}

function isMergeUndo(value: unknown): value is MergeUndo {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value as MergeUndo;
    return typeof record.id === "string"
        && typeof record.utcDate === "string"
        && typeof record.sourceTitle === "string"
        && typeof record.sourceNoteId === "string"
        && Array.isArray(record.createdBranchIds)
        && Array.isArray(record.prefixRestores)
        && Array.isArray(record.createdAttributeIds)
        && Array.isArray(record.inheritableReverts)
        && Array.isArray(record.relationRestores)
        && Array.isArray(record.deletedRelations)
        && Array.isArray(record.linkPatches);
}

