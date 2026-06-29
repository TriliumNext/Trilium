import { ProgressPhase, WebSocketMessage } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import { t } from "./i18n.js";
import server from "./server.js";
import toastService, { type ToastOptionsWithRequiredId } from "./toast.js";
import utils from "./utils.js";
import ws from "./ws.js";

type BooleanLike = boolean | "true" | "false";

export interface UploadFilesOptions {
    /** Routes the upload to a specific importer (e.g. "notion"), overriding extension-based detection. */
    format?: string;
    safeImport?: BooleanLike;
    shrinkImages: BooleanLike;
    textImportedAsText?: BooleanLike;
    codeImportedAsCode?: BooleanLike;
    spreadsheetImportedAsSpreadsheet?: BooleanLike;
    explodeArchives?: BooleanLike;
    replaceUnderscoresWithSpaces?: BooleanLike;
}

export async function uploadFiles(entityType: string, parentNoteId: string, files: string[] | File[], options: UploadFilesOptions) {
    if (!["notes", "attachments"].includes(entityType)) {
        throw new Error(`Unrecognized import entity type '${entityType}'.`);
    }

    if (files.length === 0) {
        return;
    }

    const taskId = utils.randomString(10);
    let counter = 0;

    for (const file of files) {
        counter++;

        const formData = new FormData();
        formData.append("upload", file);
        formData.append("taskId", taskId);
        formData.append("last", counter === files.length ? "true" : "false");

        for (const key in options) {
            formData.append(key, (options as any)[key]);
        }

        await $.ajax({
            url: `${window.glob.baseApiUrl}notes/${parentNoteId}/${entityType}-import`,
            headers: await server.getHeaders(),
            data: formData,
            dataType: "json",
            type: "POST",
            timeout: 60 * 60 * 1000,
            error (xhr) {
                // Fallback toast for failures that never produced a WebSocket `taskError` (e.g. transport or
                // auth errors raised before the importer runs). Deferred so the canonical WebSocket error —
                // emitted alongside this same 500 — can claim the taskId first and win.
                const message = t("import.failed", { message: xhr.responseText });
                setTimeout(() => reportImportError(taskId, message), IMPORT_ERROR_FALLBACK_DELAY);
            },
            contentType: false, // NEEDED, DON'T REMOVE THIS
            processData: false // NEEDED, DON'T REMOVE THIS
        });
    }
}

function makeToast(id: string, message: string): ToastOptionsWithRequiredId {
    return {
        id,
        message,
        icon: "bx bx-check",
        // This toast replaces the in-progress one (same id), and showPersistent merges fields rather than
        // swapping the object — so reset the fields the progress toast set: clear the progress (otherwise the
        // finished bar lingers at 100%) and re-enable dismissal (the progress toast disabled it).
        progress: undefined,
        dismissible: true
    };
}

/**
 * Builds the persistent "import in progress" toast:
 *  - a phase is known (zip import) → a phase-specific message: "Extracted X items of N" while extracting
 *    archive entries, "Processed X notes of N" while post-processing the created notes;
 *  - a total but no phase (single-format importers like Notion/Obsidian) → "Imported X notes of N";
 *  - some progress, no total → a bare running count;
 *  - nothing counted yet (count 0, no total) → a generic indeterminate message, since "in progress: 0"
 *    is meaningless while the importer is still working out how much there is to do.
 */
function makeProgressToast(taskId: string, progressCount: number, totalCount?: number, phase?: ProgressPhase): ToastOptionsWithRequiredId {
    const hasTotal = typeof totalCount === "number" && totalCount > 0;
    let message: string;
    if (hasTotal && phase === "extracting") {
        message = t("import.extracting", { progress: progressCount, total: totalCount });
    } else if (hasTotal && phase === "processing") {
        message = t("import.processing", { progress: progressCount, total: totalCount });
    } else if (hasTotal) {
        message = t("import.in-progress-with-total", { progress: progressCount, total: totalCount });
    } else if (progressCount > 0) {
        message = t("import.in-progress", { progress: progressCount });
    } else {
        message = t("import.starting");
    }

    return {
        id: taskId,
        icon: "bx bx-loader-circle bx-spin",
        message,
        // The import keeps running regardless of the toast, so don't offer a × that looks like "cancel".
        dismissible: false,
        ...(hasTotal ? { progress: progressCount / totalCount } : {})
    };
}

/**
 * Shows an import failure exactly once per taskId. A failed import surfaces on two channels: the canonical
 * WebSocket `taskError` message (clean text, paired with the progress toast) and this upload's AJAX error
 * callback (a fallback for failures that never reach the task system). Both route through here, so whichever
 * fires first wins and the duplicate is suppressed.
 */
const IMPORT_ERROR_FALLBACK_DELAY = 500;
const reportedImportErrorTaskIds = new Set<string>();

function reportImportError(taskId: string, message: string) {
    if (reportedImportErrorTaskIds.has(taskId)) {
        return;
    }
    reportedImportErrorTaskIds.add(taskId);
    // Release the taskId once both channels have certainly fired, keeping the guard set bounded.
    setTimeout(() => reportedImportErrorTaskIds.delete(taskId), 60_000);
    toastService.closePersistent(taskId);
    toastService.showError(message);
}

ws.subscribeToMessages(async (message) => {
    if (!("taskType" in message) || message.taskType !== "importNotes") {
        return;
    }

    if (message.type === "taskError") {
        reportImportError(message.taskId, message.message);
    } else if (message.type === "taskProgressCount") {
        toastService.showPersistent(makeProgressToast(message.taskId, message.progressCount, message.totalCount, message.phase));
    } else if (message.type === "taskSucceeded") {
        const toast = makeToast(message.taskId, t("import.successful"));
        toast.timeout = 5000;

        toastService.showPersistent(toast);

        if (message.result.importedNoteId) {
            await appContext.tabManager.getActiveContext()?.setNote(message.result.importedNoteId);
        }
    }
});

ws.subscribeToMessages(async (message: WebSocketMessage) => {
    if (!("taskType" in message) || message.taskType !== "importAttachments") {
        return;
    }

    if (message.type === "taskError") {
        reportImportError(message.taskId, message.message);
    } else if (message.type === "taskProgressCount") {
        toastService.showPersistent(makeProgressToast(message.taskId, message.progressCount, message.totalCount, message.phase));
    } else if (message.type === "taskSucceeded") {
        const toast = makeToast(message.taskId, t("import.successful"));
        toast.timeout = 5000;

        toastService.showPersistent(toast);

        if (message.result.parentNoteId) {
            await appContext.tabManager.getActiveContext()?.setNote(message.result.importedNoteId, {
                viewScope: {
                    viewMode: "attachments"
                }
            });
        }
    }
});

// The export progress toast subscription lives here too — in this eagerly-loaded service — rather than in
// the lazily-loaded export dialog (export.tsx). Registered at startup, it re-registers on every page load,
// so an in-progress export's toast resumes after a refresh; a subscription inside the dialog module would
// never re-register unless the dialog were reopened. Reuses this existing transfer service rather than
// adding a parallel export one.
ws.subscribeToMessages(async (message: WebSocketMessage) => {
    if (!("taskType" in message) || message.taskType !== "export") {
        return;
    }

    if (message.type === "taskError") {
        toastService.closePersistent(message.taskId);
        toastService.showError(message.message);
    } else if (message.type === "taskProgressCount") {
        toastService.showPersistent(makeExportProgressToast(message.taskId, message.progressCount, message.totalCount));
    } else if (message.type === "taskSucceeded") {
        const toast = makeExportToast(message.taskId, t("export.export_finished_successfully"));
        toast.timeout = 5000;

        toastService.showPersistent(toast);
    }
});

function makeExportToast(id: string, message: string): ToastOptionsWithRequiredId {
    return {
        id,
        message,
        icon: "export",
        // This toast replaces the in-progress one (same id), and showPersistent merges fields rather than
        // swapping the object — so reset the fields the progress toast set: clear the progress (otherwise the
        // finished bar lingers at 100%) and re-enable dismissal (the progress toast disabled it).
        progress: undefined,
        dismissible: true
    };
}

/**
 * Builds the persistent "export in progress" toast. The metadata-collection phase doesn't know the total
 * up front, so it shows an indeterminate "Preparing for export…" message; once the content-writing phase
 * sets a total, the message switches to "Exported X notes out of N" with a progress bar.
 */
function makeExportProgressToast(taskId: string, progressCount: number, totalCount?: number): ToastOptionsWithRequiredId {
    const hasTotal = typeof totalCount === "number" && totalCount > 0;
    return {
        id: taskId,
        icon: "bx bx-loader-circle bx-spin",
        message: hasTotal
            ? t("export.export_in_progress_with_total", { progressCount, totalCount })
            : t("export.preparing_export"),
        // The export keeps running regardless of the toast, so don't offer a × that looks like "cancel".
        dismissible: false,
        ...(hasTotal ? { progress: progressCount / totalCount } : {})
    };
}

export default {
    uploadFiles
};
