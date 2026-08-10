/**
 * Imports a Logseq graph (a zipped graph folder of Markdown files plus assets) into a Trilium note tree.
 *
 * This first pass is deliberately plain: every `.md` file becomes a `text` note whose Markdown body is
 * rendered to HTML, and the graph's folder layout (`journals/`, `pages/`, `assets/`, `draws/`, …) is mirrored
 * as the note tree, a folder becoming an empty container note holding its notes. Every other file becomes a
 * standalone `file`/`image` note at its graph folder location, so nothing in the archive is silently dropped.
 *
 * None of Logseq's own syntax is interpreted yet — the outline of `-` blocks, `key:: value` properties,
 * `[[page]]` references, `{{query}}` macros, `TODO`/`SCHEDULED`/`:LOGBOOK:` markers, the `A___B___C` namespace
 * encoding of page filenames, journal dates and `.excalidraw` drawings all import as the literal Markdown
 * around them. Those are follow-ups; this pass only establishes the importer and its wiring.
 *
 * A graph can be zipped two ways — its *contents* (so `logseq/` sits at the zip root) or its *outer folder*
 * (so everything is nested under `Graph name/`). The location of the `logseq/` config folder pins the true
 * graph root either way, so the redundant wrapper folder is stripped and the import root is named after the
 * graph.
 *
 * Invoked from the shared file-import dispatcher (routes/api/import.ts) when the upload is tagged
 * `format=logseq`, so progress, completion and failure are reported by that dispatcher's TaskContext — this
 * service just builds the tree and returns its root note, like the zip/notion/anytype/obsidian importers.
 */

import { t } from "i18next";

import type BNote from "../../../becca/entities/bnote.js";
import * as cls from "../../context.js";
import noteService from "../../notes.js";
import protectedSessionService from "../../protected_session.js";
import type TaskContext from "../../task_context.js";
import { decodeUtf8 } from "../../utils/binary.js";
import date_utils from "../../utils/date.js";
import { removeFileExtension } from "../../utils/index.js";
import { basename } from "../../utils/path.js";
import { getZipProvider, type ZipSource } from "../../zip_provider.js";
import markdownService from "../markdown.js";
import mimeService from "../mime.js";

interface GraphNote {
    /** The note's graph-root-relative POSIX path, e.g. `pages/contents.md` (the wrapper folder stripped). */
    path: string;
    title: string;
    markdown: string;
    /** The zip entry's modification time, when the reader exposes it (the standalone reader doesn't). */
    modified?: Date;
}

async function importLogseq(taskContext: TaskContext<"importNotes">, source: ZipSource, importRootNote: BNote, fileName?: string): Promise<BNote> {
    const { notes, files, graphRoot } = await parseGraph(source);
    taskContext.setTotalCount(notes.length);

    return createNotes(importRootNote, notes, files, graphTitle(graphRoot, fileName), taskContext);
}

/**
 * Reads the graph zip, collecting one {@link GraphNote} per Markdown file and the raw bytes of every other
 * kept file. The graph root is detected from the location of `logseq/` (see {@link detectGraphRoot}) and
 * stripped from every path. Notes are sorted by path so the resulting tree is built (and ordered)
 * deterministically.
 */
async function parseGraph(source: ZipSource): Promise<{ notes: GraphNote[]; files: Map<string, Uint8Array>; graphRoot: string }> {
    const provider = getZipProvider();
    const allPaths: string[] = [];
    const raw: { path: string; markdown: string; modified?: Date }[] = [];
    const rawFiles: { path: string; bytes: Uint8Array }[] = [];
    const filenameEncoding = await provider.detectFilenameEncoding(source);

    await provider.readZipFile(source, async (entry, readContent) => {
        const path = normalizePath(entry.fileName);
        if (isDirectory(path)) {
            return;
        }
        // Record every entry (including logseq/) so the graph root can be detected; only collect content for
        // the kept ones below.
        allPaths.push(path);
        if (isIgnored(path)) {
            return;
        }
        if (isMarkdown(path)) {
            raw.push({ path, markdown: decodeUtf8(await readContent()), modified: entry.lastModified });
        } else {
            rawFiles.push({ path, bytes: await readContent() });
        }
    }, filenameEncoding);

    const graphRoot = detectGraphRoot(allPaths);
    const notes = raw.map(({ path, markdown, modified }) => {
        const relative = stripGraphRoot(path, graphRoot);
        return { path: relative, title: noteTitle(relative), markdown, modified };
    });
    notes.sort((a, b) => a.path.localeCompare(b.path));

    const files = new Map<string, Uint8Array>();
    for (const { path, bytes } of rawFiles) {
        files.set(stripGraphRoot(path, graphRoot), bytes);
    }

    return { notes, files, graphRoot };
}

/**
 * Builds the note tree under a fresh import root named after the graph. Each note is parented under the
 * container note for its folder (created on demand by {@link ensureFolder}, so a folder note exists before its
 * children), with its Markdown rendered to HTML. Non-Markdown files follow as `file`/`image` notes at their
 * own folder location. Returns the import root.
 */
function createNotes(importRootNote: BNote, notes: GraphNote[], files: Map<string, Uint8Array>, rootTitle: string, taskContext: TaskContext<"importNotes">): BNote {
    /* v8 ignore next -- the protected branch needs a protected import root with an active protected session, which the in-memory test DB has no way to set up */
    const isProtected = !!(importRootNote.isProtected && protectedSessionService.isProtectedSessionAvailable());

    const rootNote = noteService.createNewNote({ parentNoteId: importRootNote.noteId, title: rootTitle, content: "", type: "text", mime: "text/html", isProtected }).note;
    rootNote.addLabel("iconClass", "bx bx-import");

    // Root created; keep the graph's notes/folders in order under an inherited #newNotesOnTop (the root above
    // still floats to the top of the target). See cls.setImportOrderPreserved.
    cls.setImportOrderPreserved(true);

    // Folder path (POSIX) -> its container note. The empty path maps to the import root.
    const folderNotes = new Map<string, BNote>();

    for (const graphNote of notes) {
        const parent = ensureFolder(parentFolder(graphNote.path), rootNote, folderNotes, isProtected);
        const content = markdownService.renderToHtml(graphNote.markdown, graphNote.title);
        const { note } = noteService.createNewNote({ parentNoteId: parent.noteId, title: graphNote.title, content, type: "text", mime: "text/html", isProtected });
        preserveDates(note, graphNote.modified);
        taskContext.increaseProgressCount();
    }

    for (const path of [...files.keys()].sort((a, b) => a.localeCompare(b))) {
        const parent = ensureFolder(parentFolder(path), rootNote, folderNotes, isProtected);
        createFileNote(parent, path, files.get(path), isProtected);
    }

    return rootNote;
}

/**
 * Creates a standalone note for a non-Markdown graph file: an `image` note for a picture, a `file` note
 * otherwise. The bytes become the note content, the title drops the extension (Trilium convention) which is
 * preserved in an `originalFileName` label — matching how the generic ZIP importer treats arbitrary files.
 */
function createFileNote(parent: BNote, path: string, bytes: Uint8Array | undefined, isProtected: boolean): void {
    /* v8 ignore next 3 -- defensive: `path` comes from the files map, so its bytes are always present */
    if (!bytes) {
        return;
    }
    const fileName = basename(path);
    const mime = mimeService.getMime(fileName) || "application/octet-stream";
    const type = mime.startsWith("image/") ? "image" : "file";
    const { note } = noteService.createNewNote({ parentNoteId: parent.noteId, title: removeFileExtension(fileName, mime), content: bytes, type, mime, isProtected });
    note.addLabel("originalFileName", fileName);
}

/**
 * Stamps the note with the file's modification time from the zip. ZIP carries no reliable creation time, so
 * created falls back to it. (Guard the DOS-epoch sentinel a date-less entry yields.)
 */
function preserveDates(note: BNote, modified: Date | undefined): void {
    if (modified && modified.getFullYear() > 1980) {
        const utc = date_utils.utcDateTimeStr(modified);
        note.setDateCreatedAndModified(utc, utc);
    }
}

/** Returns (creating on demand, parents first) the container note for `folderPath`; the empty path is the root. */
function ensureFolder(folderPath: string, rootNote: BNote, folderNotes: Map<string, BNote>, isProtected: boolean): BNote {
    if (folderPath === "") {
        return rootNote;
    }
    const cached = folderNotes.get(folderPath);
    if (cached) {
        return cached;
    }
    const parent = ensureFolder(parentFolder(folderPath), rootNote, folderNotes, isProtected);
    const { note } = noteService.createNewNote({ parentNoteId: parent.noteId, title: basename(folderPath), content: "", type: "text", mime: "text/html", isProtected });
    folderNotes.set(folderPath, note);
    return note;
}

/**
 * Determines the graph root to strip from every entry. The `logseq/` config folder always sits at the true
 * graph root, so the prefix before the *shallowest* `logseq/` is authoritative (empty when the contents were
 * zipped directly). When there is no `logseq/` (a stripped or non-graph zip), fall back to a single wrapper
 * folder shared by every entry; otherwise nothing is stripped.
 */
function detectGraphRoot(paths: string[]): string {
    let configRoot: string | undefined;
    for (const path of paths) {
        const segments = path.split("/");
        const idx = segments.indexOf("logseq");
        // The last segment is the file name, so a `logseq` there is a page called "logseq", not the folder.
        if (idx === -1 || idx === segments.length - 1) {
            continue;
        }
        const prefix = idx === 0 ? "" : `${segments.slice(0, idx).join("/")}/`;
        if (configRoot === undefined || prefix.length < configRoot.length) {
            configRoot = prefix;
        }
    }
    if (configRoot !== undefined) {
        return configRoot;
    }

    const first = paths[0]?.split("/")[0];
    if (first && paths.every((path) => path.startsWith(`${first}/`))) {
        return `${first}/`;
    }
    return "";
}

/** Strips the detected graph-root prefix from an entry path (a no-op when the root is the zip root). */
function stripGraphRoot(path: string, graphRoot: string): string {
    return graphRoot && path.startsWith(graphRoot) ? path.slice(graphRoot.length) : path;
}

/**
 * The import root's title: the stripped wrapper folder's name when the graph was zipped as a subfolder, else
 * the zip file's name (without extension), falling back to the generic "Logseq import".
 */
function graphTitle(graphRoot: string, fileName?: string): string {
    if (graphRoot) {
        return basename(graphRoot.replace(/\/$/, "")) || t("logseq_import.root-title");
    }
    if (fileName) {
        const base = basename(normalizePath(fileName)).replace(/\.zip$/i, "").trim();
        if (base) {
            return base;
        }
    }
    return t("logseq_import.root-title");
}

/** The POSIX parent-folder path of `path` (everything before the last `/`), or `""` when at the graph root. */
function parentFolder(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? "" : path.slice(0, slash);
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
}

/** A zip directory entry (trailing slash) carries no content. */
function isDirectory(path: string): boolean {
    return path.endsWith("/");
}

/**
 * Skips the graph's `logseq/` config folder (`config.edn`, `custom.css` and the `bak/` backups) and every
 * dot-prefixed entry (`.DS_Store`, …).
 *
 * The config folder is what pins the graph root (see {@link detectGraphRoot}), and that root is either the zip
 * root or a single wrapper folder — so the folder can only ever appear as `logseq/…` or `<wrapper>/logseq/…`,
 * and matching those two depths is exactly as precise as the root detection itself.
 */
function isIgnored(path: string): boolean {
    const segments = path.split("/");
    if (segments.some((segment) => segment.startsWith("."))) {
        return true;
    }
    const idx = segments.indexOf("logseq");
    return (idx === 0 || idx === 1) && idx < segments.length - 1;
}

function isMarkdown(path: string): boolean {
    return path.toLowerCase().endsWith(".md");
}

/** The note title for a Markdown file: its base name without the `.md` extension. */
function noteTitle(path: string): string {
    return basename(path).replace(/\.md$/i, "");
}

export default { importLogseq };
