import { default as electron, ipcMain, type IpcMainEvent } from "electron";
import fs from "fs/promises";
import { t } from "i18next";

import log from "./log.js";
import port from "./port.js";
import { formatDownloadTitle } from "./utils.js";

interface PrintOpts {
    notePath: string;
    printToPdf: boolean;
}

interface ExportAsPdfOpts {
    notePath: string;
    title: string;
    landscape: boolean;
    pageSize: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "Legal" | "Letter" | "Tabloid" | "Ledger";
    scale: number;
    margins: string;
    pageRanges: string;
}

interface PrintFromPreviewOpts extends ExportAsPdfOpts {
    silent: boolean;
    deviceName?: string;
}

/** Parses the printMargins attribute into Electron margins.
 *  Values are stored in mm and converted to inches for Electron.
 *  Presets expand to explicit numeric margins since Electron's `marginType` aliases
 *  (especially `none` and `printableArea`) behave inconsistently for PDF output. */
function parseMargins(margins: string): Electron.Margins {
    const mmToInches = (mm: number) => mm / 25.4;
    const uniform = (mm: number): Electron.Margins => ({
        marginType: "custom",
        top: mmToInches(mm),
        right: mmToInches(mm),
        bottom: mmToInches(mm),
        left: mmToInches(mm)
    });

    if (!margins || margins === "default") return uniform(20);  // 2cm
    if (margins === "none") return uniform(0);
    if (margins === "minimum") return uniform(5);

    const parts = margins.split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        return {
            marginType: "custom",
            top: mmToInches(parts[0]),
            right: mmToInches(parts[1]),
            bottom: mmToInches(parts[2]),
            left: mmToInches(parts[3])
        };
    }

    return uniform(10);
}

/** Convert "1-5, 8, 11-13" into PageRanges array form expected by webContents.print. */
function parsePageRangesForPrint(pageRanges: string): { from: number; to: number }[] | undefined {
    if (!pageRanges?.trim()) return undefined;
    const ranges: { from: number; to: number }[] = [];
    for (const part of pageRanges.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const [fromStr, toStr] = trimmed.split("-").map(s => s.trim());
        const from = parseInt(fromStr, 10);
        const to = toStr ? parseInt(toStr, 10) : from;
        if (!isNaN(from) && !isNaN(to)) ranges.push({ from, to });
    }
    return ranges.length ? ranges : undefined;
}

async function getBrowserWindowForPrinting(e: IpcMainEvent, notePath: string, action: "printing" | "exporting_pdf") {
    // Offscreen rendering crashes on Wayland due to a Chromium bug where the OSR surface
    // lacks a valid xdg_toplevel role, causing a fatal zxdg_exporter_v2 protocol error.
    // On Linux we work around this by creating a regular window positioned off-screen,
    // since `show: false` without OSR causes Chromium to skip rendering entirely.
    const useOffscreen = process.platform !== "linux";
    const browserWindow = new electron.BrowserWindow({
        show: !useOffscreen,
        ...(useOffscreen ? {} : {
            width: 1,
            height: 1,
            frame: false,
            skipTaskbar: true,
            focusable: false,
        }),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            offscreen: useOffscreen,
            devTools: false,
            session: e.sender.session
        },
    });

    const progressCallback = (_e: IpcMainEvent, progress: number) => e.sender.send("print-progress", { progress, action });
    ipcMain.on("print-progress", progressCallback);

    // Capture ALL console output (including errors) for debugging
    browserWindow.webContents.on("console-message", (event, message, line, sourceId) => {
        if (event.level === "debug") return;
        if (event.level === "error") {
            log.error(`[Print Window ${sourceId}:${line}] ${message}`);
            return;
        }
        log.info(`[Print Window ${sourceId}:${line}] ${message}`);
    });

    try {
        await browserWindow.loadURL(`http://127.0.0.1:${port}/?print#${notePath}`);
    } catch (err) {
        log.error(`Failed to load print window: ${err}`);
        ipcMain.off("print-progress", progressCallback);
        throw err;
    }

    // Set up error tracking and logging in the renderer process
    await browserWindow.webContents.executeJavaScript(`
        (function() {
            window._printWindowErrors = [];
            window.addEventListener("error", (e) => {
                const errorMsg = "Uncaught error: " + e.message + " at " + e.filename + ":" + e.lineno + ":" + e.colno;
                console.error(errorMsg);
                if (e.error?.stack) console.error(e.error.stack);
                window._printWindowErrors.push({
                    type: 'error',
                    message: errorMsg,
                    stack: e.error?.stack
                });
            });
            window.addEventListener("unhandledrejection", (e) => {
                const errorMsg = "Unhandled rejection: " + String(e.reason);
                console.error(errorMsg);
                if (e.reason?.stack) console.error(e.reason.stack);
                window._printWindowErrors.push({
                    type: 'rejection',
                    message: errorMsg,
                    stack: e.reason?.stack
                });
            });
        })();
    `).catch(err => log.error(`Failed to set up error handlers in print window: ${err}`));

    let printReport;
    try {
        printReport = await browserWindow.webContents.executeJavaScript(`
            new Promise((resolve, reject) => {
                if (window._noteReady) return resolve(window._noteReady);

                // Check for errors periodically
                const errorChecker = setInterval(() => {
                    if (window._printWindowErrors && window._printWindowErrors.length > 0) {
                        clearInterval(errorChecker);
                        const errors = window._printWindowErrors.map(e => e.message).join('; ');
                        reject(new Error("Print window errors: " + errors));
                    }
                }, 100);

                window.addEventListener("note-ready", (data) => {
                    clearInterval(errorChecker);
                    resolve(data.detail);
                });
            });
        `);
    } catch (err) {
        log.error(`Print window promise failed for ${notePath}: ${err}`);
        ipcMain.off("print-progress", progressCallback);
        throw err;
    }

    ipcMain.off("print-progress", progressCallback);
    return { browserWindow, printReport };
}

/** Registers all printing-related IPC handlers. Call once on Electron startup. */
export function initPrintingHandlers() {
    electron.ipcMain.on("print-note", async (e, { notePath }: PrintOpts) => {
        try {
            const { browserWindow, printReport } = await getBrowserWindowForPrinting(e, notePath, "printing");
            browserWindow.webContents.print({}, (success, failureReason) => {
                if (!success && failureReason !== "Print job canceled") {
                    electron.dialog.showErrorBox(t("pdf.unable-to-print"), failureReason);
                }
                e.sender.send("print-done", printReport);
                browserWindow.destroy();
            });
        } catch (err) {
            e.sender.send("print-done", {
                type: "error",
                message: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined
            });
        }
    });

    electron.ipcMain.on("export-as-pdf", async (e, { title, notePath, landscape, pageSize, scale, margins, pageRanges }: ExportAsPdfOpts) => {
        try {
            const { browserWindow, printReport } = await getBrowserWindowForPrinting(e, notePath, "exporting_pdf");

            async function print() {
                const filePath = electron.dialog.showSaveDialogSync(browserWindow, {
                    defaultPath: formatDownloadTitle(title, "file", "application/pdf"),
                    filters: [
                        {
                            name: t("pdf.export_filter"),
                            extensions: ["pdf"]
                        }
                    ]
                });
                if (!filePath) return;

                let buffer: Buffer;
                try {
                    buffer = await browserWindow.webContents.printToPDF({
                        landscape,
                        pageSize,
                        scale,
                        margins: parseMargins(margins),
                        pageRanges: pageRanges || undefined,
                        preferCSSPageSize: false,
                        generateDocumentOutline: true,
                        generateTaggedPDF: true,
                        printBackground: true,
                        displayHeaderFooter: true,
                        headerTemplate: `<div></div>`,
                        footerTemplate: `
                            <div class="pageNumber" style="width: 100%; text-align: center; font-size: 10pt;">
                            </div>
                        `
                    });
                } catch (_e) {
                    electron.dialog.showErrorBox(t("pdf.unable-to-export-title"), t("pdf.unable-to-export-message"));
                    return;
                }

                try {
                    await fs.writeFile(filePath, buffer);
                } catch (_e) {
                    electron.dialog.showErrorBox(t("pdf.unable-to-export-title"), t("pdf.unable-to-save-message"));
                    return;
                }

                electron.shell.openPath(filePath);
            }

            try {
                await print();
            } finally {
                e.sender.send("print-done", printReport);
                browserWindow.destroy();
            }
        } catch (err) {
            e.sender.send("print-done", {
                type: "error",
                message: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined
            });
        }
    });

    electron.ipcMain.on("export-as-pdf-preview", async (e, { notePath, landscape, pageSize, scale, margins, pageRanges }: ExportAsPdfOpts) => {
        try {
            const { browserWindow, printReport } = await getBrowserWindowForPrinting(e, notePath, "exporting_pdf");

            try {
                const buffer = await browserWindow.webContents.printToPDF({
                    landscape,
                    pageSize,
                    scale,
                    margins: parseMargins(margins),
                    pageRanges: pageRanges || undefined,
                    preferCSSPageSize: false,
                    generateDocumentOutline: true,
                    generateTaggedPDF: true,
                    printBackground: true,
                    displayHeaderFooter: true,
                    headerTemplate: `<div></div>`,
                    footerTemplate: `
                        <div class="pageNumber" style="width: 100%; text-align: center; font-size: 10pt;">
                        </div>
                    `
                });

                e.sender.send("export-as-pdf-preview-result", { buffer, notePath });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                e.sender.send("export-as-pdf-preview-result", { notePath, error: message });
            } finally {
                e.sender.send("print-done", printReport);
                browserWindow.destroy();
            }
        } catch (err) {
            e.sender.send("print-done", {
                type: "error",
                message: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined
            });
        }
    });

    electron.ipcMain.on("save-pdf", async (_e, { title, buffer }: { title: string; buffer: Buffer }) => {
        const focusedWindow = electron.BrowserWindow.getFocusedWindow();
        if (!focusedWindow) return;

        const filePath = electron.dialog.showSaveDialogSync(focusedWindow, {
            defaultPath: formatDownloadTitle(title, "file", "application/pdf"),
            filters: [
                {
                    name: t("pdf.export_filter"),
                    extensions: ["pdf"]
                }
            ]
        });
        if (!filePath) return;

        try {
            await fs.writeFile(filePath, Buffer.from(buffer));
        } catch (_e) {
            electron.dialog.showErrorBox(t("pdf.unable-to-export-title"), t("pdf.unable-to-save-message"));
            return;
        }

        electron.shell.openPath(filePath);
    });

    electron.ipcMain.handle("get-printers", async (e) => {
        try {
            const printers = await e.sender.getPrintersAsync();
            return printers.map((p) => {
                // Platform-specific: CUPS uses "printer-location", Windows/mac often expose "location".
                const opts = (p.options ?? {}) as Record<string, string>;
                return {
                    name: p.name,
                    displayName: p.displayName,
                    description: p.description,
                    location: opts["printer-location"] || opts.location || "",
                    isDefault: (p as unknown as { isDefault?: boolean }).isDefault ?? false
                };
            });
        } catch {
            return [];
        }
    });

    electron.ipcMain.on("print-from-preview", async (e, { notePath, landscape, pageSize, scale, margins, pageRanges, silent, deviceName }: PrintFromPreviewOpts) => {
        try {
            const { browserWindow, printReport } = await getBrowserWindowForPrinting(e, notePath, "printing");

            // print() accepts most of the same options as printToPDF, but typing differs
            // slightly (e.g. no "Ledger" pageSize). Cast to keep this concise.
            // "Ledger" and "Tabloid" are the same physical size (11×17 in); Electron's
            // print() API only recognises "Tabloid", so we map "Ledger" to "Tabloid".
            const printOpts: Electron.WebContentsPrintOptions = {
                silent,
                deviceName,
                landscape,
                pageSize: pageSize === "Ledger" ? "Tabloid" : pageSize,
                scaleFactor: Math.round(scale * 100),
                margins: parseMargins(margins),
                pageRanges: parsePageRangesForPrint(pageRanges),
                printBackground: true
            };

            browserWindow.webContents.print(printOpts, (success, failureReason) => {
                if (!success && failureReason !== "Print job canceled") {
                    electron.dialog.showErrorBox(t("pdf.unable-to-print"), failureReason);
                }
                e.sender.send("print-from-preview-done");
                e.sender.send("print-done", printReport);
                browserWindow.destroy();
            });
        } catch (err) {
            e.sender.send("print-from-preview-done");
            e.sender.send("print-done", {
                type: "error",
                message: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined
            });
        }
    });
}
