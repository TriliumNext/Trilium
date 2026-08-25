import type { AttachmentRole } from "@triliumnext/commons";

import becca from "../../becca/becca.js";
import type BAttachment from "../../becca/entities/battachment.js";
import type BNote from "../../becca/entities/bnote.js";
import { SCRIPT_MODULES_ROOT } from "../hidden_subtree.js";
import noteService from "../notes.js";
import { decodeUtf8 } from "../utils/binary.js";
import { hashedBlobId } from "../utils/index.js";
import type { PackageSpec, ScriptModuleArtifact } from "./provider.js";

/** Role of the attachments holding a module's files, so they read as source rather than media. */
export const MODULE_FILE_ROLE: AttachmentRole = "scriptModule";

/**
 * One file of an installed package, described without its source.
 *
 * Everything here comes from the note and attachment rows, so describing an install reads no
 * content. The source is read a file at a time through {@link openScriptModuleSources}.
 */
export interface ScriptModuleFileInfo {
    name: string;
    /** URL it came from, kept so an install can be checked against its source later. */
    url: string;
    /** Length of the stored source, measured by SQL rather than by reading it. */
    size: number;
    /** Identity of the stored source, so a loader can tell a rebuild from what it already holds. */
    blobId: string;
}

/** An installed package, as it is kept in the database. */
export interface StoredScriptModule {
    noteId: string;
    spec: PackageSpec;
    /** {@link ScriptModuleArtifact.providerId} of whoever built it. */
    providerId: string;
    /** Name of the file in {@link files} to import. */
    entry: string;
    files: ScriptModuleFileInfo[];
    /** Stored length across every file. */
    size: number;
    /** When the install last wrote this, as a UTC datetime string. */
    dateModified: string;
}

/**
 * Writes an artifact to its note, replacing whatever was there.
 *
 * The note id is derived from the package rather than generated, so two instances that install the
 * same package before they sync converge on one note instead of each carrying its own copy.
 *
 * Needs a CLS context, as any note write does.
 */
export function storeScriptModule(artifact: ScriptModuleArtifact): StoredScriptModule {
    const noteId = scriptModuleNoteId(artifact.spec);
    const manifest: ScriptModuleManifest = {
        spec: artifact.spec,
        providerId: artifact.providerId,
        entry: artifact.entry,
        files: artifact.files.map((file) => ({ name: file.name, url: file.url }))
    };
    const content = JSON.stringify(manifest, null, 4);

    let note = becca.notes[noteId];
    if (note) {
        note.setContent(content);
    } else {
        ({ note } = noteService.createNewNote({
            noteId,
            parentNoteId: SCRIPT_MODULES_ROOT,
            title: formatPackageSpec(artifact.spec),
            type: "code",
            mime: "application/json",
            content,
            ignoreForbiddenParents: true
        }));
    }

    for (const file of artifact.files) {
        note.saveAttachment({
            title: file.name,
            role: MODULE_FILE_ROLE,
            mime: "application/javascript",
            content: file.source
        }, "title");
    }

    // A rebuild of the same package can name fewer files than the install it replaces.
    const stored = new Set(artifact.files.map((file) => file.name));
    for (const attachment of moduleAttachments(note)) {
        if (!stored.has(attachment.title)) {
            attachment.markAsDeleted();
        }
    }

    const read = readScriptModule(note);
    if (!read) {
        const name = formatPackageSpec(artifact.spec);
        throw new Error(`Stored script module '${name}' could not be read back.`);
    }
    return read;
}

/** The installed package for a spec, or `undefined` where it is not installed. */
export function findScriptModule(spec: PackageSpec): StoredScriptModule | undefined {
    const note = becca.notes[scriptModuleNoteId(spec)];
    return note ? readScriptModule(note) : undefined;
}

/**
 * The installed package a note holds, or `undefined` where the note is not one.
 *
 * Answers by note id alone, so acting on one install — removing it, loading it — does not have to
 * read every other install to find it.
 */
export function findScriptModuleByNoteId(noteId: string): StoredScriptModule | undefined {
    const note = becca.notes[noteId];
    const installed = note?.getParentBranches()
        .some((branch) => branch.parentNoteId === SCRIPT_MODULES_ROOT);

    return note && installed ? readScriptModule(note) : undefined;
}

/** Every installed package, in title order. */
export function listScriptModules(): StoredScriptModule[] {
    const root = becca.notes[SCRIPT_MODULES_ROOT];
    if (!root) {
        return [];
    }

    const modules: StoredScriptModule[] = [];
    for (const child of root.getChildNotes()) {
        const module = readScriptModule(child);
        if (module) {
            modules.push(module);
        }
    }

    return modules.sort((a, b) =>
        formatPackageSpec(a.spec).localeCompare(formatPackageSpec(b.spec)));
}

/**
 * Opens a module's sources for reading a file at a time.
 *
 * The attachment rows are listed once and their content is read per call, so a script that imports
 * one file of a package never puts the rest of it in memory.
 */
export function openScriptModuleSources(note: BNote): (fileName: string) => string | undefined {
    const attachments = new Map(moduleAttachments(note).map((a) => [a.title, a]));

    return (fileName: string) => {
        const attachment = attachments.get(fileName);
        return attachment ? decodeUtf8(attachment.getContent()) : undefined;
    };
}

/** Removes an installed package. Answers whether there was one to remove. Needs a CLS context. */
export function deleteScriptModule(spec: PackageSpec): boolean {
    const note = becca.notes[scriptModuleNoteId(spec)];
    if (!note) {
        return false;
    }

    note.deleteNote();
    return true;
}

/**
 * The note id an installed package occupies.
 *
 * Derived from the package rather than random so that every instance agrees on it, and prefixed so
 * that a note id belonging to a module is recognizable as one.
 */
export function scriptModuleNoteId(spec: PackageSpec): string {
    return `sm${hashedBlobId(formatPackageSpec(spec)).slice(0, 10)}`;
}

/** Writes a spec back in the form it was parsed from: `@scope/name@version/subpath`. */
export function formatPackageSpec(spec: PackageSpec): string {
    const version = spec.version ? `@${spec.version}` : "";
    return `${spec.name}${version}${spec.subpath ?? ""}`;
}

/** What a module note's content holds. The sources live in attachments, not here. */
interface ScriptModuleManifest {
    spec: PackageSpec;
    providerId: string;
    entry: string;
    files: { name: string; url: string }[];
}

/**
 * Reads a module note back, or answers `undefined` where it is not one — a note whose content is
 * not a manifest, or one whose files did not all survive.
 *
 * Reads the manifest and the attachment rows, never the sources: what an install is stays
 * answerable however large the package it holds.
 */
function readScriptModule(note: BNote): StoredScriptModule | undefined {
    const manifest = parseManifest(decodeUtf8(note.getContent()));
    if (!manifest) {
        return undefined;
    }

    const attachments = new Map(moduleAttachments(note).map((a) => [a.title, a]));

    const files: ScriptModuleFileInfo[] = [];
    let size = 0;
    for (const file of manifest.files) {
        const attachment = attachments.get(file.name);
        if (!attachment) {
            return undefined;
        }
        const fileSize = attachment.contentLength ?? 0;
        size += fileSize;
        files.push({
            name: file.name,
            url: file.url,
            size: fileSize,
            blobId: attachment.blobId ?? ""
        });
    }

    return {
        noteId: note.noteId,
        spec: manifest.spec,
        providerId: manifest.providerId,
        entry: manifest.entry,
        files,
        size,
        dateModified: note.utcDateModified ?? ""
    };
}

/**
 * Reads a manifest, answering `undefined` for anything that is not one.
 *
 * Kept separate from the note it came out of so the shape of a stored module is checked in one
 * place, whether that content was written by this version, an older one, or by hand.
 */
export function parseManifest(content: string): ScriptModuleManifest | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return undefined;
    }

    if (typeof parsed !== "object" || parsed === null) {
        return undefined;
    }

    const { spec, providerId, entry, files } = parsed as Record<string, unknown>;
    if (typeof providerId !== "string" || typeof entry !== "string" || !Array.isArray(files)) {
        return undefined;
    }
    const asSpec = spec as PackageSpec | null;
    if (typeof spec !== "object" || asSpec === null || typeof asSpec.name !== "string") {
        return undefined;
    }

    const named: { name: string; url: string }[] = [];
    for (const file of files) {
        if (typeof file !== "object" || file === null) {
            return undefined;
        }
        const { name, url } = file as Record<string, unknown>;
        if (typeof name !== "string" || typeof url !== "string") {
            return undefined;
        }
        named.push({ name, url });
    }

    if (!named.some((file) => file.name === entry)) {
        return undefined;
    }

    return { spec: spec as PackageSpec, providerId, entry, files: named };
}

/** Lists a module's file attachments with their stored length, but without their content. */
function moduleAttachments(note: BNote): BAttachment[] {
    return note.getAttachments().filter((attachment) => attachment.role === MODULE_FILE_ROLE);
}
