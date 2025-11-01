import fs from "fs/promises";
import fsExtra from "fs-extra";
import path from "path";
import type { NoteMetaFile } from "@triliumnext/server/src/services/meta/note_meta.js";
import { initializeTranslations } from "@triliumnext/server/src/services/i18n.js";
import debounce from "@triliumnext/client/src/services/debounce.js";
import { extractZip, importData, initializeDatabase, startElectron } from "./utils.js";
import cls from "@triliumnext/server/src/services/cls.js";
import type { AdvancedExportOptions, ExportFormat } from "@triliumnext/server/src/services/export/zip/abstract_provider.js";
import { parseNoteMetaFile } from "@triliumnext/server/src/services/in_app_help.js";
import type NoteMeta from "@triliumnext/server/src/services/meta/note_meta.js";

interface NoteMapping {
    rootNoteId: string;
    path: string;
    format: "markdown" | "html";
    ignoredFiles?: string[];
    exportOnly?: boolean;
}

const { DOCS_ROOT, USER_GUIDE_ROOT } = process.env;
if (!DOCS_ROOT || !USER_GUIDE_ROOT) {
    throw new Error("Missing DOCS_ROOT or USER_GUIDE_ROOT environment variable.");
}

const NOTE_MAPPINGS: NoteMapping[] = [
    {
        rootNoteId: "pOsGYCXsbNQG",
        path: path.join(__dirname, DOCS_ROOT, "User Guide"),
        format: "markdown"
    },
    {
        rootNoteId: "pOsGYCXsbNQG",
        path: path.join(__dirname, USER_GUIDE_ROOT),
        format: "html",
        ignoredFiles: ["index.html", "navigation.html", "style.css", "User Guide.html"],
        exportOnly: true
    },
    {
        rootNoteId: "jdjRLhLV3TtI",
        path: path.join(__dirname, DOCS_ROOT, "Developer Guide"),
        format: "markdown"
    },
    {
        rootNoteId: "hD3V4hiu2VW4",
        path: path.join(__dirname, DOCS_ROOT, "Release Notes"),
        format: "markdown"
    }
];

async function main() {
    const initializedPromise = startElectron(() => {
        // Wait for the import to be finished and the application to be loaded before we listen to changes.
        setTimeout(() => registerHandlers(), 10_000);
    });

    await initializeTranslations();
    await initializeDatabase(true);

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

    const minifyMeta = (format === "html");
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

        console.log("Got entity changed", e.entityName, e.entity.title);
        debouncer();
    });
}

main();
