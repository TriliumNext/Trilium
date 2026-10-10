import { getShareLink } from "@triliumnext/share-theme/model/page";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import * as sanitize from "../services/sanitizer.js";
import type SAttachment from "./shaca/entities/sattachment.js";
import type SNote from "./shaca/entities/snote.js";

/**
 * Notes as the rows the client's `froca.addResp()` takes, so that a shared page builds the same
 * `FNote`s the app does, with the share link of each note in `links`.
 */
export interface FrocaRows {
    notes: ReturnType<typeof getNoteRow>[];
    branches: ReturnType<SNote["parentBranches"][number]["getPojo"]>[];
    attributes: ReturnType<SNote["ownedAttributes"][number]["getPojo"]>[];
    links: Record<string, string>;
}

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
 */
export function buildFrocaRows(roots: SNote[], canAccess: (note: SNote) => boolean = () => true): FrocaRows {
    const notes = new Map<string, SNote>();
    const add = (candidate: SNote | null | undefined) => {
        if (candidate && !candidate.isProtected && canAccess(candidate)) {
            notes.set(candidate.noteId, candidate);
        }
    };

    for (const root of roots) {
        add(root);
        for (const child of root.getVisibleChildNotes()) {
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
            const { attributeId, noteId, type, name, value, position, isInheritable } = attribute;
            rows.attributes.push({ attributeId, noteId, type, name, value, position, isInheritable: !!isInheritable });
        }
    }

    for (const included of notes.values()) {
        rows.notes.push(getNoteRow(included));
        rows.links[included.noteId] = getShareLink(included, sanitize.sanitizeUrl).href;
        for (const branch of included.parentBranches) {
            if (notes.has(branch.parentNoteId)) {
                rows.branches.push(branch.getPojo());
            }
        }
        for (const attribute of included.ownedAttributes) {
            if (attribute.name === "shareCredentials") {
                continue;
            }
            if (attribute.type === "label" || notes.has(attribute.value) || templates.has(attribute.value)) {
                rows.attributes.push(attribute.getPojo());
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
