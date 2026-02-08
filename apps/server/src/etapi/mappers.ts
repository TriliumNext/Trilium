import type BAttachment from "../becca/entities/battachment.js";
import type BAttribute from "../becca/entities/battribute.js";
import type BBranch from "../becca/entities/bbranch.js";
import type BNote from "../becca/entities/bnote.js";
import type BRevision from "../becca/entities/brevision.js";

function mapNoteToPojo(note: BNote) {
    return {
        noteId: note.noteId,
        isProtected: note.isProtected,
        title: note.title,
        type: note.type,
        mime: note.mime,
        blobId: note.blobId,
        dateCreated: note.dateCreated,
        dateModified: note.dateModified,
        utcDateCreated: note.utcDateCreated,
        utcDateModified: note.utcDateModified,
        parentNoteIds: note.getParentNotes().map((p) => p.noteId),
        childNoteIds: note.getChildNotes().map((ch) => ch.noteId),
        parentBranchIds: note.getParentBranches().map((p) => p.branchId),
        childBranchIds: note.getChildBranches().map((ch) => ch.branchId),
        attributes: note.getAttributes().map((attr) => mapAttributeToPojo(attr))
    };
}

function mapBranchToPojo(branch: BBranch) {
    return {
        branchId: branch.branchId,
        noteId: branch.noteId,
        parentNoteId: branch.parentNoteId,
        prefix: branch.prefix,
        notePosition: branch.notePosition,
        isExpanded: branch.isExpanded,
        utcDateModified: branch.utcDateModified
    };
}

function mapAttributeToPojo(attr: BAttribute) {
    return {
        attributeId: attr.attributeId,
        noteId: attr.noteId,
        type: attr.type,
        name: attr.name,
        value: attr.value,
        position: attr.position,
        isInheritable: attr.isInheritable,
        utcDateModified: attr.utcDateModified
    };
}

function mapAttachmentToPojo(attachment: BAttachment) {
    return {
        attachmentId: attachment.attachmentId,
        ownerId: attachment.ownerId,
        role: attachment.role,
        mime: attachment.mime,
        title: attachment.title,
        position: attachment.position,
        blobId: attachment.blobId,
        dateModified: attachment.dateModified,
        utcDateModified: attachment.utcDateModified,
        utcDateScheduledForErasureSince: attachment.utcDateScheduledForErasureSince,
        contentLength: attachment.contentLength
    };
}

function mapRevisionToPojo(revision: BRevision) {
    return {
        revisionId: revision.revisionId,
        noteId: revision.noteId,
        type: revision.type,
        mime: revision.mime,
        isProtected: revision.isProtected,
        title: revision.title,
        blobId: revision.blobId,
        dateLastEdited: revision.dateLastEdited,
        dateCreated: revision.dateCreated,
        utcDateLastEdited: revision.utcDateLastEdited,
        utcDateCreated: revision.utcDateCreated,
        utcDateModified: revision.utcDateModified,
        contentLength: revision.contentLength
    };
}

export default {
    mapNoteToPojo,
    mapBranchToPojo,
    mapAttributeToPojo,
    mapAttachmentToPojo,
    mapRevisionToPojo
};
