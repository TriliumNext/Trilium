import { note_service as noteService, ValidationError, ws } from "@triliumnext/core";
import chokidar from "chokidar";
import type { Request } from "express";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import tmp from "tmp";

import { becca } from "@triliumnext/core";
import dataDirs from "../../services/data_dir.js";
import { getLog } from "@triliumnext/core";
import utils from "../../services/utils.js";

function updateFile(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    const file = req.file;
    if (!file) {
        return {
            uploaded: false,
            message: `Missing file.`
        };
    }

    if (req.query.replace !== "1") {
        note.saveRevision();
    }

    note.mime = file.mimetype.toLowerCase();
    note.save();

    note.setContent(file.buffer);

    note.setLabel("originalFileName", file.originalname);

    void noteService.asyncPostProcessContent(note, file.buffer);

    return {
        uploaded: true
    };
}

function updateAttachment(req: Request<{ attachmentId: string }>) {
    const attachment = becca.getAttachmentOrThrow(req.params.attachmentId);
    const file = req.file;
    if (!file) {
        return {
            uploaded: false,
            message: `Missing file.`
        };
    }

    attachment.getNote().saveRevision();

    attachment.mime = file.mimetype.toLowerCase();
    attachment.setContent(file.buffer, { forceSave: true });

    return {
        uploaded: true
    };
}

function fileContentProvider(req: Request<{ noteId: string }>) {
    // Read the file name from route params.
    const note = becca.getNoteOrThrow(req.params.noteId);

    // blobId is a content hash, so it's a stable ETag that changes only when the content does.
    return streamContent(note.getContent(), note.getFileName(), note.mime, note.blobId);
}

function attachmentContentProvider(req: Request<{ attachmentId: string }>) {
    // Read the file name from route params.
    const attachment = becca.getAttachmentOrThrow(req.params.attachmentId);

    return streamContent(attachment.getContent(), attachment.getFileName(), attachment.mime, attachment.blobId);
}

async function streamContent(content: string | Uint8Array, fileName: string, mimeType: string, etag?: string) {
    if (typeof content === "string") {
        content = Buffer.from(content, "utf8");
    }

    const totalSize = content.byteLength;

    const getStream = (range: { start: number; end: number }) => {
        if (!range) {
            // Request if for complete content.
            return Readable.from(content);
        }
        // Partial content request.
        const { start, end } = range;

        return Readable.from(content.slice(start, end + 1));
    };

    return {
        fileName,
        totalSize,
        mimeType,
        etag,
        getStream
    };
}

function saveNoteToTmpDir(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);
    const fileName = note.getFileName();
    const content = note.getContent();

    return saveToTmpDir(fileName, content, "notes", note.noteId);
}

function saveAttachmentToTmpDir(req: Request<{ attachmentId: string }>) {
    const attachment = becca.getAttachmentOrThrow(req.params.attachmentId);
    const fileName = attachment.getFileName();
    const content = attachment.getContent();

    if (!attachment.attachmentId) {
        throw new ValidationError("Missing attachment ID.");
    }
    return saveToTmpDir(fileName, content, "attachments", attachment.attachmentId);
}

const createdTemporaryFiles = new Set<string>();

function saveToTmpDir(fileName: string, content: string | Uint8Array, entityType: string, entityId: string) {
    const tmpObj = tmp.fileSync({
        postfix: fileName,
        tmpdir: dataDirs.TMP_DIR
    });

    if (typeof content === "string") {
        fs.writeSync(tmpObj.fd, content);
    } else {
        fs.writeSync(tmpObj.fd, content);
    }

    fs.closeSync(tmpObj.fd);

    createdTemporaryFiles.add(tmpObj.name);

    getLog().info(`Saved temporary file ${tmpObj.name}`);

    if (utils.isElectron) {
        chokidar.watch(tmpObj.name).on("change", (path, stats) => {
            ws.sendMessageToAllClients({
                type: "openedFileUpdated",
                entityType,
                entityId,
                lastModifiedMs: stats?.atimeMs,
                filePath: tmpObj.name
            });
        });
    }

    return {
        tmpFilePath: tmpObj.name
    };
}

/**
 * Validates that the given file path is a known temporary file created by this server
 * and resides within the expected temporary directory. This prevents path traversal
 * attacks (CWE-22) where an attacker could read arbitrary files from the filesystem.
 */
function validateTemporaryFilePath(filePath: string): void {
    if (!filePath || typeof filePath !== "string") {
        throw new ValidationError("Missing or invalid file path.");
    }

    // Check 1: The file must be in our set of known temporary files created by saveToTmpDir().
    if (!createdTemporaryFiles.has(filePath)) {
        throw new ValidationError(`File '${filePath}' is not a tracked temporary file.`);
    }

    // Check 2 (defense-in-depth): Resolve to an absolute path and verify it is within TMP_DIR.
    // This guards against any future bugs where a non-temp path could end up in the set.
    const resolvedPath = path.resolve(filePath);
    const resolvedTmpDir = path.resolve(dataDirs.TMP_DIR);

    if (!resolvedPath.startsWith(resolvedTmpDir + path.sep) && resolvedPath !== resolvedTmpDir) {
        throw new ValidationError(`File path '${filePath}' is outside the temporary directory.`);
    }
}

function uploadModifiedFileToNote(req: Request<{ noteId: string }>) {
    const noteId = req.params.noteId;
    const { filePath } = req.body;

    validateTemporaryFilePath(filePath);

    const note = becca.getNoteOrThrow(noteId);

    getLog().info(`Updating note '${noteId}' with content from '${filePath}'`);

    note.saveRevision();

    const fileContent = fs.readFileSync(filePath);

    if (!fileContent) {
        throw new ValidationError(`File '${fileContent}' is empty`);
    }

    note.setContent(fileContent);
}

function uploadModifiedFileToAttachment(req: Request<{ attachmentId: string }>) {
    const { attachmentId } = req.params;
    const { filePath } = req.body;

    validateTemporaryFilePath(filePath);

    const attachment = becca.getAttachmentOrThrow(attachmentId);

    getLog().info(`Updating attachment '${attachmentId}' with content from '${filePath}'`);

    attachment.getNote().saveRevision();

    const fileContent = fs.readFileSync(filePath);

    if (!fileContent) {
        throw new ValidationError(`File '${fileContent}' is empty`);
    }

    attachment.setContent(fileContent);
}

export default {
    updateFile,
    updateAttachment,
    fileContentProvider,
    saveNoteToTmpDir,
    saveAttachmentToTmpDir,
    attachmentContentProvider,
    uploadModifiedFileToNote,
    uploadModifiedFileToAttachment
};
