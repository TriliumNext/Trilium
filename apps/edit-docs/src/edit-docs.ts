import debounce from "@triliumnext/client/src/services/debounce.js";
import cls from "@triliumnext/server/src/services/cls.js";
import type { AdvancedExportOptions, ExportFormat } from "@triliumnext/server/src/services/export/zip/abstract_provider.js";
import { initializeTranslations } from "@triliumnext/server/src/services/i18n.js";
import { parseNoteMetaFile } from "@triliumnext/server/src/services/in_app_help.js";
import type { NoteMetaFile } from "@triliumnext/server/src/services/meta/note_meta.js";
import type NoteMeta from "@triliumnext/server/src/services/meta/note_meta.js";
import fs from "fs/promises";
import fsExtra from "fs-extra";
import yaml from "js-yaml";
import path from "path";

import packageJson from "../package.json" with { type: "json" };
import { extractZip, importData, initializeDatabase, startElectron } from "./utils.js";

interface NoteMapping {
    rootNoteId: string;
    path: string;
    format: "markdown" | "html";
    ignoredFiles?: string[];
    exportOnly?: boolean;
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
    const config = yaml.load(configContent) as Config;

    BASE_URL = config.baseUrl;
    // Resolve all paths relative to the config file's directory (for flexibility with external configs)
    const CONFIG_DIR = path.dirname(CONFIG_PATH);
    NOTE_MAPPINGS = config.noteMappings.map((mapping) => ({
        ...mapping,
        path: path.resolve(CONFIG_DIR, mapping.path)
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

    await initializeTranslations();
    await initializeDatabase(true);

    // Wait for becca to be loaded before importing data
    const beccaLoader = await import("@triliumnext/server/src/becca/becca_loader.js");
    await beccaLoader.beccaLoaded;

    cls.init(async () => {
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
    const optionsService = (await import("@triliumnext/server/src/services/options.js")).default;
    optionsService.setOption("eraseUnusedAttachmentsAfterSeconds", 10);
    optionsService.setOption("eraseUnusedAttachmentsAfterTimeScale", 60);
    optionsService.setOption("compressImages", "false");
}

async function exportData(noteId: string, format: ExportFormat, outputPath: string, ignoredFiles?: Set<string>) {
    const zipFilePath = "output.zip";

    try {
        await fsExtra.remove(outputPath);
        await fsExtra.mkdir(outputPath);

        // First export as zip.
        const { exportToZipFile } = (await import("@triliumnext/server/src/services/export/zip.js")).default;

        const exportOpts: AdvancedExportOptions = {};
        if (format === "html") {
            exportOpts.skipHtmlTemplate = true;
            exportOpts.customRewriteLinks = (originalRewriteLinks, getNoteTargetUrl) => {
                return (content: string, noteMeta: NoteMeta) => {
                    content = content.replace(/src="[^"]*api\/images\/([a-zA-Z0-9_]+)\/[^"]*"/g, (match, targetNoteId) => {
                        const url = getNoteTargetUrl(targetNoteId, noteMeta);

                        return url ? `src="${url}"` : match;
                    });

                    content = content.replace(/src="[^"]*api\/attachments\/([a-zA-Z0-9_]+)\/image\/[^"]*"/g, (match, targetAttachmentId) => {
                        const url = findAttachment(targetAttachmentId);

                        return url ? `src="${url}"` : match;
                    });

                    content = content.replace(/href="[^"]*#root[^"]*attachmentId=([a-zA-Z0-9_]+)\/?"/g, (match, targetAttachmentId) => {
                        const url = findAttachment(targetAttachmentId);

                        return url ? `href="${url}"` : match;
                    });

                    content = content.replace(/href="[^"]*#root[a-zA-Z0-9_\/]*\/([a-zA-Z0-9_]+)[^"]*"/g, (match, targetNoteId) => {
                        const components = match.split("/");
                        components[components.length - 1] = `_help_${components[components.length - 1]}`;
                        return components.join("/");
                    });

                    return content;

                    function findAttachment(targetAttachmentId: string) {
                        let url;

                        const attachmentMeta = (noteMeta.attachments || []).find((attMeta) => attMeta.attachmentId === targetAttachmentId);
                        if (attachmentMeta) {
                            // easy job here, because attachment will be in the same directory as the note's data file.
                            url = attachmentMeta.dataFileName;
                        } else {
                            console.info(`Could not find attachment meta object for attachmentId '${targetAttachmentId}'`);
                        }
                        return url;
                    }
                };
            };
        }

        await exportToZipFile(noteId, format, zipFilePath, exportOpts);
        await extractZip(zipFilePath, outputPath, ignoredFiles);
    } finally {
        if (await fsExtra.exists(zipFilePath)) {
            await fsExtra.rm(zipFilePath);
        }
    }

    const minifyMeta = (format === "html" || format === "share");
    await cleanUpMeta(outputPath, minifyMeta);
}

async function cleanUpMeta(outputPath: string, minify: boolean) {
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

        // Rewrite web view URLs that point to root.
        if (el.type === "webView" && minify) {
            const srcAttr = el.attributes.find(attr => attr.name === "webViewSrc");
            if (srcAttr.value.startsWith("/")) {
                srcAttr.value = BASE_URL + srcAttr.value;
            }
        }
    }

    if (minify) {
        const subtree = parseNoteMetaFile(meta);
        await fs.writeFile(metaPath, JSON.stringify(subtree));
    } else {
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 4));
    }

}

async function registerHandlers() {
    const events = (await import("@triliumnext/server/src/services/events.js")).default;
    const eraseService = (await import("@triliumnext/server/src/services/erase.js")).default;
    const debouncer = debounce(async () => {
        eraseService.eraseUnusedAttachmentsNow();

        for (const mapping of NOTE_MAPPINGS) {
            const ignoredFiles = mapping.ignoredFiles ? new Set(mapping.ignoredFiles) : undefined;
            await exportData(mapping.rootNoteId, mapping.format, mapping.path, ignoredFiles);
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
