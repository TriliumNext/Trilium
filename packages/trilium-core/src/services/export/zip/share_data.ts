import {
    getImageAttachmentTitle, SHARE_HOSTED_NOTE_TYPES, SHARE_HOSTED_VIEW_TYPES
} from "@triliumnext/commons";
import mimeTypes from "mime-types";

import becca from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import {
    buildFrocaRows, buildVisibleNoteMap, buildVisibleRelationMap, buildVisibleScriptBundle,
    getAttachmentRow, getBlobRow, type IsVisibleNote
} from "../../../share/froca_payload.js";

/** Where the export of a subtree writes its notes, as paths relative to the export's root. */
export interface ShareDataPaths {
    /** The path of a note's page, `""` for the root's, or `null` for a note left out. */
    getNotePath(noteId: string): string | null;
    /** The path of an attachment's file, or `null` for one left out. */
    getAttachmentPath(attachmentId: string): string | null;
}

/**
 * Builds the files under `data/` the app views of the export of `root` read in place of the
 * share's API, keyed by their path in the archive:
 *
 * - `data/rows.json`: the rows of every note of the export, with its attachments and the path of
 *   each note's page, of each attachment's file and of each note's image;
 * - `data/blobs/{notes,attachments}/<id>.json`: the content of the notes the views read and of
 *   their attachments;
 * - `data/images/<noteId>.<extension>`: the image of an image note, whose page takes its file;
 * - `data/note-map/<mapRootNoteId>-{tree,link}.json`, `data/relation-map/<noteId>.json` and
 *   `data/script/<noteId>.json`: what a note map, a relation map and a render note draw.
 *
 * Only notes the export holds and that are not protected appear, as on a shared page.
 */
export function buildShareData(root: BNote, paths: ShareDataPaths) {
    const files = new Map<string, string | Uint8Array>();
    const writeJson = (name: string, data: unknown) => files.set(name, JSON.stringify(data));
    const notes = root.getSubtree().notes
        .filter((note) => !note.isProtected && paths.getNotePath(note.noteId) !== null);
    const included = new Set(notes.map((note) => note.noteId));
    const isVisible = (noteId: string) => included.has(noteId);

    const attachments: Record<string, ReturnType<typeof getAttachmentRow>[]> = {};
    const attachmentPaths: Record<string, string> = {};
    const images: Record<string, string> = {};
    for (const note of notes) {
        const owned = note.getAttachments();
        attachments[note.noteId] = owned.map(getAttachmentRow);
        for (const attachment of owned) {
            const path = paths.getAttachmentPath(attachment.attachmentId ?? "");
            if (path !== null) {
                attachmentPaths[attachment.attachmentId ?? ""] = path;
            }
        }

        const imagePath = writeImage(note, files, attachmentPaths);
        if (imagePath) {
            images[note.noteId] = imagePath;
        }
    }

    const rows = buildFrocaRows(notes, (note) => isVisible(note.noteId),
        (note) => paths.getNotePath(note.noteId) ?? "");
    writeJson("data/rows.json", { ...rows, attachments, attachmentPaths, images });

    for (const note of getNotesReadByViews(notes)) {
        writeJson(`data/blobs/notes/${note.noteId}.json`, getBlobRow(note));
        for (const attachment of note.getAttachments()) {
            if (attachment.hasStringContent()) {
                writeJson(`data/blobs/attachments/${attachment.attachmentId}.json`,
                    getBlobRow(attachment));
            }
        }
    }

    for (const note of notes) {
        if (note.type === "noteMap") {
            writeNoteMaps(note, files, isVisible);
        } else if (note.type === "relationMap") {
            writeJson(`data/relation-map/${note.noteId}.json`,
                buildVisibleRelationMap(note.noteId, note.getContent(), isVisible));
        }

        const scripts = note.type === "render" ? note.getRelations("renderNote") : [];
        for (const script of scripts.flatMap((relation) => relation.targetNote ?? [])) {
            const bundle = buildVisibleScriptBundle(script, isVisible);
            if (bundle) {
                writeJson(`data/script/${script.noteId}.json`, bundle);
            }
        }
    }
    return files;
}

/** The view type of a collection, the grid when it names none, or `null` for another note. */
export function getViewTypeOf(note: BNote) {
    return note.type === "book" ? note.getLabelValue("viewType") || "grid" : null;
}

/** Whether a page of the export hosts an app view for `note`. */
export function isHostedNote(note: BNote) {
    const viewType = getViewTypeOf(note);
    return viewType
        ? SHARE_HOSTED_VIEW_TYPES.includes(viewType)
        : SHARE_HOSTED_NOTE_TYPES.includes(note.type);
}

/**
 * The notes whose content the app views of `notes` read: each hosted note, its children (a
 * collection's cards, a dashboard's widgets, a presentation's slides) and theirs (vertical
 * slides), of `notes` alone.
 */
function getNotesReadByViews(notes: BNote[]) {
    const byId = new Map(notes.map((note) => [ note.noteId, note ]));
    const read = new Map<string, BNote>();
    for (const hosted of notes.filter(isHostedNote)) {
        const children = hosted.getChildNotes();
        const grandchildren = children.flatMap((child) => child.getChildNotes());
        for (const note of [ hosted, ...children, ...grandchildren ]) {
            const exported = byId.get(note.noteId);
            if (exported) {
                read.set(exported.noteId, exported);
            }
        }
    }
    return [ ...read.values() ];
}

/**
 * Writes the image of an image note under `data/images/` and returns its path; for a note whose
 * image is an attachment, such as a canvas's `canvas-export.svg`, returns that attachment's path.
 */
function writeImage(
    note: BNote,
    files: Map<string, string | Uint8Array>,
    attachmentPaths: Record<string, string>
) {
    if (note.type === "image") {
        const path = `data/images/${note.noteId}.${mimeTypes.extension(note.mime) || "dat"}`;
        files.set(path, note.getContent());
        return path;
    }

    const title = getImageAttachmentTitle(note.type);
    const attachment = title
        ? note.getAttachments().find((candidate) => candidate.title === title)
        : undefined;
    return attachment ? attachmentPaths[attachment.attachmentId ?? ""] : undefined;
}

/**
 * Writes both maps of a note map note, which a reader can switch between, rooted where the app
 * roots it: at `#mapRootNoteId`, else at the note's parent.
 */
function writeNoteMaps(
    note: BNote,
    files: Map<string, string | Uint8Array>,
    isVisible: IsVisibleNote
) {
    const mapRootNoteId = note.getLabelValue("mapRootNoteId")
        || note.getParentBranches()[0]?.parentNoteId;
    const mapRoot = mapRootNoteId ? becca.getNote(mapRootNoteId) : null;
    if (!mapRoot) {
        return;
    }

    const filters = {
        excludeRelations: note.getLabels("mapExcludeRelation").map((label) => label.value),
        includeRelations: note.getLabels("mapIncludeRelation").map((label) => label.value)
    };
    for (const mapType of [ "tree", "link" ] as const) {
        files.set(`data/note-map/${mapRoot.noteId}-${mapType}.json`,
            JSON.stringify(buildVisibleNoteMap(mapRoot, mapType, filters, isVisible)));
    }
}
