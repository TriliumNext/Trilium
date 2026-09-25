/**
 * The import/export half of edit-docs, with no Electron dependency: `edit-docs.ts` runs it
 * behind a window, `sync-docs.ts` runs it headless.
 */
import { BackupService, initializeCore, type AdvancedExportOptions, type MessagingProvider, type NoteMeta, type NoteMetaFile } from "@triliumnext/core";
import AsyncLocalStorageExecutionContext from "@triliumnext/server/src/cls_provider.js";
import NodejsCryptoProvider from "@triliumnext/server/src/crypto_provider.js";
import ServerPlatformProvider from "@triliumnext/server/src/platform_provider.js";
import { serverImageProvider } from "@triliumnext/server/src/services/image_provider.js";
import BetterSqlite3Provider from "@triliumnext/server/src/sql_provider.js";
import NodejsZipProvider from "@triliumnext/server/src/zip_provider.js";
import { type Archiver, ZipArchive } from "archiver";
import { createWriteStream, readFileSync, type WriteStream } from "fs";
import fs from "fs/promises";
import { load } from "js-yaml";
import path from "path";

import { deferred } from "../../../packages/commons/src/index.js";
import { parseNoteMetaFile, serverTextNoteHandler, standaloneTextNoteHandler, stripAppVersion } from "./help_meta_generator.js";

export interface NoteMapping {
    rootNoteId: string;
    path: string;
    format: "markdown" | "html";
    ignoredFiles?: string[];
    exportOnly?: boolean;
}

export interface Config {
    baseUrl: string;
    noteMappings: NoteMapping[];
}

/**
 * Reads `edit-docs-config.yaml`: the given path, else the current directory, else the repository
 * root. Mapping paths resolve against the config file's directory.
 */
export async function loadConfig(configPath?: string): Promise<Config> {
    let resolvedPath = configPath
        ? path.resolve(configPath)
        : path.join(process.cwd(), "edit-docs-config.yaml");

    const exists = await fs.access(resolvedPath).then(() => true).catch(() => false);
    if (!exists && !configPath) {
        resolvedPath = path.join(__dirname, "../../../edit-docs-config.yaml");
    }

    const config = load(await fs.readFile(resolvedPath, "utf-8")) as Config;
    const configDir = path.dirname(resolvedPath);
    return {
        baseUrl: config.baseUrl,
        noteMappings: config.noteMappings.map((mapping) => ({
            ...mapping,
            path: path.resolve(configDir, mapping.path)
        }))
    };
}

// Stub backup service (not used in edit-docs, but required by initializeCore)
class StubBackupService extends BackupService {
    constructor() {
        super({ getOption: () => "", getOptionOrNull: () => null, getOptionBool: () => false, setOption: () => {} });
    }
    scheduleBackups(): void {}
    async backupNow(_name: string): Promise<string> {
        throw new Error("Backup not supported in edit-docs");
    }
    async getExistingBackups() {
        return [];
    }
    async getBackupContent(_filePath: string): Promise<Uint8Array | null> {
        return null;
    }
}

/**
 * Initializes core against an in-memory database. `messaging` is the IPC provider when a window
 * is attached; headless runs pass none.
 */
export async function initializeDocsCore(messaging?: MessagingProvider) {
    const dbProvider = new BetterSqlite3Provider();
    dbProvider.loadFromMemory();

    const { serverZipExportProviderFactory } = await import("@triliumnext/server/src/services/export/zip/factory.js");

    await initializeCore({
        dbConfig: {
            provider: dbProvider,
            isReadOnly: false,
            async onTransactionCommit() {
                if (!messaging) {
                    return;
                }
                const { ws } = await import("@triliumnext/core");
                ws.sendTransactionEntityChangesToAllClients();
            },
            onTransactionRollback: () => {}
        },
        crypto: new NodejsCryptoProvider(),
        zip: new NodejsZipProvider(),
        zipExportProviderFactory: serverZipExportProviderFactory,
        executionContext: new AsyncLocalStorageExecutionContext(),
        platform: new ServerPlatformProvider(),
        schema: readFileSync(require.resolve("@triliumnext/core/src/assets/schema.sql"), "utf-8"),
        translations: (await import("@triliumnext/server/src/services/i18n.js")).initializeTranslationsWithParams,
        messaging,
        getDemoArchive: async () => null,
        backup: new StubBackupService(),
        image: serverImageProvider
    });
}

export async function importData(path: string) {
    const buffer = await createImportZip(path);
    const { zipImportService, TaskContext, becca } = (await import("@triliumnext/core"));
    const context = new TaskContext("no-progress-reporting", "importNotes", null);

    const rootNote = becca.getRoot();
    if (!rootNote) {
        throw new Error("Missing root note for import.");
    }
    await zipImportService.importZip(context, buffer, rootNote, {
        preserveIds: true
    });
}

/** Imports every mapping that is not `exportOnly`, in config order. */
export async function importMappings(mappings: NoteMapping[]) {
    for (const mapping of mappings) {
        if (!mapping.exportOnly) {
            await importData(mapping.path);
        }
    }
}

/** Exports every mapping, in config order, replacing each target directory. */
export async function exportMappings(mappings: NoteMapping[], baseUrl: string) {
    for (const mapping of mappings) {
        const ignoredFiles = mapping.ignoredFiles ? new Set(mapping.ignoredFiles) : undefined;
        await exportData(mapping.rootNoteId, mapping.format, mapping.path, baseUrl, ignoredFiles);
    }
}

export async function exportData(noteId: string, format: "markdown" | "html", outputPath: string, baseUrl: string, ignoredFiles?: Set<string>) {
    const zipFilePath = "output.zip";

    try {
        await fs.rm(outputPath, { recursive: true, force: true });
        await fs.mkdir(outputPath, { recursive: true });

        // First export as zip.
        const { zipExportService } = (await import("@triliumnext/core"));

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

                    content = rewriteHelpLinks(content);

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

        await zipExportService.exportToZipFile(noteId, format, zipFilePath, exportOpts);
        await extractZip(zipFilePath, outputPath, ignoredFiles);
    } finally {
        await fs.rm(zipFilePath, { force: true });
    }

    await cleanUpMeta(outputPath, format === "html", baseUrl);
}

async function cleanUpMeta(outputPath: string, minify: boolean, baseUrl: string) {
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
                srcAttr.value = baseUrl + srcAttr.value;
            }
        }
    }

    if (minify) {
        const subtree = parseNoteMetaFile(meta, serverTextNoteHandler, baseUrl);
        await fs.writeFile(metaPath, JSON.stringify(subtree));

        // Generate standalone meta: webView-based, pointing to online docs.
        const standaloneSubtree = parseNoteMetaFile(meta, standaloneTextNoteHandler, baseUrl);
        const standaloneMetaPath = path.resolve(__dirname, "../../standalone/src/assets/help_meta.json");
        await fs.writeFile(standaloneMetaPath, JSON.stringify(standaloneSubtree));
    } else {
        await fs.writeFile(metaPath, JSON.stringify(stripAppVersion(meta), null, 4));
    }
}

async function createImportZip(path: string) {
    const inputFile = "input.zip";
    const archive = new ZipArchive({
        zlib: { level: 0 }
    });

    archive.directory(path, "/");

    const outputStream = createWriteStream(inputFile);
    archive.pipe(outputStream);
    await waitForEnd(archive, outputStream);

    try {
        return await fs.readFile(inputFile);
    } finally {
        await fs.rm(inputFile);
    }
}

function waitForEnd(archive: Archiver, stream: WriteStream) {
    return new Promise<void>((res, rej) => {
        stream.on("finish", res);
        stream.on("error", rej);
        archive.on("error", rej);
        archive.finalize().catch(rej);
    });
}

/**
 * Rewrites internal `#root/...` note links in exported help HTML so that they resolve
 * against the help subtree once imported into a production Trilium instance.
 *
 * In the edit-docs instance the help notes carry plain, randomly generated IDs, but in
 * production they live under the `_help` subtree with a `_help_` prefix. This adds that
 * prefix to the link's target note ID, and reduces the link to that ID alone: the editor
 * writes a full note path when a link is created, whose intermediate IDs belong to the
 * docs instance and match nothing in the tree a reader has, leaving the client to fall
 * back to the note's own path. The importer writes the same single-ID form, so a note
 * exported straight after an edit now matches one that has been through an import.
 */
export function rewriteHelpLinks(content: string): string {
    return content.replace(/href="([^"]*#root)(?:[a-zA-Z0-9_/]*\/)?([a-zA-Z0-9_]+)([^"]*)"/g,
        (match, prefix: string, targetNoteId: string, suffix: string) => {
            if (targetNoteId.startsWith("_help_")) {
                return `href="${prefix}/${targetNoteId}${suffix}"`;
            }

            // Canonical hidden-subtree notes (e.g. _options, _optionsTextNotes) keep their IDs in
            // production, so they already start with an underscore, and their path is a real one.
            // Only help notes (random alphanumeric IDs) get the `_help_` prefix; prefixing the
            // others would produce broken `_help__optionsTextNotes`-style links (see issue #9646).
            if (targetNoteId.startsWith("_")) {
                return match;
            }
            return `href="${prefix}/_help_${targetNoteId}${suffix}"`;
        });
}

export async function createZipFromDirectory(dirPath: string, zipPath: string) {
    const archive = new ZipArchive({ zlib: { level: 5 } });
    const outputStream = createWriteStream(zipPath);
    archive.directory(dirPath, false);
    archive.pipe(outputStream);
    await waitForEnd(archive, outputStream);
}

export async function extractZip(zipFilePath: string, outputPath: string, ignoredFiles?: Set<string>) {
    const promise = deferred<void>();
    setTimeout(async () => {
        const { getZipProvider } = (await import("@triliumnext/core"));
        const zipProvider = getZipProvider();
        const buffer = await fs.readFile(zipFilePath);
        await zipProvider.readZipFile(buffer, async (entry, readContent) => {
            // We ignore directories since they can appear out of order anyway.
            if (!entry.fileName.endsWith("/") && !ignoredFiles?.has(entry.fileName)) {
                const destPath = path.join(outputPath, entry.fileName);
                const fileContent = await readContent();

                await fs.mkdir(path.dirname(destPath), { recursive: true });
                await fs.writeFile(destPath, normalizeLineEndings(fileContent));
            }
        });
        promise.resolve();
    }, 1000);
    await promise;
}

/**
 * Rewrites CRLF line endings to LF, so that `extractZip` writes the same bytes on Windows as it
 * does elsewhere. The exported trees (`docs/`, the help HTML, the demo) are stored with LF, and
 * Git only hides the difference once a file is staged.
 *
 * Binary entries such as images keep their bytes. They are detected the way Git detects them: a
 * NUL byte within the first {@link BINARY_DETECTION_LENGTH} bytes marks the content as binary.
 */
export function normalizeLineEndings(content: Uint8Array): Uint8Array {
    if (isBinary(content)) {
        return content;
    }

    const normalized = new Uint8Array(content.length);
    let length = 0;
    for (const [index, byte] of content.entries()) {
        if (byte === CARRIAGE_RETURN && content[index + 1] === LINE_FEED) {
            continue;
        }

        normalized[length++] = byte;
    }

    return length === content.length ? content : normalized.subarray(0, length);
}

const NUL = 0x00;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const BINARY_DETECTION_LENGTH = 8000;

function isBinary(content: Uint8Array) {
    const end = Math.min(content.length, BINARY_DETECTION_LENGTH);
    for (let index = 0; index < end; index++) {
        if (content[index] === NUL) {
            return true;
        }
    }

    return false;
}
