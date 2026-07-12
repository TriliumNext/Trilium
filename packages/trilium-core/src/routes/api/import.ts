import type { Request } from "express";

import type { File } from "../../services/import/common.js";

type ImportRequest<P> = Omit<Request<P>, "file"> & { file?: File };

import becca from "../../becca/becca.js";
import becca_loader from "../../becca/becca_loader.js";
import type BNote from "../../becca/entities/bnote.js";
import { ValidationError } from "../../errors.js";
import * as cls from "../../services/context.js";
import importFile from "../../services/import/dispatch.js";
import singleImportService from "../../services/import/single.js";
import { getLog } from "../../services/log.js";
import TaskContext from "../../services/task_context.js";
import { safeExtractMessageAndStackFromError } from "../../services/utils/index.js";

async function importNotesToBranch(req: ImportRequest<{ parentNoteId: string }>) {
    const { parentNoteId } = req.params;
    const { taskId, last, format } = req.body;

    const options = {
        safeImport: req.body.safeImport !== "false",
        shrinkImages: req.body.shrinkImages !== "false",
        textImportedAsText: req.body.textImportedAsText !== "false",
        codeImportedAsCode: req.body.codeImportedAsCode !== "false",
        spreadsheetImportedAsSpreadsheet: req.body.spreadsheetImportedAsSpreadsheet !== "false",
        explodeArchives: req.body.explodeArchives !== "false",
        replaceUnderscoresWithSpaces: req.body.replaceUnderscoresWithSpaces !== "false"
    };

    const file = req.file;

    if (!file) {
        throw new ValidationError("No file has been uploaded");
    }

    const parentNote = becca.getNoteOrThrow(parentNoteId);

    // running all the event handlers on imported notes (and attributes) is slow
    // and may produce unintended consequences
    cls.disableEntityEvents();

    // eliminate flickering during import
    cls.ignoreEntityChangeIds();

    let note: BNote | null; // typically root of the import - client can show it after finishing the import

    const taskContext = TaskContext.getInstance(taskId, "importNotes", options);

    try {
        const importResult = await importFile(taskContext, file, parentNote, options, format);
        if (Array.isArray(importResult)) {
            // OPML reports a structured failure as a `[httpStatus, message]` tuple — pass it straight through.
            return importResult;
        }
        note = importResult;
    } catch (e: unknown) {
        const [errMessage, errStack] = safeExtractMessageAndStackFromError(e);
        console.warn(e);
        const message = `Import failed with following error: '${errMessage}'. More details might be in the logs.`;
        taskContext.reportError(message);

        getLog().error(message + errStack);

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
    becca_loader.load();

    return note.getPojo();
}

function importAttachmentsToNote(req: ImportRequest<{ parentNoteId: string }>) {
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

        getLog().error(message + errStack);

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

export default {
    importNotesToBranch,
    importAttachmentsToNote
};
