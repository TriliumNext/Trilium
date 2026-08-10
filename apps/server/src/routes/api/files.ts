import { ValidationError, ws } from "@triliumnext/core";
import chokidar from "chokidar";
import type { Request } from "express";
import fs from "fs";
import path from "path";
import tmp from "tmp";

import { becca } from "@triliumnext/core";
import dataDirs from "../../services/data_dir.js";
import { getLog } from "@triliumnext/core";
import utils from "../../services/utils.js";

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
    saveNoteToTmpDir,
    saveAttachmentToTmpDir,
    uploadModifiedFileToNote,
    uploadModifiedFileToAttachment
};
