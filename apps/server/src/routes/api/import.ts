

import type { Request } from "express";
import path from "path";

import becca from "../../becca/becca.js";
import beccaLoader from "../../becca/becca_loader.js";
import type BNote from "../../becca/entities/bnote.js";
import ValidationError from "../../errors/validation_error.js";
import cls from "../../services/cls.js";
import enexImportService from "../../services/import/enex.js";
import opmlImportService from "../../services/import/opml.js";
import singleImportService from "../../services/import/single.js";
import zipImportService from "../../services/import/zip.js";
import previewZipForImport from "../../services/import/zip_preview.js";
import log from "../../services/log.js";
import TaskContext from "../../services/task_context.js";
import { safeExtractMessageAndStackFromError } from "../../services/utils.js";

async function importNotesToBranch(req: Request) {
    const { parentNoteId } = req.params;
    const { taskId, last } = req.body;

    const options = {
        safeImport: req.body.safeImport !== "false",
        shrinkImages: req.body.shrinkImages !== "false",
        textImportedAsText: req.body.textImportedAsText !== "false",
        codeImportedAsCode: req.body.codeImportedAsCode !== "false",
        explodeArchives: req.body.explodeArchives !== "false",
        replaceUnderscoresWithSpaces: req.body.replaceUnderscoresWithSpaces !== "false"
    };

    const file = req.file;

    if (!file) {
        throw new ValidationError("No file has been uploaded");
    }

    const parentNote = becca.getNoteOrThrow(parentNoteId);

    const extension = path.extname(file.originalname).toLowerCase();

    // running all the event handlers on imported notes (and attributes) is slow
    // and may produce unintended consequences
    cls.disableEntityEvents();

    // eliminate flickering during import
    cls.ignoreEntityChangeIds();

    let note: BNote | null; // typically root of the import - client can show it after finishing the import

    const taskContext = TaskContext.getInstance(taskId, "importNotes", options);

    try {
        if (extension === ".zip" && options.explodeArchives && typeof file.buffer !== "string") {
            note = await zipImportService.importZip(taskContext, file.buffer, parentNote);
        } else if (extension === ".opml" && options.explodeArchives) {
            const importResult = await opmlImportService.importOpml(taskContext, file.buffer, parentNote);
            if (!Array.isArray(importResult)) {
                note = importResult;
            } else {
                return importResult;
            }
        } else if (extension === ".enex" && options.explodeArchives) {
            const importResult = await enexImportService.importEnex(taskContext, file, parentNote);
            if (!Array.isArray(importResult)) {
                note = importResult;
            } else {
                return importResult;
            }
        } else {
            note = await singleImportService.importSingleFile(taskContext, file, parentNote);
        }
    } catch (e: unknown) {
        const [errMessage, errStack] = safeExtractMessageAndStackFromError(e);
        const message = `Import failed with following error: '${errMessage}'. More details might be in the logs.`;
        taskContext.reportError(message);

        log.error(message + errStack);

        return [500, message];
    }

    if (!note) {
        return [500, "No note was generated as a result of the import."];
    }

    if (last === "true") {
        // small timeout to avoid race condition (the message is received before the transaction is committed)
        setTimeout(
            () =>
                taskContext.taskSucceeded({
                    parentNoteId,
                    importedNoteId: note?.noteId
                }),
            1000
        );
    }

    // import has deactivated note events so becca is not updated, instead we force it to reload
    beccaLoader.load();

    return note.getPojo();
}

function importAttachmentsToNote(req: Request) {
    const { parentNoteId } = req.params;
    const { taskId, last } = req.body;

    const options = {
        shrinkImages: req.body.shrinkImages !== "false"
    };

    const file = req.file;

    if (!file) {
        throw new ValidationError("No file has been uploaded");
    }

    const parentNote = becca.getNoteOrThrow(parentNoteId);
    const taskContext = TaskContext.getInstance(taskId, "importNotes", options);

    // unlike in note import, we let the events run, because a huge number of attachments is not likely

    try {
        singleImportService.importAttachment(taskContext, file, parentNote);
    } catch (e: unknown) {
        const [errMessage, errStack] = safeExtractMessageAndStackFromError(e);

        const message = `Import failed with following error: '${errMessage}'. More details might be in the logs.`;
        taskContext.reportError(message);

        log.error(message + errStack);

        return [500, message];
    }

    if (last === "true") {
        // small timeout to avoid race condition (the message is received before the transaction is committed)
        setTimeout(
            () =>
                taskContext.taskSucceeded({
                    parentNoteId
                }),
            1000
        );
    }
}

async function importPreview(req: Request) {
    const file = req.file;
    if (!file) {
        throw new ValidationError("No file has been uploaded");
    }

    if (!file.originalname.endsWith(".trilium")) {
        throw new ValidationError("Preview supports only .trilium files.");
    }

    await previewZipForImport(file.buffer);

    return "OK";
}

export default {
    importNotesToBranch,
    importAttachmentsToNote,
    importPreview
};
