

import { sanitize } from "@triliumnext/core";
import imageType from "image-type";
import isAnimated from "is-animated";
import isSvg from "is-svg";
import { Jimp } from "jimp";
import sanitizeFilename from "sanitize-filename";

import becca from "../becca/becca.js";
import log from "./log.js";
import noteService from "./notes.js";
import optionService from "./options.js";
import protectedSessionService from "./protected_session.js";
import sql from "./sql.js";

async function processImage(uploadBuffer: Buffer, originalName: string, shrinkImageSwitch: boolean) {
    const compressImages = optionService.getOptionBool("compressImages");
    const origImageFormat = await getImageType(uploadBuffer);

    if (!origImageFormat || !["jpg", "png"].includes(origImageFormat.ext)) {
        shrinkImageSwitch = false;
    } else if (isAnimated(uploadBuffer)) {
        // recompression of animated images will make them static
        shrinkImageSwitch = false;
    }

    let finalImageBuffer;
    let imageFormat;

    if (compressImages && shrinkImageSwitch) {
        finalImageBuffer = await shrinkImage(uploadBuffer, originalName);
        imageFormat = await getImageType(finalImageBuffer);
    } else {
        finalImageBuffer = uploadBuffer;
        imageFormat = origImageFormat || {
            ext: "dat"
        };
    }

    return {
        buffer: finalImageBuffer,
        imageFormat
    };
}

async function getImageType(buffer: Buffer) {
    if (isSvg(buffer.toString())) {
        return { ext: "svg" };
    } 
    return (await imageType(buffer)) || { ext: "jpg" }; // optimistic JPG default
    
}

function getImageMimeFromExtension(ext: string) {
    ext = ext.toLowerCase();

    return `image/${ext === "svg" ? "svg+xml" : ext}`;
}

function updateImage(noteId: string, uploadBuffer: Buffer, originalName: string) {
    log.info(`Updating image ${noteId}: ${originalName}`);

    originalName = sanitize.sanitizeHtml(originalName);

    const note = becca.getNote(noteId);
    if (!note) {
        throw new Error("Unable to find note.");
    }

    note.saveRevision();

    note.setLabel("originalFileName", originalName);

    // resizing images asynchronously since JIMP does not support sync operation
    processImage(uploadBuffer, originalName, true).then(({ buffer, imageFormat }) => {
        sql.transactional(() => {
            note.mime = getImageMimeFromExtension(imageFormat.ext);
            note.save();

            note.setContent(buffer);
        });
    });
}

function saveImage(parentNoteId: string, uploadBuffer: Buffer, originalName: string, shrinkImageSwitch: boolean, trimFilename = false) {
    log.info(`Saving image ${originalName} into parent ${parentNoteId}`);

    if (trimFilename && originalName.length > 40) {
        // https://github.com/zadam/trilium/issues/2307
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

    // resizing images asynchronously since JIMP does not support sync operation
    processImage(uploadBuffer, originalName, shrinkImageSwitch).then(({ buffer, imageFormat }) => {
        sql.transactional(() => {
            note.mime = getImageMimeFromExtension(imageFormat.ext);

            if (!originalName.includes(".")) {
                originalName += `.${imageFormat.ext}`;

                note.setLabel("originalFileName", originalName);
                note.title = sanitizeFilename(originalName);
            }

            note.setContent(buffer, { forceSave: true });
        });
    });

    return {
        fileName,
        note,
        noteId: note.noteId,
        url: `api/images/${note.noteId}/${encodeURIComponent(fileName)}`
    };
}

function saveImageToAttachment(noteId: string, uploadBuffer: Buffer, originalName: string, shrinkImageSwitch?: boolean, trimFilename = false) {
    log.info(`Saving image '${originalName}' as attachment into note '${noteId}'`);

    if (trimFilename && originalName.length > 40) {
        // https://github.com/zadam/trilium/issues/2307
        originalName = "image";
    }

    const fileName = sanitizeFilename(originalName);
    const note = becca.getNoteOrThrow(noteId);

    let attachment = note.saveAttachment({
        role: "image",
        mime: "unknown",
        title: fileName
    });

    // TODO: this is a quick-fix solution of a recursive bug - this is called from asyncPostProcessContent()
    //       find some async way to do this - perhaps some global timeout with a Set of noteIds needing one more
    //       run of asyncPostProcessContent
    setTimeout(() => {
        sql.transactional(() => {
            const note = becca.getNoteOrThrow(noteId);
            noteService.asyncPostProcessContent(note, note.getContent()); // to mark an unused attachment for deletion
        });
    }, 5000);

    // resizing images asynchronously since JIMP does not support sync operation
    processImage(uploadBuffer, originalName, !!shrinkImageSwitch).then(({ buffer, imageFormat }) => {
        sql.transactional(() => {
            // re-read, might be changed in the meantime
            if (!attachment.attachmentId) {
                throw new Error("Missing attachment ID.");
            }
            attachment = becca.getAttachmentOrThrow(attachment.attachmentId);

            attachment.mime = getImageMimeFromExtension(imageFormat.ext);

            if (!originalName.includes(".")) {
                originalName += `.${imageFormat.ext}`;
                attachment.title = sanitizeFilename(originalName);
            }

            attachment.setContent(buffer, { forceSave: true });
        });
    });

    return attachment;
}

async function shrinkImage(buffer: Buffer, originalName: string) {
    let jpegQuality = optionService.getOptionInt("imageJpegQuality", 0);

    if (jpegQuality < 10 || jpegQuality > 100) {
        jpegQuality = 75;
    }

    let finalImageBuffer;
    try {
        finalImageBuffer = await resize(buffer, jpegQuality);
    } catch (e: any) {
        log.error(`Failed to resize image '${originalName}', stack: ${e.stack}`);

        finalImageBuffer = buffer;
    }

    // if resizing did not help with size, then save the original
    // (can happen when e.g., resizing PNG into JPEG)
    if (finalImageBuffer.byteLength >= buffer.byteLength) {
        finalImageBuffer = buffer;
    }

    return finalImageBuffer;
}

async function resize(buffer: Buffer, quality: number) {
    const imageMaxWidthHeight = optionService.getOptionInt("imageMaxWidthHeight");

    const start = Date.now();

    const image = await Jimp.read(buffer);

    if (image.bitmap.width > image.bitmap.height && image.bitmap.width > imageMaxWidthHeight) {
        image.resize({ w: imageMaxWidthHeight });
    } else if (image.bitmap.height > imageMaxWidthHeight) {
        image.resize({ h: imageMaxWidthHeight });
    }

    // when converting PNG to JPG, we lose the alpha channel, this is replaced by white to match Trilium white background
    image.background = 0xffffffff;

    const resultBuffer = await image.getBuffer("image/jpeg", { quality });

    log.info(`Resizing image of ${resultBuffer.byteLength} took ${Date.now() - start}ms`);

    return resultBuffer;
}

export default {
    saveImage,
    saveImageToAttachment,
    updateImage
};
