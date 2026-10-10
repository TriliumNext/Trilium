import { getShareLink } from "@triliumnext/share-theme/model/page";

import becca from "../becca/becca.js";
import type BAttribute from "../becca/entities/battribute.js";
import type BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import * as sanitize from "../services/sanitizer.js";
import type SAttachment from "./shaca/entities/sattachment.js";
import type SAttribute from "./shaca/entities/sattribute.js";
import type SBranch from "./shaca/entities/sbranch.js";
import type SNote from "./shaca/entities/snote.js";

/**
 * Notes as the rows the client's `froca.addResp()` takes, so that a shared page builds the same
 * `FNote`s the app does, with the share link of each note in `links`.
 */
export interface FrocaRows {
    notes: ReturnType<typeof getNoteRow>[];
    branches: ReturnType<typeof getBranchRow>[];
    attributes: ReturnType<typeof getAttributeRow>[];
    links: Record<string, string>;
}

/** A note of the share, or a note of the static export, which renders becca's notes. */
type PayloadNote = SNote | BNote;

/**
 * The notes a collection view reads, embedded in its page so the view draws without a request, of
 * those that `canAccess` lets the visitor read.
 */
export function buildFrocaPayload(note: SNote, canAccess?: (note: SNote) => boolean) {
    return buildFrocaRows([ note ], canAccess);
}

/**
 * Collects `roots`, their visible children and the notes their relations point to (templates and
 * `#calendar:title` relations), with their owned attributes and the branches between them. Shaca
 * holds only shared notes, so a relation to a note outside the share is left out, as is every note
 * that is protected or that `canAccess` refuses. A built-in template such as `_template_calendar`
 * is read from becca instead, as it lives in the hidden subtree, so the notes inherit its labels.
 * `#shareCredentials` is always left out, as it holds the password of the notes.
 *
 * The roots are shaca's notes on a shared page and becca's in the static export, whose relations
 * and children are notes of the same cache. `getLink` gives the URL of each note's page, by
 * default its shared page.
 */
export function buildFrocaRows<T extends PayloadNote>(
    roots: T[],
    canAccess: (note: T) => boolean = () => true,
    getLink: (note: T) => string = (note) => getShareLink(note, sanitize.sanitizeUrl).href
): FrocaRows {
    const notes = new Map<string, T>();
    const add = (candidate: PayloadNote | null | undefined) => {
        if (candidate && !candidate.isProtected && canAccess(candidate as T)) {
            notes.set(candidate.noteId, candidate as T);
        }
    };

    for (const root of roots) {
        add(root);
        const children = root instanceof BNote ? root.getChildNotes() : root.getVisibleChildNotes();
        for (const child of children) {
            add(child);
        }
    }
    for (const owner of [ ...notes.values() ]) {
        for (const relation of owner.ownedAttributes) {
            if (relation.type === "relation") {
                add(relation.targetNote);
            }
        }
    }

    const rows: FrocaRows = { notes: [], branches: [], attributes: [], links: {} };
    const templates = new Map<string, BNote>();
    for (const owner of notes.values()) {
        for (const relation of owner.ownedAttributes) {
            const template = relation.type === "relation" && relation.value.startsWith("_template_")
                ? becca.getNote(relation.value) : null;
            if (template && !notes.has(template.noteId)) {
                templates.set(template.noteId, template);
            }
        }
    }
    for (const template of templates.values()) {
        rows.notes.push(getNoteRow(template));
        for (const attribute of template.getOwnedAttributes()) {
            rows.attributes.push(getAttributeRow(attribute));
        }
    }

    for (const included of notes.values()) {
        rows.notes.push(getNoteRow(included));
        rows.links[included.noteId] = getLink(included);
        for (const branch of included.parentBranches) {
            if (notes.has(branch.parentNoteId)) {
                rows.branches.push(getBranchRow(branch));
            }
        }
        for (const attribute of included.ownedAttributes) {
            if (attribute.name === "shareCredentials") {
                continue;
            }
            if (attribute.type === "label" || notes.has(attribute.value) || templates.has(attribute.value)) {
                rows.attributes.push(getAttributeRow(attribute));
            }
        }
    }
    return rows;
}

/** An attachment as the row `froca` reads attachments from. */
export function getAttachmentRow(attachment: SAttachment) {
    const pojo = attachment.getPojo();
    return {
        ...pojo,
        ownerId: attachment.ownerId,
        dateModified: pojo.utcDateModified,
        utcDateScheduledForErasureSince: null,
        contentLength: 0
    };
}

/** The content of a note or an attachment as the blob row `froca.getBlob()` reads. */
export function getBlobRow(entity: SNote | SAttachment) {
    const content = entity.hasStringContent() ? String(entity.getContent()) : null;
    const utcDateModified = "noteId" in entity ? entity.utcDateModified : entity.getPojo().utcDateModified;
    return {
        blobId: utcDateModified,
        content,
        contentLength: content?.length ?? 0,
        dateModified: utcDateModified,
        utcDateModified
    };
}

function getBranchRow(branch: SBranch | BBranch) {
    const { branchId, noteId, parentNoteId, notePosition, prefix, isExpanded } = branch.getPojo();
    return {
        branchId, noteId, parentNoteId, notePosition, prefix, isExpanded, fromSearchNote: false
    };
}

function getAttributeRow(attribute: SAttribute | BAttribute) {
    const { attributeId, noteId, type, name, value, position, isInheritable } = attribute.getPojo();
    return { attributeId, noteId, type, name, value, position, isInheritable: !!isInheritable };
}

function getNoteRow(note: SNote | BNote) {
    return {
        noteId: note.noteId,
        title: note.title,
        isProtected: !!note.isProtected,
        type: note.type,
        mime: note.mime,
        blobId: note.utcDateModified ?? ""
    };
}
