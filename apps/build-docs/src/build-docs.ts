process.env.TRILIUM_INTEGRATION_TEST = "memory-no-store";
// Only set TRILIUM_RESOURCE_DIR if not already set (e.g., by Nix wrapper)
if (!process.env.TRILIUM_RESOURCE_DIR) {
    process.env.TRILIUM_RESOURCE_DIR = "../server/src";
}
process.env.NODE_ENV = "development";

import cls from "@triliumnext/server/src/services/cls.js";
import archiver from "archiver";
import { execSync } from "child_process";
import { WriteStream } from "fs";
import * as fs from "fs/promises";
import * as fsExtra from "fs-extra";
import yaml from "js-yaml";
import { dirname, join, resolve } from "path";

import BuildContext from "./context.js";

interface NoteMapping {
    rootNoteId: string;
    path: string;
    format: "markdown" | "html" | "share";
    ignoredFiles?: string[];
    exportOnly?: boolean;
}

interface Config {
    baseUrl: string;
    noteMappings: NoteMapping[];
}

const DOCS_ROOT = "../../../docs";
const OUTPUT_DIR = "../../site";

// Load configuration from edit-docs-config.yaml
async function loadConfig(configPath?: string): Promise<Config | null> {
    const pathsToTry = configPath
        ? [resolve(configPath)]
        : [
            join(process.cwd(), "edit-docs-config.yaml"),
            join(__dirname, "../../../edit-docs-config.yaml")
        ];

    for (const path of pathsToTry) {
        try {
            const configContent = await fs.readFile(path, "utf-8");
            const config = yaml.load(configContent) as Config;

            // Resolve all paths relative to the config file's directory
            const CONFIG_DIR = dirname(path);
            config.noteMappings = config.noteMappings.map((mapping) => ({
                ...mapping,
                path: resolve(CONFIG_DIR, mapping.path)
            }));

            return config;
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error; // rethrow unexpected errors
            }
        }
    }

    return null; // No config file found
}

async function exportDocs(
    noteId: string,
    format: "markdown" | "html" | "share",
    outputPath: string,
    ignoredFiles?: string[]
) {
    const zipFilePath = `output-${noteId}.zip`;
    try {
        const { exportToZipFile } = (await import("@triliumnext/server/src/services/export/zip.js"))
            .default;
        await exportToZipFile(noteId, format, zipFilePath, {});

        const ignoredSet = ignoredFiles ? new Set(ignoredFiles) : undefined;
        await extractZip(zipFilePath, outputPath, ignoredSet);
    } finally {
        if (await fsExtra.exists(zipFilePath)) {
            await fsExtra.rm(zipFilePath);
        }
    }
}

async function importAndExportDocs(sourcePath: string, outputSubDir: string) {
    const note = await importData(sourcePath);

    // Use a meaningful name for the temporary zip file
    const zipName = outputSubDir || "user-guide";
    const zipFilePath = `output-${zipName}.zip`;
    try {
        const { exportToZip } = (await import("@triliumnext/server/src/services/export/zip.js"))
            .default;
        const branch = note.getParentBranches()[0];
        const taskContext = new (await import("@triliumnext/server/src/services/task_context.js"))
            .default(
                "no-progress-reporting",
                "export",
                null
            );
        const fileOutputStream = fsExtra.createWriteStream(zipFilePath);
        await exportToZip(taskContext, branch, "share", fileOutputStream);
        const { waitForStreamToFinish } = await import("@triliumnext/server/src/services/utils.js");
        await waitForStreamToFinish(fileOutputStream);

        // Output to root directory if outputSubDir is empty, otherwise to subdirectory
        const outputPath = outputSubDir ? join(OUTPUT_DIR, outputSubDir) : OUTPUT_DIR;
        await extractZip(zipFilePath, outputPath);
    } finally {
        if (await fsExtra.exists(zipFilePath)) {
            await fsExtra.rm(zipFilePath);
        }
    }
}

async function buildDocsInner(config?: Config) {
    const i18n = await import("@triliumnext/server/src/services/i18n.js");
    await i18n.initializeTranslations();

    const sqlInit = (await import("../../server/src/services/sql_init.js")).default;
    await sqlInit.createInitialDatabase(true);

    // Wait for becca to be loaded before importing data
    const beccaLoader = await import("../../server/src/becca/becca_loader.js");
    await beccaLoader.beccaLoaded;

    if (config) {
        // Config-based build (reads from edit-docs-config.yaml)
        console.log("Building documentation from config file...");

        // Import all non-export-only mappings
        for (const mapping of config.noteMappings) {
            if (!mapping.exportOnly) {
                console.log(`Importing from ${mapping.path}...`);
                await importData(mapping.path);
            }
        }

        // Export all mappings
        for (const mapping of config.noteMappings) {
            if (mapping.exportOnly) {
                console.log(`Exporting ${mapping.format} to ${mapping.path}...`);
                await exportDocs(
                    mapping.rootNoteId,
                    mapping.format,
                    mapping.path,
                    mapping.ignoredFiles
                );
            }
        }
    } else {
        // Legacy hardcoded build (for backward compatibility)
        console.log("Building User Guide...");
        await importAndExportDocs(join(__dirname, DOCS_ROOT, "User Guide"), "user-guide");

        console.log("Building Developer Guide...");
        await importAndExportDocs(
            join(__dirname, DOCS_ROOT, "Developer Guide"),
            "developer-guide"
        );

        // Copy favicon.
        await fs.copyFile("../../apps/website/src/assets/favicon.ico",
            join(OUTPUT_DIR, "favicon.ico"));
        await fs.copyFile("../../apps/website/src/assets/favicon.ico",
            join(OUTPUT_DIR, "user-guide", "favicon.ico"));
        await fs.copyFile("../../apps/website/src/assets/favicon.ico",
            join(OUTPUT_DIR, "developer-guide", "favicon.ico"));
    }

    console.log("Documentation built successfully!");
}

export async function importData(path: string) {
    const buffer = await createImportZip(path);
    const importService = (await import("../../server/src/services/import/zip.js")).default;
    const TaskContext = (await import("../../server/src/services/task_context.js")).default;
    const context = new TaskContext("no-progress-reporting", "importNotes", null);
    const becca = (await import("../../server/src/becca/becca.js")).default;

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

    console.log("Archive path is ", resolve(path));
    archive.directory(path, "/");

    const outputStream = fsExtra.createWriteStream(inputFile);
    archive.pipe(outputStream);
    archive.finalize();
    const { waitForStreamToFinish } = await import("@triliumnext/server/src/services/utils.js");
    await waitForStreamToFinish(outputStream);

    try {
        return await fsExtra.readFile(inputFile);
    } finally {
        await fsExtra.rm(inputFile);
    }
}


export async function extractZip(
    zipFilePath: string,
    outputPath: string,
    ignoredFiles?: Set<string>
) {
    const { readZipFile, readContent } = (await import(
        "@triliumnext/server/src/services/import/zip.js"
    ));
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

export async function buildDocsFromConfig(configPath?: string, gitRootDir?: string) {
    const config = await loadConfig(configPath);

    if (gitRootDir) {
        // Build the share theme if we have a gitRootDir (for Trilium project)
        execSync(`pnpm run --filter share-theme build`, {
            stdio: "inherit",
            cwd: gitRootDir
        });
    }

    // Trigger the actual build.
    await new Promise((res, rej) => {
        cls.init(() => {
            buildDocsInner(config ?? undefined)
                .catch(rej)
                .then(res);
        });
    });
}

export default async function buildDocs({ gitRootDir }: BuildContext) {
    // Build the share theme.
    execSync(`pnpm run --filter share-theme build`, {
        stdio: "inherit",
        cwd: gitRootDir
    });

    // Trigger the actual build.
    await new Promise((res, rej) => {
        cls.init(() => {
            buildDocsInner()
                .catch(rej)
                .then(res);
        });
    });
}
