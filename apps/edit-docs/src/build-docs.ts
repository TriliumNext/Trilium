process.env.TRILIUM_INTEGRATION_TEST = "memory-no-store";
process.env.TRILIUM_RESOURCE_DIR = "../server/src";
process.env.NODE_ENV = "development";

import cls from "@triliumnext/server/src/services/cls.js";
import { dirname, join, resolve } from "path";
import fs, { copyFile } from "fs/promises";
import fsExtra, { createWriteStream, type WriteStream } from "fs-extra";
import archiver from "archiver";

const DOCS_ROOT = "../../../docs";
const OUTPUT_DIR = "../../site";

async function main() {
    const i18n = await import("@triliumnext/server/src/services/i18n.js");
    await i18n.initializeTranslations();

    const sqlInit = (await import("../../server/src/services/sql_init.js")).default;
    await sqlInit.createInitialDatabase(true);

    const note = await importData(join(__dirname, DOCS_ROOT, "User Guide"));

    // Export
    const zipFilePath = "output.zip";
    try {
        const { exportToZip } = (await import("@triliumnext/server/src/services/export/zip.js")).default;
        const branch = note.getParentBranches()[0];
        const taskContext = new (await import("@triliumnext/server/src/services/task_context.js")).default(
            "no-progress-reporting",
            "export",
            null
        );
        const fileOutputStream = createWriteStream(zipFilePath);
        await exportToZip(taskContext, branch, "share", fileOutputStream);
        await waitForStreamToFinish(fileOutputStream);
        await extractZip(zipFilePath, OUTPUT_DIR);
    } finally {
        if (await fsExtra.exists(zipFilePath)) {
            await fsExtra.rm(zipFilePath);
        }
    }

    // Copy favicon.
    await copyFile("../../apps/website/src/assets/favicon.ico", join(OUTPUT_DIR, "favicon.ico"));

    console.log("Documentation built successfully!");
}

export async function importData(path: string) {
    const buffer = await createImportZip(path);
    const importService = (await import("@triliumnext/server/src/services/import/zip.js")).default;
    const TaskContext = (await import("@triliumnext/server/src/services/task_context.js")).default;
    const context = new TaskContext("no-progress-reporting", "importNotes", null);
    const becca = (await import("@triliumnext/server/src/becca/becca.js")).default;

    const rootNote = becca.getRoot();
    if (!rootNote) {
        throw new Error("Missing root note for import.");
    }
    return await importService.importZip(context, buffer, rootNote, {
        preserveIds: true
    });
}

async function createImportZip(path: string) {
    const inputFile = "input.zip";
    const archive = archiver("zip", {
        zlib: { level: 0 }
    });

    console.log("Archive path is ", resolve(path))
    archive.directory(path, "/");

    const outputStream = fsExtra.createWriteStream(inputFile);
    archive.pipe(outputStream);
    archive.finalize();
    await waitForStreamToFinish(outputStream);

    try {
        return await fsExtra.readFile(inputFile);
    } finally {
        await fsExtra.rm(inputFile);
    }
}

function waitForStreamToFinish(stream: WriteStream) {
    return new Promise<void>((res, rej) => {
        stream.on("finish", () => res());
        stream.on("error", (err) => rej(err));
    });
}

export async function extractZip(zipFilePath: string, outputPath: string, ignoredFiles?: Set<string>) {
    const { readZipFile, readContent } = (await import("@triliumnext/server/src/services/import/zip.js"));
    await readZipFile(await fs.readFile(zipFilePath), async (zip, entry) => {
        // We ignore directories since they can appear out of order anyway.
        if (!entry.fileName.endsWith("/") && !ignoredFiles?.has(entry.fileName)) {
            const destPath = join(outputPath, entry.fileName);
            const fileContent = await readContent(zip, entry);

            await fsExtra.mkdirs(dirname(destPath));
            await fs.writeFile(destPath, fileContent);
        }

        zip.readEntry();
    });
}

cls.init(main);
