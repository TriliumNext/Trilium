import { afterEach, describe, expect, it, vi } from "vitest";

import type BNote from "../../becca/entities/bnote.js";
import type TaskContext from "../task_context.js";
import anytypeImportService from "./anytype/importer.js";
import type { File } from "./common.js";
import importFile, { type ImportOptions } from "./dispatch.js";
import enexImportService from "./enex.js";
import keepImportService from "./keep/importer.js";
import notionImportService from "./notion/importer.js";
import obsidianImportService from "./obsidian/importer.js";
import opmlImportService from "./opml.js";
import singleImportService from "./single.js";
import zipImportService from "./zip.js";

// dispatch only routes — it picks an importer and hands it a source. The server test setup eagerly loads
// the core barrel, so the importer modules are already cached and vi.mock can't replace them; spying on the
// real (singleton) service objects works regardless of load order. We stub each importer so nothing touches
// the filesystem/DB, and assert which one ran and with what source (path vs. raw bytes) and extra arguments.
const stubbed = {
    importNotion: vi.spyOn(notionImportService, "importNotion").mockResolvedValue({} as BNote),
    importKeep: vi.spyOn(keepImportService, "importKeep").mockResolvedValue({} as BNote),
    importAnytype: vi.spyOn(anytypeImportService, "importAnytype").mockResolvedValue({} as BNote),
    importObsidian: vi.spyOn(obsidianImportService, "importObsidian").mockResolvedValue({} as BNote),
    importZip: vi.spyOn(zipImportService, "importZip").mockResolvedValue({} as BNote),
    importOpml: vi.spyOn(opmlImportService, "importOpml").mockResolvedValue({} as BNote),
    importEnex: vi.spyOn(enexImportService, "importEnex").mockResolvedValue({} as BNote),
    importSingleFile: vi.spyOn(singleImportService, "importSingleFile").mockResolvedValue({} as BNote)
};

const taskContext = {} as TaskContext<"importNotes">;
const parentNote = { noteId: "parent" } as BNote;

function makeOptions(overrides: Partial<ImportOptions> = {}): ImportOptions {
    return {
        safeImport: false,
        shrinkImages: false,
        textImportedAsText: true,
        codeImportedAsCode: true,
        spreadsheetImportedAsSpreadsheet: true,
        explodeArchives: true,
        replaceUnderscoresWithSpaces: false,
        ...overrides
    };
}

function makeFile(overrides: Partial<File> = {}): File {
    return {
        originalname: "data.zip",
        mimetype: "application/zip",
        buffer: new Uint8Array([1, 2, 3]),
        ...overrides
    };
}

describe("importFile (dispatch)", () => {
    afterEach(() => vi.clearAllMocks());

    describe("tagged providers (the upload is a plain .zip the dialog disambiguates by format)", () => {
        it("routes a notion-tagged upload to the Notion importer, reading from the temp path", async () => {
            const file = makeFile({ path: "/tmp/up.zip" });
            await importFile(taskContext, file, parentNote, makeOptions(), "notion");
            expect(stubbed.importNotion).toHaveBeenCalledWith(taskContext, { path: "/tmp/up.zip" }, parentNote);
        });

        it("falls back to the raw bytes when there is no temp path (browser/WASM upload)", async () => {
            const buffer = new Uint8Array([9, 8, 7]);
            const file = makeFile({ buffer, path: undefined });
            await importFile(taskContext, file, parentNote, makeOptions(), "notion");
            expect(stubbed.importNotion).toHaveBeenCalledWith(taskContext, buffer, parentNote);
        });

        it("routes a keep-tagged upload to the Keep importer", async () => {
            const file = makeFile({ path: "/tmp/keep.zip" });
            await importFile(taskContext, file, parentNote, makeOptions(), "keep");
            expect(stubbed.importKeep).toHaveBeenCalledWith(taskContext, { path: "/tmp/keep.zip" }, parentNote);
        });

        it("routes an anytype-tagged upload to the Anytype importer, passing the original name", async () => {
            const file = makeFile({ originalname: "vault.zip", path: "/tmp/any.zip" });
            await importFile(taskContext, file, parentNote, makeOptions(), "anytype");
            expect(stubbed.importAnytype).toHaveBeenCalledWith(taskContext, { path: "/tmp/any.zip" }, parentNote, "vault.zip");
        });

        it("routes an obsidian-tagged upload to the Obsidian importer, passing the original name", async () => {
            const file = makeFile({ originalname: "MyVault.zip", path: "/tmp/obs.zip" });
            await importFile(taskContext, file, parentNote, makeOptions(), "obsidian");
            expect(stubbed.importObsidian).toHaveBeenCalledWith(taskContext, { path: "/tmp/obs.zip" }, parentNote, "MyVault.zip");
        });

        it("ignores the format tag and falls through to single import when the upload is a bare string body", async () => {
            // No path and a string buffer means there are no real bytes to hand a zip-reading importer, so
            // the provider guards short-circuit and the file is imported as a single note.
            const file = makeFile({ originalname: "export.zip", buffer: "not-real-bytes", path: undefined });
            await importFile(taskContext, file, parentNote, makeOptions(), "notion");
            expect(stubbed.importNotion).not.toHaveBeenCalled();
            expect(stubbed.importSingleFile).toHaveBeenCalledWith(taskContext, file, parentNote);
        });
    });

    describe("extension-based routing (no format tag)", () => {
        it("routes a .zip to the generic zip importer when archives are exploded", async () => {
            const file = makeFile({ originalname: "backup.zip", path: "/tmp/b.zip" });
            await importFile(taskContext, file, parentNote, makeOptions());
            expect(stubbed.importZip).toHaveBeenCalledWith(taskContext, { path: "/tmp/b.zip" }, parentNote);
        });

        it("imports a .zip as a single file when archives are not exploded", async () => {
            const file = makeFile({ originalname: "opaque.zip", path: "/tmp/o.zip" });
            await importFile(taskContext, file, parentNote, makeOptions({ explodeArchives: false }));
            expect(stubbed.importZip).not.toHaveBeenCalled();
            expect(stubbed.importSingleFile).toHaveBeenCalledWith(taskContext, file, parentNote);
        });

        it("routes a .opml to the OPML importer using the buffer", async () => {
            const file = makeFile({ originalname: "outline.opml", buffer: "<opml/>" });
            await importFile(taskContext, file, parentNote, makeOptions());
            expect(stubbed.importOpml).toHaveBeenCalledWith(taskContext, "<opml/>", parentNote);
        });

        it("passes an OPML structured failure tuple straight through", async () => {
            stubbed.importOpml.mockResolvedValueOnce([400, "bad opml"] as never);
            const file = makeFile({ originalname: "broken.opml", buffer: "<opml/>" });
            const result = await importFile(taskContext, file, parentNote, makeOptions());
            expect(result).toEqual([400, "bad opml"]);
        });

        it("routes a .enex to the ENEX importer using the whole file", async () => {
            const file = makeFile({ originalname: "notes.enex", buffer: "<en-export/>" });
            await importFile(taskContext, file, parentNote, makeOptions());
            expect(stubbed.importEnex).toHaveBeenCalledWith(taskContext, file, parentNote);
        });

        it("falls back to single-file import for an unrecognised extension", async () => {
            const file = makeFile({ originalname: "note.md", buffer: "# hi" });
            await importFile(taskContext, file, parentNote, makeOptions());
            expect(stubbed.importSingleFile).toHaveBeenCalledWith(taskContext, file, parentNote);
        });
    });
});
