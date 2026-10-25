import type { AttributeType } from "@triliumnext/commons";

import type BNote from "../../becca/entities/bnote.js";
import { captureContentJobEnv } from "../content_jobs/env.js";
import { getContentJobExecutor } from "../content_jobs/executor.js";
import * as cls from "../context.js";
import * as utils from "../utils/index.js";
import imageService from "../image.js";
import { getLog } from "../log.js";
import noteService from "../notes.js";
import protectedSessionService from "../protected_session.js";
import type TaskContext from "../task_context.js";
import { escapeHtml, md5 } from "../utils/index.js";
import { decodeBase64 } from "../utils/binary.js";
import type { File } from "./common.js";
import { type EnexTask, rewriteEvernoteLinks } from "./enex_converter.js";
import { sanitizeHtml } from "../sanitizer.js";

/** A parsed `<note>` waiting for its content job and its save. */
type ParsedNote = Pick<Partial<Note>, "title" | "content" | "attributes" | "resources" | "tasks" | "utcDateCreated" | "utcDateModified">;

/** A parsed note and its running content job, or `null` when the note lacks a title or content. */
interface QueuedNote {
    parsedNote: ParsedNote;
    convertedContent: Promise<string> | null;
}

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

    // Root created; keep the imported notes in their ENEX order under an inherited #newNotesOnTop (the root
    // above still floats to the top of the target). See cls.setImportOrderPreserved.
    cls.setImportOrderPreserved(true);

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

            /* v8 ignore next -- a text event under note-attributes always has a current tag, so the "" fallback is unreachable */
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

    const contentJobs = getContentJobExecutor();
    const contentEnv = captureContentJobEnv();

    // Each parsed note's content job starts when the note is queued, so the jobs of queued notes
    // run concurrently. The notes are saved one at a time, in document order, by a chain of
    // promises: each waits for the previous save and for its own content job. The parser pauses
    // while too many wait.
    const highWater = (contentJobs.concurrency ?? 4) * 4;
    const queuedNotes: QueuedNote[] = [];
    let saving: Promise<void> = Promise.resolve();
    let saveFailure: { error: unknown } | null = null;
    let onNoteSaved: (() => void) | null = null;

    function queueNote(parsedNote: ParsedNote) {
        const { title, content, tasks } = parsedNote;
        const convertedContent = title && content
            ? contentJobs.run({
                kind: "enexNoteContent", content, tasks: tasks ?? [], env: contentEnv
            })
            : null;
        // The save chain awaits it; until then a rejection is not unhandled.
        convertedContent?.catch(() => {});
        queuedNotes.push({ parsedNote, convertedContent });

        saving = saving.then(async () => {
            const next = queuedNotes.shift();
            try {
                if (next && !saveFailure) {
                    await saveNote(next);
                }
            } catch (error) {
                saveFailure = { error };
            } finally {
                onNoteSaved?.();
                onNoteSaved = null;
            }
        });
    }

    async function saveNote({ parsedNote, convertedContent }: QueuedNote) {
        let { title, attributes, resources, utcDateCreated, utcDateModified } = parsedNote;

        if (!title || !convertedContent) {
            throw new Error("Missing title or content for note.");
        }

        let content = await convertedContent;

        const noteEntity = noteService.createNewNote({
            parentNoteId: rootNote.noteId,
            title,
            content,
            utcDateCreated,
            type: "text",
            mime: "text/html",
            isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
        }).note;

        /* v8 ignore next -- the note object is created with an attributes array on <note>, so the [] fallback is unreachable */
        for (const attr of attributes || []) {
            noteEntity.addAttribute(attr.type, attr.name, attr.value);
        }

        utcDateCreated = utcDateCreated || noteEntity.utcDateCreated;
        // sometime date modified is not present in ENEX, then use date created
        utcDateModified = utcDateModified || utcDateCreated;

        taskContext.increaseProgressCount();

        /* v8 ignore next -- the note object is created with a resources array on <note>, so the [] fallback is unreachable */
        for (const resource of resources || []) {
            if (!resource.content) {
                continue;
            }

            /* v8 ignore next -- the parser only ever accumulates a resource's data as a base64 string */
            if (typeof resource.content === "string") {
                resource.content = decodeBase64(resource.content);
            }

            const hash = md5(resource.content);

            // skip all checked/unchecked checkboxes from OneNote
            /* v8 ignore start -- hitting this needs the byte-exact OneNote checkbox images these md5 hashes were taken from */
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
            /* v8 ignore stop */

            const mediaRegex = new RegExp(`<en-media [^>]*hash="${hash}"[^>]*>`, "g");

            resource.mime = resource.mime || "application/octet-stream";

            const createFileAttachment = () => {
                const attachment = noteEntity.saveAttachment({
                    role: "file",
                    /* v8 ignore next -- the mime is defaulted just above, so this fallback is unreachable */
                    mime: resource.mime || "application/octet-stream",
                    title: resource.title,
                    /* v8 ignore next -- a content-less resource is skipped above, so this fallback is unreachable */
                    content: resource.content ?? ""
                });

                const attachmentLink = `<a class="reference-link" href="#root/${noteEntity.noteId}?viewMode=attachments&attachmentId=${attachment.attachmentId}">${escapeHtml(resource.title)}</a>`;

                /* v8 ignore next -- saveNote rejects an empty content above, so the "" fallback is unreachable */
                content = (content || "").replace(mediaRegex, attachmentLink);
            };

            if (resource.mime && resource.mime.startsWith("image/")) {
                try {
                    /* v8 ignore next -- a resource's title defaults to "resource", so it is never empty here */
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
            // A copy, because the parser keeps appending to the arrays of the note it last opened.
            const { title, content, attributes, resources, tasks, utcDateCreated, utcDateModified } = note;
            queueNote({
                title,
                content,
                attributes: attributes && [ ...attributes ],
                resources: resources && [ ...resources ],
                tasks: tasks && [ ...tasks ],
                utcDateCreated,
                utcDateModified
            });
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

    // Each write ends at most one note, so the queue grows by at most one between checks.
    const CHUNK_SIZE = 64 * 1024;
    let parseError: { error: unknown } | null = null;
    try {
        let position = 0;
        let nextYield = CHUNK_SIZE;
        // The end of the note being written, searched for again only once `position` reaches it.
        let noteEnd = 0;
        while (position < content.length && !saveFailure) {
            if (noteEnd <= position) {
                const found = content.indexOf("</note>", position);
                noteEnd = found === -1 ? content.length : found + "</note>".length;
            }
            const end = Math.min(position + CHUNK_SIZE, noteEnd);
            parser.write(content.slice(position, end));
            position = end;

            while (queuedNotes.length > highWater && !saveFailure) {
                await new Promise<void>((resolve) => {
                    onNoteSaved = resolve;
                });
            }

            if (position >= nextYield) {
                nextYield = position + CHUNK_SIZE;
                // Yield to the event loop between chunks to avoid blocking the server.
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }
        if (!saveFailure) {
            parser.close();
        }
    } catch (error) {
        parseError = { error };
    }

    await saving;
    // A failed save comes earlier in the document than anything the parser reached after it.
    const failure = saveFailure ?? parseError;
    if (failure) {
        throw failure.error;
    }

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
