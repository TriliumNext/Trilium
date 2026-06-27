import type { AttributeType } from "@triliumnext/commons";

import type BNote from "../../becca/entities/bnote.js";
import * as utils from "../utils/index.js";
import imageService from "../image.js";
import { getLog } from "../log.js";
import noteService from "../notes.js";
import protectedSessionService from "../protected_session.js";
import type TaskContext from "../task_context.js";
import { escapeHtml, md5 } from "../utils/index.js";
import { decodeBase64 } from "../utils/binary.js";
import type { File } from "./common.js";
import { convertEnexContent, type EnexTask, rewriteEvernoteLinks } from "./enex_converter.js";
import { sanitizeHtml } from "../sanitizer.js";

/**
 * date format is e.g. 20181121T193703Z or 2013-04-14T16:19:00.000Z (Mac evernote, see #3496)
 * @returns trilium date format, e.g. 2013-04-14 16:19:00.000Z
 */
function parseDate(text: string) {
    // convert ISO format to the "20181121T193703Z" format
    text = text.replace(/[-:]/g, "");

    // insert - and : to convert it to trilium format
    text = `${text.substr(0, 4)  }-${  text.substr(4, 2)  }-${  text.substr(6, 2)  } ${  text.substr(9, 2)  }:${  text.substr(11, 2)  }:${  text.substr(13, 2)  }.000Z`;

    return text;
}

interface Attribute {
    type: AttributeType;
    name: string;
    value: string;
}

interface Resource {
    title: string;
    content?: Uint8Array | string;
    mime?: string;
    attributes: Attribute[];
}

interface Note {
    title: string;
    attributes: Attribute[];
    utcDateCreated: string;
    utcDateModified: string;
    noteId: string;
    blobId: string;
    content: string;
    resources: Resource[];
    tasks: EnexTask[];
}

let note: Partial<Note> = {};
let resource: Resource;
let task: EnexTask;

async function importEnex(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote): Promise<BNote> {
    // Imported dynamically so sax's module initialization is deferred to the first ENEX import
    // rather than running at server startup (enex.ts is otherwise in the eager route graph).
    const sax = (await import("sax")).default;
    const parser = sax.parser(true);

    const rootNoteTitle = file.originalname.toLowerCase().endsWith(".enex") ? file.originalname.substr(0, file.originalname.length - 5) : file.originalname;

    // root note is new note into all ENEX/notebook's notes will be imported
    const rootNote = noteService.createNewNote({
        parentNoteId: parentNote.noteId,
        title: rootNoteTitle,
        content: "",
        type: "text",
        mime: "text/html",
        isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
    }).note;

    function extractContent(content: string, tasks: EnexTask[] = []) {
        const openingNoteIndex = content.indexOf("<en-note>");

        if (openingNoteIndex !== -1) {
            content = content.substr(openingNoteIndex + 9);
        }

        const closingNoteIndex = content.lastIndexOf("</en-note>");

        if (closingNoteIndex !== -1) {
            content = content.substr(0, closingNoteIndex);
        }

        content = content.trim();

        // Replace OneNote converted checkboxes with unicode ballot box based
        // on known hash of checkboxes for regular, p1, and p2 checkboxes
        content = content.replace(
            /<en-media alt="To Do( priority [12])?" hash="(74de5d3d1286f01bac98d32a09f601d9|4a19d3041585e11643e808d68dd3e72f|8e17580123099ac6515c3634b1f6f9a1)"( type="[a-z\/]*"| width="\d+"| height="\d+")*\/>/g,
            "\u2610 "
        );
        content = content.replace(
            /<en-media alt="To Do( priority [12])?" hash="(5069b775461e471a47ce04ace6e1c6ae|7912ee9cec35fc3dba49edb63a9ed158|3a05f4f006a6eaf2627dae5ed8b8013b)"( type="[a-z\/]*"| width="\d+"| height="\d+")*\/>/g,
            "\u2611 "
        );

        // Rewrite Evernote's richer blocks (code/math/mermaid/callouts/toggles/checkboxes) and inline the
        // note's tasks. Runs BEFORE the list workarounds below: those match on closing tags alone (e.g.
        // `</div></li>`) and would corrupt the attribute-tagged `--en-todo` checkbox lists; the converter has
        // already rewritten those into clean todo-lists. Also runs before sanitization, which would strip the
        // `--en-*` style markers the conversion keys off.
        content = convertEnexContent(content, tasks);

        // workaround for https://github.com/ckeditor/ckeditor5-list/issues/116
        content = content.replace(/<li>\s*<div>/g, "<li>");
        content = content.replace(/<\/div>\s*<\/li>/g, "</li>");

        // workaround for https://github.com/ckeditor/ckeditor5-list/issues/115
        content = content.replace(/<ul>\s*<ul>/g, "<ul><li><ul>");
        content = content.replace(/<\/li>\s*<ul>/g, "<ul>");
        content = content.replace(/<\/ul>\s*<\/ul>/g, "</ul></li></ul>");
        content = content.replace(/<\/ul>\s*<li>/g, "</ul></li><li>");

        content = content.replace(/<ol>\s*<ol>/g, "<ol><li><ol>");
        content = content.replace(/<\/li>\s*<ol>/g, "<ol>");
        content = content.replace(/<\/ol>\s*<\/ol>/g, "</ol></li></ol>");
        content = content.replace(/<\/ol>\s*<li>/g, "</ol></li><li>");

        content = sanitizeHtml(content);

        return content;
    }

    const path: string[] = [];

    function getCurrentTag() {
        if (path.length >= 1) {
            return path[path.length - 1];
        }
    }

    function getPreviousTag() {
        if (path.length >= 2) {
            return path[path.length - 2];
        }
    }

    parser.onerror = (e) => {
        getLog().error(`error when parsing ENEX file: ${e}`);
        // clear the error and resume
        parser.error = null;
        parser.resume();
    };

    parser.ontext = (text) => {
        const currentTag = getCurrentTag();
        const previousTag = getPreviousTag();

        if (previousTag === "note-attributes") {
            let labelName = currentTag;

            if (labelName === "source-url") {
                labelName = "pageUrl";
            }

            labelName = utils.sanitizeAttributeName(labelName || "");

            if (note.attributes) {
                note.attributes.push({
                    type: "label",
                    name: labelName,
                    value: text
                });
            }
        } else if (previousTag === "resource-attributes") {
            if (currentTag === "file-name") {
                resource.attributes.push({
                    type: "label",
                    name: "originalFileName",
                    value: text
                });

                resource.title = text;
            } else if (currentTag === "source-url") {
                resource.attributes.push({
                    type: "label",
                    name: "pageUrl",
                    value: text
                });
            }
        } else if (previousTag === "resource") {
            if (currentTag === "data") {
                text = text.replace(/\s/g, "");

                // resource can be chunked into multiple events: https://github.com/zadam/trilium/issues/3424
                // it would probably make sense to do this in a more global way since it can in theory affect any field,
                // not just data
                resource.content = (resource.content || "") + text;
            } else if (currentTag === "mime") {
                resource.mime = text.toLowerCase();
            }
        } else if (previousTag === "note") {
            if (currentTag === "title") {
                note.title = text;
            } else if (currentTag === "created") {
                note.utcDateCreated = parseDate(text);
            } else if (currentTag === "updated") {
                note.utcDateModified = parseDate(text);
            } else if (currentTag === "tag" && note.attributes) {
                note.attributes.push({
                    type: "label",
                    name: utils.sanitizeAttributeName(text),
                    value: ""
                });
            }
            // unknown tags are just ignored
        } else if (previousTag === "task" && task) {
            // Fields can be chunked across events (like resource data), so append rather than assign.
            if (currentTag === "title") {
                task.title += text;
            } else if (currentTag === "taskStatus") {
                task.status += text;
            } else if (currentTag === "taskGroupNoteLevelID") {
                task.groupId += text;
            }
        }
    };

    parser.onopentag = (tag) => {
        path.push(tag.name);

        if (tag.name === "note") {
            note = {
                content: "",
                // it's an array, not a key-value object because we don't know if attributes can be duplicated
                attributes: [],
                resources: [],
                tasks: []
            };
        } else if (tag.name === "resource") {
            resource = {
                title: "resource",
                attributes: []
            };

            if (note.resources) {
                note.resources.push(resource);
            }
        } else if (tag.name === "task") {
            // Evernote's Tasks feature exports each task as a note-level <task> element; the body keeps only a
            // "Content not supported" placeholder. Collected here so saveNote can render them as a to-do list.
            task = { title: "", status: "", groupId: "" };

            if (note.tasks) {
                note.tasks.push(task);
            }
        }
    };

    // Resolving Evernote internal note links needs every imported note's title -> id, which isn't fully
    // known until all notes are created (a note can link to one parsed later). Collect the mapping and each
    // note's final content during the first pass, then resolve the links in a second pass below.
    // Value is the note's id, or null when the title is shared by 2+ imported notes (see saveNote).
    const noteIdByTitle = new Map<string, string | null>();
    const createdNotes: { note: BNote; content: string; utcDateCreated?: string; utcDateModified?: string }[] = [];

    function saveNote() {
        // make a copy because stream continues with the next call and note gets overwritten
        let { title, content, attributes, resources, tasks, utcDateCreated, utcDateModified } = note;

        if (!title || !content) {
            throw new Error("Missing title or content for note.");
        }

        content = extractContent(content, tasks);

        const noteEntity = noteService.createNewNote({
            parentNoteId: rootNote.noteId,
            title,
            content,
            utcDateCreated,
            type: "text",
            mime: "text/html",
            isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
        }).note;

        for (const attr of attributes || []) {
            noteEntity.addAttribute(attr.type, attr.name, attr.value);
        }

        utcDateCreated = utcDateCreated || noteEntity.utcDateCreated;
        // sometime date modified is not present in ENEX, then use date created
        utcDateModified = utcDateModified || utcDateCreated;

        taskContext.increaseProgressCount();

        for (const resource of resources || []) {
            if (!resource.content) {
                continue;
            }

            if (typeof resource.content === "string") {
                resource.content = decodeBase64(resource.content);
            }

            const hash = md5(resource.content);

            // skip all checked/unchecked checkboxes from OneNote
            if (
                [
                    "74de5d3d1286f01bac98d32a09f601d9",
                    "4a19d3041585e11643e808d68dd3e72f",
                    "8e17580123099ac6515c3634b1f6f9a1",
                    "5069b775461e471a47ce04ace6e1c6ae",
                    "7912ee9cec35fc3dba49edb63a9ed158",
                    "3a05f4f006a6eaf2627dae5ed8b8013b"
                ].includes(hash)
            ) {
                continue;
            }

            const mediaRegex = new RegExp(`<en-media [^>]*hash="${hash}"[^>]*>`, "g");

            resource.mime = resource.mime || "application/octet-stream";

            const createFileAttachment = () => {
                const attachment = noteEntity.saveAttachment({
                    role: "file",
                    mime: resource.mime || "application/octet-stream",
                    title: resource.title,
                    content: resource.content ?? ""
                });

                const attachmentLink = `<a class="reference-link" href="#root/${noteEntity.noteId}?viewMode=attachments&attachmentId=${attachment.attachmentId}">${escapeHtml(resource.title)}</a>`;

                content = (content || "").replace(mediaRegex, attachmentLink);
            };

            if (resource.mime && resource.mime.startsWith("image/")) {
                try {
                    const originalName = resource.title && resource.title !== "resource" ? resource.title : `image.${resource.mime.substr(6)}`; // default if real name is not present

                    const attachment = imageService.saveImageToAttachment(noteEntity.noteId, resource.content, originalName, !!taskContext.data?.shrinkImages);

                    const encodedTitle = encodeURIComponent(attachment.title);
                    const url = `api/attachments/${attachment.attachmentId}/image/${encodedTitle}`;
                    const imageLink = `<img src="${url}">`;

                    content = content.replace(mediaRegex, imageLink);

                    if (!content.includes(imageLink)) {
                        // if there wasn't any match for the reference, we'll add the image anyway,
                        // otherwise the image would be removed since no note would include it
                        content += imageLink;
                    }
                } catch (e: any) {
                    getLog().error(`error when saving image from ENEX file: ${e.message}`);
                    createFileAttachment();
                }
            } else {
                createFileAttachment();
            }
        }

        content = sanitizeHtml(content);

        // save updated content with links to files/images
        noteEntity.setContent(content);

        noteService.asyncPostProcessContent(noteEntity, content);

        noteEntity.setDateCreatedAndModified(utcDateCreated, utcDateModified);

        // Record for the internal-link resolution pass. Internal links are matched by the target's title
        // (the export carries no per-note guid to match on), so a title shared by 2+ notes is ambiguous:
        // mark it null to leave those links unresolved rather than pointing at the wrong same-named note.
        // Key on the trimmed title so a padded export title still matches a link's (trimmed) anchor text.
        const titleKey = title.trim();
        noteIdByTitle.set(titleKey, noteIdByTitle.has(titleKey) ? null : noteEntity.noteId);
        createdNotes.push({ note: noteEntity, content, utcDateCreated, utcDateModified });
    }

    parser.onclosetag = (tag) => {
        path.pop();

        if (tag === "note") {
            saveNote();
        }
    };

    parser.oncdata = (text) => {
        note.content += text;
    };

    const content = typeof file.buffer === "string" ? file.buffer : new TextDecoder().decode(file.buffer);

    // saveNote() increments progress once per note; count the note-opening tags up front so the client can
    // render a progress bar instead of a bare count. The file is already in memory, so a cheap regex over
    // the raw text gives the denominator without a second parse. `[\s>]` keeps it from matching
    // `<note-attributes>` or `<en-note>`.
    const totalNotes = (content.match(/<note[\s>]/g) ?? []).length;
    if (totalNotes > 0) {
        taskContext.setTotalCount(totalNotes);
    }

    const CHUNK_SIZE = 64 * 1024;
    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
        parser.write(content.slice(i, i + CHUNK_SIZE));
        // Yield to the event loop between chunks to avoid blocking the server.
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    parser.close();

    // Second pass: now that every imported note's title is known, resolve Evernote internal note links
    // (`evernote://view-note/<guid>`) to Trilium reference links. setContent re-stamps the modification
    // date, so the original timestamps are restored afterwards.
    for (const { note: noteEntity, content, utcDateCreated, utcDateModified } of createdNotes) {
        const rewritten = rewriteEvernoteLinks(content, (title) => noteIdByTitle.get(title) ?? null);
        if (rewritten === content) {
            continue;
        }

        noteEntity.setContent(rewritten);
        noteService.asyncPostProcessContent(noteEntity, rewritten);
        noteEntity.setDateCreatedAndModified(utcDateCreated, utcDateModified);
    }

    return rootNote;
}

export default { importEnex };
