import { date_utils as dateUtils, sanitize, special_notes as specialNotesService, utils } from "@triliumnext/core";
import type { Request, Response } from "express";

import imageService from "../../services/image.js";
import noteService from "../../services/notes.js";

const SAFE_TITLE_MAX = 80;

/**
 * Picks a note title from the shared `title` field, falling back to the first
 * line of the shared body, then to a generic placeholder.
 */
export function deriveTitle(rawTitle: unknown, fallbackBody: string | undefined): string {
    if (typeof rawTitle === "string" && rawTitle.trim()) {
        return rawTitle.trim().slice(0, SAFE_TITLE_MAX);
    }
    if (fallbackBody) {
        const firstLine = fallbackBody.trim().split(/\r?\n/, 1)[0] ?? "";
        if (firstLine) {
            return firstLine.slice(0, SAFE_TITLE_MAX);
        }
    }
    return "Shared content";
}

/** Builds the HTML body for a text/url share, escaping user-provided content. */
export function buildBody(text: string | undefined, url: string | undefined): string {
    const parts: string[] = [];
    if (text) {
        parts.push(`<p>${utils.escapeHtml(text).replace(/\r?\n/g, "<br>")}</p>`);
    }
    if (url) {
        const escapedUrl = utils.escapeHtml(url);
        parts.push(`<p><a href="${escapedUrl}">${escapedUrl}</a></p>`);
    }
    return parts.join("");
}

/** Returns the value if it's a non-blank string, otherwise undefined. */
export function getOptionalString(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim()) {
        return value;
    }
    return undefined;
}

/**
 * Whether shared items should be grouped under a parent note. We create a
 * parent when there's accompanying text/url, or when more than one file is
 * shared; a single lone file is placed directly in the inbox instead.
 */
export function needsContainerNote(hasText: boolean, fileCount: number): boolean {
    return hasText || fileCount > 1;
}

async function handleShare(req: Request, res: Response) {
    const inboxNote = specialNotesService.getInboxNote(dateUtils.localNowDate());

    const rawTitle = req.body?.title;
    const text = getOptionalString(req.body?.text);
    const rawUrl = getOptionalString(req.body?.url);
    const url = rawUrl ? sanitize.sanitizeUrl(rawUrl) : undefined;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    const hasText = !!(text || url);
    if (!hasText && files.length === 0) {
        res.status(400).type("text/plain").send("Nothing to share: no text, url or files were provided.");
        return;
    }

    // When there's text/url or more than one file, create a parent note that
    // holds the text/url and groups the files as children. A single lone file
    // is placed directly in the inbox.
    let containerNoteId: string | null = null;
    if (needsContainerNote(hasText, files.length)) {
        const { note } = noteService.createNewNote({
            parentNoteId: inboxNote.noteId,
            title: deriveTitle(rawTitle, text || url),
            content: buildBody(text, url) || "<p></p>",
            type: "text",
            mime: "text/html",
            isProtected: false
        });
        note.addLabel("sharedToTrilium");
        if (url) {
            note.setLabel("pageUrl", url);
        }
        containerNoteId = note.noteId;
    }

    const fileParentNoteId = containerNoteId ?? inboxNote.noteId;
    let firstFileNoteId: string | null = null;

    for (const file of files) {
        if (file.mimetype.startsWith("image/")) {
            const { note, noteId } = imageService.saveImage(
                fileParentNoteId,
                file.buffer,
                file.originalname || "image",
                true // shrinkImageSwitch: optimize shared images, matching the Sender/clipper behaviour
            );
            note.addLabel("sharedToTrilium");
            firstFileNoteId ??= noteId;
            continue;
        }

        const title = deriveTitle(file.originalname, undefined);
        const { note } = noteService.createNewNote({
            parentNoteId: fileParentNoteId,
            title,
            content: file.buffer,
            type: "file",
            mime: file.mimetype || "application/octet-stream",
            isProtected: false
        });
        note.addLabel("originalFileName", file.originalname || title);
        note.addLabel("sharedToTrilium");
        firstFileNoteId ??= note.noteId;
    }

    // Open the parent note when one was created, otherwise the lone file note.
    res.redirect(303, `/#root/${containerNoteId ?? firstFileNoteId}`);
}

export default {
    handleShare
};
