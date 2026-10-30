import { t } from "i18next";
import { parse } from "node-html-parser";

import type BNote from "../becca/entities/bnote.js";
import { ValidationError } from "../errors.js";
import noteService from "../services/notes.js";
import * as sanitize from "../services/sanitizer.js";

/** The largest content a guest save accepts, in UTF-16 code units. */
export const MAX_GUEST_CONTENT_LENGTH = 2 * 1024 * 1024;

const MAX_TITLE_LENGTH = 1000;

export type GuestSaveResult =
    | { ok: true; blobId: string }
    /** The note changed since the guest loaded it; `current` is the version the server holds. */
    | { ok: false; current: { blobId: string } };

/** Guests edit text notes, and never one the host marked read-only. */
export function isGuestEditableNote(note: BNote): boolean {
    return note.type === "text" && note.isContentAvailable() && !note.isLabelTruthy("readOnly");
}

/**
 * Runs the HTML through the sanitizer imported HTML goes through, then drops inline `data:` images
 * and includes of any element, through which content could bring in an attachment or another note.
 */
export function sanitizeGuestContent(html: string): string {
    const document = parse(sanitize.sanitizeHtml(html));

    for (const image of document.querySelectorAll("img")) {
        if ((image.getAttribute("src") ?? "").trim().toLowerCase().startsWith("data:")) {
            image.remove();
        }
    }

    for (const include of document.querySelectorAll(".include-note")) {
        include.remove();
    }

    return document.toString();
}

/**
 * Saves `content` as a guest, sanitized, with a `collab` revision when due, and only over the
 * version `baseBlobId` names. Unlike the host's saves, it leaves internal links without relations.
 */
export function updateContentAsGuest(note: BNote, content: string, baseBlobId: string | null): GuestSaveResult {
    assertGuestEditable(note);
    if (content.length > MAX_GUEST_CONTENT_LENGTH) {
        throw new ValidationError(t("share_edit.content-too-large"));
    }

    const blobId = note.blobId ?? "";
    if (baseBlobId !== null && blobId !== baseBlobId) {
        return { ok: false, current: { blobId } };
    }

    noteService.saveRevisionIfNeeded(note, "collab");
    note.setContent(sanitizeGuestContent(content));
    return { ok: true, blobId: note.blobId ?? "" };
}

/** Renames the note as a guest; a title is plain text of 1 to {@link MAX_TITLE_LENGTH} characters. */
export function updateTitleAsGuest(note: BNote, title: string): { title: string } {
    assertGuestEditable(note);
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > MAX_TITLE_LENGTH) {
        throw new ValidationError(t("share_edit.title-length", { max: MAX_TITLE_LENGTH }));
    }

    if (note.title !== cleanTitle) {
        noteService.saveRevisionIfNeeded(note, "collab");
        note.title = cleanTitle;
        note.save();
    }

    return { title: note.title };
}

function assertGuestEditable(note: BNote) {
    if (!isGuestEditableNote(note)) {
        throw new ValidationError(t("share_edit.not-editable"));
    }
}
