/**
 * Imports an Anytype JSON ("any-block") export zip into a Trilium note tree.
 *
 * Anytype exports each object as a single `objects/<cid>.pb.json` file (the protobuf export uses `.pb`
 * instead — not handled here), alongside sibling `relations/`, `types/`, `templates/` and `relationsOptions/`
 * folders. This importer reads the *pages* (basic note-like objects) and converts each text block to HTML:
 * headings, inline marks (bold/italic/strikethrough/underline/inline-code and text/background colours),
 * code blocks (with the language preserved as the Trilium MIME), bullet/numbered/task lists (grouped and
 * nested), toggles (normal toggles → collapsible blocks; toggle headings → plain headings), callouts
 * (→ admonitions), quotes/highlights (→ `<blockquote>`), dividers (→ `<hr>`), inline file/media blocks
 * (an embedded image → an inline `role:"image"` attachment; any other attached file → a `role:"file"`
 * attachment reference link, the bytes resolved from the export's `filesObjects/` metadata + `files/`
 * bytes) and cross-page links (Anytype's block-level "link to object" → a Trilium reference link plus an
 * `internalLink` relation, so backlinks resolve). Each page keeps its original creation and modification
 * timestamps.
 *
 * Collections and their properties are handled in {@link ./collection.js}: a collection becomes a `book` in
 * its mapped view (table / list / grid / calendar / board) whose columns are promoted-attribute definitions,
 * its members nest beneath it, and an object's custom relations become labels / file attachments. Pages
 * without a collection land as flat children of a fresh "Anytype import" root. Types and templates are still
 * deferred.
 *
 * Invoked from the shared file-import dispatcher (routes/api/import.ts) when the upload is tagged
 * `format=anytype`, so progress, completion and failure are reported by that dispatcher's TaskContext —
 * this service just builds the tree and returns its root note, like the zip/notion importers.
 */

import { t } from "i18next";
import { parse } from "node-html-parser";

import type BNote from "../../../becca/entities/bnote.js";
import cloningService from "../../cloning.js";
import imageService from "../../image.js";
import noteService from "../../notes.js";
import protectedSessionService from "../../protected_session.js";
import type TaskContext from "../../task_context.js";
import { decodeUtf8 } from "../../utils/binary.js";
import date_utils from "../../utils/date.js";
import { newEntityId } from "../../utils/index.js";
import { basename } from "../../utils/path.js";
import { getZipProvider } from "../../zip_provider.js";
import { saveFileAttachment } from "../collection_utils.js";
import { applyCollectionView, applyFiles, applyProperties, buildFileObjectMap, buildOptionMap, buildRelationMap, createCollectionNote, normalizePath, parseCollection, parseFiles, parseProperties, synthesizeColumns } from "./collection.js";
import { extractContent } from "./content.js";
import type { AnytypeDetails, AnytypeSnapshot, FileObjectInfo, LinkResolver, ParsedColumn, ParsedObject, RelationInfo, ResolvedLink } from "./model.js";

async function importAnytype(taskContext: TaskContext<"importNotes">, fileBuffer: Uint8Array, importRootNote: BNote, fileName?: string): Promise<BNote> {
    const { objects, relations, options, fileObjects, files, protobufObjectCount, markdownFileCount } = await parseZip(fileBuffer);
    const relationMap = buildRelationMap(relations);
    const optionMap = buildOptionMap(options);
    const fileObjectMap = buildFileObjectMap(fileObjects);
    // Import basic pages and collections (a collection carries the collection layout, so isPage rejects it);
    // query sets and system objects stay out.
    const pageSnapshots = objects.filter((snapshot) => isPage(snapshot) || isCollectionObject(snapshot));

    // Anytype offers three export shapes; this importer only understands the JSON "Any-Block" one
    // (`objects/*.pb.json`). The Protobuf variant ships binary `objects/*.pb`, the Markdown variant ships
    // `*.md` files — neither yields a JSON object, so they'd otherwise import as an empty tree. When no JSON
    // page was found but those files were, fail with guidance to re-export as JSON (mirrors the Notion importer).
    if (pageSnapshots.length === 0) {
        if (protobufObjectCount > 0) {
            throw new Error(t("anytype_import.protobuf-export-unsupported"));
        }
        if (markdownFileCount > 0) {
            throw new Error(t("anytype_import.markdown-export-unsupported"));
        }
    }

    // A collection-scoped export omits the collection itself (Anytype doesn't export the wrapper), so its
    // name and column schema are lost. Recover them: name the import root from the zip and make it a `table`
    // collection whose columns are synthesized from the properties its member pages carry.
    const objectIds = new Set(objects.map((snapshot) => snapshot.snapshot?.data?.details?.id).filter((id): id is string => !!id));
    const collectionExport = !!fileName && isSingleCollectionExport(pageSnapshots, objectIds);
    const rootTitle = collectionExport && fileName ? collectionTitleFromFileName(fileName) : undefined;
    const rootColumns = collectionExport ? synthesizeColumns(pageSnapshots.map((snapshot) => snapshot.snapshot?.data?.details ?? {}), relationMap) : undefined;

    // Assign each page its Trilium note id up front so cross-page links resolve even when they point at a
    // page that hasn't been created yet (links routinely point forward in the export). The note is later
    // created with this forced id, keeping the reference link's href and the real note in sync.
    const targets = new Map<string, ResolvedLink>();
    for (const snapshot of pageSnapshots) {
        const details = snapshot.snapshot?.data?.details;
        const cid = details?.id;
        if (cid) {
            targets.set(cid, { noteId: newEntityId(), title: pageTitle(details) });
        }
    }
    const resolveLink: LinkResolver = (cid) => targets.get(cid);

    const pages = pageSnapshots.map((snapshot) => parseObject(snapshot, resolveLink, relationMap, optionMap));
    taskContext.setTotalCount(pages.length);

    // For the collection-scoped recovery in createNotes: a bundled file referenced by an object we don't
    // import (a set, or a system object like the workspace/participant) is not a dropped-in collection member,
    // so harvest those objects' file references too — the recovery must exclude them, not surface them as
    // stray members. Only needed when the recovery actually runs (a collection-scoped export).
    const excludedFileRefs = collectionExport
        ? new Set(
              objects
                  .filter((snapshot) => !isPage(snapshot) && !isCollectionObject(snapshot))
                  .flatMap((snapshot) => {
                      const parsed = parseObject(snapshot, resolveLink, relationMap, optionMap);
                      return [...parsed.fileRefs, ...parsed.inlineFileIds];
                  })
          )
        : undefined;

    return createNotes(importRootNote, pages, targets, fileObjectMap, files, rootTitle, rootColumns, collectionExport, excludedFileRefs, taskContext);
}

/**
 * Reads the export's `objects/*.pb.json` (page/collection snapshots), `relations/*.pb.json` (property
 * definitions), `relationsOptions/*.pb.json` (select / multi-select option values), `filesObjects/*.pb.json`
 * (file metadata) and the raw bytes under `files/` (keyed by normalized path). The relation definitions name
 * and type the custom properties; the options resolve a select value's option id to its name; the file
 * objects + bytes back the file properties. Other sibling folders (types, templates, …) are ignored for now.
 * A malformed entry is skipped rather than failing the import. The wrong-format `objects/*.pb` (Protobuf) and
 * `*.md` (Markdown) entries are merely counted, so the caller can fail with guidance instead of importing an
 * empty tree.
 */
async function parseZip(fileBuffer: Uint8Array): Promise<{ objects: AnytypeSnapshot[]; relations: AnytypeSnapshot[]; options: AnytypeSnapshot[]; fileObjects: AnytypeSnapshot[]; files: Map<string, Uint8Array>; protobufObjectCount: number; markdownFileCount: number }> {
    const provider = getZipProvider();
    const objects: AnytypeSnapshot[] = [];
    const relations: AnytypeSnapshot[] = [];
    const options: AnytypeSnapshot[] = [];
    const fileObjects: AnytypeSnapshot[] = [];
    const files = new Map<string, Uint8Array>();
    let protobufObjectCount = 0;
    let markdownFileCount = 0;
    const filenameEncoding = await provider.detectFilenameEncoding(fileBuffer);

    await provider.readZipFile(fileBuffer, async (entry, readContent) => {
        // Raw bytes under files/ are kept as-is (they back file-property attachments), not parsed as JSON.
        if (isFileEntry(entry.fileName)) {
            files.set(normalizePath(entry.fileName), await readContent());
            return;
        }
        // Tally the other-export-format files (so importAnytype can reject them with guidance), then skip them.
        if (isProtobufObjectEntry(entry.fileName)) {
            protobufObjectCount++;
            return;
        }
        if (isMarkdownEntry(entry.fileName)) {
            markdownFileCount++;
            return;
        }
        const bucket = isObjectEntry(entry.fileName) ? objects
            : isRelationOptionEntry(entry.fileName) ? options
                : isFileObjectEntry(entry.fileName) ? fileObjects
                    : isRelationEntry(entry.fileName) ? relations : undefined;
        if (!bucket) {
            return;
        }
        try {
            bucket.push(JSON.parse(new TextDecoder().decode(await readContent())) as AnytypeSnapshot);
        } catch {
            // A non-JSON or truncated entry isn't something we can import — skip it.
        }
    }, filenameEncoding);

    return { objects, relations, options, fileObjects, files, protobufObjectCount, markdownFileCount };
}

/** True for entries that are JSON object files under the export's `objects/` folder. */
function isObjectEntry(fileName: string): boolean {
    return isJsonEntryUnder(fileName, "objects/");
}

/** True for entries that are JSON relation-definition files under the export's `relations/` folder. */
function isRelationEntry(fileName: string): boolean {
    return isJsonEntryUnder(fileName, "relations/");
}

/** True for entries that are JSON option files under the export's `relationsOptions/` folder. */
function isRelationOptionEntry(fileName: string): boolean {
    return isJsonEntryUnder(fileName, "relationsoptions/");
}

/** True for entries that are JSON file-metadata files under the export's `filesObjects/` folder. */
function isFileObjectEntry(fileName: string): boolean {
    return isJsonEntryUnder(fileName, "filesobjects/");
}

/** True for entries that are raw files under the export's `files/` folder (the bytes a file property links). */
function isFileEntry(fileName: string): boolean {
    return normalizePath(fileName).startsWith("files/");
}

/** True for an Anytype *Protobuf* export's binary object (`objects/*.pb`) — the JSON export uses `.pb.json`. */
function isProtobufObjectEntry(fileName: string): boolean {
    const normalized = normalizePath(fileName);
    return normalized.startsWith("objects/") && normalized.endsWith(".pb");
}

/** True for an Anytype *Markdown* export's page file (a top-level `*.md`). */
function isMarkdownEntry(fileName: string): boolean {
    return normalizePath(fileName).endsWith(".md");
}

function isJsonEntryUnder(fileName: string, folder: string): boolean {
    const normalized = normalizePath(fileName);
    return normalized.startsWith(folder) && normalized.endsWith(".pb.json");
}

/**
 * Whether a snapshot is a page we should import. A page is a `Page` smartblock with the basic layout (0);
 * this excludes sets/collections (layout 3) and system objects like the participant, workspace and
 * dashboard widget. Conservative on purpose — other content layouts can be admitted as the importer grows.
 *
 * Anytype omits `layout` when it's the default (Basic = 0) — a single-object export of a basic page has no
 * `layout` field at all — so we fall back to `resolvedLayout` (always present) and treat a wholly missing
 * value as basic. Sets and other non-page layouts are still excluded by their non-zero value.
 */
export function isPage(snapshot: AnytypeSnapshot): boolean {
    if (snapshot.sbType !== "Page") {
        return false;
    }
    const details = snapshot.snapshot?.data?.details;
    const layout = details?.layout ?? details?.resolvedLayout ?? 0;
    return layout === 0;
}

/**
 * Whether a snapshot is a collection — a `Page` smartblock with a dataview block flagged `isCollection`.
 * A collection's `resolvedLayout` is the collection layout (14), not the basic 0, so {@link isPage} excludes
 * it; it's admitted by this flag instead. Query *sets* (a dataview with `isCollection` false) stay excluded.
 */
export function isCollectionObject(snapshot: AnytypeSnapshot): boolean {
    if (snapshot.sbType !== "Page") {
        return false;
    }
    return (snapshot.snapshot?.data?.blocks ?? []).some((block) => block.dataview?.isCollection);
}

/**
 * Whether the export is a single collection's contents. Exporting just a collection (rather than the whole
 * space) omits the collection object itself, so its name is lost and only its member objects ship — each
 * created inside the same (now absent) collection. So: every imported page shares one `createdInContext` id
 * that isn't itself present in the export. A regular export fails this (pages have varied or no context, and
 * a full export keeps the collection wrapper). When true, the import root is named from the zip instead.
 */
export function isSingleCollectionExport(pageSnapshots: AnytypeSnapshot[], objectIds: Set<string>): boolean {
    if (pageSnapshots.length === 0) {
        return false;
    }
    const context = pageSnapshots[0].snapshot?.data?.details?.createdInContext;
    if (!context || objectIds.has(context)) {
        return false;
    }
    return pageSnapshots.every((snapshot) => snapshot.snapshot?.data?.details?.createdInContext === context);
}

/** The import-root title for a collection-scoped export: the export file's base name without its extension. */
export function collectionTitleFromFileName(fileName: string): string {
    const base = basename(fileName.replace(/\\/g, "/"));
    return base.replace(/\.[^.]+$/, "").trim() || base;
}

/**
 * Reduces a page snapshot to the title, body HTML, outgoing link targets, property values and (for a
 * collection) its table schema and membership. `resolveLink` maps a linked object's id to the Trilium note
 * it became; without one (parsing a page in isolation) link blocks are dropped. `relations` names and types
 * the custom properties; without it (or for system fields) properties are skipped.
 */
export function parseObject(snapshot: AnytypeSnapshot, resolveLink: LinkResolver = () => undefined, relations: Map<string, RelationInfo> = new Map(), options: Map<string, string> = new Map()): ParsedObject {
    const data = snapshot.snapshot?.data;
    const details = data?.details ?? {};
    const id = details.id ?? "";
    const title = pageTitle(details);
    const { html, linkTargetIds, fileTargetIds } = extractContent(data?.blocks ?? [], id, resolveLink);

    return {
        id,
        title,
        content: html,
        linkTargetIds,
        dateCreated: anytypeDate(details.createdDate),
        dateModified: anytypeDate(details.lastModifiedDate),
        properties: parseProperties(details, relations, options),
        fileRefs: parseFiles(details, relations),
        inlineFileIds: fileTargetIds,
        collection: parseCollection(data?.blocks ?? [], details, relations)
    };
}

/** The note title for a page: its trimmed `details.name`, or "Untitled" when blank. */
function pageTitle(details: AnytypeDetails | undefined): string {
    return (details?.name ?? "").trim() || "Untitled";
}

/**
 * Converts an Anytype detail date (a Unix timestamp in *seconds*) to a Trilium UTC datetime string, or
 * undefined for a missing or non-positive value — system objects export `0`, which would otherwise become
 * a 1970 date.
 */
export function anytypeDate(seconds: number | undefined): string | undefined {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
        return undefined;
    }
    return date_utils.utcDateTimeStr(new Date(seconds * 1000));
}

/**
 * Creates a fresh "Anytype import" root and the page notes beneath it. A collection becomes a `book` with a
 * `table` view and one promoted-attribute definition per column; a regular page becomes a `text` note. Each
 * note is created with the id pre-assigned in {@link importAnytype} (`targets`), so the reference links
 * already baked into the content point at the real notes, and carries its own property values as labels. A
 * collection's members are parented under it (their first collection) — a member in further collections is
 * cloned into each. File-property values become `role:"file"` attachments with a reference link prepended to
 * the body. A file object that's itself a collection member becomes a `file`/`image` note under the
 * collection (in a collection-scoped export, where the membership list is lost, any unreferenced bundled file
 * is treated as such a member). Once every page exists, each page's outgoing links are recorded as
 * `internalLink` relations, which Trilium uses for backlink detection ("what links here").
 */
function createNotes(importRootNote: BNote, pages: ParsedObject[], targets: Map<string, ResolvedLink>, fileObjects: Map<string, FileObjectInfo>, files: Map<string, Uint8Array>, rootTitle: string | undefined, rootColumns: ParsedColumn[] | undefined, collectionExport: boolean, excludedFileRefs: Set<string> | undefined, taskContext: TaskContext<"importNotes">): BNote {
    /* v8 ignore next -- the protected branch needs a protected import root with an active protected session, which the in-memory test DB has no way to set up */
    const isProtected = importRootNote.isProtected && protectedSessionService.isProtectedSessionAvailable();
    const shrinkImages = !!taskContext.data?.shrinkImages;

    // A collection-scoped export's root *is* the collection: a `table`-view book carrying the synthesized
    // columns, with the member pages as its rows. A normal export's root is a plain container.
    const title = rootTitle ?? t("anytype_import.root-title");
    const rootNote = rootColumns
        ? noteService.createNewNote({ parentNoteId: importRootNote.noteId, title, content: "", type: "book", mime: "", isProtected }).note
        : noteService.createNewNote({ parentNoteId: importRootNote.noteId, title, content: "", type: "text", mime: "text/html", isProtected }).note;
    if (rootColumns) {
        applyCollectionView(rootNote, "table", rootColumns);
    }
    rootNote.addLabel("iconClass", "bx bx-import");

    // Each member's primary parent is the first collection that lists it (a collection itself stays at the
    // root, so it's never reparented — it's cloned into an owning collection by the membership pass below).
    const collectionPageIds = new Set(pages.filter((page) => page.collection).map((page) => page.id));
    const primaryCollectionByMember = new Map<string, string>();
    for (const page of pages) {
        for (const memberId of page.collection?.memberIds ?? []) {
            if (!collectionPageIds.has(memberId) && !primaryCollectionByMember.has(memberId)) {
                primaryCollectionByMember.set(memberId, page.id);
            }
        }
    }

    // Create collections before regular pages so a member can be parented under its collection.
    const notesByPageId = new Map<string, BNote>();
    const ordered = [...pages].sort((a, b) => (a.collection ? 0 : 1) - (b.collection ? 0 : 1));
    for (const page of ordered) {
        const noteId = targets.get(page.id)?.noteId;
        let note: BNote;
        if (page.collection) {
            note = createCollectionNote(rootNote.noteId, page, page.collection, noteId, isProtected);
        } else {
            const primaryCollectionId = primaryCollectionByMember.get(page.id);
            const parentNoteId = (primaryCollectionId ? notesByPageId.get(primaryCollectionId)?.noteId : undefined) ?? rootNote.noteId;
            ({ note } = noteService.createNewNote({ noteId, parentNoteId, title: page.title, content: page.content, type: "text", mime: "text/html", isProtected, utcDateCreated: page.dateCreated }));
        }

        applyProperties(note, page.properties);
        applyFiles(note, page, fileObjects, files);
        applyInlineFiles(note, fileObjects, files, shrinkImages);
        applyDates(note, page);
        notesByPageId.set(page.id, note);
        taskContext.increaseProgressCount();
    }

    // A collection can list a *file object* directly as a member (a file dropped into the collection). It's
    // not a page, so no note was created for it above — create one now, a `file`/`image` note under its
    // owning collection, so the member shows up. The membership pass below then clones it into any further
    // collections. Done after the page loop so the owning collection note already exists.
    for (const fileId of fileMemberIds(pages, notesByPageId, fileObjects)) {
        const info = fileObjects.get(fileId);
        const bytes = info ? files.get(normalizePath(info.source)) : undefined;
        if (!info || !bytes) {
            continue;
        }
        const primaryCollectionId = primaryCollectionByMember.get(fileId);
        const parentNoteId = (primaryCollectionId ? notesByPageId.get(primaryCollectionId)?.noteId : undefined) ?? rootNote.noteId;
        notesByPageId.set(fileId, createFileMemberNote(parentNoteId, info, bytes, isProtected, shrinkImages));
    }

    // A collection-scoped export omits the collection wrapper, so a file dropped into the collection loses its
    // membership signal — there's no `links`, and the file's `createdInContext` points at where it was first
    // added (a page), not the collection. Recover it: in a collection-scoped export, any bundled file the
    // member pages don't already reference (inline, or as a file property) is a member of the synthesized root
    // collection — create a `file`/`image` note for it under the root.
    if (collectionExport) {
        const referenced = new Set<string>(excludedFileRefs);
        for (const page of pages) {
            for (const id of [...page.fileRefs, ...page.inlineFileIds]) {
                referenced.add(id);
            }
        }
        for (const [fileId, info] of fileObjects) {
            if (notesByPageId.has(fileId) || referenced.has(fileId)) {
                continue;
            }
            const bytes = files.get(normalizePath(info.source));
            if (bytes) {
                notesByPageId.set(fileId, createFileMemberNote(rootNote.noteId, info, bytes, isProtected, shrinkImages));
            }
        }
    }

    // Membership: clone a member into every collection that isn't already its (primary) parent.
    for (const page of pages) {
        const collectionNote = page.collection ? notesByPageId.get(page.id) : undefined;
        for (const memberId of page.collection?.memberIds ?? []) {
            if (primaryCollectionByMember.get(memberId) === page.id) {
                continue;
            }
            const memberNote = notesByPageId.get(memberId);
            if (memberNote && collectionNote) {
                cloningService.cloneNoteToParentNote(memberNote.noteId, collectionNote.noteId);
            }
        }
    }

    for (const page of pages) {
        const sourceNote = notesByPageId.get(page.id);
        for (const targetNoteId of page.linkTargetIds) {
            sourceNote?.addRelation("internalLink", targetNoteId);
        }
    }

    return rootNote;
}

/** The file-object ids a collection lists as members that no page note was created for — i.e. files dropped
 * directly into a collection (resolvable to bytes via the file map). De-duplicated across collections. */
function fileMemberIds(pages: ParsedObject[], notesByPageId: Map<string, BNote>, fileObjects: Map<string, FileObjectInfo>): Set<string> {
    const ids = new Set<string>();
    for (const page of pages) {
        for (const memberId of page.collection?.memberIds ?? []) {
            if (!notesByPageId.has(memberId) && fileObjects.has(memberId)) {
                ids.add(memberId);
            }
        }
    }
    return ids;
}

/** Creates a Trilium note for a file dropped into a collection: an `image` note for an image (so it renders
 * inline), otherwise a `file` note holding the raw bytes — both children of the owning collection. */
function createFileMemberNote(parentNoteId: string, info: FileObjectInfo, bytes: Uint8Array, isProtected: boolean | undefined, shrinkImages: boolean): BNote {
    if (info.mime.startsWith("image/")) {
        return imageService.saveImage(parentNoteId, bytes, info.title, shrinkImages).note;
    }
    const { note } = noteService.createNewNote({ parentNoteId, title: info.title, content: bytes, type: "file", mime: info.mime || "application/octet-stream", isProtected });
    note.addLabel("originalFileName", info.title);
    return note;
}

/**
 * Resolves the inline file/media placeholders a page's body carries ({@link ./content.js} emits each
 * `file` block as an `<img>` / `<a class="anytype-file">` whose `src`/`href` is the linked `FileObject`'s
 * id). For each one it looks the id up in the export's file metadata and bytes, then saves the bytes as an
 * attachment and rewrites the reference to point at it — an inline `role:"image"` for an image, a
 * `role:"file"` attachment reference-link for any other file type (matching the Notion importer). A
 * placeholder whose file is missing from the export (no metadata or bytes — e.g. a still-uploading file) is
 * dropped (image) or left as plain text (other). Only re-saves the content when something changed.
 */
function applyInlineFiles(note: BNote, fileObjects: Map<string, FileObjectInfo>, files: Map<string, Uint8Array>, shrinkImages: boolean) {
    const content = decodeUtf8(note.getContent());
    // Cheap guard: parse only when the body actually holds a placeholder to resolve.
    if (!content.includes("<img") && !content.includes('class="anytype-file"')) {
        return;
    }

    const root = parse(content);
    let changed = false;

    for (const img of root.querySelectorAll("img")) {
        const targetId = img.getAttribute("src");
        const bytes = targetId ? inlineFileBytes(targetId, fileObjects, files) : undefined;
        if (!targetId || !bytes) {
            // Unresolved image (still uploading, or bytes absent) — drop the broken figure rather than
            // leaving an `<img>` pointing at a bare file id. Only the enclosing `<figure>` is safe to
            // remove; an inline `<img>` (e.g. inside a paragraph or table cell) must drop just itself so
            // surrounding text survives.
            const parent = img.parentNode;
            if (parent?.tagName?.toLowerCase() === "figure") {
                parent.remove();
            } else {
                /* v8 ignore next -- content.ts always wraps an inline image in a <figure>, so a bare (non-figure) <img> never reaches here; kept as a defensive fallback */
                img.remove();
            }
            changed = true;
            continue;
        }
        const info = fileObjects.get(targetId);
        const { attachmentId, title } = imageService.saveImageToAttachment(note.noteId, bytes, info?.title || "image", shrinkImages);
        /* v8 ignore next -- saveImageToAttachment always returns the id of the attachment it just created, so this guard is never false in practice */
        if (attachmentId) {
            img.setAttribute("src", `api/attachments/${attachmentId}/image/${encodeURIComponent(title)}`);
            changed = true;
        }
    }

    for (const anchor of root.querySelectorAll("a.anytype-file")) {
        anchor.removeAttribute("class");
        changed = true;

        const targetId = anchor.getAttribute("href");
        const info = targetId ? fileObjects.get(targetId) : undefined;
        const bytes = targetId ? inlineFileBytes(targetId, fileObjects, files) : undefined;
        if (!info || !bytes) {
            // Unresolved file — keep the (now class-less) link text but drop the bare-id href.
            anchor.removeAttribute("href");
            continue;
        }
        const attachment = saveFileAttachment(note, info.title, bytes, info.mime);
        /* v8 ignore next -- saveAttachment always returns the id of the attachment it just created, so this guard is never false in practice */
        if (attachment.attachmentId) {
            anchor.setAttribute("href", `#root/${note.noteId}?viewMode=attachments&attachmentId=${attachment.attachmentId}`);
            anchor.setAttribute("class", "reference-link");
        }
    }

    if (changed) {
        note.setContent(root.toString());
    }
}

/** The raw bytes a file id (an inline block's `targetObjectId`) resolves to, via its `FileObject`'s source
 * path, or undefined when either the metadata or the bytes are absent from the export. */
function inlineFileBytes(targetId: string, fileObjects: Map<string, FileObjectInfo>, files: Map<string, Uint8Array>): Uint8Array | undefined {
    const info = fileObjects.get(targetId);
    return info ? files.get(normalizePath(info.source)) : undefined;
}

/**
 * Restores a page's original timestamps (note creation stamps "modified" — and the blob — with now). A
 * date-less page is left untouched, keeping its import-time dates. When only one date is present we fall back
 * like the ENEX importer: modified defaults to created.
 */
function applyDates(note: BNote, page: ParsedObject) {
    if (page.dateCreated || page.dateModified) {
        const dateCreated = page.dateCreated ?? note.utcDateCreated;
        note.setDateCreatedAndModified(dateCreated, page.dateModified ?? dateCreated);
    }
}

export default { importAnytype };
