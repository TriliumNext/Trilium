import { FUniver } from "@univerjs/presets";
import { MutableRef } from "preact/hooks";

import NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import toast from "../../../services/toast";
import utils from "../../../services/utils";
import { useTriliumEvent } from "../../react/hooks";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CSV_MIME = "text/csv;charset=utf-8";
const ZIP_MIME = "application/zip";
// Excel on Windows only auto-detects UTF-8 in a CSV when it starts with a byte-order mark.
const UTF8_BOM = "\uFEFF";

/**
 * Exports the spreadsheet when the `exportXlsx` / `exportCsv` events fire for this note
 * context. The events are raised from the note actions menu and the floating buttons (the
 * same surfaces the PNG/SVG exports use), so they work regardless of Univer's own toolbar
 * (which is hidden in read-only mode). The conversions run client-side via the exporters in
 * `@triliumnext/commons`, dynamically imported so their dependencies (e.g. exceljs) are only
 * fetched on export (and never enter the standalone/core bundles).
 */
export default function useSpreadsheetExport(apiRef: MutableRef<FUniver | undefined>, note: FNote, noteContext: NoteContext | null | undefined) {
    useTriliumEvent("exportXlsx", ({ ntxId }) => {
        if (ntxId !== noteContext?.ntxId) return;
        void exportToXlsx(apiRef.current, note);
    });
    useTriliumEvent("exportCsv", ({ ntxId }) => {
        if (ntxId !== noteContext?.ntxId) return;
        void exportToCsv(apiRef.current, note);
    });
}

async function exportToXlsx(univerAPI: FUniver | undefined, note: FNote) {
    const json = serializeWorkbook(univerAPI);
    if (json == null) return;

    try {
        // Dynamic import keeps exceljs out of the main bundle (and out of standalone/core).
        const { renderSpreadsheetToXlsx } = await import("@triliumnext/commons/src/lib/spreadsheet/render_to_xlsx");
        const buffer = await renderSpreadsheetToXlsx(json);
        await download(note, "xlsx", new Blob([buffer as BlobPart], { type: XLSX_MIME }));
    } catch (e) {
        console.error("[spreadsheet-export] xlsx failed", e);
        toast.showError(t("spreadsheet.export-failed"));
    }
}

async function exportToCsv(univerAPI: FUniver | undefined, note: FNote) {
    const workbook = univerAPI?.getActiveWorkbook();
    if (!workbook) return;

    const wbData = workbook.save();
    const json = JSON.stringify({ version: 1, workbook: wbData });

    try {
        // A workbook with multiple visible sheets can't fit in one CSV, so bundle one file per
        // sheet into a zip; a single-sheet workbook downloads as a plain .csv of that sheet.
        if (countVisibleSheets(wbData) > 1) {
            const { renderSpreadsheetToCsvZip } = await import("@triliumnext/commons/src/lib/spreadsheet/render_to_csv");
            const zip = await renderSpreadsheetToCsvZip(json);
            await download(note, "zip", new Blob([zip as BlobPart], { type: ZIP_MIME }));
            return;
        }

        const sheetId = workbook.getActiveSheet()?.getSheetId();
        const { renderSpreadsheetToCsv } = await import("@triliumnext/commons/src/lib/spreadsheet/render_to_csv");
        const csv = renderSpreadsheetToCsv(json, { sheetId });
        await download(note, "csv", new Blob([UTF8_BOM + csv], { type: CSV_MIME }));
    } catch (e) {
        console.error("[spreadsheet-export] csv failed", e);
        toast.showError(t("spreadsheet.export-csv-failed"));
    }
}

/** Counts the sheets Univer's `save()` reports as not hidden — mirrors `getVisibleSheets` in commons. */
function countVisibleSheets(wbData: { sheetOrder?: string[]; sheets?: Record<string, { hidden?: number }> }): number {
    const sheets = wbData.sheets ?? {};
    const ids = wbData.sheetOrder ?? Object.keys(sheets);
    return ids.filter((id) => sheets[id] && !sheets[id].hidden).length;
}

/** Serializes the live workbook in the same shape the note is persisted in. */
function serializeWorkbook(univerAPI: FUniver | undefined): string | null {
    const workbook = univerAPI?.getActiveWorkbook();
    if (!workbook) return null;
    return JSON.stringify({ version: 1, workbook: workbook.save() });
}

async function download(note: FNote, extension: string, blob: Blob) {
    // Download via a data URL (utils.triggerDownload): a blob-URL anchor click after these
    // awaits gets silently blocked once the user-activation is consumed, whereas the
    // data-URL path used by downloadAsPng/Svg works.
    const dataUrl = await blobToDataUrl(blob);
    utils.triggerDownload(`${note.title || "spreadsheet"}.${extension}`, dataUrl);
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}
