import { createZipFromDirectory, extractZip, importData, initializeEditDocsCore, startElectron } from "./utils.js";
import debounce from "@triliumnext/client/src/services/debounce.js";
import cls from "@triliumnext/server/src/services/cls.js";
import fs from "fs/promises";
import { join } from "path";
import type { NoteMetaFile } from "@triliumnext/server/src/services/meta/note_meta.js";
import type NoteMeta from "@triliumnext/server/src/services/meta/note_meta.js";

// Paths are relative to apps/edit-docs/dist.
const DEMO_ZIP_PATH = join(__dirname, "../../server/src/assets/db/demo.zip");
const DEMO_ZIP_DIR_PATH = join(__dirname, "../demo");

async function main() {
    const initializedPromise = startElectron(() => {
        // Wait for the import to be finished and the application to be loaded before we listen to changes.
        setTimeout(() => registerHandlers(), 10_000);
    });

    await initializeEditDocsCore();

    // Create the in-memory database schema and resolve dbReady (requires CLS context)
    const { sql_init, becca_loader } = await import("@triliumnext/core");
    cls.init(async () => {
        cls.ignoreEntityChangeIds();
        await sql_init.createInitialDatabase(true);
        await becca_loader.beccaLoaded;

        await importData(DEMO_ZIP_DIR_PATH);
        setOptions();
        initializedPromise.resolve();
    });
}

async function setOptions() {
    const optionsService = (await import("@triliumnext/server/src/services/options.js")).default;
    const sql = (await import("@triliumnext/server/src/services/sql.js")).default;

    optionsService.setOption("eraseUnusedAttachmentsAfterSeconds", 10);
    optionsService.setOption("eraseUnusedAttachmentsAfterTimeScale", 60);
    optionsService.setOption("compressImages", "false");

    // Set initial note to the first visible child of root (not _hidden)
    const startNoteId = sql.getValue("SELECT noteId FROM branches WHERE parentNoteId = 'root' AND isDeleted = 0 AND noteId != '_hidden' ORDER BY notePosition") || "root";
    optionsService.setOption("openNoteContexts", JSON.stringify([{ notePath: startNoteId, active: true }]));
}

async function registerHandlers() {
    const { events } = await import("@triliumnext/core");
    const { erase: eraseService } = await import("@triliumnext/core");
    const debouncer = debounce(async () => {
        console.log("Exporting data");
        eraseService.eraseUnusedAttachmentsNow();
        await exportData();

        await fs.rm(DEMO_ZIP_DIR_PATH, { recursive: true }).catch(() => {});
        await extractZip(DEMO_ZIP_PATH, DEMO_ZIP_DIR_PATH);
        await cleanUpMeta(DEMO_ZIP_DIR_PATH);
        await createZipFromDirectory(DEMO_ZIP_DIR_PATH, DEMO_ZIP_PATH);
    }, 10_000);
    events.subscribe(events.ENTITY_CHANGED, async (e) => {
        if (e.entityName === "options") {
            return;
        }

        console.log("Got entity changed ", e);
        debouncer();
    });
}

async function exportData() {
    const { zipExportService } = (await import("@triliumnext/core"));
    await zipExportService.exportToZipFile("root", "html", DEMO_ZIP_PATH);
}

const EXPANDED_NOTE_IDS = new Set([
    "root",
    "rvaX6hEaQlmk" // Trilium Demo
]);

async function cleanUpMeta(dirPath: string) {
    const metaPath = join(dirPath, "!!!meta.json");
    const meta = JSON.parse(await fs.readFile(metaPath, "utf-8")) as NoteMetaFile;

    for (const file of meta.files) {
        file.notePosition = 1;
        traverse(file);
    }

    function traverse(el: NoteMeta) {
        el.isExpanded = EXPANDED_NOTE_IDS.has(el.noteId);
        for (const child of el.children || []) {
            traverse(child);
        }
    }

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 4));
}

main();
