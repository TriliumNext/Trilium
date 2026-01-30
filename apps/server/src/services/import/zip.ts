

import { ALLOWED_NOTE_TYPES, type NoteType } from "@triliumnext/commons";
import path from "path";
import type { Stream } from "stream";
import yauzl from "yauzl";

import becca from "../../becca/becca.js";
import BAttachment from "../../becca/entities/battachment.js";
import BAttribute from "../../becca/entities/battribute.js";
import BBranch from "../../becca/entities/bbranch.js";
import type BNote from "../../becca/entities/bnote.js";
import attributeService from "../../services/attributes.js";
import log from "../../services/log.js";
import noteService from "../../services/notes.js";
import { getNoteTitle, newEntityId, processStringOrBuffer, removeFileExtension, unescapeHtml } from "../../services/utils.js";
import htmlSanitizer from "../html_sanitizer.js";
import type AttributeMeta from "../meta/attribute_meta.js";
import type NoteMeta from "../meta/note_meta.js";
import protectedSessionService from "../protected_session.js";
import type TaskContext from "../task_context.js";
import treeService from "../tree.js";
import markdownService from "./markdown.js";
import mimeService from "./mime.js";

interface MetaFile {
    files: NoteMeta[];
}

interface ImportZipOpts {
    preserveIds?: boolean;
}

async function importZip(taskContext: TaskContext<"importNotes">, fileBuffer: Buffer, importRootNote: BNote, opts?: ImportZipOpts): Promise<BNote> {
    /** maps from original noteId (in ZIP file) to newly generated noteId */
    const noteIdMap: Record<string, string> = {};
    /** type maps from original attachmentId (in ZIP file) to newly generated attachmentId */
    const attachmentIdMap: Record<string, string> = {};
    const attributes: AttributeMeta[] = [];
    // path => noteId, used only when meta file is not available
    /** path => noteId | attachmentId */
    const createdPaths: Record<string, string> = { "/": importRootNote.noteId, "\\": importRootNote.noteId };
    let metaFile: MetaFile | null = null;
    let firstNote: BNote | null = null;
    let topLevelPath = "";
    const createdNoteIds = new Set<string>();

    function getNewNoteId(origNoteId: string) {
        if (!origNoteId.trim()) {
            // this probably shouldn't happen, but still good to have this precaution
            return "empty_note_id";
        }

        if (origNoteId === "root" || origNoteId.startsWith("_") || opts?.preserveIds) {
            // these "named" noteIds don't differ between Trilium instances
            return origNoteId;
        }

        if (!noteIdMap[origNoteId]) {
            noteIdMap[origNoteId] = newEntityId();
        }

        return noteIdMap[origNoteId];
    }

    function getNewAttachmentId(origAttachmentId: string) {
        if (opts?.preserveIds) {
            return origAttachmentId;
        }

        if (!origAttachmentId.trim()) {
            // this probably shouldn't happen, but still good to have this precaution
            return "empty_attachment_id";
        }

        if (!attachmentIdMap[origAttachmentId]) {
            attachmentIdMap[origAttachmentId] = newEntityId();
        }

        return attachmentIdMap[origAttachmentId];
    }

    function getAttachmentMeta(parentNoteMeta: NoteMeta, dataFileName: string) {
        for (const noteMeta of parentNoteMeta.children || []) {
            for (const attachmentMeta of noteMeta.attachments || []) {
                if (attachmentMeta.dataFileName === dataFileName) {
                    return {
                        parentNoteMeta,
                        noteMeta,
                        attachmentMeta
                    };
                }
            }
        }

        return {};
    }

    function getMeta(filePath: string) {
        if (!metaFile) {
            return {};
        }

        const pathSegments = filePath.split(/[\/\\]/g);

        let cursor: NoteMeta | undefined = {
            isImportRoot: true,
            children: metaFile.files,
            dataFileName: ""
        };

        let parent: NoteMeta | undefined;

        for (let segment of pathSegments) {
            if (!cursor?.children?.length) {
                return {};
            }

            segment = unescapeHtml(segment);
            parent = cursor;
            if (parent.children) {
                cursor = parent.children.find((file) => file.dataFileName === segment || file.dirFileName === segment);
            }

            if (!cursor) {
                return getAttachmentMeta(parent, segment);
            }
        }

        return {
            parentNoteMeta: parent,
            noteMeta: cursor,
            attachmentMeta: null
        };
    }

    function getParentNoteId(filePath: string, parentNoteMeta?: NoteMeta) {
        let parentNoteId;

        if (parentNoteMeta?.noteId) {
            parentNoteId = parentNoteMeta.isImportRoot ? importRootNote.noteId : getNewNoteId(parentNoteMeta.noteId);
        } else {
            const parentPath = path.dirname(filePath);

            if (parentPath === ".") {
                parentNoteId = importRootNote.noteId;
            } else if (parentPath in createdPaths) {
                parentNoteId = createdPaths[parentPath];
            } else {
                // ZIP allows creating out of order records - i.e., file in a directory can appear in the ZIP stream before the actual directory
                parentNoteId = saveDirectory(parentPath);
            }
        }

        return parentNoteId;
    }

    function getNoteId(noteMeta: NoteMeta | undefined, filePath: string): string {
        if (noteMeta?.noteId) {
            return getNewNoteId(noteMeta.noteId);
        }

        // in case we lack metadata, we treat e.g. "Programming.html" and "Programming" as the same note
        // (one data file, the other directory for children)
        const filePathNoExt = removeFileExtension(filePath);

        if (filePathNoExt in createdPaths) {
            return createdPaths[filePathNoExt];
        }

        const noteId = newEntityId();

        createdPaths[filePathNoExt] = noteId;

        return noteId;
    }

    function detectFileTypeAndMime(taskContext: TaskContext<"importNotes">, filePath: string) {
        const mime = mimeService.getMime(filePath) || "application/octet-stream";
        const type = mimeService.getType(taskContext.data || {}, mime);

        return { mime, type };
    }

    function saveAttributes(note: BNote, noteMeta: NoteMeta | undefined) {
        if (!noteMeta) {
            return;
        }

        for (const attr of noteMeta.attributes || []) {
            attr.noteId = note.noteId;

            if (attr.type === "label-definition") {
                attr.type = "label";
                attr.name = `label:${attr.name}`;
            } else if (attr.type === "relation-definition") {
                attr.type = "label";
                attr.name = `relation:${attr.name}`;
            }

            if (!attributeService.isAttributeType(attr.type)) {
                log.error(`Unrecognized attribute type ${attr.type}`);
                continue;
            }

            if (attr.type === "relation" && ["internalLink", "imageLink", "relationMapLink", "includeNoteLink"].includes(attr.name)) {
                // these relations are created automatically and as such don't need to be duplicated in the import
                continue;
            }

            if (attr.type === "relation") {
                attr.value = getNewNoteId(attr.value);
            }

            if (taskContext.data?.safeImport && attributeService.isAttributeDangerous(attr.type, attr.name)) {
                attr.name = `disabled:${attr.name}`;
            }

            if (taskContext.data?.safeImport) {
                attr.name = htmlSanitizer.sanitize(attr.name);
                attr.value = htmlSanitizer.sanitize(attr.value);
            }

            attributes.push(attr);
        }
    }

    function saveDirectory(filePath: string) {
        const { parentNoteMeta, noteMeta } = getMeta(filePath);

        const noteId = getNoteId(noteMeta, filePath);

        if (becca.getNote(noteId)) {
            return;
        }

        const noteTitle = getNoteTitle(filePath, !!taskContext.data?.replaceUnderscoresWithSpaces, noteMeta);
        const parentNoteId = getParentNoteId(filePath, parentNoteMeta);

        if (!parentNoteId) {
            throw new Error("Missing parent note ID.");
        }

        const { note } = noteService.createNewNote({
            parentNoteId,
            title: noteTitle || "",
            content: "",
            noteId,
            type: resolveNoteType(noteMeta?.type),
            mime: noteMeta ? noteMeta.mime : "text/html",
            prefix: noteMeta?.prefix || "",
            isExpanded: !!noteMeta?.isExpanded,
            notePosition: noteMeta && firstNote ? noteMeta.notePosition : undefined,
            isProtected: importRootNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
        });

        createdNoteIds.add(note.noteId);

        saveAttributes(note, noteMeta);

        firstNote = firstNote || note;
        return noteId;
    }

    function getEntityIdFromRelativeUrl(url: string, filePath: string) {
        let absUrl: string;
        if (!url.startsWith("/")) {
            while (url.startsWith("./")) {
                url = url.substr(2);
            }

            absUrl = path.dirname(filePath);

            while (url.startsWith("../")) {
                absUrl = path.dirname(absUrl);

                url = url.substr(3);
            }

            if (absUrl === ".") {
                absUrl = "";
            }

            absUrl += `${absUrl.length > 0 ? "/" : ""}${url}`;
        } else {
            absUrl = topLevelPath + url;
        }

        console.log(url, "-->", absUrl);

        const { noteMeta, attachmentMeta } = getMeta(absUrl);

        if (attachmentMeta && attachmentMeta.attachmentId && noteMeta.noteId) {
            return {
                attachmentId: getNewAttachmentId(attachmentMeta.attachmentId),
                noteId: getNewNoteId(noteMeta.noteId)
            };
        } 
        // don't check for noteMeta since it's not mandatory for notes
        return {
            noteId: getNoteId(noteMeta, absUrl)
        };
        
    }

    function processTextNoteContent(content: string, noteTitle: string, filePath: string, noteMeta?: NoteMeta) {
        function isUrlAbsolute(url: string) {
            return /^(?:[a-z]+:)?\/\//i.test(url);
        }

        content = removeTriliumTags(content);

        content = content.replace(/<h1>([^<]*)<\/h1>/gi, (match, text) => {
            if (noteTitle.trim() === text.trim()) {
                return ""; // remove whole H1 tag
            } 
            return `<h2>${text}</h2>`;
            
        });

        if (taskContext.data?.safeImport) {
            content = htmlSanitizer.sanitize(content);
        }

        content = content.replace(/<html.*<body[^>]*>/gis, "");
        content = content.replace(/<\/body>.*<\/html>/gis, "");

        content = content.replace(/src="([^"]*)"/g, (match, url) => {
            if (url.startsWith("data:image")) {
                // inline images are parsed and saved into attachments in the note service
                return match;
            }

            try {
                url = decodeURIComponent(url).trim();
            } catch (e: any) {
                log.error(`Cannot parse image URL '${url}', keeping original. Error: ${e.message}.`);
                return `src="${url}"`;
            }

            if (isUrlAbsolute(url)) {
                return match;
            }

            const target = getEntityIdFromRelativeUrl(url, filePath);

            if (target.attachmentId) {
                return `src="api/attachments/${target.attachmentId}/image/${path.basename(url)}"`;
            } else if (target.noteId) {
                return `src="api/images/${target.noteId}/${path.basename(url)}"`;
            } 
            return match;
            
        });

        content = content.replace(/href="([^"]*)"/g, (match, url) => {
            try {
                url = decodeURIComponent(url).trim();
            } catch (e: any) {
                log.error(`Cannot parse link URL '${url}', keeping original. Error: ${e.message}.`);
                return `href="${url}"`;
            }

            if (
                url.startsWith("#") || // already a note path (probably)
                isUrlAbsolute(url)
            ) {
                return match;
            }

            const target = getEntityIdFromRelativeUrl(url, filePath);

            if (target.attachmentId) {
                return `href="#root/${target.noteId}?viewMode=attachments&attachmentId=${target.attachmentId}"`;
            } else if (target.noteId) {
                return `href="#root/${target.noteId}"`;
            } 
            return match;
            
        });

        if (noteMeta) {
            const includeNoteLinks = (noteMeta.attributes || []).filter((attr) => attr.type === "relation" && attr.name === "includeNoteLink");

            for (const link of includeNoteLinks) {
                // no need to escape the regexp find string since it's a noteId which doesn't contain any special characters
                content = content.replace(new RegExp(link.value, "g"), getNewNoteId(link.value));
            }
        }

        content = content.trim();

        return content;
    }

    function processNoteContent(noteMeta: NoteMeta | undefined, type: string, mime: string, content: string | Buffer, noteTitle: string, filePath: string) {
        if ((noteMeta?.format === "markdown" || (!noteMeta && taskContext.data?.textImportedAsText && ["text/markdown", "text/x-markdown", "text/mdx"].includes(mime))) && typeof content === "string") {
            content = markdownService.renderToHtml(content, noteTitle);
        }

        if (type === "text" && typeof content === "string") {
            content = processTextNoteContent(content, noteTitle, filePath, noteMeta);
        }

        if (type === "relationMap" && noteMeta && typeof content === "string") {
            const relationMapLinks = (noteMeta.attributes || []).filter((attr) => attr.type === "relation" && attr.name === "relationMapLink");

            // this will replace relation map links
            for (const link of relationMapLinks) {
                // no need to escape the regexp find string since it's a noteId which doesn't contain any special characters
                content = content.replace(new RegExp(link.value, "g"), getNewNoteId(link.value));
            }
        }

        return content;
    }

    function saveNote(filePath: string, content: string | Buffer) {
        const { parentNoteMeta, noteMeta, attachmentMeta } = getMeta(filePath);

        if (noteMeta?.noImport) {
            return;
        }

        const noteId = getNoteId(noteMeta, filePath);

        if (attachmentMeta && attachmentMeta.attachmentId) {
            const attachment = new BAttachment({
                attachmentId: getNewAttachmentId(attachmentMeta.attachmentId),
                ownerId: noteId,
                title: attachmentMeta.title,
                role: attachmentMeta.role,
                mime: attachmentMeta.mime,
                position: attachmentMeta.position
            });

            attachment.setContent(content, { forceSave: true });
            return;
        }

        const parentNoteId = getParentNoteId(filePath, parentNoteMeta);

        if (!parentNoteId) {
            throw new Error(`Cannot find parentNoteId for '${filePath}'`);
        }

        if (noteMeta?.isClone) {
            if (!becca.getBranchFromChildAndParent(noteId, parentNoteId)) {
                new BBranch({
                    noteId,
                    parentNoteId,
                    isExpanded: noteMeta.isExpanded,
                    prefix: noteMeta.prefix,
                    notePosition: noteMeta.notePosition
                }).save();
            }

            return;
        }

        let { mime, type: detectedType } = noteMeta ? noteMeta : detectFileTypeAndMime(taskContext, filePath);
        const type = resolveNoteType(detectedType);
        if (mime == null) {
            throw new Error("Unable to resolve mime type.");
        }

        if (type !== "file" && type !== "image") {
            content = processStringOrBuffer(content);
        }

        const noteTitle = getNoteTitle(filePath, taskContext.data?.replaceUnderscoresWithSpaces || false, noteMeta);

        content = processNoteContent(noteMeta, type, mime, content, noteTitle || "", filePath);

        let note = becca.getNote(noteId);

        const isProtected = importRootNote.isProtected && protectedSessionService.isProtectedSessionAvailable();

        if (note) {
            // only skeleton was created because of altered order of cloned notes in ZIP, we need to update
            // https://github.com/zadam/trilium/issues/2440
            if (note.type === undefined) {
                note.type = type;
                note.mime = mime;
                note.title = noteTitle || "";
                note.isProtected = isProtected;
                note.save();
            }

            note.setContent(content);

            if (!becca.getBranchFromChildAndParent(noteId, parentNoteId)) {
                new BBranch({
                    noteId,
                    parentNoteId,
                    isExpanded: noteMeta?.isExpanded,
                    prefix: noteMeta?.prefix,
                    notePosition: noteMeta?.notePosition
                }).save();
            }

            if (opts?.preserveIds) {
                firstNote = firstNote || note;
            }
        } else {
            if (detectedType as string === "geoMap") {
                attributes.push({
                    noteId,
                    type: "relation",
                    name: "template",
                    value: "_template_geo_map"
                });

                const attachment = new BAttachment({
                    attachmentId: getNewAttachmentId(newEntityId()),
                    ownerId: noteId,
                    title: "geoMap.json",
                    role: "viewConfig",
                    mime: "application/json",
                    position: 0
                });

                attachment.setContent(content, { forceSave: true });
                content = "";
                mime = "";
            }

            ({ note } = noteService.createNewNote({
                parentNoteId,
                title: noteTitle || "",
                content,
                noteId,
                type,
                mime,
                prefix: noteMeta?.prefix || "",
                isExpanded: !!noteMeta?.isExpanded,
                // root notePosition should be ignored since it relates to the original document
                // now import root should be placed after existing notes into new parent
                notePosition: noteMeta && firstNote ? noteMeta.notePosition : undefined,
                isProtected
            }));

            createdNoteIds.add(note.noteId);

            saveAttributes(note, noteMeta);

            firstNote = firstNote || note;
        }

        if (!noteMeta && (type === "file" || type === "image")) {
            attributes.push({
                noteId,
                type: "label",
                name: "originalFileName",
                value: path.basename(filePath)
            });
        }
    }

    // we're running two passes in order to obtain critical information first (meta file and root)
    const topLevelItems = new Set<string>();
    await readZipFile(fileBuffer, async (zipfile: yauzl.ZipFile, entry: yauzl.Entry) => {
        const filePath = normalizeFilePath(entry.fileName);

        // make sure that the meta file is loaded before the rest of the files is processed.
        if (filePath === "!!!meta.json") {
            const content = await readContent(zipfile, entry);

            metaFile = JSON.parse(content.toString("utf-8"));
        }

        // determine the root of the .zip (i.e. if it has only one top-level folder then the root is that folder, or the root of the archive if there are multiple top-level folders).
        const firstSlash = filePath.indexOf("/");
        const topLevelPath = (firstSlash !== -1 ? filePath.substring(0, firstSlash) : filePath);
        topLevelItems.add(topLevelPath);

        zipfile.readEntry();
    });

    topLevelPath = (topLevelItems.size > 1 ? "" : topLevelItems.values().next().value ?? "");

    await readZipFile(fileBuffer, async (zipfile: yauzl.ZipFile, entry: yauzl.Entry) => {
        const filePath = normalizeFilePath(entry.fileName);

        if (/\/$/.test(entry.fileName)) {
            saveDirectory(filePath);
        } else if (filePath !== "!!!meta.json") {
            const content = await readContent(zipfile, entry);

            saveNote(filePath, content);
        }

        taskContext.increaseProgressCount();
        zipfile.readEntry();
    });

    for (const noteId of createdNoteIds) {
        const note = becca.getNote(noteId);
        if (!note) continue;
        await noteService.asyncPostProcessContent(note, note.getContent());

        if (!metaFile) {
            // if there's no meta file, then the notes are created based on the order in that zip file but that
            // is usually quite random, so we sort the notes in the way they would appear in the file manager
            treeService.sortNotes(noteId, "title", false, true);
        }

        taskContext.increaseProgressCount();
    }

    // we're saving attributes and links only now so that all relation and link target notes
    // are already in the database (we don't want to have "broken" relations, not even transitionally)
    for (const attr of attributes) {
        if (attr.type !== "relation" || attr.value in becca.notes) {
            new BAttribute(attr).save();
        } else {
            log.info(`Relation not imported since the target note doesn't exist: ${JSON.stringify(attr)}`);
        }
    }

    if (!firstNote) {
        throw new Error("Unable to determine first note.");
    }

    return firstNote;
}

/** @returns path without leading or trailing slash and backslashes converted to forward ones */
function normalizeFilePath(filePath: string): string {
    filePath = filePath.replace(/\\/g, "/");

    if (filePath.startsWith("/")) {
        filePath = filePath.substr(1);
    }

    if (filePath.endsWith("/")) {
        filePath = filePath.substr(0, filePath.length - 1);
    }

    return filePath;
}

function streamToBuffer(stream: Stream): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));

    return new Promise((res, rej) => stream.on("end", () => res(Buffer.concat(chunks))));
}

export function readContent(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
    return new Promise((res, rej) => {
        zipfile.openReadStream(entry, (err, readStream) => {
            if (err) rej(err);
            if (!readStream) throw new Error("Unable to read content.");

            streamToBuffer(readStream).then(res);
        });
    });
}

export function readZipFile(buffer: Buffer, processEntryCallback: (zipfile: yauzl.ZipFile, entry: yauzl.Entry) => Promise<void>) {
    return new Promise<void>((res, rej) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: false }, (err, zipfile) => {
            if (err) rej(err);
            if (!zipfile) throw new Error("Unable to read zip file.");

            zipfile.readEntry();
            zipfile.on("entry", async (entry) => {
                try {
                    await processEntryCallback(zipfile, entry);
                } catch (e) {
                    rej(e);
                }
            });
            zipfile.on("end", res);
        });
    });
}

function resolveNoteType(type: string | undefined): NoteType {
    // BC for ZIPs created in Trilium 0.57 and older
    switch (type) {
        case "relation-map":
            return "relationMap";
        case "note-map":
            return "noteMap";
        case "web-view":
            return "webView";
        case "geoMap":
            return "book";
    }

    if (type && (ALLOWED_NOTE_TYPES as readonly string[]).includes(type)) {
        return type as NoteType;
    } 
    return "text";
    
}

export function removeTriliumTags(content: string) {
    const tagsToRemove = [
        "<h1 data-trilium-h1>([^<]*)<\/h1>",
        "<title data-trilium-title>([^<]*)<\/title>"
    ];
    for (const tag of tagsToRemove) {
        const re = new RegExp(tag, "gi");
        content = content.replace(re, "");
    }

    // Remove ckeditor tags
    content = content.replace(/<div class="ck-content">(.*)<\/div>/gms, "$1");
    content = content.replace(/<div class="content">(.*)<\/div>/gms, "$1");

    return content;
}

export default {
    importZip
};
