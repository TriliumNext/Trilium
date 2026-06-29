import { NoteType } from "@triliumnext/commons";
import sanitize from "sanitize-filename";

import packageInfo from "../../../package.json" with { type: "json" };
import becca from "../../becca/becca.js";
import BBranch from "../../becca/entities/bbranch.js";
import type BNote from "../../becca/entities/bnote.js";
import dateUtils from "../utils/date.js";
import { getLog } from "../log.js";
import protectedSessionService from "../protected_session.js";
import TaskContext from "../task_context.js";
import { getZipProvider } from "../zip_provider.js";
import { getContentDisposition } from "../utils/index"
import { AdvancedExportOptions, ZipExportProviderData } from "./zip/abstract_provider.js";
import { getZipExportProviderFactory } from "./zip_export_provider_factory.js";
import { AttachmentMeta, AttributeMeta, ExportFormat, NoteMeta, NoteMetaFile } from "../../meta";
import { ValidationError } from "../../errors";
import { extname } from "../utils/path";
import { truncateUtf8Bytes } from "../utils/binary";
import { rewriteMarkdownContentLinks, isMarkdownCodeNote } from "./rewrite_links.js";

// Most filesystems cap a single path component at 255 bytes; keep exported file names within that.
const MAX_FILENAME_BYTES = 255;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exportToZip(taskContext: TaskContext<"export">, branch: BBranch, format: ExportFormat, res: Record<string, any>, setHeaders = true, zipExportOptions?: AdvancedExportOptions) {
    const archive = getZipProvider().createZipArchive();
    const rewriteFn = (zipExportOptions?.customRewriteLinks ? zipExportOptions?.customRewriteLinks(rewriteLinks, getNoteTargetUrl) : rewriteLinks);
    const provider = await buildProvider();
    const log = getLog();

    const noteIdToMeta: Record<string, NoteMeta> = {};

    async function buildProvider() {
        const providerData: ZipExportProviderData = {
            getNoteTargetUrl,
            archive,
            branch,
            rewriteFn,
            zipExportOptions
        };

        return getZipExportProviderFactory()(format, providerData);
    }

    function getUniqueFilename(existingFileNames: Record<string, number>, fileName: string) {
        const lcFileName = fileName.toLowerCase();

        if (lcFileName in existingFileNames) {
            let index;
            let newName;

            do {
                index = existingFileNames[lcFileName]++;

                newName = `${index}_${lcFileName}`;
            } while (newName in existingFileNames);

            return `${index}_${fileName}`;
        }
        existingFileNames[lcFileName] = 1;

        return fileName;

    }

    function getDataFileName(type: NoteType | null, mime: string, baseFileName: string, existingFileNames: Record<string, number>): string {
        let fileName = baseFileName.trim();
        if (!fileName) {
            fileName = "note";
        }

        const existingExtension = extname(fileName).toLowerCase();
        const newExtension = provider.mapExtension(type, mime, existingExtension, format);

        // if the note is already named with the extension (e.g. "image.jpg"), then it's silly to append the exact same extension again
        const extension = newExtension && existingExtension !== `.${newExtension.toLowerCase()}` ? `.${newExtension}` : "";

        // sanitize() strips illegal filename characters; we then byte-truncate the base
        // name so the whole entry (extension included) stays within the 255-byte
        // filesystem limit without ever chopping the extension off long / multi-byte
        // titles and attachment names. This replaces the old arbitrary 30-char cap.
        const base = truncateUtf8Bytes(sanitize(fileName), MAX_FILENAME_BYTES - extension.length);

        return getUniqueFilename(existingFileNames, `${base}${extension}`);
    }

    function createNoteMeta(branch: BBranch, parentMeta: Partial<NoteMeta>, existingFileNames: Record<string, number>): NoteMeta | null {
        const note = branch.getNote();

        if (note.hasOwnedLabel("excludeFromExport")) {
            return null;
        }

        const title = note.getTitleOrProtected();
        const completeTitle = branch.prefix ? `${branch.prefix} - ${title}` : title;
        let baseFileName = sanitize(completeTitle);
        if (format === "share") {
            baseFileName = sanitize(note.getOwnedLabelValue("shareAlias") || baseFileName);
        }

        if (baseFileName.length > 200) {
            // the actual limit is 256 bytes(!) but let's be conservative
            baseFileName = baseFileName.substr(0, 200);
        }

        if (!parentMeta.notePath) {
            throw new Error("Missing parent note path.");
        }
        const notePath = parentMeta.notePath.concat([note.noteId]);

        if (note.noteId in noteIdToMeta) {
            const extension = provider.mapExtension("text", "text/html", "", format);
            const fileName = getUniqueFilename(existingFileNames, `${baseFileName}.clone.${extension}`);

            const meta: NoteMeta = {
                isClone: true,
                noteId: note.noteId,
                notePath,
                title: note.getTitleOrProtected(),
                prefix: branch.prefix,
                dataFileName: fileName,
                type: "text", // export will have text description
                format: (format === "markdown" ? "markdown" : "html")
            };
            return meta;
        }

        const meta: Partial<NoteMeta> = {};
        meta.isClone = false;
        meta.noteId = note.noteId;
        meta.notePath = notePath;
        meta.title = note.getTitleOrProtected();
        meta.notePosition = branch.notePosition;
        meta.prefix = branch.prefix;
        meta.isExpanded = branch.isExpanded;
        meta.type = note.type;
        meta.mime = note.mime;
        meta.attributes = note.getOwnedAttributes().map((attribute) => {
            const attrMeta: AttributeMeta = {
                type: attribute.type,
                name: attribute.name,
                value: attribute.value,
                isInheritable: attribute.isInheritable,
                position: attribute.position
            };

            return attrMeta;
        });

        taskContext.increaseProgressCount();

        if (note.type === "text") {
            meta.format = (format === "markdown" ? "markdown" : "html");
        }

        noteIdToMeta[note.noteId] = meta as NoteMeta;

        // sort children for having a stable / reproducible export format
        note.sortChildren();
        const childBranches = note.getChildBranches().filter((branch) => branch?.noteId !== "_hidden");

        let shouldIncludeFile = (!note.isProtected || protectedSessionService.isProtectedSessionAvailable());
        if (format !== "share") {
            shouldIncludeFile = shouldIncludeFile && (note.getContent().length > 0 || childBranches.length === 0);
        }

        // if it's a leaf, then we'll export it even if it's empty
        if (shouldIncludeFile) {
            meta.dataFileName = getDataFileName(note.type, note.mime, baseFileName, existingFileNames);
        }

        const attachments = note.getAttachments();
        meta.attachments = attachments
            .toSorted((a, b) => ((a.attachmentId ?? "").localeCompare(b.attachmentId ?? "", "en") ?? 1))
            .map((attachment) => {
                const attMeta: AttachmentMeta = {
                    attachmentId: attachment.attachmentId,
                    title: attachment.title,
                    role: attachment.role,
                    mime: attachment.mime,
                    position: attachment.position,
                    dataFileName: getDataFileName(null, attachment.mime, `${baseFileName  }_${  attachment.title}`, existingFileNames)
                };
                return attMeta;
            });

        if (childBranches.length > 0) {
            meta.dirFileName = getUniqueFilename(existingFileNames, baseFileName);
            meta.children = [];

            // namespace is shared by children in the same note
            const childExistingNames = {};

            for (const childBranch of childBranches) {
                if (!childBranch) {
                    continue;
                }

                const note = createNoteMeta(childBranch, meta as NoteMeta, childExistingNames);

                // can be undefined if export is disabled for this note
                if (note) {
                    meta.children.push(note);
                }
            }
        }

        return meta as NoteMeta;
    }

    function getNoteTargetUrl(targetNoteId: string, sourceMeta: NoteMeta): string | null {
        const targetMeta = noteIdToMeta[targetNoteId];

        if (!targetMeta || !targetMeta.notePath || !sourceMeta.notePath) {
            return null;
        }

        const targetPath = targetMeta.notePath.slice();
        const sourcePath = sourceMeta.notePath.slice();

        // > 1 for the edge case that targetPath and sourcePath are exact same (a link to itself)
        while (targetPath.length > 1 && sourcePath.length > 1 && targetPath[0] === sourcePath[0]) {
            targetPath.shift();
            sourcePath.shift();
        }

        let url = "../".repeat(sourcePath.length - 1);

        for (let i = 0; i < targetPath.length - 1; i++) {
            const meta = noteIdToMeta[targetPath[i]];
            if (meta === rootMeta && format === "share") {
                continue;
            }

            if (meta.dirFileName) {
                url += `${encodeURIComponent(meta.dirFileName)}/`;
            }
        }

        const meta = noteIdToMeta[targetPath[targetPath.length - 1]];

        // link can target note which is only "folder-note" and as such, will not have a file in an export
        url += encodeURIComponent(meta.dataFileName || meta.dirFileName || "");

        return url;
    }

    function rewriteLinks(content: string, noteMeta: NoteMeta): string {
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
            const url = getNoteTargetUrl(targetNoteId, noteMeta);

            return url ? `href="${url}"` : match;
        });

        if (format === "share") {
            content = content.replace(/src="[^"]*api\/notes\/([a-zA-Z0-9_]+)\/download"/g, (match, targetNoteId) => {
                const url = getNoteTargetUrl(targetNoteId, noteMeta);

                return url ? `src="${url}"` : match;
            });
        }

        return content;

        function findAttachment(targetAttachmentId: string) {
            let url;

            const attachmentMeta = (noteMeta.attachments || []).find((attMeta) => attMeta.attachmentId === targetAttachmentId);
            if (attachmentMeta) {
                // easy job here, because attachment will be in the same directory as the note's data file.
                url = attachmentMeta.dataFileName;
            } else {
                log.info(`Could not find attachment meta object for attachmentId '${targetAttachmentId}'`);
            }
            return url;
        }
    }

    function prepareContent(title: string, content: string | Uint8Array, noteMeta: NoteMeta, note?: BNote): string | Uint8Array {
        const isText = ["html", "markdown"].includes(noteMeta?.format || "");
        if (isText) {
            content = content.toString();
        }

        content = provider.prepareContent(title, content, noteMeta, note, branch);

        // Rewrite markdown-style links for code notes with markdown MIME.
        // These notes store content as markdown (not HTML), so the HTML-based
        // rewriteLinks in the providers won't match their link syntax.
        if (noteMeta.type === "code" && isMarkdownCodeNote(noteMeta.mime) && typeof content === "string") {
            content = rewriteMarkdownContentLinks(content, noteMeta, getNoteTargetUrl);
        }

        return content;
    }

    async function saveNote(noteMeta: NoteMeta, filePathPrefix: string) {
        if (!noteMeta.noteId || noteMeta.title === undefined) {
            throw new Error("Missing note meta.");
        }

        if (noteMeta.isClone) {
            const targetUrl = getNoteTargetUrl(noteMeta.noteId, noteMeta);

            let content: string | Uint8Array = `<p>This is a clone of a note. Go to its <a href="${targetUrl}">primary location</a>.</p>`;

            content = prepareContent(noteMeta.title, content, noteMeta, undefined);

            archive.append(typeof content === "string" ? content : new Uint8Array(content), {
                name: filePathPrefix + noteMeta.dataFileName
            });

            return;
        }

        const note = becca.getNote(noteMeta.noteId);
        if (!note) {
            throw new Error("Unable to find note.");
        }
        if (!note.utcDateModified) {
            throw new Error("Unable to find modification date.");
        }

        if (noteMeta.dataFileName) {
            const content = prepareContent(noteMeta.title, note.getContent(), noteMeta, note);

            archive.append(content as string | Uint8Array, {
                name: filePathPrefix + noteMeta.dataFileName,
                date: dateUtils.parseDateTime(note.utcDateModified),
                store: shouldStoreUncompressed(noteMeta.mime)
            });

            // Pace the synchronous tree walk against the archive's drain so the
            // whole export isn't buffered into archiver's queue at once.
            await archive.waitForCapacity?.();
        }

        taskContext.increaseProgressCount();

        for (const attachmentMeta of noteMeta.attachments || []) {
            if (!attachmentMeta.attachmentId) {
                continue;
            }

            const attachment = note.getAttachmentById(attachmentMeta.attachmentId);
            // getContent() already returns a string or a Uint8Array; the binary
            // case can be appended as-is (the zip provider handles the Buffer
            // conversion), so avoid an extra full copy of the blob here.
            const content = attachment.getContent();

            archive.append(content, {
                name: filePathPrefix + attachmentMeta.dataFileName,
                date: dateUtils.parseDateTime(note.utcDateModified),
                store: shouldStoreUncompressed(attachmentMeta.mime)
            });

            await archive.waitForCapacity?.();
        }

        if (noteMeta.children?.length || 0 > 0) {
            const directoryPath = filePathPrefix !== "" || format !== "share" ? filePathPrefix + noteMeta.dirFileName : "";

            // create directory
            if (directoryPath) {
                archive.append("", { name: `${directoryPath}/`, date: dateUtils.parseDateTime(note.utcDateModified) });
            }

            for (const childMeta of noteMeta.children || []) {
                await saveNote(childMeta, `${directoryPath}/`);
            }
        }
    }

    const existingFileNames: Record<string, number> = format === "html" ? { navigation: 0, index: 1 } : {};
    const rootMeta = createNoteMeta(branch, { notePath: [] }, existingFileNames);
    if (!rootMeta) {
        throw new Error("Unable to create root meta.");
    }

    const metaFile: NoteMetaFile = {
        formatVersion: 2,
        appVersion: packageInfo.version,
        files: [rootMeta]
    };

    provider.prepareMeta(metaFile);

    try {
        for (const noteMeta of Object.values(noteIdToMeta)) {
            // filter out relations which are not inside this export
            noteMeta.attributes = (noteMeta.attributes || []).filter((attr) => {
                if (attr.type !== "relation") {
                    return true;
                } else if (attr.value in noteIdToMeta) {
                    return true;
                } else if (attr.value === "root" || attr.value?.startsWith("_")) {
                    // relations to "named" noteIds can be preserved
                    return true;
                }
                return false;
            });
        }

        if (!rootMeta) {
            // corner case of disabled export for exported note
            if ("sendStatus" in res) {
                res.sendStatus(400);
            }
            return;
        }
    } catch (e: unknown) {
        const message = `Export failed with error: ${e instanceof Error ? e.message : String(e)}`;
        log.error(message);
        taskContext.reportError(message);

        if ("sendStatus" in res) {
            res.removeHeader("Content-Disposition");
            res.removeHeader("Content-Type");
            res.status(500).send(message);
        }
    }

    const note = branch.getNote();
    const zipFileName = `${branch.prefix ? `${branch.prefix} - ` : ""}${note.getTitleOrProtected()}.zip`;

    if (setHeaders && "setHeader" in res) {
        res.setHeader("Content-Disposition", getContentDisposition(zipFileName));
        res.setHeader("Content-Type", "application/zip");
    }

    // Start streaming to the destination *before* appending content. The archiver
    // drains each appended blob as it is added, so memory stays bounded instead of
    // buffering the whole export. Trade-off: a failure while reading content mid-
    // export can no longer produce a clean HTTP error (bytes are already on the
    // wire); the validation that can fail cleanly runs in the try/catch above.
    archive.pipe(res);

    const metaFileJson = JSON.stringify(metaFile, null, "\t");

    archive.append(metaFileJson, { name: "!!!meta.json" });

    // The metadata pass above already drove the bare progress count. Reset it and seed the total with the
    // number of notes about to be written so the content-writing pass renders a clean 0→100% progress bar.
    taskContext.resetProgressCount();
    const noteCount = countMetaNodes(rootMeta);
    taskContext.setTotalCount(noteCount);

    // A single summary line instead of one log entry per note — per-note logging floods the log file and
    // stdout on large exports (e.g. 20k lines for a 20k-note subtree) for no operational benefit.
    log.info(`Exporting ${noteCount} notes with format '${format}'`);

    await saveNote(rootMeta, "");

    provider.afterDone(rootMeta);

    await archive.finalize();

    // Report success here only for an HTTP response, whose bytes are on the wire once finalize() resolves.
    // A file (or other) stream isn't durably written until its "finish" event — which the caller awaits via
    // waitForFinish() — so for those the caller emits taskSucceeded after the flush, not here, to avoid
    // reporting success before a late write error (e.g. a full disk) leaves a truncated archive.
    if ("setHeader" in res) {
        taskContext.taskSucceeded(null);
    }
}

/** Counts the notes in a metadata tree — i.e. the number of `saveNote()` calls the content-writing pass will make. */
function countMetaNodes(meta: NoteMeta): number {
    let count = 1;
    for (const child of meta.children || []) {
        count += countMetaNodes(child);
    }
    return count;
}

async function exportToZipFile(noteId: string, format: ExportFormat, zipFilePath: string, zipExportOptions?: AdvancedExportOptions) {
    const { destination, waitForFinish } = getZipProvider().createFileStream(zipFilePath);
    const taskContext = new TaskContext("no-progress-reporting", "export", null);

    const note = becca.getNote(noteId);

    if (!note) {
        throw new ValidationError(`Note ${noteId} not found.`);
    }

    await exportToZip(taskContext, note.getParentBranches()[0], format, destination as Record<string, any>, false, zipExportOptions);
    await waitForFinish();

    getLog().info(`Exported '${noteId}' with format '${format}' to '${zipFilePath}'`);
}

/**
 * Streams a subtree (branch) export straight to a file on disk, reporting
 * progress/success/failure over the WebSocket via `taskId`. Used by the desktop
 * "native export" flow, which writes directly to a user-chosen path instead of
 * routing a potentially multi-GB archive through an in-memory HTTP response.
 */
async function exportBranchToZipFile(branchId: string, format: ExportFormat, zipFilePath: string, taskId: string) {
    const branch = becca.getBranch(branchId);
    if (!branch) {
        throw new ValidationError(`Branch ${branchId} not found.`);
    }

    const taskContext = new TaskContext(taskId, "export", null);
    const { destination, waitForFinish } = getZipProvider().createFileStream(zipFilePath);

    try {
        await exportToZip(taskContext, branch, format, destination as Record<string, any>, false);
        await waitForFinish();
        // exportToZip defers success for non-HTTP destinations: only now, with the file fully flushed to
        // disk, is the export genuinely complete — so report it here rather than before the final write.
        taskContext.taskSucceeded(null);
    } catch (e: unknown) {
        taskContext.reportError(`Export failed with error: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
    }

    getLog().info(`Exported branch '${branchId}' with format '${format}' to '${zipFilePath}'`);
}

export default {
    exportToZip,
    exportToZipFile,
    exportBranchToZipFile
};

/**
 * Whether a payload of the given MIME type is already compressed and should be
 * stored uncompressed in a ZIP rather than re-deflated. Deflating these wastes
 * CPU (often the export bottleneck) for negligible — sometimes negative — size
 * change. Conservative: anything not known-compressed returns false and is
 * compressed normally, so text/HTML/SVG/JSON/code all still deflate.
 */
export function shouldStoreUncompressed(mime: string | undefined | null): boolean {
    if (!mime) {
        return false;
    }
    const m = mime.toLowerCase().split(";")[0].trim();

    // Codec-compressed media. PCM/AIFF are uncompressed, so let them deflate.
    if (m.startsWith("video/")) {
        return true;
    }
    if (m.startsWith("audio/")) {
        return !UNCOMPRESSED_AUDIO.has(m);
    }

    return ALREADY_COMPRESSED.has(m) || isZipBasedContainer(m);
}

// Office / e-book / package formats that are ZIP containers under the hood.
function isZipBasedContainer(mime: string): boolean {
    return (
        mime.startsWith("application/vnd.openxmlformats-officedocument.") || // docx/xlsx/pptx
        mime.startsWith("application/vnd.oasis.opendocument.") ||            // odt/ods/odp
        mime === "application/epub+zip" ||
        mime === "application/java-archive" ||
        mime === "application/vnd.android.package-archive"
    );
}

const UNCOMPRESSED_AUDIO = new Set([
    "audio/wav", "audio/x-wav", "audio/wave", "audio/aiff", "audio/x-aiff"
]);

const ALREADY_COMPRESSED = new Set([
    // Raster images (SVG/BMP/ICO/TIFF deliberately excluded — they deflate well)
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/avif", "image/heic", "image/heif", "image/jp2", "image/apng",
    // Archives / compressed streams
    "application/zip", "application/x-zip-compressed", "application/gzip",
    "application/x-gzip", "application/x-bzip2", "application/x-xz",
    "application/x-7z-compressed", "application/x-rar-compressed",
    "application/x-apple-diskimage",
    // Already-compressed documents / fonts
    "application/pdf", "font/woff", "font/woff2"
]);
