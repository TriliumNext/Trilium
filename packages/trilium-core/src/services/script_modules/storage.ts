import type { AttachmentRole } from "@triliumnext/commons";

import becca from "../../becca/becca.js";
import type BAttachment from "../../becca/entities/battachment.js";
import type BNote from "../../becca/entities/bnote.js";
import { SCRIPT_MODULES_ROOT } from "../hidden_subtree.js";
import noteService from "../notes.js";
import { decodeUtf8 } from "../utils/binary.js";
import { hashedBlobId } from "../utils/index.js";
import type { ModuleTarget, PackageSpec, ScriptModuleArtifact, ScriptModuleFile } from "./provider.js";

/** Role of the attachments holding a module's files, so they read as source rather than media. */
export const MODULE_FILE_ROLE: AttachmentRole = "scriptModule";

/**
 * Role of the attachments holding a module's TypeScript declarations.
 *
 * Kept apart from the sources so the two are read by the halves that want them and nothing else: the
 * loader lists only {@link MODULE_FILE_ROLE}, and the editor only these.
 */
export const MODULE_TYPES_ROLE: AttachmentRole = "scriptModuleTypes";

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

/** The declarations an installed package is typed by, as they are kept in the database. */
export interface StoredScriptModuleTypes {
    /** Name of the file in {@link files} the package is typed by. */
    entry: string;
    files: ScriptModuleFileInfo[];
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
    /** What the package is typed by, where it was installed with declarations. */
    types?: StoredScriptModuleTypes;
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
        files: artifact.files.map(described),
        ...(artifact.types
            ? { types: { entry: artifact.types.entry, files: artifact.types.files.map(described) } }
            : {})
    };
    const content = JSON.stringify(manifest, null, 4);

    let note = becca.notes[noteId];
    if (note) {
        note.setContent(content);
    } else {
        ({ note } = noteService.createNewNote({
            noteId,
            parentNoteId: SCRIPT_MODULES_ROOT,
            title: scriptModuleTitle(artifact.spec),
            type: "code",
            mime: "application/json",
            content,
            ignoreForbiddenParents: true
        }));
    }

    writeFiles(note, artifact.files, MODULE_FILE_ROLE, "application/javascript");
    writeFiles(note, artifact.types?.files ?? [], MODULE_TYPES_ROLE, "application/typescript");

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

/**
 * Reads an installed package's declarations whole, or answers nothing where it has none.
 *
 * Whole rather than a file at a time, unlike {@link openScriptModuleSources}: the one reader of
 * these is the script editor, which needs every one of them at once to type-check against.
 */
export function readScriptModuleTypes(module: StoredScriptModule): { name: string; content: string }[] | undefined {
    const note = becca.notes[module.noteId];
    if (!note || !module.types) {
        return undefined;
    }

    const attachments = new Map(moduleAttachments(note, MODULE_TYPES_ROLE).map((a) => [a.title, a]));

    const files: { name: string; content: string }[] = [];
    for (const file of module.types.files) {
        const attachment = attachments.get(file.name);
        if (!attachment) {
            return undefined;
        }
        files.push({ name: file.name, content: decodeUtf8(attachment.getContent()) });
    }

    return files;
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
    const identity = spec.target === "portable"
        ? formatPackageSpec(spec)
        : `${formatPackageSpec(spec)}#${spec.target}`;

    return `sm${hashedBlobId(identity).slice(0, 10)}`;
}

/**
 * Writes a spec back in the form it was parsed from: `@scope/name@version/subpath`.
 *
 * The build is not part of it. This is what a script names in `require()`, and which build answers
 * that is the runtime's business rather than something a script should have to spell.
 */
export function formatPackageSpec(spec: PackageSpec): string {
    const version = spec.version ? `@${spec.version}` : "";
    return `${spec.name}${version}${spec.subpath ?? ""}`;
}

/** How an installed package is titled, where the build has to be told apart at a glance. */
export function scriptModuleTitle(spec: PackageSpec): string {
    return spec.target === "node"
        ? `${formatPackageSpec(spec)} (Node.js)`
        : formatPackageSpec(spec);
}

/** What a module note's content holds. The sources live in attachments, not here. */
interface ScriptModuleManifest {
    spec: PackageSpec;
    providerId: string;
    entry: string;
    files: { name: string; url: string }[];
    types?: { entry: string; files: { name: string; url: string }[] };
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

    const files = describeStored(note, MODULE_FILE_ROLE, manifest.files);
    if (!files) {
        return undefined;
    }

    // Declarations that did not survive cost the completions rather than the install, so a package
    // whose types are gone is read back as one that never had any.
    const typeFiles = manifest.types
        && describeStored(note, MODULE_TYPES_ROLE, manifest.types.files);

    return {
        noteId: note.noteId,
        spec: manifest.spec,
        providerId: manifest.providerId,
        entry: manifest.entry,
        files,
        ...(manifest.types && typeFiles ? { types: { entry: manifest.types.entry, files: typeFiles } } : {}),
        size: files.reduce((total, file) => total + file.size, 0),
        dateModified: note.utcDateModified ?? ""
    };
}

/**
 * Describes one role's stored files, or `undefined` where the manifest names one that is not there.
 *
 * Reads the attachment rows and never their content, so describing an install stays free of the
 * megabytes it holds.
 */
function describeStored(
    note: BNote,
    role: AttachmentRole,
    named: { name: string; url: string }[]
): ScriptModuleFileInfo[] | undefined {
    const attachments = new Map(moduleAttachments(note, role).map((a) => [a.title, a]));

    const files: ScriptModuleFileInfo[] = [];
    for (const file of named) {
        const attachment = attachments.get(file.name);
        if (!attachment) {
            return undefined;
        }
        files.push({
            name: file.name,
            url: file.url,
            size: attachment.contentLength ?? 0,
            blobId: attachment.blobId ?? ""
        });
    }

    return files;
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

    const { spec, providerId, entry, files, types } = parsed as Record<string, unknown>;
    if (typeof providerId !== "string" || typeof entry !== "string" || !Array.isArray(files)) {
        return undefined;
    }

    const asSpec = spec as PackageSpec | null;
    if (typeof spec !== "object" || asSpec === null || typeof asSpec.name !== "string") {
        return undefined;
    }
    // A note written before builds were told apart holds the portable one.
    const target: ModuleTarget = asSpec.target === "node" ? "node" : "portable";

    const named = parseFileNames(files);
    if (!named || !named.some((file) => file.name === entry)) {
        return undefined;
    }

    return {
        spec: { ...asSpec, target },
        providerId,
        entry,
        files: named,
        ...(parseTypes(types) ?? {})
    };
}

/** The `types` section of a manifest, or nothing where there is none to read or it is not one. */
function parseTypes(types: unknown): { types: ScriptModuleManifest["types"] } | undefined {
    if (typeof types !== "object" || types === null) {
        return undefined;
    }

    const { entry, files } = types as Record<string, unknown>;
    if (typeof entry !== "string" || !Array.isArray(files)) {
        return undefined;
    }

    const named = parseFileNames(files);
    if (!named || !named.some((file) => file.name === entry)) {
        return undefined;
    }

    return { types: { entry, files: named } };
}

/** Reads a manifest's file list, answering `undefined` for anything that is not one. */
function parseFileNames(files: unknown[]): { name: string; url: string }[] | undefined {
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

    return named;
}

/** Lists a module's file attachments with their stored length, but without their content. */
function moduleAttachments(note: BNote, role: AttachmentRole = MODULE_FILE_ROLE): BAttachment[] {
    return note.getAttachments().filter((attachment) => attachment.role === role);
}

/** How a file is named in the manifest: enough to find it again and to check it against its source. */
function described(file: ScriptModuleFile): { name: string; url: string } {
    return { name: file.name, url: file.url };
}

/**
 * Writes one role's files, dropping the ones a rebuild no longer names.
 *
 * A rebuild of the same package can name fewer files than the install it replaces — and a package
 * that published declarations at one version may publish none at the next, which is that same case
 * with nothing left to write.
 */
function writeFiles(note: BNote, files: ScriptModuleFile[], role: AttachmentRole, mime: string) {
    for (const file of files) {
        note.saveAttachment({ title: file.name, role, mime, content: file.source }, "title");
    }

    const stored = new Set(files.map((file) => file.name));
    for (const attachment of moduleAttachments(note, role)) {
        if (!stored.has(attachment.title)) {
            attachment.markAsDeleted();
        }
    }
}
