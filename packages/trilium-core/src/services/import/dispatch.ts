import type BNote from "../../becca/entities/bnote.js";
import type TaskContext from "../task_context.js";
import { extname } from "../utils/path.js";
import type { ZipSource } from "../zip_provider.js";
import anytypeImportService from "./anytype/importer.js";
import type { File } from "./common.js";
import enexImportService from "./enex.js";
import keepImportService from "./keep/importer.js";
import notionImportService from "./notion/importer.js";
import obsidianImportService from "./obsidian/importer.js";
import opmlImportService from "./opml.js";
import singleImportService from "./single.js";
import zipImportService from "./zip.js";

export interface ImportOptions {
    safeImport: boolean;
    shrinkImages: boolean;
    textImportedAsText: boolean;
    codeImportedAsCode: boolean;
    spreadsheetImportedAsSpreadsheet: boolean;
    explodeArchives: boolean;
    replaceUnderscoresWithSpaces: boolean;
}

/**
 * Routes a single uploaded or natively-picked file to the appropriate importer, returning the root note
 * of the import (the note the client activates afterwards). OPML reports a structured failure as a
 * `[httpStatus, message]` array instead of throwing.
 *
 * Shared by the HTTP import route and the desktop native import handler so both resolve a file to an
 * importer identically. The caller owns the surrounding CLS setup (`disableEntityEvents`,
 * `ignoreEntityChangeIds`) and the `becca_loader.load()` afterwards.
 *
 * A `.zip` is read from `file.path` in place (streamed per entry) when present, falling back to
 * `file.buffer` for the browser/WASM upload that has no temp file.
 */
export default async function importFile(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote, options: ImportOptions, format?: string): Promise<BNote | (string | number)[] | null> {
    const extension = extname(file.originalname).toLowerCase();

    // Every zip-reading importer (generic + the tagged providers) reads the archive straight from the temp
    // file (server disk storage / native pick) so a multi-GB zip is streamed per entry — never held in one
    // buffer, and free of fs.readFile's ~2 GiB ceiling. Falls back to the buffer when there's no path (the
    // browser/WASM upload). The `typeof file.buffer !== "string"` guards below ensure the no-path fallback
    // is real bytes, not a string body.
    const zipSource: ZipSource = file.path ? { path: file.path } : file.buffer as Uint8Array;

    if (format === "notion" && (file.path || typeof file.buffer !== "string")) {
        // An explicit format always wins over extension sniffing: a Notion export is just a `.zip`,
        // indistinguishable from a Trilium export without inspecting its contents. The Notion import
        // dialog tags the upload, so we route it to the Notion importer rather than the generic zip.
        return await notionImportService.importNotion(taskContext, zipSource, parentNote);
    } else if (format === "keep" && (file.path || typeof file.buffer !== "string")) {
        // Like Notion, a Google Keep (Takeout) export is just a `.zip` indistinguishable from a Trilium
        // export by extension alone, so the Keep import dialog tags the upload to route it here.
        return await keepImportService.importKeep(taskContext, zipSource, parentNote);
    } else if (format === "anytype" && (file.path || typeof file.buffer !== "string")) {
        // An Anytype JSON export is likewise a plain `.zip`; the Anytype import dialog tags the upload so
        // it routes to the Anytype importer rather than the generic zip importer.
        return await anytypeImportService.importAnytype(taskContext, zipSource, parentNote, file.originalname);
    } else if (format === "obsidian" && (file.path || typeof file.buffer !== "string")) {
        // An Obsidian vault is exported as a plain `.zip` of Markdown files, indistinguishable from a
        // Trilium export by extension alone; the Obsidian import dialog tags the upload to route it here.
        return await obsidianImportService.importObsidian(taskContext, zipSource, parentNote, file.originalname);
    } else if (extension === ".zip" && options.explodeArchives && (file.path || typeof file.buffer !== "string")) {
        return await zipImportService.importZip(taskContext, zipSource, parentNote);
    } else if (extension === ".opml" && options.explodeArchives) {
        return await opmlImportService.importOpml(taskContext, file.buffer, parentNote);
    } else if (extension === ".enex" && options.explodeArchives) {
        return await enexImportService.importEnex(taskContext, file, parentNote);
    } else {
        return await singleImportService.importSingleFile(taskContext, file, parentNote);
    }
}
