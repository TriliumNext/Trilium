import debounce from "@triliumnext/client/src/services/debounce.js";
import type { NoteMeta, NoteMetaFile } from "@triliumnext/core";
import { cls } from "@triliumnext/core";

import { buildHelpBundle } from "./help_bundle_generator.js";
import { buildHelpMeta } from "./help_meta_generator.js";
import { readFileSync } from "fs";
import fs from "fs/promises";
import { load } from "js-yaml";
import path from "path";

import packageJson from "../package.json" with { type: "json" };
import { extractZip, importData, initializeEditDocsCore, startElectron } from "./utils.js";

interface NoteMapping {
    rootNoteId: string;
    path: string;
    format: "markdown";
    ignoredFiles?: string[];
    exportOnly?: boolean;
    /**
     * Where to write the in-app help tree derived from this mapping's export, if it is the one
     * backing the User Guide. Relative to the configuration file.
     */
    helpMeta?: string;
    /** Where to write the rendered content of that tree. Relative to the configuration file. */
    helpContent?: string;
}

interface Config {
    baseUrl: string;
    noteMappings: NoteMapping[];
}

// Parse command-line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    let configPath: string | undefined;
    let showHelp = false;
    let showVersion = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--config' || args[i] === '-c') {
            configPath = args[i + 1];
            if (!configPath) {
                console.error("Error: --config/-c requires a path argument");
                process.exit(1);
            }
            i++; // Skip the next argument as it's the value
        } else if (args[i] === '--help' || args[i] === '-h') {
            showHelp = true;
        } else if (args[i] === '--version' || args[i] === '-v') {
            showVersion = true;
        }
    }

    return { configPath, showHelp, showVersion };
}

function getVersion(): string {
    return packageJson.version;
}

function printHelp() {
    const version = getVersion();
    console.log(`
Usage: trilium-edit-docs [options]

Options:
  -c, --config <path>  Path to the configuration file (default: edit-docs-config.yaml in the root)
  -h, --help           Display this help message
  -v, --version        Display version information

Version: ${version}
`);
}

function printVersion() {
    const version = getVersion();
    console.log(version);
}

const { configPath, showHelp, showVersion } = parseArgs();

if (showHelp) {
    printHelp();
    process.exit(0);
} else if (showVersion) {
    printVersion();
    process.exit(0);
}

// Configuration variables to be initialized
let BASE_URL: string;
let NOTE_MAPPINGS: NoteMapping[];

// Load configuration from edit-docs-config.yaml
async function loadConfig() {
    let CONFIG_PATH = configPath
        ? path.resolve(configPath)
        : path.join(process.cwd(), "edit-docs-config.yaml");

    const exists = await fs.access(CONFIG_PATH).then(() => true).catch(() => false);
    if (!exists && !configPath) {
        // Fallback to project root if running from within a subproject
        CONFIG_PATH = path.join(__dirname, "../../../edit-docs-config.yaml");
    }

    const configContent = await fs.readFile(CONFIG_PATH, "utf-8");
    const config = load(configContent) as Config;

    BASE_URL = config.baseUrl;
    // Resolve all paths relative to the config file's directory (for flexibility with external configs)
    const CONFIG_DIR = path.dirname(CONFIG_PATH);
    NOTE_MAPPINGS = config.noteMappings.map((mapping) => ({
        ...mapping,
        path: path.resolve(CONFIG_DIR, mapping.path),
        helpMeta: mapping.helpMeta ? path.resolve(CONFIG_DIR, mapping.helpMeta) : undefined,
        helpContent: mapping.helpContent ? path.resolve(CONFIG_DIR, mapping.helpContent) : undefined
    }));
}

async function main() {
    await loadConfig();
    const initializedPromise = startElectron(() => {
        // Wait for the import to be finished and the application to be loaded before we listen to changes.
        setTimeout(() => {
            registerHandlers();
        }, 10_000);
    });

    await initializeEditDocsCore();

    // Create the in-memory database schema and resolve dbReady (requires CLS context)
    const { sql_init, becca_loader: beccaLoader } = await import("@triliumnext/core");
    cls.init(async () => {
        cls.ignoreEntityChangeIds();
        await sql_init.createInitialDatabase(true);
        await beccaLoader.beccaLoaded;

        for (const mapping of NOTE_MAPPINGS) {
            if (!mapping.exportOnly) {
                await importData(mapping.path);
            }
        }
        setOptions();
        initializedPromise.resolve();
    });
}

async function setOptions() {
    const { options: optionsService } = await import("@triliumnext/core");
    const sql = (await import("@triliumnext/server/src/services/sql.js")).default;

    optionsService.setOption("eraseUnusedAttachmentsAfterSeconds", 10);
    optionsService.setOption("eraseUnusedAttachmentsAfterTimeScale", 60);
    optionsService.setOption("compressImages", "false");

    // Set initial note to the first visible child of root (not _hidden)
    const startNoteId = sql.getValue("SELECT noteId FROM branches WHERE parentNoteId = 'root' AND isDeleted = 0 AND noteId != '_hidden' ORDER BY notePosition") || "root";
    optionsService.setOption("openNoteContexts", JSON.stringify([{ notePath: startNoteId, active: true }]));
}

async function exportData(mapping: NoteMapping) {
    const { path: outputPath, ignoredFiles: ignoredFileNames } = mapping;
    const ignoredFiles = ignoredFileNames ? new Set(ignoredFileNames) : undefined;
    const zipFilePath = "output.zip";

    try {
        await fs.rm(outputPath, { recursive: true, force: true });
        await fs.mkdir(outputPath, { recursive: true });

        // First export as zip.
        const { zipExportService } = (await import("@triliumnext/core"));

        await zipExportService.exportToZipFile(mapping.rootNoteId, mapping.format, zipFilePath, {});
        await extractZip(zipFilePath, outputPath, ignoredFiles);
    } finally {
        await fs.rm(zipFilePath, { force: true });
    }

    await cleanUpMeta(outputPath, mapping);
}

/**
 * Normalizes the freshly exported `!!!meta.json` so it doesn't churn between runs, and — for the
 * mapping backing the User Guide — derives the in-app help tree and its rendered content.
 */
async function cleanUpMeta(outputPath: string, mapping: NoteMapping) {
    const metaPath = path.join(outputPath, "!!!meta.json");
    const meta = JSON.parse(await fs.readFile(metaPath, "utf-8")) as NoteMetaFile;
    for (const file of meta.files) {
        file.notePosition = 1;
        traverse(file);
    }

    function traverse(el: NoteMeta) {
        for (const child of el.children || []) {
            traverse(child);
        }

        el.isExpanded = false;
    }

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 4));

    if (!mapping.helpMeta && !mapping.helpContent) {
        return;
    }

    const helpMeta = buildHelpMeta(meta, BASE_URL);

    if (mapping.helpMeta) {
        await writeJson(mapping.helpMeta, helpMeta);
    }

    if (mapping.helpContent) {
        const { markdownImportService } = await import("@triliumnext/core");
        const bundle = buildHelpBundle(
            helpMeta,
            (source) => {
                try {
                    return readFileSync(path.join(outputPath, source), "utf-8");
                } catch {
                    return null;
                }
            },
            (markdown, title) => markdownImportService.renderToHtml(markdown, title)
        );

        await writeJson(mapping.helpContent, bundle);
    }
}

/** Writes JSON with one entry per line, so a docs change shows up as the pages it touched. */
async function writeJson(filePath: string, value: unknown) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 4));
}

async function registerHandlers() {
    const { events } = await import("@triliumnext/core");
    const { erase: eraseService } = await import("@triliumnext/core");
    const debouncer = debounce(async () => {
        eraseService.eraseUnusedAttachmentsNow();

        for (const mapping of NOTE_MAPPINGS) {
            await exportData(mapping);
        }
    }, 10_000);
    events.subscribe(events.ENTITY_CHANGED, async (e) => {
        if (e.entityName === "options") {
            return;
        }

        debouncer();
    });
}

main();
