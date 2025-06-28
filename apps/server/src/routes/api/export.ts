"use strict";

import zipExportService from "../../services/export/zip.js";
import singleExportService from "../../services/export/single.js";
import opmlExportService from "../../services/export/opml.js";
import becca from "../../becca/becca.js";
import TaskContext from "../../services/task_context.js";
import log from "../../services/log.js";
import NotFoundError from "../../errors/not_found_error.js";
import type { Request, Response } from "express";
import ValidationError from "../../errors/validation_error.js";
import { safeExtractMessageAndStackFromError } from "../../services/utils.js";

function exportBranch(req: Request, res: Response) {
    const { branchId, type, format, version, taskId } = req.params;
    const branch = becca.getBranch(branchId);

    if (!branch) {
        const message = `Cannot export branch '${branchId}' since it does not exist.`;
        log.error(message);

        res.setHeader("Content-Type", "text/plain").status(500).send(message);
        return;
    }

    const taskContext = new TaskContext(taskId, "export");

    try {
        if (type === "subtree" && (format === "html" || format === "markdown" || format === "share")) {
            zipExportService.exportToZip(taskContext, branch, format, res);
        } else if (type === "single") {
            if (format !== "html" && format !== "markdown") {
                throw new ValidationError("Invalid export type.");
            }
            singleExportService.exportSingleNote(taskContext, branch, format, res);
        } else if (format === "opml") {
            opmlExportService.exportToOpml(taskContext, branch, version, res);
        } else {
            throw new NotFoundError(`Unrecognized export format '${format}'`);
        }
    } catch (e: unknown) {
        const [errMessage, errStack] = safeExtractMessageAndStackFromError(e);
        const message = `Export failed with following error: '${errMessage}'. More details might be in the logs.`;
        taskContext.reportError(message);

        log.error(errMessage + errStack);

        res.setHeader("Content-Type", "text/plain").status(500).send(message);
    }
}

export default {
    exportBranch
};
