/**
 * Imports a Google Keep (Google Takeout) export zip into a Trilium note tree.
 *
 * Takeout exports each Keep note as `<title-or-timestamp>.json` (plus a redundant `.html`/`.txt` and any
 * attachment files alongside). Keep has no hierarchy — notes are a flat list organised only by labels — so
 * this importer creates every note directly under a single "Google Keep import" root. It reconstructs each
 * note's title, body (plain text, rich text or checklist), colour, original timestamps and any attachments
 * (Keep stores images/audio/etc. as separate files in the zip, referenced from the note JSON's
 * `attachments` array). Labels and pinned/archived/trashed flags are deliberately deferred.
 *
 * Invoked from the shared file-import dispatcher (routes/api/import.ts) when the upload is tagged
 * `format=keep`, so progress, completion and failure are reported by that dispatcher's TaskContext — this
 * service just builds the tree and returns its root note, like the zip/notion importers.
 */

import { t } from "i18next";

import type BNote from "../../../becca/entities/bnote.js";
import * as cls from "../../context.js";
import imageService from "../../image.js";
import noteService from "../../notes.js";
import protectedSessionService from "../../protected_session.js";
import { sanitizeHtml } from "../../sanitizer.js";
import type TaskContext from "../../task_context.js";
import { decodeUtf8 } from "../../utils/binary.js";
import dateUtils from "../../utils/date.js";
import { getZipProvider, type ZipSource } from "../../zip_provider.js";
import mimeService from "../mime.js";
import { convertKeepHtml, convertKeepHtmlInline } from "./converter.js";

/** A checklist row in a Keep note (`listContent`). */
interface KeepListItem {
    text?: string;
    /** Rich-text (basic formatting) variant of `text`; preferred when present. */
    textHtml?: string;
    isChecked?: boolean;
}

/** A media file (image, audio, drawing, …) attached to a Keep note; the binary lives alongside in the zip. */
interface KeepAttachment {
    /** The attachment's file name within the export (the zip entry's base name), e.g. "abc123.png". */
    filePath?: string;
    /** Keep's declared MIME type, e.g. "image/png" — used only as a fallback to the extension. */
    mimetype?: string;
}

/** The subset of a Keep Takeout note JSON this iteration reads. */
interface KeepNote {
    title?: string;
    /** Plain-text body of a text note; fallback when `textContentHtml` is absent. */
    textContent?: string;
    /** Rich-text (basic formatting) body of a text note; preferred when present. */
    textContentHtml?: string;
    /** Body of a checklist note; mutually exclusive with the text fields. */
    listContent?: KeepListItem[];
    /** Media files (images/audio/…) attached to the note, stored as separate files in the export. */
    attachments?: KeepAttachment[];
    /** Note background colour, one of Keep's named palette entries ("DEFAULT" for none). */
    color?: string;
    /** Creation/last-edit timestamps, in microseconds since the Unix epoch. */
    createdTimestampUsec?: number;
    userEditedTimestampUsec?: number;
}

/** A note attachment resolved to its export file name and the MIME we'll persist it with. */
interface ParsedAttachment {
    /** The attachment file's base name, used to look its binary up among the zip's non-note entries. */
    fileName: string;
    /** MIME derived from the file's extension, falling back to Keep's declared type then octet-stream. */
    mime: string;
}

interface ParsedNote {
    title: string;
    /** Body HTML; empty when the note has neither text nor list content. */
    content: string;
    /** Media attachments referenced by the note (images embedded inline, other files as links). */
    attachments: ParsedAttachment[];
    /** Hex colour for Trilium's `#color` label, or undefined for Keep's default (no colour). */
    colorHex?: string;
    utcDateCreated?: string;
    utcDateModified?: string;
}

async function importKeep(taskContext: TaskContext<"importNotes">, source: ZipSource, importRootNote: BNote): Promise<BNote> {
    const { notes, binaries } = await parseNotes(source);
    taskContext.setTotalCount(notes.length);

    return createNotes(importRootNote, notes, binaries, taskContext);
}

/**
 * Reads the zip in a single pass, parsing each note (.json entry) and collecting every attachment binary
 * (keyed by its base file name) so notes can later resolve the files they reference. The redundant per-note
 * `.html`/`.txt` and the `Labels.txt` index are skipped.
 */
async function parseNotes(source: ZipSource): Promise<{ notes: ParsedNote[]; binaries: Map<string, Uint8Array> }> {
    const provider = getZipProvider();
    const filenameEncoding = await provider.detectFilenameEncoding(source);

    const notes: ParsedNote[] = [];
    const binaries = new Map<string, Uint8Array>();
    await provider.readZipFile(source, async (entry, readContent) => {
        const path = entry.fileName;
        if (isDirectory(path)) {
            return;
        }

        const lower = path.toLowerCase();
        if (lower.endsWith(".json")) {
            const parsed = parseNote(path, new TextDecoder().decode(await readContent()));
            if (parsed) {
                notes.push(parsed);
            }
        } else if (!lower.endsWith(".html") && !lower.endsWith(".txt")) {
            // Everything that isn't a note or a redundant per-note .html/.txt (nor the Labels.txt index, also
            // .txt) is an attachment binary. Key it by base name to match the note JSON's `filePath`.
            binaries.set(baseName(path), await readContent());
        }
    }, filenameEncoding);

    return { notes, binaries };
}

export function parseNote(path: string, json: string): ParsedNote | null {
    let note: KeepNote;
    try {
        note = JSON.parse(json) as KeepNote;
    } catch {
        // A non-note JSON (or a malformed entry) is skipped rather than failing the whole import.
        return null;
    }

    // Untitled Keep notes export with an empty `title`; fall back to a readable title derived from the
    // timestamp filename.
    const title = note.title?.trim() || formatUntitledTitle(removeExtension(baseName(path)));

    return {
        title,
        content: buildContent(note),
        attachments: parseAttachments(note.attachments),
        colorHex: keepColorToHex(note.color),
        utcDateCreated: usecToUtc(note.createdTimestampUsec),
        utcDateModified: usecToUtc(note.userEditedTimestampUsec)
    };
}

/**
 * Resolves a note's `attachments` entries to the file name + MIME we'll persist them with. Entries without a
 * `filePath` (nothing to look up) are dropped. The MIME is derived from the file's extension — Keep's own
 * `mimetype` is only the fallback, mirroring the other importers, which trust the extension over the export's
 * declared type.
 */
function parseAttachments(attachments: KeepAttachment[] | undefined): ParsedAttachment[] {
    if (!attachments?.length) {
        return [];
    }

    const parsed: ParsedAttachment[] = [];
    for (const attachment of attachments) {
        const fileName = attachment.filePath ? baseName(attachment.filePath) : "";
        if (!fileName) {
            continue;
        }
        parsed.push({
            fileName,
            mime: mimeService.getMime(fileName) || attachment.mimetype || "application/octet-stream"
        });
    }
    return parsed;
}

/**
 * Builds a note's body HTML from its checklist or text content (whichever is present). For both, Keep's
 * rich-text variant (`textHtml`/`textContentHtml`, basic bold/italic/underline formatting) is preferred,
 * falling back to the plain-text field. The result is sanitized downstream, in {@link createNotes}.
 */
function buildContent(note: KeepNote): string {
    if (note.listContent?.length) {
        const items = note.listContent
            .filter((item) => item.text || item.textHtml)
            .map((item) => {
                // Match the canonical CKEditor task-list serialization (checked before disabled).
                const attributes = item.isChecked ? ` checked="checked" disabled="disabled"` : ` disabled="disabled"`;
                // The `?? ""` fallback is unreachable: items with neither `text` nor `textHtml` are removed by
                // the filter above, so reaching the `escapeHtml` branch (textHtml falsy) implies `text` is set.
                /* v8 ignore next */
                const label = item.textHtml ? convertKeepHtmlInline(item.textHtml) : escapeHtml(item.text ?? "");
                return `<li><label class="todo-list__label"><input type="checkbox"${attributes}><span class="todo-list__label__description">${label}</span></label></li>`;
            });
        return items.length ? `<ul class="todo-list">${items.join("")}</ul>` : "";
    }

    if (note.textContentHtml) {
        return convertKeepHtml(note.textContentHtml);
    }

    if (note.textContent) {
        return note.textContent
            .split("\n")
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join("");
    }

    return "";
}

/**
 * Creates the (flat) note tree under a fresh "Google Keep import" root — Keep has no page hierarchy, so
 * every note is parented directly under that root. Returns the root.
 */
function createNotes(importRootNote: BNote, notes: ParsedNote[], binaries: Map<string, Uint8Array>, taskContext: TaskContext<"importNotes">): BNote {
    // The protected-session branch requires importing into a protected root with an active protected session,
    // which the import harness/tests don't exercise.
    /* v8 ignore next */
    const isProtected = importRootNote.isProtected && protectedSessionService.isProtectedSessionAvailable();
    const shrinkImages = !!taskContext.data?.shrinkImages;

    const rootNote = noteService.createNewNote({ parentNoteId: importRootNote.noteId, title: t("keep_import.root-title"), content: "", type: "text", mime: "text/html", isProtected }).note;
    rootNote.addLabel("iconClass", "bx bx-import");

    // Root created; keep the imported notes in export order under an inherited #newNotesOnTop (the root above
    // still floats to the top of the target). See cls.setImportOrderPreserved.
    cls.setImportOrderPreserved(true);

    for (const parsed of notes) {
        const { note } = noteService.createNewNote({
            parentNoteId: rootNote.noteId,
            title: parsed.title,
            // Keep's exported HTML is external content; sanitize before persisting (this also demotes the
            // `<h1>` Keep uses for its top heading level, which Trilium reserves for the note title).
            content: sanitizeHtml(parsed.content),
            type: "text",
            mime: "text/html",
            isProtected
        });

        if (parsed.colorHex) {
            note.addLabel("color", parsed.colorHex);
        }

        // Embed the note's attachments (their binaries live elsewhere in the zip). Re-saves the content, so it
        // must precede the timestamp restore below.
        appendAttachments(note, parsed.attachments, binaries, shrinkImages);

        // Preserve Keep's original timestamps. Must run after createNewNote's content save (and the attachment
        // re-save above), which would otherwise re-stamp the modification date with "now".
        if (parsed.utcDateCreated || parsed.utcDateModified) {
            note.setDateCreatedAndModified(parsed.utcDateCreated ?? parsed.utcDateModified, parsed.utcDateModified ?? parsed.utcDateCreated);
        }

        taskContext.increaseProgressCount();
    }

    return rootNote;
}

/**
 * Persists a note's attachments and appends a reference to each onto the note's body. Keep notes carry no
 * inline placeholder for their attachments (the JSON lists them separately), so each is appended after the
 * text body: an image as an inline `<img>` pointing at a `role:"image"` attachment, any other file as a
 * `role:"file"` attachment reference-link. An attachment whose binary is missing from the export is skipped.
 * Only re-saves the content when at least one attachment was embedded.
 */
function appendAttachments(note: BNote, attachments: ParsedAttachment[], binaries: Map<string, Uint8Array>, shrinkImages: boolean) {
    const additions: string[] = [];

    for (const attachment of attachments) {
        const bytes = binaries.get(attachment.fileName);
        if (!bytes) {
            continue;
        }

        if (attachment.mime.startsWith("image/")) {
            const { attachmentId, title } = imageService.saveImageToAttachment(note.noteId, bytes, attachment.fileName, shrinkImages);
            // saveImageToAttachment always returns the id of the attachment it just created, so this guard is
            // never false in practice.
            /* v8 ignore next */
            if (attachmentId) {
                additions.push(`<p><img src="api/attachments/${attachmentId}/image/${encodeURIComponent(title)}"></p>`);
            }
        } else {
            const { attachmentId } = note.saveAttachment({ role: "file", mime: attachment.mime, title: attachment.fileName, content: bytes });
            additions.push(`<p><a class="reference-link" href="#root/${note.noteId}?viewMode=attachments&attachmentId=${attachmentId}">${escapeHtml(attachment.fileName)}</a></p>`);
        }
    }

    if (additions.length) {
        note.setContent(sanitizeHtml(decodeUtf8(note.getContent()) + additions.join("")));
    }
}

/**
 * Keep's named note colours mapped to their exact palette hex (taken from the colour classes in Keep's own
 * exported `.html`). "DEFAULT" (no colour) is intentionally absent.
 */
const KEEP_COLOR_HEX: Record<string, string> = {
    RED: "#ff6d3f",
    ORANGE: "#ff9b00",
    YELLOW: "#ffda00",
    GREEN: "#95d641",
    TEAL: "#1ce8b5",
    BLUE: "#3fc3ff",
    CERULEAN: "#82b1ff",
    PURPLE: "#b388ff",
    PINK: "#f8bbd0",
    BROWN: "#d7ccc8",
    GRAY: "#b8c4c9"
};

/** Maps a Keep note colour to its Trilium `#color` hex, or undefined for the default/unknown/missing colour. */
function keepColorToHex(color: string | undefined): string | undefined {
    return color ? KEEP_COLOR_HEX[color.toUpperCase()] : undefined;
}

/** Converts a Keep microsecond-epoch timestamp to Trilium's UTC DB format, or undefined if absent/invalid. */
function usecToUtc(usec: number | undefined): string | undefined {
    if (usec == null) {
        return undefined;
    }
    const date = new Date(usec / 1000);
    return Number.isNaN(date.getTime()) ? undefined : dateUtils.utcDateTimeStr(date);
}

/**
 * Builds a readable title for an untitled note from its filename. Keep names untitled notes by their
 * timestamp with the local-time offset baked in (e.g. "2026-06-21T11_14_14.438+03_00"); reformat that to
 * "2026-06-21 11:14:14" — the digits before the offset are already local, so no conversion is needed.
 * Non-timestamp names are returned as-is, and an empty name falls back to "Untitled".
 */
function formatUntitledTitle(name: string): string {
    const match = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})_(\d{2})_(\d{2})/);
    if (match) {
        const [, date, hour, minute, second] = match;
        return `${date} ${hour}:${minute}:${second}`;
    }
    return name || "Untitled";
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isDirectory(path: string): boolean {
    return path.endsWith("/");
}

function baseName(path: string): string {
    // The `?? path` fallback is unreachable: String.prototype.split always returns a non-empty array, so
    // `pop()` here is at worst "" (never undefined).
    /* v8 ignore next */
    return path.split("/").pop() ?? path;
}

function removeExtension(name: string): string {
    return name.replace(/\.[^.]+$/, "");
}

export default { importKeep };
