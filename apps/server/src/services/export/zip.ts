"use strict";

import html from "html";
import dateUtils from "../date_utils.js";
import path from "path";
import mimeTypes from "mime-types";
import mdService from "./markdown.js";
import packageInfo from "../../../package.json" with { type: "json" };
import { getContentDisposition, escapeHtml, getResourceDir, isDev } from "../utils.js";
import protectedSessionService from "../protected_session.js";
import sanitize from "sanitize-filename";
import fs from "fs";
import becca from "../../becca/becca.js";
import archiver from "archiver";
import log from "../log.js";
import TaskContext from "../task_context.js";
import ValidationError from "../../errors/validation_error.js";
import type NoteMeta from "../meta/note_meta.js";
import type AttachmentMeta from "../meta/attachment_meta.js";
import type AttributeMeta from "../meta/attribute_meta.js";
import type BBranch from "../../becca/entities/bbranch.js";
import type { Response } from "express";
import type { NoteMetaFile } from "../meta/note_meta.js";

type RewriteLinksFn = (content: string, noteMeta: NoteMeta) => string;

export interface AdvancedExportOptions {
    /**
     * If `true`, then only the note's content will be kept. If `false` (default), then each page will have its own <html> template.
     */
    skipHtmlTemplate?: boolean;

    /**
     * Provides a custom function to rewrite the links found in HTML or Markdown notes. This method is called for every note imported, if it's of the right type.
     *
     * @param originalRewriteLinks the original rewrite links function. Can be used to access the default behaviour without having to reimplement it.
     * @param getNoteTargetUrl the method to obtain a note's target URL, used internally by `originalRewriteLinks` but can be used here as well.
     * @returns a function to rewrite the links in HTML or Markdown notes.
     */
    customRewriteLinks?: (originalRewriteLinks: RewriteLinksFn, getNoteTargetUrl: (targetNoteId: string, sourceMeta: NoteMeta) => string | null) => RewriteLinksFn;
}

async function exportToZip(taskContext: TaskContext<"export">, branch: BBranch, format: "html" | "markdown", res: Response | fs.WriteStream, setHeaders = true, zipExportOptions?: AdvancedExportOptions) {
    if (!["html", "markdown"].includes(format)) {
        throw new ValidationError(`Only 'html' and 'markdown' allowed as export format, '${format}' given`);
    }

    const archive = archiver("zip", {
        zlib: { level: 9 } // Sets the compression level.
    });

    const noteIdToMeta: Record<string, NoteMeta> = {};

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
        } else {
            existingFileNames[lcFileName] = 1;

            return fileName;
        }
    }

    function getDataFileName(type: string | null, mime: string, baseFileName: string, existingFileNames: Record<string, number>): string {
        let fileName = baseFileName.trim();
        if (!fileName) {
            fileName = "note";
        }

        // Crop fileName to avoid its length exceeding 30 and prevent cutting into the extension.
        if (fileName.length > 30) {
            // We use regex to match the extension to preserve multiple dots in extensions (e.g. .tar.gz).
            let match = fileName.match(/(\.[a-zA-Z0-9_.!#-]+)$/);
            let ext = match ? match[0] : "";
            // Crop the extension if extension length exceeds 30
            const croppedExt = ext.slice(-30);
            // Crop the file name section and append the cropped extension
            fileName = fileName.slice(0, 30 - croppedExt.length) + croppedExt;
        }

        let existingExtension = path.extname(fileName).toLowerCase();
        let newExtension;

        // the following two are handled specifically since we always want to have these extensions no matter the automatic detection
        // and/or existing detected extensions in the note name
        if (type === "text" && format === "markdown") {
            newExtension = "md";
        } else if (type === "text" && format === "html") {
            newExtension = "html";
        } else if (mime === "application/x-javascript" || mime === "text/javascript") {
            newExtension = "js";
        } else if (type === "canvas" || mime === "application/json") {
            newExtension = "json";
        } else if (existingExtension.length > 0) {
            // if the page already has an extension, then we'll just keep it
            newExtension = null;
        } else {
            if (mime?.toLowerCase()?.trim() === "image/jpg") {
                newExtension = "jpg";
            } else if (mime?.toLowerCase()?.trim() === "text/mermaid") {
                newExtension = "txt";
            } else {
                newExtension = mimeTypes.extension(mime) || "dat";
            }
        }

        // if the note is already named with the extension (e.g. "image.jpg"), then it's silly to append the exact same extension again
        if (newExtension && existingExtension !== `.${newExtension.toLowerCase()}`) {
            fileName += `.${newExtension}`;
        }

        return getUniqueFilename(existingFileNames, fileName);
    }

    function createNoteMeta(branch: BBranch, parentMeta: Partial<NoteMeta>, existingFileNames: Record<string, number>): NoteMeta | null {
        const note = branch.getNote();

        if (note.hasOwnedLabel("excludeFromExport")) {
            return null;
        }

        const title = note.getTitleOrProtected();
        const completeTitle = branch.prefix ? `${branch.prefix} - ${title}` : title;
        let baseFileName = sanitize(completeTitle);

        if (baseFileName.length > 200) {
            // the actual limit is 256 bytes(!) but let's be conservative
            baseFileName = baseFileName.substr(0, 200);
        }

        if (!parentMeta.notePath) {
            throw new Error("Missing parent note path.");
        }
        const notePath = parentMeta.notePath.concat([note.noteId]);

        if (note.noteId in noteIdToMeta) {
            const fileName = getUniqueFilename(existingFileNames, `${baseFileName}.clone.${format === "html" ? "html" : "md"}`);

            const meta: NoteMeta = {
                isClone: true,
                noteId: note.noteId,
                notePath: notePath,
                title: note.getTitleOrProtected(),
                prefix: branch.prefix,
                dataFileName: fileName,
                type: "text", // export will have text description
                format: format
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
            meta.format = format;
        }

        noteIdToMeta[note.noteId] = meta as NoteMeta;

        // sort children for having a stable / reproducible export format
        note.sortChildren();
        const childBranches = note.getChildBranches().filter((branch) => branch?.noteId !== "_hidden");

        const available = !note.isProtected || protectedSessionService.isProtectedSessionAvailable();

        // if it's a leaf, then we'll export it even if it's empty
        if (available && (note.getContent().length > 0 || childBranches.length === 0)) {
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
                dataFileName: getDataFileName(null, attachment.mime, baseFileName + "_" + attachment.title, existingFileNames)
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
            if (meta.dirFileName) {
                url += `${encodeURIComponent(meta.dirFileName)}/`;
            }
        }

        const meta = noteIdToMeta[targetPath[targetPath.length - 1]];

        // link can target note which is only "folder-note" and as such, will not have a file in an export
        url += encodeURIComponent(meta.dataFileName || meta.dirFileName || "");

        return url;
    }

    const rewriteFn = (zipExportOptions?.customRewriteLinks ? zipExportOptions?.customRewriteLinks(rewriteLinks, getNoteTargetUrl) : rewriteLinks);

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

    function prepareContent(title: string, content: string | Buffer, noteMeta: NoteMeta): string | Buffer {
        if (["html", "markdown"].includes(noteMeta?.format || "")) {
            content = content.toString();
            content = rewriteFn(content, noteMeta);
        }

        if (noteMeta.format === "html" && typeof content === "string") {
            if (!content.substr(0, 100).toLowerCase().includes("<html") && !zipExportOptions?.skipHtmlTemplate) {
                if (!noteMeta?.notePath?.length) {
                    throw new Error("Missing note path.");
                }

                const cssUrl = `${"../".repeat(noteMeta.notePath.length - 1)}style.css`;
                const htmlTitle = escapeHtml(title);

                // <base> element will make sure external links are openable - https://github.com/zadam/trilium/issues/1289#issuecomment-704066809
                content = `<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="${cssUrl}">
    <base target="_parent">
    <title data-trilium-title>${htmlTitle}</title>
</head>
<body>
  <div class="content">
    <h1 data-trilium-h1>${htmlTitle}</h1>

    <div class="ck-content">${content}</div>
  </div>
</body>
</html>`;
            }

            return content.length < 100_000 ? html.prettyPrint(content, { indent_size: 2 }) : content;
        } else if (noteMeta.format === "markdown" && typeof content === "string") {
            let markdownContent = mdService.toMarkdown(content);

            if (markdownContent.trim().length > 0 && !markdownContent.startsWith("# ")) {
                markdownContent = `# ${title}\r
${markdownContent}`;
            }

            return markdownContent;
        } else {
            return content;
        }
    }

    function saveNote(noteMeta: NoteMeta, filePathPrefix: string) {
        log.info(`Exporting note '${noteMeta.noteId}'`);

        if (!noteMeta.noteId || noteMeta.title === undefined) {
            throw new Error("Missing note meta.");
        }

        if (noteMeta.isClone) {
            const targetUrl = getNoteTargetUrl(noteMeta.noteId, noteMeta);

            let content: string | Buffer = `<p>This is a clone of a note. Go to its <a href="${targetUrl}">primary location</a>.</p>`;

            content = prepareContent(noteMeta.title, content, noteMeta);

            archive.append(content, { name: filePathPrefix + noteMeta.dataFileName });

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
            const content = prepareContent(noteMeta.title, note.getContent(), noteMeta);

            archive.append(content, {
                name: filePathPrefix + noteMeta.dataFileName,
                date: dateUtils.parseDateTime(note.utcDateModified)
            });
        }

        taskContext.increaseProgressCount();

        for (const attachmentMeta of noteMeta.attachments || []) {
            if (!attachmentMeta.attachmentId) {
                continue;
            }

            const attachment = note.getAttachmentById(attachmentMeta.attachmentId);
            const content = attachment.getContent();

            archive.append(content, {
                name: filePathPrefix + attachmentMeta.dataFileName,
                date: dateUtils.parseDateTime(note.utcDateModified)
            });
        }

        if (noteMeta.children?.length || 0 > 0) {
            const directoryPath = filePathPrefix + noteMeta.dirFileName;

            // create directory
            archive.append("", { name: `${directoryPath}/`, date: dateUtils.parseDateTime(note.utcDateModified) });

            for (const childMeta of noteMeta.children || []) {
                saveNote(childMeta, `${directoryPath}/`);
            }
        }
    }

    function saveNavigation(rootMeta: NoteMeta, navigationMeta: NoteMeta) {
        if (!navigationMeta.dataFileName) {
            return;
        }

        function saveNavigationInner(meta: NoteMeta) {
            let html = "<li>";

            const escapedTitle = escapeHtml(`${meta.prefix ? `${meta.prefix} - ` : ""}${meta.title}`);

            if (meta.dataFileName && meta.noteId) {
                const targetUrl = getNoteTargetUrl(meta.noteId, rootMeta);

                html += `<a href="${targetUrl}" target="detail">${escapedTitle}</a>`;
            } else {
                html += escapedTitle;
            }

            if (meta.children && meta.children.length > 0) {
                html += "<ul>";

                for (const child of meta.children) {
                    html += saveNavigationInner(child);
                }

                html += "</ul>";
            }

            return `${html}</li>`;
        }

        const fullHtml = `<html>
<head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <ul>${saveNavigationInner(rootMeta)}</ul>
</body>
</html>`;
        const prettyHtml = fullHtml.length < 100_000 ? html.prettyPrint(fullHtml, { indent_size: 2 }) : fullHtml;

        archive.append(prettyHtml, { name: navigationMeta.dataFileName });
    }

    function saveIndex(rootMeta: NoteMeta, indexMeta: NoteMeta) {
        let firstNonEmptyNote;
        let curMeta = rootMeta;

        if (!indexMeta.dataFileName) {
            return;
        }

        while (!firstNonEmptyNote) {
            if (curMeta.dataFileName && curMeta.noteId) {
                firstNonEmptyNote = getNoteTargetUrl(curMeta.noteId, rootMeta);
            }

            if (curMeta.children && curMeta.children.length > 0) {
                curMeta = curMeta.children[0];
            } else {
                break;
            }
        }

        const fullHtml = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<frameset cols="25%,75%">
    <frame name="navigation" src="navigation.html">
    <frame name="detail" src="${firstNonEmptyNote}">
</frameset>
</html>`;

        archive.append(fullHtml, { name: indexMeta.dataFileName });
    }

    function saveCss(rootMeta: NoteMeta, cssMeta: NoteMeta) {
        if (!cssMeta.dataFileName) {
            return;
        }

        const cssFile = isDev
            ? path.join(__dirname, "../../../../../node_modules/ckeditor5/dist/ckeditor5-content.css")
            : path.join(getResourceDir(), "ckeditor5-content.css");

        archive.append(fs.readFileSync(cssFile, "utf-8"), { name: cssMeta.dataFileName });
    }

    try {
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

        let navigationMeta: NoteMeta | null = null;
        let indexMeta: NoteMeta | null = null;
        let cssMeta: NoteMeta | null = null;

        if (format === "html") {
            navigationMeta = {
                noImport: true,
                dataFileName: "navigation.html"
            };

            metaFile.files.push(navigationMeta);

            indexMeta = {
                noImport: true,
                dataFileName: "index.html"
            };

            metaFile.files.push(indexMeta);

            cssMeta = {
                noImport: true,
                dataFileName: "style.css"
            };

            metaFile.files.push(cssMeta);
        }

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
                } else {
                    return false;
                }
            });
        }

        if (!rootMeta) {
            // corner case of disabled export for exported note
            if ("sendStatus" in res) {
                res.sendStatus(400);
            }
            return;
        }

        const metaFileJson = JSON.stringify(metaFile, null, "\t");

        archive.append(metaFileJson, { name: "!!!meta.json" });

        saveNote(rootMeta, "");

        if (format === "html") {
            if (!navigationMeta || !indexMeta || !cssMeta) {
                throw new Error("Missing meta.");
            }

            saveNavigation(rootMeta, navigationMeta);
            saveIndex(rootMeta, indexMeta);
            saveCss(rootMeta, cssMeta);
        }

        const note = branch.getNote();
        const zipFileName = `${branch.prefix ? `${branch.prefix} - ` : ""}${note.getTitleOrProtected() || "note"}.zip`;

        if (setHeaders && "setHeader" in res) {
            res.setHeader("Content-Disposition", getContentDisposition(zipFileName));
            res.setHeader("Content-Type", "application/zip");
        }

        archive.pipe(res);
        await archive.finalize();
        taskContext.taskSucceeded(null);
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
}

async function exportToZipFile(noteId: string, format: "markdown" | "html", zipFilePath: string, zipExportOptions?: AdvancedExportOptions) {
    const fileOutputStream = fs.createWriteStream(zipFilePath);
    const taskContext = new TaskContext("no-progress-reporting", "export", null);

    const note = becca.getNote(noteId);

    if (!note) {
        throw new ValidationError(`Note ${noteId} not found.`);
    }

    await exportToZip(taskContext, note.getParentBranches()[0], format, fileOutputStream, false, zipExportOptions);

    log.info(`Exported '${noteId}' with format '${format}' to '${zipFilePath}'`);
}

export default {
    exportToZip,
    exportToZipFile
};
