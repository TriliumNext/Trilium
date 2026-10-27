/**
 * The import/export half of edit-docs, with no Electron dependency: `edit-docs.ts` runs it
 * behind a window, `sync-docs.ts` runs it headless.
 */
import { BackupService, initializeCore, type MessagingProvider, type NoteMeta, type NoteMetaFile } from "@triliumnext/core";
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
import { buildHelpBundle } from "./help_bundle_generator.js";
import { buildHelpMeta, serializeHelpMeta, stripAppVersion } from "./help_meta_generator.js";
import { openApiToMarkdown, type OpenApiSpec } from "./openapi_markdown.js";
import { runTypeDoc, typeDocToDeclarations, type TypeDocMarkdownOptions, typeDocToMarkdown } from "./typedoc_markdown.js";

export interface NoteMapping {
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
    /** Pages whose Markdown is generated from an OpenAPI document before every import. */
    openApiPages?: OpenApiPage[];
    /** Pages whose Markdown is generated from TypeScript declarations before every import. */
    typeDocPages?: TypeDocPage[];
}

export interface OpenApiPage {
    /** A text note of this mapping with a Markdown data file. */
    noteId: string;
    /** The OpenAPI document in YAML. Relative to the configuration file. */
    spec: string;
}

export interface TypeDocPage extends TypeDocMarkdownOptions {
    /** A text note of this mapping with a Markdown data file. */
    noteId: string;
    /** The module whose exports the page documents. Relative to the configuration file. */
    entryPoint: string;
    /** The tsconfig that compiles it. Relative to the configuration file. */
    tsconfig: string;
    /**
     * Where to also write the declarations as compact TypeScript, for the LLM skill sheets that
     * `load_skill` serves. Relative to the configuration file.
     */
    skillReference?: string;
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
            path: path.resolve(configDir, mapping.path),
            helpMeta: mapping.helpMeta ? path.resolve(configDir, mapping.helpMeta) : undefined,
            helpContent: mapping.helpContent ? path.resolve(configDir, mapping.helpContent) : undefined,
            openApiPages: mapping.openApiPages?.map((page) => ({ ...page, spec: path.resolve(configDir, page.spec) })),
            typeDocPages: mapping.typeDocPages?.map((page) => ({
                ...page,
                entryPoint: path.resolve(configDir, page.entryPoint),
                tsconfig: path.resolve(configDir, page.tsconfig),
                skillReference: page.skillReference ? path.resolve(configDir, page.skillReference) : undefined
            }))
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
            await writeGeneratedPages(mapping);
            await importData(mapping.path);
        }
    }
}

/** Exports every mapping, in config order, replacing each target directory. */
export async function exportMappings(mappings: NoteMapping[], baseUrl: string) {
    for (const mapping of mappings) {
        await exportData(mapping, baseUrl);
    }
}

/**
 * Regenerates the Markdown of the mapping's `openApiPages` and `typeDocPages` from their sources,
 * and the skill references of the `typeDocPages` that name one.
 */
async function writeGeneratedPages(mapping: NoteMapping) {
    const pages = [
        ...(mapping.openApiPages ?? []).map((page) => ({
            noteId: page.noteId,
            render: async () => openApiToMarkdown(load(await fs.readFile(page.spec, "utf-8")) as OpenApiSpec)
        })),
        ...(mapping.typeDocPages ?? []).map((page) => ({
            noteId: page.noteId,
            render: async () => {
                const project = await runTypeDoc(page.entryPoint, page.tsconfig);
                if (page.skillReference) {
                    await writeArtifact(page.skillReference, renderSkillReference(project, page));
                }
                return typeDocToMarkdown(project, page);
            }
        }))
    ];
    if (!pages.length) {
        return;
    }

    const meta = JSON.parse(await fs.readFile(path.join(mapping.path, "!!!meta.json"), "utf-8")) as NoteMetaFile;
    for (const page of pages) {
        const found = findDataFile(meta.files, page.noteId);
        if (!found?.dataFile.endsWith(".md")) {
            throw new Error(`Generated page ${page.noteId} needs a Markdown data file in ${mapping.path}.`);
        }

        const markdown = await toExportedMarkdown(await page.render(), found.note.title ?? "");
        await fs.writeFile(path.join(mapping.path, found.dataFile), markdown);
    }
}

/** The skill reference of a TypeDoc page: its declarations under a heading `readSkill()` appends. */
function renderSkillReference(project: Awaited<ReturnType<typeof runTypeDoc>>, page: TypeDocPage) {
    return [
        `<!-- Generated from ${path.basename(page.entryPoint)} by \`pnpm edit-docs:sync-docs\`. Do not edit. -->`,
        "## API reference",
        "Every member of `api` and of the objects it returns, as TypeScript declarations, each under the first sentence of its description.",
        `\`\`\`ts\n${typeDocToDeclarations(project, page)}\n\`\`\``
    ].join("\n\n") + "\n";
}

/**
 * Converts generated Markdown to the form `MarkdownExportProvider` writes, so an import that no
 * export follows leaves the page unchanged on disk.
 */
async function toExportedMarkdown(markdown: string, title: string) {
    const { markdownImportService, markdownExportService } = await import("@triliumnext/core");
    const html = markdownImportService.renderToHtml(markdown, title);
    const exported = markdownExportService.toMarkdown(html);
    return exported.startsWith("# ") ? exported : `# ${title}\n${exported}`;
}

/** A note's meta and the path of its data file relative to the export root. */
function findDataFile(
    notes: NoteMeta[], noteId: string, dir = ""
): { note: NoteMeta; dataFile: string } | undefined {
    for (const note of notes) {
        if (note.noteId === noteId) {
            return note.dataFileName
                ? { note, dataFile: path.join(dir, note.dataFileName) }
                : undefined;
        }

        const found = findDataFile(note.children ?? [], noteId, path.join(dir, note.dirFileName ?? ""));
        if (found) {
            return found;
        }
    }

    return undefined;
}

export async function exportData(mapping: NoteMapping, baseUrl: string) {
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

    await cleanUpMeta(outputPath, mapping, baseUrl);
}

/**
 * Normalizes the freshly exported `!!!meta.json` so it doesn't churn between runs, and — for the
 * mapping backing the User Guide — derives the in-app help tree and its rendered content.
 */
async function cleanUpMeta(outputPath: string, mapping: NoteMapping, baseUrl: string) {
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

    await fs.writeFile(metaPath, JSON.stringify(stripAppVersion(meta), null, 4));

    if (!mapping.helpMeta && !mapping.helpContent) {
        return;
    }

    const { meta: helpMeta, sources } = buildHelpMeta(meta, baseUrl);

    if (mapping.helpMeta) {
        await writeArtifact(mapping.helpMeta, serializeHelpMeta(helpMeta));
    }

    if (mapping.helpContent) {
        const { markdownImportService } = await import("@triliumnext/core");
        const bundle = buildHelpBundle(
            helpMeta,
            sources,
            (source) => {
                try {
                    return readFileSync(path.join(outputPath, source), "utf-8");
                } catch {
                    return null;
                }
            },
            (markdown, title) => markdownImportService.renderToHtml(markdown, title)
        );

        // One page per line: the bundle is a flat map from note ID to HTML.
        await writeArtifact(mapping.helpContent, JSON.stringify(bundle, null, 4));
    }
}

/** Writes a generated help artifact, creating its directory if needed. */
async function writeArtifact(filePath: string, content: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
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
 * does elsewhere. The exported trees (`docs/`, the demo) are stored with LF, and
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
