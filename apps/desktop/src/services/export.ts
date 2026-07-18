import type { ExportFormat } from "@triliumnext/core";
import { getLog, utils as coreUtils, zipExportService } from "@triliumnext/core";
import type { NativeExportResult } from "@triliumnext/commons";
import { default as electron } from "electron";
import fs from "fs/promises";
import { t } from "i18next";

interface ExportSubtreeOpts {
    branchId: string;
    format: string;
    title: string;
    taskId: string;
}

/**
 * Registers the desktop-native subtree export IPC handler. Instead of streaming a
 * (potentially multi-GB) archive through an in-memory HTTP response — which
 * Electron's download manager buffers whole — this prompts a save dialog and
 * streams the export straight to the chosen file with bounded memory.
 */
export function setupExportHandlers() {
    electron.ipcMain.handle("export-subtree-to-file", async (_e, { branchId, format, title, taskId }: ExportSubtreeOpts): Promise<NativeExportResult> => {
        const focusedWindow = electron.BrowserWindow.getFocusedWindow();
        if (!focusedWindow) {
            return { status: "cancelled" };
        }

        // Async dialog: showSaveDialogSync blocks the main process event loop (freezing the UI, WebSockets
        // and background tasks) for as long as the dialog is open.
        const { canceled, filePath } = await electron.dialog.showSaveDialog(focusedWindow, {
            defaultPath: coreUtils.formatDownloadTitle(title, "file", "application/zip"),
            filters: [{ name: t("export.zip_filter"), extensions: ["zip"] }]
        });
        if (canceled || !filePath) {
            return { status: "cancelled" };
        }

        try {
            await zipExportService.exportBranchToZipFile(branchId, format as ExportFormat, filePath, taskId);
            // Reveal the saved archive in the OS file manager, selecting it — more useful than opening the
            // zip itself (cf. PDF export, which opens the document).
            electron.shell.showItemInFolder(filePath);
            return { status: "saved", filePath };
        } catch (e) {
            // Remove the partial/incomplete archive left at the destination.
            await fs.rm(filePath, { force: true });
            getLog().error(`Native subtree export failed: ${coreUtils.safeExtractMessageAndStackFromError(e)}`);
            return { status: "error", message: e instanceof Error ? e.message : String(e) };
        }
    });
}
