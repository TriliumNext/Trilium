import { ALLOWED_NOTE_TYPES, type NoteType } from "@triliumnext/commons";
import { basename, dirname } from "../utils/path.js";
import { getZipProvider, type ZipSource } from "../zip_provider.js";

import becca from "../../becca/becca.js";
import BAttachment from "../../becca/entities/battachment.js";
import BAttribute from "../../becca/entities/battribute.js";
import BBranch from "../../becca/entities/bbranch.js";
import type BNote from "../../becca/entities/bnote.js";
import attributeService from "../../services/attributes.js";
import { getLog } from "../../services/log.js";
import noteService from "../../services/notes.js";
import { getNoteTitle, newEntityId, removeFileExtension, unescapeHtml } from "../../services/utils/index.js";
import { processStringOrBuffer } from "../../services/utils/binary.js";
import protectedSessionService from "../protected_session.js";
import { getSql } from "../sql/index.js";
import type TaskContext from "../task_context.js";
import treeService from "../tree.js";
import markdownService from "./markdown.js";
import mimeService from "./mime.js";
import { AttributeMeta, NoteMeta } from "../../meta.js";
import { isMarkdownCodeNote } from "../export/rewrite_links.js";
import { sanitizeHtml } from "../sanitizer.js";
import { extractFrontmatter, type FrontmatterAttribute } from "./frontmatter.js";

// Source mimes that import as editable spreadsheet notes (parsed to Univer workbook JSON),
// mirroring the single-file importer. As resolved by `mime-types` from the entry extension.
const CSV_MIME = "text/csv";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SPREADSHEET_MIME = "text/x-spreadsheet";

// Source mimes rendered from Markdown to HTML on import.
const MARKDOWN_MIMES = ["text/markdown", "text/x-markdown", "text/mdx"];

// A note entry whose content has been read (and any async conversion already applied), ready for the
// synchronous saveNote() inside a batch transaction. `mimeOverride` is set when prepareEntry converted a
// raw spreadsheet so saveNote stores it as a spreadsheet instead of re-detecting the raw CSV/XLSX mime.
interface BatchEntry {
    filePath: string;
    content: string | Uint8Array;
    mimeOverride?: string;
}

// A buffered import operation, replayed in order inside one transaction. Directory entries carry no
// content; note entries are BatchEntry. Buffering both preserves the exact zip order across batches.
type BatchItem = { isDirectory: true; filePath: string } | ({ isDirectory: false } & BatchEntry);

interface MetaFile {
    files: NoteMeta[];
}

interface ImportZipOpts {
    preserveIds?: boolean;
    /**
     * Restore a whole-database export: map the archive's "root" note onto the import target instead of
     * importing it as a new child note. The archived root's content merges into the destination and its
     * children become the destination's children - no redundant "root" wrapper note, no root->root branch.
     * Used by the demo-content import (and intended for a future "restore from ZIP" flow). Without it, an
     * archived "root" is remapped to a fresh id like any other note (see {@link getNewNoteId}).
     */
    restoreAsRoot?: boolean;
}

async function importZip(taskContext: TaskContext<"importNotes">, source: ZipSource, importRootNote: BNote, opts?: ImportZipOpts): Promise<BNote> {
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

        if (opts?.preserveIds) {
            return origNoteId;
        }

        // Whole-database restore: the archived root note IS the destination root, not a new child note.
        if (opts?.restoreAsRoot && origNoteId === "root") {
            return importRootNote.noteId;
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
            const parentPath = dirname(filePath);

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
        const rawMime = mimeService.getMime(filePath) || "application/octet-stream";

        // CSV/XLSX entries become editable spreadsheet notes (matching single-file import) unless
        // the user opts out, in which case they fall through to a plain file attachment. The raw
        // mime is kept so `saveNote` knows which parser to run; it's swapped for the spreadsheet
        // mime once the bytes have been converted to the Univer workbook JSON.
        if (taskContext.data?.spreadsheetImportedAsSpreadsheet && (rawMime === CSV_MIME || rawMime === XLSX_MIME)) {
            return { mime: rawMime, type: "spreadsheet" as NoteType };
        }

        const type = mimeService.getType(taskContext.data || {}, rawMime);
        // Normalize aliased code MIMEs (e.g. `text/markdown` → `text/x-markdown`,
        // `application/javascript` → `text/javascript`) so the
        // stored MIME matches what the rest of the app expects.
        const mime = (type === "code" && mimeService.normalizeMimeType(rawMime)) || rawMime;

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
                getLog().error(`Unrecognized attribute type ${attr.type}`);
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
                attr.name = sanitizeHtml(attr.name);
                attr.value = sanitizeHtml(attr.value);
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

            absUrl = dirname(filePath);

            while (url.startsWith("../")) {
                absUrl = dirname(absUrl);

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
                attachmentTitle: attachmentMeta.title,
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
            content = sanitizeHtml(content);
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
                getLog().error(`Cannot parse image URL '${url}', keeping original. Error: ${e.message}.`);
                return `src="${url}"`;
            }

            if (isUrlAbsolute(url)) {
                return match;
            }

            const target = getEntityIdFromRelativeUrl(url, filePath);

            if (target.attachmentId) {
                return `src="api/attachments/${target.attachmentId}/image/${basename(url)}"`;
            } else if (target.noteId) {
                return `src="api/images/${target.noteId}/${basename(url)}"`;
            }
            return match;

        });

        content = content.replace(/href="([^"]*)"/g, (match, url) => {
            try {
                url = decodeURIComponent(url).trim();
            } catch (e: any) {
                getLog().error(`Cannot parse link URL '${url}', keeping original. Error: ${e.message}.`);
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

    function processNoteContent(noteMeta: NoteMeta | undefined, type: string, mime: string, content: string | Uint8Array, noteTitle: string, filePath: string) {
        if ((noteMeta?.format === "markdown" || (!noteMeta && taskContext.data?.textImportedAsText && MARKDOWN_MIMES.includes(mime))) && typeof content === "string") {
            content = markdownService.renderToHtml(content, noteTitle);
        }

        // `book` notes are rendered as rich HTML through the same `renderText()` path as
        // `text` notes (see content_renderer), so their content must receive the same
        // import processing — crucially the Safe Import HTML sanitization. Otherwise a
        // malicious `book` note bypasses sanitization and achieves stored XSS/RCE when its
        // content is previewed in a grid/list view.
        if ((type === "text" || type === "book") && typeof content === "string") {
            content = processTextNoteContent(content, noteTitle, filePath, noteMeta);
        }

        if (type === "code" && isMarkdownCodeNote(mime) && typeof content === "string") {
            content = processMarkdownCodeNoteContent(content, filePath);
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

    /**
     * Rewrites relative file paths in markdown code notes back to Trilium internal
     * URLs (counterpart to `rewriteMarkdownContentLinks` in the export).
     */
    function processMarkdownCodeNoteContent(content: string, filePath: string) {
        function isUrlAbsolute(url: string) {
            return /^(?:[a-z]+:)?\/\//i.test(url);
        }

        // Image links: ![alt](relative/path)
        content = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
            try {
                url = decodeURIComponent(url).trim();
            } catch {
                return match;
            }

            if (isUrlAbsolute(url) || url.startsWith("api/")) {
                return match;
            }

            const target = getEntityIdFromRelativeUrl(url, filePath);

            if (target.attachmentId) {
                return `![${alt}](api/attachments/${target.attachmentId}/image/${encodeURIComponent(target.attachmentTitle || "image")})`;
            } else if (target.noteId) {
                return `![${alt}](api/images/${target.noteId}/${basename(url)})`;
            }
            return match;
        });

        // Non-image links: [text](relative/path)
        content = content.replace(/(?<!!)\[([^\]]*)\]\(([^)]+)\)/g, (match, text, url) => {
            try {
                url = decodeURIComponent(url).trim();
            } catch {
                return match;
            }

            if (isUrlAbsolute(url) || url.startsWith("#") || url.startsWith("api/")) {
                return match;
            }

            const target = getEntityIdFromRelativeUrl(url, filePath);

            if (target.attachmentId) {
                return `[${text}](#root/${target.noteId}?viewMode=attachments&attachmentId=${target.attachmentId})`;
            } else if (target.noteId) {
                return `[${text}](#root/${target.noteId})`;
            }
            return match;
        });

        return content;
    }

    function saveNote(filePath: string, content: string | Uint8Array, mimeOverride?: string) {
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

        let parentNoteId = getParentNoteId(filePath, parentNoteMeta);

        if (!parentNoteId) {
            throw new Error(`Cannot find parentNoteId for '${filePath}'`);
        }

        // When restoring a whole database (restoreAsRoot), the archived "root" maps onto the import root
        // itself - it already exists with its own parentage, so we only refresh its content and never
        // create a branch for it. For any other note, guard against a self-referential branch: reserved
        // IDs like "root" are remapped on import so this shouldn't normally happen, but a malformed archive
        // could otherwise persist a root->root branch that corrupts the tree and breaks loading.
        const isImportRootNote = noteId === importRootNote.noteId;
        if (!isImportRootNote && parentNoteId === noteId) {
            parentNoteId = importRootNote.noteId;
        }

        if (noteMeta?.isClone) {
            if (!isImportRootNote && !becca.getBranchFromChildAndParent(noteId, parentNoteId)) {
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

        // A raw CSV/XLSX entry is converted to the Univer workbook JSON a spreadsheet note stores by the
        // async prepareEntry() step (so this function can stay synchronous and run inside a batch
        // transaction). When that happened, prepareEntry passes the spreadsheet mime here so the note is
        // stored as a spreadsheet instead of being re-detected as raw CSV/XLSX.
        if (mimeOverride != null) {
            mime = mimeOverride;
        }

        if (type !== "file" && type !== "image") {
            content = processStringOrBuffer(content);
        }

        const noteTitle = getNoteTitle(filePath, taskContext.data?.replaceUnderscoresWithSpaces || false, noteMeta);

        // Generic Markdown (not a Trilium export, which carries its attributes in !!!meta.json) may begin
        // with a YAML front matter block; lift it into labels and strip it before the body is rendered.
        let frontmatterAttributes: FrontmatterAttribute[] = [];
        if (!noteMeta && typeof content === "string" && taskContext.data?.textImportedAsText && MARKDOWN_MIMES.includes(mime)) {
            const parsed = extractFrontmatter(content);
            content = parsed.body;
            frontmatterAttributes = parsed.attributes;
        }

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

            if (!isImportRootNote && !becca.getBranchFromChildAndParent(noteId, parentNoteId)) {
                new BBranch({
                    noteId,
                    parentNoteId,
                    isExpanded: noteMeta?.isExpanded,
                    prefix: noteMeta?.prefix,
                    notePosition: noteMeta?.notePosition
                }).save();
            }

            if (opts?.preserveIds || isImportRootNote) {
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
            for (const attribute of frontmatterAttributes) {
                note.addLabel(attribute.name, attribute.value);
            }

            firstNote = firstNote || note;
        }

        if (!noteMeta && (type === "file" || type === "image")) {
            attributes.push({
                noteId,
                type: "label",
                name: "originalFileName",
                value: basename(filePath)
            });
        }
    }

    /**
     * Runs the only asynchronous part of importing a note — converting a raw CSV/XLSX entry into the Univer
     * workbook JSON a spreadsheet note stores — ahead of the synchronous {@link saveNote}. Keeping saveNote
     * synchronous is what lets a whole batch of notes be written inside a single synchronous transaction.
     * Returns the (possibly converted) content plus, when it converted, the mime saveNote should force.
     */
    async function prepareEntry(filePath: string, content: string | Uint8Array): Promise<BatchEntry> {
        const { noteMeta, attachmentMeta } = getMeta(filePath);

        // Attachments, clones and skipped notes return from saveNote before the spreadsheet branch, so
        // they never need conversion. Only an actual note whose mime resolves to a raw spreadsheet does.
        if (!attachmentMeta && !noteMeta?.isClone && !noteMeta?.noImport) {
            const { mime, type: detectedType } = noteMeta ? noteMeta : detectFileTypeAndMime(taskContext, filePath);
            if (resolveNoteType(detectedType) === "spreadsheet" && (mime === CSV_MIME || mime === XLSX_MIME)) {
                return { filePath, content: await convertSpreadsheetContent(mime, content), mimeOverride: SPREADSHEET_MIME };
            }
        }

        return { filePath, content };
    }

    const zipProvider = getZipProvider();

    // Per-phase wall-clock so a single import run reveals where the time goes (logged as one summary line
    // below). Cheap: a couple of Date.now() reads per entry.
    const timing = { encoding: 0, scan: 0, read: 0, save: 0, postProcess: 0, sort: 0, attributes: 0 };
    let timingMark = Date.now();

    // Detect filename encoding once for the whole ZIP (e.g. GBK for Chinese Windows ZIPs)
    const filenameEncoding = await zipProvider.detectFilenameEncoding(source);
    timing.encoding = Date.now() - timingMark;
    timingMark = Date.now();

    // we're running two passes in order to obtain critical information first (meta file and root)
    const topLevelItems = new Set<string>();
    // count of entries the processing pass will handle, used as the progress denominator so the
    // client can show a progress bar ("X of N") instead of a bare running count
    let entriesToProcess = 0;

    await zipProvider.readZipFile(source, async (entry, readContent) => {
        const filePath = normalizeFilePath(entry.fileName);

        if (isMacOSMetadata(filePath)) {
            return;
        }

        entriesToProcess++;

        // make sure that the meta file is loaded before the rest of the files is processed.
        if (filePath === "!!!meta.json") {
            const content = await readContent();
            metaFile = JSON.parse(new TextDecoder("utf-8").decode(content));
        }

        // determine the root of the .zip (i.e. if it has only one top-level folder then the root is that folder, or the root of the archive if there are multiple top-level folders).
        const firstSlash = filePath.indexOf("/");
        const topLevelPath = (firstSlash !== -1 ? filePath.substring(0, firstSlash) : filePath);
        topLevelItems.add(topLevelPath);
    }, filenameEncoding);
    timing.scan = Date.now() - timingMark;

    topLevelPath = (topLevelItems.size > 1 ? "" : topLevelItems.values().next().value ?? "");

    // The import runs in two labelled phases, each driving its own 0→100% bar: first "extracting" counts
    // every archive entry (notes, attachments, folders, the meta file), then "processing" counts only the
    // notes that were actually created. The denominator deliberately changes between phases — the client
    // shows distinct messages ("Extracted X items" vs "Processed X notes") so the switch reads as progress
    // rather than the bar jerking. Here we seed the extraction phase with the entry count from the scan.
    taskContext.setPhase("extracting");
    taskContext.resetProgressCount();
    taskContext.setTotalCount(entriesToProcess);

    // Notes are written in batches, each batch in a single synchronous transaction, instead of letting
    // every entity save auto-commit on its own. The per-note BEGIN/COMMIT (and its WAL fsync) dominated
    // import time; batching collapses tens of thousands of commits into a handful (the inner per-entity
    // transactions become cheap savepoints under the outer one). The flush MUST stay synchronous: holding
    // a transaction open across the async readContent() would let concurrent requests on the shared DB
    // connection interleave into the import's transaction. So all async work (reading entries and the
    // spreadsheet conversion in prepareEntry) happens during accumulation, outside the transaction; the
    // flush only replays already-prepared items. A byte cap keeps memory bounded so a multi-GB ZIP is
    // never fully materialised, preserving the per-entry streaming the reader was built for.
    const BATCH_MAX_COUNT = 200;
    const BATCH_MAX_BYTES = 50 * 1024 * 1024;
    let batch: BatchItem[] = [];
    let batchBytes = 0;

    const flushBatch = () => {
        if (batch.length === 0) {
            return;
        }
        const items = batch;
        batch = [];
        batchBytes = 0;

        const saveStart = Date.now();
        getSql().transactional(() => {
            for (const item of items) {
                if (item.isDirectory) {
                    saveDirectory(item.filePath);
                } else {
                    saveNote(item.filePath, item.content, item.mimeOverride);
                }
            }
        });
        timing.save += Date.now() - saveStart;
    };

    await zipProvider.readZipFile(source, async (entry, readContent) => {
        const filePath = normalizeFilePath(entry.fileName);

        if (isMacOSMetadata(filePath)) {
            return;
        }

        if (/\/$/.test(entry.fileName)) {
            batch.push({ isDirectory: true, filePath });
        } else if (filePath !== "!!!meta.json") {
            const readStart = Date.now();
            const content = await readContent();
            const prepared = await prepareEntry(filePath, content);
            timing.read += Date.now() - readStart;

            batch.push({ isDirectory: false, ...prepared });
            batchBytes += prepared.content.length;

            if (batch.length >= BATCH_MAX_COUNT || batchBytes >= BATCH_MAX_BYTES) {
                flushBatch();
            }
        }

        taskContext.increaseProgressCount();
    }, filenameEncoding);

    flushBatch();

    // Post-processing phase: increments progress once per created note (now known exactly). Reset the count
    // and re-seed the total with the note count so this phase renders its own clean 0→100% bar.
    taskContext.setPhase("processing");
    taskContext.resetProgressCount();
    taskContext.setTotalCount(createdNoteIds.size);

    for (const noteId of createdNoteIds) {
        const note = becca.getNote(noteId);
        if (!note) continue;
        const postStart = Date.now();
        await noteService.asyncPostProcessContent(note, note.getContent());
        timing.postProcess += Date.now() - postStart;

        if (!metaFile) {
            // if there's no meta file, then the notes are created based on the order in that zip file but that
            // is usually quite random, so we sort the notes in the way they would appear in the file manager
            const sortStart = Date.now();
            treeService.sortNotes(noteId, "title", false, true);
            timing.sort += Date.now() - sortStart;
        }

        taskContext.increaseProgressCount();
    }

    // we're saving attributes and links only now so that all relation and link target notes
    // are already in the database (we don't want to have "broken" relations, not even transitionally)
    timingMark = Date.now();
    for (const attr of attributes) {
        if (attr.type !== "relation" || attr.value in becca.notes) {
            new BAttribute(attr).save();
        } else {
            getLog().info(`Relation not imported since the target note doesn't exist: ${JSON.stringify(attr)}`);
        }
    }
    timing.attributes = Date.now() - timingMark;

    getLog().info(
        `Import timing (ms): encoding=${timing.encoding} scan=${timing.scan} read=${timing.read} ` +
        `save=${timing.save} postProcess=${timing.postProcess} sort=${timing.sort} attributes=${timing.attributes} ` +
        `— ${createdNoteIds.size} notes, ${entriesToProcess} entries, ${attributes.length} attributes`
    );

    if (!firstNote) {
        throw new Error("Unable to determine first note.");
    }

    return firstNote;
}

/** Skips macOS resource fork metadata that pollutes ZIP archives created on macOS. */
function isMacOSMetadata(filePath: string): boolean {
    return filePath.startsWith("__MACOSX/") || filePath === "__MACOSX";
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

/**
 * Parses a raw CSV or XLSX entry into the Univer workbook JSON a spreadsheet note stores.
 * The parsers are dynamically imported so exceljs only loads when such a file is imported
 * (keeping it out of the core barrel and the standalone/browser bundle).
 */
async function convertSpreadsheetContent(mime: string, content: string | Uint8Array): Promise<string> {
    if (mime === XLSX_MIME) {
        const { parseXlsxToWorkbook } = await import("@triliumnext/commons/src/lib/spreadsheet/parse_from_xlsx.js");
        const buffer = typeof content === "string" ? Buffer.from(content) : content;
        return JSON.stringify(await parseXlsxToWorkbook(buffer));
    }

    const { parseCsvToWorkbook } = await import("@triliumnext/commons/src/lib/spreadsheet/parse_from_csv.js");
    return JSON.stringify(parseCsvToWorkbook(processStringOrBuffer(content)));
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
