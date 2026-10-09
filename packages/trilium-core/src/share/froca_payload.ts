import { getShareLink } from "@triliumnext/share-theme/model/page";

import * as sanitize from "../services/sanitizer.js";
import type SNote from "./shaca/entities/snote.js";

/**
 * The notes a collection view reads, as the rows the client's `froca.addResp()` takes, so that the
 * share page builds the same `FNote`s the app does. `links` maps each note to its share link.
 */
export interface FrocaPayload {
    notes: ReturnType<typeof getNoteRow>[];
    branches: ReturnType<SNote["parentBranches"][number]["getPojo"]>[];
    attributes: ReturnType<SNote["ownedAttributes"][number]["getPojo"]>[];
    links: Record<string, string>;
}

/**
 * Collects `note`, its visible children and the notes their relations point to (templates and
 * `#calendar:title` relations), with their owned attributes and the branches between them.
 * Shaca holds only shared notes, so a relation to a note outside the share is left out.
 */
export function buildFrocaPayload(note: SNote): FrocaPayload {
    const notes = new Map<string, SNote>();
    const add = (candidate: SNote | null | undefined) => {
        if (candidate && !candidate.isProtected) {
            notes.set(candidate.noteId, candidate);
        }
    };

    add(note);
    for (const child of note.getVisibleChildNotes()) {
        add(child);
    }
    for (const owner of [ ...notes.values() ]) {
        for (const relation of owner.ownedAttributes) {
            if (relation.type === "relation") {
                add(relation.targetNote);
            }
        }
    }

    const payload: FrocaPayload = { notes: [], branches: [], attributes: [], links: {} };
    for (const included of notes.values()) {
        payload.notes.push(getNoteRow(included));
        payload.links[included.noteId] = getShareLink(included, sanitize.sanitizeUrl).href;
        for (const branch of included.parentBranches) {
            if (notes.has(branch.parentNoteId)) {
                payload.branches.push(branch.getPojo());
            }
        }
        for (const attribute of included.ownedAttributes) {
            if (attribute.type === "label" || notes.has(attribute.value)) {
                payload.attributes.push(attribute.getPojo());
            }
        }
    }
    return payload;
}

function getNoteRow(note: SNote) {
    return {
        noteId: note.noteId,
        title: note.title,
        isProtected: note.isProtected,
        type: note.type,
        mime: note.mime,
        blobId: note.utcDateModified
    };
}
