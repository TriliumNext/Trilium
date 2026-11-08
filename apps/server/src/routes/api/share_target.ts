import { isAcceptedImageMime } from "@triliumnext/commons";
import { type BNote, date_utils as dateUtils, getSql, note_service as noteService, protected_session as protectedSessionService, sanitize, special_notes as specialNotesService, utils } from "@triliumnext/core";
import type { NextFunction, Request, Response } from "express";
import { readFileSync } from "fs";
import { t } from "i18next";

import imageService from "../../services/image.js";

const SAFE_TITLE_MAX = 80;

/**
 * Turns a Web Share Target POST into notes in the inbox and redirects to the note it created.
 * The manifest's `share_target` sends `title`, `text`, `url` and `files`.
 */
async function handleShare(req: Request, res: Response) {
    const text = getOptionalString(req.body?.text);
    const rawUrl = getOptionalString(req.body?.url);
    const url = rawUrl ? sanitize.sanitizeUrl(rawUrl) : undefined;
    const files = req.files as Express.Multer.File[];

    if (!text && !url && files.length === 0) {
        res.status(400).type("text/plain").send(t("share_target.nothing-to-share"));
        return;
    }

    const { openNote, imageNoteIds } = getSql().transactional(() => saveShare(req.body?.title, text, url, files));

    // The redirect opens the note at once, so its images must be stored by then.
    await Promise.all(imageNoteIds.map((noteId) => imageService.awaitImageWrite(noteId)));

    res.redirect(303, `./#${openNote.getBestNotePathString()}`);
}

/**
 * Rejects a form that another page posts to `/share-target`. The route takes no CSRF token, and the
 * `SameSite=Lax` session cookie still reaches it from a page on the same site (another subdomain).
 * The share sheet's navigation is browser-initiated, so it arrives as `Sec-Fetch-Site: none`.
 */
function rejectOtherPages(req: Request, res: Response, next: NextFunction) {
    const site = req.headers["sec-fetch-site"];
    if (site === "same-site" || site === "cross-site") {
        res.status(403).type("text/plain").send(t("share_target.other-page"));
        return;
    }
    next();
}

/**
 * Creates the shared notes. Text, a URL or several files go into a new text note; a single file
 * without text goes straight into the inbox.
 */
function saveShare(rawTitle: unknown, text: string | undefined, url: string | undefined, files: Express.Multer.File[]) {
    const inboxNote = specialNotesService.getInboxNote(dateUtils.localNowDate());
    const hasText = !!(text || url);
    const imageNoteIds: string[] = [];

    let containerNote: BNote | undefined;
    if (needsContainerNote(hasText, files.length)) {
        ({ note: containerNote } = noteService.createNewNote({
            parentNoteId: inboxNote.noteId,
            title: deriveTitle(rawTitle, text || url),
            content: buildBody(text, url) || "<p></p>",
            type: "text",
            mime: "text/html",
            isProtected: isProtectedUnder(inboxNote)
        }));
        containerNote.addLabel("clipType", "share");
        if (url) {
            containerNote.setLabel("pageUrl", url);
        }
    }

    const fileParent = containerNote ?? inboxNote;
    const fileNotes: BNote[] = [];

    for (const file of files) {
        const content = readFileSync(file.path);
        const originalName = file.originalname;
        let note: BNote;

        if (isAcceptedImageMime(file.mimetype)) {
            ({ note } = imageService.saveImage(fileParent.noteId, content, originalName, true));
            imageNoteIds.push(note.noteId);
        } else {
            ({ note } = noteService.createNewNote({
                parentNoteId: fileParent.noteId,
                title: deriveTitle(originalName, undefined),
                content,
                type: "file",
                mime: file.mimetype,
                isProtected: isProtectedUnder(fileParent)
            }));
            note.addLabel("originalFileName", originalName);
        }

        note.addLabel("clipType", "share");
        fileNotes.push(note);
    }

    // Without a parent note there is exactly one file: handleShare() refuses an empty share.
    const openNote = containerNote ?? fileNotes[0];
    return { openNote, imageNoteIds };
}

function isProtectedUnder(parentNote: BNote) {
    return parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable();
}

/**
 * Picks a note title from the shared `title` field, falling back to the first line of the shared
 * body, then to a generic placeholder.
 */
export function deriveTitle(rawTitle: unknown, fallbackBody: string | undefined): string {
    if (typeof rawTitle === "string" && rawTitle.trim()) {
        return rawTitle.trim().slice(0, SAFE_TITLE_MAX);
    }
    if (fallbackBody) {
        const [ firstLine ] = fallbackBody.trim().split(/\r?\n/, 1);
        if (firstLine) {
            return firstLine.slice(0, SAFE_TITLE_MAX);
        }
    }
    return t("share_target.default-title");
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

/** Whether the shared items need a parent note: there is text or a URL, or more than one file. */
export function needsContainerNote(hasText: boolean, fileCount: number): boolean {
    return hasText || fileCount > 1;
}

export default {
    handleShare,
    rejectOtherPages
};
