process.env.TRILIUM_INTEGRATION_TEST = "memory-no-store";
// Only set TRILIUM_RESOURCE_DIR if not already set (e.g., by Nix wrapper)
if (!process.env.TRILIUM_RESOURCE_DIR) {
    process.env.TRILIUM_RESOURCE_DIR = "../server/src";
}
process.env.NODE_ENV = "development";

import { BackupService, getContext, initializeCore, type ImageProvider } from "@triliumnext/core";
import ClsHookedExecutionContext from "@triliumnext/server/src/cls_provider.js";
import NodejsCryptoProvider from "@triliumnext/server/src/crypto_provider.js";
import ServerPlatformProvider from "@triliumnext/server/src/platform_provider.js";
import BetterSqlite3Provider from "@triliumnext/server/src/sql_provider.js";
import NodejsZipProvider from "@triliumnext/server/src/zip_provider.js";

// Stub backup service for build-docs (not used, but required by initializeCore)
class StubBackupService extends BackupService {
    constructor() {
        super({
            getOption: () => "",
            getOptionBool: () => false,
            setOption: () => {}
        });
    }
    scheduleBackups(): void {
        // No scheduled backups in build-docs
    }
    async backupNow(_name: string): Promise<string> {
        throw new Error("Backup not supported in build-docs");
    }
    async getExistingBackups() {
        return [];
    }
    async getBackupContent(_filePath: string): Promise<Uint8Array | null> {
        return null;
    }
}

// Stub image provider for build-docs (not used, but required by initializeCore)
const stubImageProvider: ImageProvider = {
    getImageType: () => null,
    processImage: async () => {
        throw new Error("Image processing not supported in build-docs");
    }
};
import archiver from "archiver";
import { execSync } from "child_process";
import { createWriteStream, readFileSync } from "fs";
import * as fs from "fs/promises";
import yaml from "js-yaml";
import { dirname, join, resolve } from "path";

import BuildContext from "./context.js";

let initialized = false;

async function initializeBuildEnvironment() {
    if (initialized) return;
    initialized = true;

    const dbProvider = new BetterSqlite3Provider();
    dbProvider.loadFromMemory();

    const { serverZipExportProviderFactory } = await import("@triliumnext/server/src/services/export/zip/factory.js");

    await initializeCore({
        dbConfig: {
            provider: dbProvider,
            isReadOnly: false,
            onTransactionCommit: () => {},
            onTransactionRollback: () => {}
        },
        crypto: new NodejsCryptoProvider(),
        zip: new NodejsZipProvider(),
        zipExportProviderFactory: serverZipExportProviderFactory,
        executionContext: new ClsHookedExecutionContext(),
        platform: new ServerPlatformProvider(),
        schema: readFileSync(require.resolve("@triliumnext/core/src/assets/schema.sql"), "utf-8"),
        translations: (await import("@triliumnext/server/src/services/i18n.js")).initializeTranslations,
        getDemoArchive: async () => null,
        backup: new StubBackupService(),
        image: stubImageProvider
    });
}

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
        const { zipExportService } = await import("@triliumnext/core");
        await zipExportService.exportToZipFile(noteId, format, zipFilePath, {});

        const ignoredSet = ignoredFiles ? new Set(ignoredFiles) : undefined;
        await extractZip(zipFilePath, outputPath, ignoredSet);
    } finally {
        await fs.rm(zipFilePath, { force: true });
    }
}

async function importAndExportDocs(sourcePath: string, outputSubDir: string) {
    const note = await importData(sourcePath);

    // Use a meaningful name for the temporary zip file
    const zipName = outputSubDir || "user-guide";
    const zipFilePath = `output-${zipName}.zip`;
    try {
        const { zipExportService, TaskContext } = await import("@triliumnext/core");
        const { waitForStreamToFinish } = await import("@triliumnext/server/src/services/utils.js");
        const branch = note.getParentBranches()[0];
        const taskContext = new TaskContext("no-progress-reporting", "export", null);
        const fileOutputStream = createWriteStream(zipFilePath);
        await zipExportService.exportToZip(taskContext, branch, "share", fileOutputStream);
        await waitForStreamToFinish(fileOutputStream);

        // Output to root directory if outputSubDir is empty, otherwise to subdirectory
        const outputPath = outputSubDir ? join(OUTPUT_DIR, outputSubDir) : OUTPUT_DIR;
        await extractZip(zipFilePath, outputPath);
    } finally {
        await fs.rm(zipFilePath, { force: true });
    }
}

async function buildDocsInner(config?: Config) {
    const { sql_init, becca_loader } = await import("@triliumnext/core");
    await sql_init.createInitialDatabase(true);

    // Wait for becca to be loaded before importing data
    await becca_loader.beccaLoaded;

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
    const { zipImportService, TaskContext, becca } = await import("@triliumnext/core");
    const context = new TaskContext("no-progress-reporting", "importNotes", null);

    const rootNote = becca.getRoot();
    if (!rootNote) {
        throw new Error("Missing root note for import.");
    }
    return await zipImportService.importZip(context, buffer, rootNote, {
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

    const outputStream = createWriteStream(inputFile);
    archive.pipe(outputStream);
    archive.finalize();
    const { waitForStreamToFinish } = await import("@triliumnext/server/src/services/utils.js");
    await waitForStreamToFinish(outputStream);

    try {
        return await fs.readFile(inputFile);
    } finally {
        await fs.rm(inputFile);
    }
}


export async function extractZip(
    zipFilePath: string,
    outputPath: string,
    ignoredFiles?: Set<string>
) {
    const { getZipProvider } = await import("@triliumnext/core");
    await getZipProvider().readZipFile(await fs.readFile(zipFilePath), async (entry, readContent) => {
        // We ignore directories since they can appear out of order anyway.
        if (!entry.fileName.endsWith("/") && !ignoredFiles?.has(entry.fileName)) {
            const destPath = join(outputPath, entry.fileName);
            const fileContent = await readContent();

            await fs.mkdir(dirname(destPath), { recursive: true });
            await fs.writeFile(destPath, fileContent);
        }
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

    // Initialize the build environment before using cls
    await initializeBuildEnvironment();

    // Trigger the actual build.
    await new Promise((res, rej) => {
        getContext().init(() => {
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

    // Initialize the build environment before using cls
    await initializeBuildEnvironment();

    // Trigger the actual build.
    await new Promise((res, rej) => {
        getContext().init(() => {
            buildDocsInner()
                .catch(rej)
                .then(res);
        });
    });
}
