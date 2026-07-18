/**
 * Image service for saving and updating images.
 * Uses ImageProvider for platform-specific processing (compression, format detection).
 */

import sanitizeFilename from "sanitize-filename";

import becca from "../becca/becca.js";
import { getContext } from "./context.js";
import { getLog } from "./log.js";
import { getImageProvider } from "./image_provider.js";
import noteService from "./notes.js";
import protectedSessionService from "./protected_session.js";
import { getSql } from "./sql/index.js";
import { sanitizeHtml } from "./sanitizer.js";

function getImageMimeFromExtension(ext: string): string {
    ext = ext.toLowerCase();
    return `image/${ext === "svg" ? "svg+xml" : ext}`;
}

function updateImage(noteId: string, uploadBuffer: Uint8Array, originalName: string): void {
    getLog().info(`Updating image ${noteId}: ${originalName}`);

    originalName = sanitizeHtml(originalName);

    const note = becca.getNote(noteId);
    if (!note) {
        throw new Error("Unable to find note.");
    }

    note.saveRevision();
    note.setLabel("originalFileName", originalName);

    // Process image asynchronously
    getImageProvider().processImage(uploadBuffer, originalName, true).then(({ buffer, format }) => {
        getContext().init(() => {
            getSql().transactional(() => {
                note.mime = getImageMimeFromExtension(format.ext);
                note.save();
                note.setContent(buffer);
            });
        });
    });
}

function saveImage(
    parentNoteId: string,
    uploadBuffer: Uint8Array,
    originalName: string,
    shrinkImageSwitch: boolean,
    trimFilename = false
): { fileName: string; note: ReturnType<typeof noteService.createNewNote>["note"]; noteId: string; url: string } {
    getLog().info(`Saving image ${originalName} into parent ${parentNoteId}`);

    if (trimFilename && originalName.length > 40) {
        originalName = "image";
    }

    const fileName = sanitizeFilename(originalName);
    const parentNote = becca.getNote(parentNoteId);
    if (!parentNote) {
        throw new Error("Unable to find parent note.");
    }

    const { note } = noteService.createNewNote({
        parentNoteId,
        title: fileName,
        type: "image",
        mime: "unknown",
        content: "",
        isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
    });

    note.addLabel("originalFileName", originalName);

    // Process image asynchronously
    getImageProvider().processImage(uploadBuffer, originalName, shrinkImageSwitch).then(({ buffer, format }) => {
        getContext().init(() => {
            getSql().transactional(() => {
                note.mime = getImageMimeFromExtension(format.ext);

                if (!originalName.includes(".")) {
                    originalName += `.${format.ext}`;
                    note.setLabel("originalFileName", originalName);
                    note.title = sanitizeFilename(originalName);
                }

                note.setContent(buffer, { forceSave: true });
            });
        });
    });

    return {
        fileName,
        note,
        noteId: note.noteId,
        url: `api/images/${note.noteId}/${encodeURIComponent(fileName)}`
    };
}

function saveImageToAttachment(
    noteId: string,
    uploadBuffer: Uint8Array,
    originalName: string,
    shrinkImageSwitch?: boolean,
    trimFilename = false
): { attachmentId: string | undefined; title: string } {
    getLog().info(`Saving image '${originalName}' as attachment into note '${noteId}'`);

    if (trimFilename && originalName.length > 40) {
        originalName = "image";
    }

    const fileName = sanitizeFilename(originalName);
    const note = becca.getNoteOrThrow(noteId);

    let attachment = note.saveAttachment({
        role: "image",
        mime: "unknown",
        title: fileName
    });

    // Schedule post-processing to mark unused attachments
    setTimeout(() => {
        getContext().init(() => {
            getSql().transactional(() => {
                const note = becca.getNoteOrThrow(noteId);
                noteService.asyncPostProcessContent(note, note.getContent());
            });
        });
    }, 5000);

    // Process image asynchronously
    const attachmentId = attachment.attachmentId;
    getImageProvider().processImage(uploadBuffer, originalName, !!shrinkImageSwitch).then(({ buffer, format }) => {
        getContext().init(() => {
            getSql().transactional(() => {
                if (!attachmentId) {
                    throw new Error("Missing attachment ID.");
                }
                attachment = becca.getAttachmentOrThrow(attachmentId);

                attachment.mime = getImageMimeFromExtension(format.ext);

                if (!originalName.includes(".")) {
                    originalName += `.${format.ext}`;
                    attachment.title = sanitizeFilename(originalName);
                }

                attachment.setContent(buffer, { forceSave: true });
            });
        });
    });

    return attachment;
}

export default {
    saveImage,
    saveImageToAttachment,
    updateImage
};
