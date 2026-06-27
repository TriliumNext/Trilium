/**
 * Imports a Notion HTML-export zip into a Trilium note tree.
 *
 * Notion exports each page as `Page Title <id>.html`; a page that has children also gets a sibling
 * folder `Page Title <id>/` holding those children. Internal links and attachments reference the same
 * id-suffixed names. This module reconstructs the *structure* — the page hierarchy, titles, body HTML,
 * timestamps, images and attachments, and cross-page links. Database (collection) handling — turning a
 * row's properties into Trilium attributes/relations and the shared schema into promoted definitions —
 * lives in `collection.ts`, and shared path/id helpers in `paths.ts`.
 *
 * Invoked from the shared file-import dispatcher (routes/api/import.ts) when the upload is tagged
 * `format=notion`, so progress, completion and failure are reported by that dispatcher's TaskContext —
 * this service just builds the tree and returns its root note, like the zip/enex importers.
 */

import { parseCsv } from "@triliumnext/commons/src/lib/csv.js";
import { t } from "i18next";
import { type HTMLElement, parse } from "node-html-parser";

import type BNote from "../../../becca/entities/bnote.js";
import imageService from "../../image.js";
import noteService from "../../notes.js";
import protectedSessionService from "../../protected_session.js";
import { sanitizeHtml } from "../../sanitizer.js";
import type TaskContext from "../../task_context.js";
import dateUtils from "../../utils/date.js";
import { getZipProvider } from "../../zip_provider.js";
import mimeService from "../mime.js";
import { toAttributeName } from "../collection_utils.js";
import { applyDatabaseSchemas, applyOwnedProperties, applyRelationProperties, extractProperties, reconcileDateColumns, resolveDatabaseContainers } from "./collection.js";
import { convertNotionHtml } from "./converter.js";
import type { LinkTarget, ParsedPage } from "./model.js";
import { getNotionId, stripNotionId } from "./notion_id.js";
import { baseName, firstChildNotionId, folderDepth, internalPageId, isDirectory, normalizePath, ownedFolderKey, parentFolderKey, removeExtension, resolveResourcePath } from "./paths.js";

async function importNotion(taskContext: TaskContext<"importNotes">, fileBuffer: Uint8Array, importRootNote: BNote): Promise<BNote> {
    const { pages, resources, csvPaths, csvColumnsByFolder, markdownFileCount, csvRowTitles } = await parseZip(fileBuffer);
    if (pages.length === 0 && markdownFileCount > 0) {
        // The user exported from Notion as "Markdown & CSV", but this importer only understands the HTML
        // export — it reconstructs databases by correlating each `.csv` with the surrounding `.html` pages,
        // which a Markdown export doesn't have. Fail with actionable guidance rather than silently producing
        // an empty tree (or orphaning every page as a `.md` attachment).
        throw new Error(t("notion_import.markdown-export-unsupported"));
    }
    // Notion's "Create folders for subpages" export option, when disabled, drops every page to the archive
    // root with no per-page folders. Cross-page links survive (they carry the page id), but the folder
    // structure is the only thing that conveys nesting and database-row membership — so the hierarchy would
    // silently collapse. Detect it (every page at the root, yet a page still references another imported page
    // as a subpage) and fail with guidance. A single-page export has no such references and is never caught.
    if (pages.length > 1 && pages.every((page) => !page.path.includes("/"))) {
        const pageIds = new Set(pages.map((page) => page.id));
        const hasFlattenedSubpage = pages.some((page) => page.linkedPageIds.some((id) => id !== page.id && pageIds.has(id)));
        // A flattened database: its row pages sit at the root with titles matching the CSV's first column,
        // rather than nesting under the database. A folders-on database keeps its rows in folders, so it
        // never reaches here (some page would carry a "/"); an empty database has no row titles to match.
        const hasFlattenedDatabaseRow = pages.some((page) => csvRowTitles.has(page.title));
        if (hasFlattenedSubpage || hasFlattenedDatabaseRow) {
            throw new Error(t("notion_import.subpage-folders-disabled"));
        }
    }
    resolveDatabaseContainers(pages, csvPaths);
    reconcileDateColumns(pages);
    taskContext.setTotalCount(pages.length);

    return createNotes(importRootNote, pages, resources, taskContext, csvColumnsByFolder);
}

/**
 * Reads the zip: HTML entries become parsed pages; every other file (images, attachments) is kept by its
 * normalized path so page content can later reference it. The `index.html` summary is skipped.
 *
 * A Notion workspace export wraps its content in a nested zip at the archive root — the part you'd
 * otherwise have to extract by hand — so root-level `.zip` entries are descended into. A zip nested inside
 * a folder is a user's attachment and kept as-is. Recursion is depth-bounded against pathological archives.
 */
const MAX_NESTED_ZIP_DEPTH = 2;

async function parseZip(fileBuffer: Uint8Array): Promise<{ pages: ParsedPage[]; resources: Map<string, Uint8Array>; csvPaths: string[]; csvColumnsByFolder: Map<string, string[]>; markdownFileCount: number; csvRowTitles: Set<string> }> {
    const provider = getZipProvider();
    const pages: ParsedPage[] = [];
    const resources = new Map<string, Uint8Array>();
    const csvPaths: string[] = [];
    // Database folder key → its columns (sanitized), in the CSV export's order — the authoritative column order.
    const csvColumnsByFolder = new Map<string, string[]>();
    // Notion's "Markdown & CSV" export emits pages as `.md`; the HTML export this importer is built around
    // never does. Counting them lets importNotion detect that wrong export format and fail with guidance.
    let markdownFileCount = 0;
    // Title of every database row (a CSV's first column), used to detect a "Create folders for subpages"-
    // disabled export, where row pages are flattened to the root instead of nesting under the database.
    const csvRowTitles = new Set<string>();

    const readArchive = async (buffer: Uint8Array, depth: number): Promise<void> => {
        const filenameEncoding = await provider.detectFilenameEncoding(buffer);
        await provider.readZipFile(buffer, async (entry, readContent) => {
            const path = entry.fileName;
            if (isDirectory(path)) {
                return;
            }
            if (path.toLowerCase().endsWith(".zip") && !path.includes("/")) {
                if (depth < MAX_NESTED_ZIP_DEPTH) {
                    await readArchive(await readContent(), depth + 1);
                }
            } else if (path.toLowerCase().endsWith(".html")) {
                if (baseName(path) === "index.html") {
                    return;
                }
                const parsed = parsePage(path, new TextDecoder().decode(await readContent()));
                if (parsed) {
                    pages.push(parsed);
                }
            } else if (path.toLowerCase().endsWith(".csv")) {
                // A Notion database exports as a CSV: its path reconstructs the hierarchy (a database with no
                // own page), and its header row lists every column in the database's order.
                csvPaths.push(path);
                const [header = [], ...rows] = parseCsv(new TextDecoder().decode(await readContent()));
                // Trim before sanitizing so a padded CSV header (`Name, Age , …`) still matches the HTML
                // property `<th>` text, which is trimmed on extraction.
                csvColumnsByFolder.set(ownedFolderKey(path), header.map((column) => toAttributeName(column.trim())));
                // The first column is each row's title; collect them so a flattened database (rows at the
                // root, matching these titles, rather than nested under the database) can be detected.
                for (const row of rows) {
                    const rowTitle = row[0]?.trim();
                    if (rowTitle) {
                        csvRowTitles.add(rowTitle);
                    }
                }
            } else {
                // Keep the file as a resource so a genuine `.md` attachment inside an HTML export survives,
                // but tally markdown pages so the wrong export format can be detected.
                if (path.toLowerCase().endsWith(".md")) {
                    markdownFileCount++;
                }
                resources.set(normalizePath(path), await readContent());
            }
        }, filenameEncoding);
    };

    await readArchive(fileBuffer, 0);

    return { pages, resources, csvPaths, csvColumnsByFolder, markdownFileCount, csvRowTitles };
}

function parsePage(path: string, html: string): ParsedPage | null {
    const root = parse(html);

    // The page's own id is on the top-level element inside <body> (Notion gives it `id="<uuid>"`);
    // fall back to the id suffix on the filename so a structurally-odd page still lands somewhere.
    const body = root.querySelector("body");
    const id = firstChildNotionId(body) ?? getNotionId(baseName(path));
    if (!id) {
        return null;
    }

    const title = root.querySelector("title")?.textContent?.trim() || stripNotionId(removeExtension(baseName(path))) || "Untitled";

    const pageBody = root.querySelector(".page-body");
    const content = pageBody ? sanitizeHtml(convertNotionHtml(pageBody.innerHTML)) : "";

    // Capture subpage references from the raw HTML (before conversion rewrites them): a `link-to-page` block
    // is a child page or explicit page link, and a collection table's cells link to the database's rows.
    // Inline page mentions are deliberately excluded — only these structural references signal nesting.
    const linkedPageIds: string[] = [];
    for (const anchor of root.querySelectorAll("figure.link-to-page a, .collection-content a")) {
        const linkedId = internalPageId(anchor.getAttribute("href"));
        if (linkedId) {
            linkedPageIds.push(linkedId);
        }
    }

    return {
        id,
        title,
        path,
        content,
        linkedPageIds,
        properties: extractProperties(root),
        utcDateCreated: extractDate(root, "property-row-created_time"),
        utcDateModified: extractDate(root, "property-row-last_edited_time")
    };
}

/**
 * Creates the note tree under a fresh "Notion import" root. Notion encodes the hierarchy through the
 * folder structure: a page `Title <id>.html` keeps its children in a sibling folder named after its title
 * (no id, e.g. `Title/`). So each page is parented under whichever page "owns" its containing folder —
 * matched on a normalized, id-stripped folder path so it works whether or not the folders carry ids.
 * Pages are created shallowest-first, so a parent's note exists before its children. Returns the root.
 */
function createNotes(importRootNote: BNote, pages: ParsedPage[], resources: Map<string, Uint8Array>, taskContext: TaskContext<"importNotes">, csvColumnsByFolder: Map<string, string[]>): BNote {
    /* v8 ignore next -- the protected branch needs a protected import root with an active protected session, which the in-memory test DB has no way to set up */
    const isProtected = importRootNote.isProtected && protectedSessionService.isProtectedSessionAvailable();
    const shrinkImages = !!taskContext.data?.shrinkImages;

    const rootNote = noteService.createNewNote({ parentNoteId: importRootNote.noteId, title: t("notion_import.root-title"), content: "", type: "text", mime: "text/html", isProtected }).note;
    rootNote.addLabel("iconClass", "bx bx-import");

    const noteByFolder = new Map<string, BNote>();
    const targetByPageId = new Map<string, LinkTarget>();
    const created: { note: BNote; content: string; page: ParsedPage }[] = [];
    const ordered = [...pages].sort((a, b) => folderDepth(a.path) - folderDepth(b.path));

    // First pass: create every note (so cross-page links can resolve in the second pass) and save its
    // referenced images as attachments. Content is only rewritten/saved once, in the second pass.
    for (const page of ordered) {
        const targetParentId = noteByFolder.get(parentFolderKey(page.path))?.noteId ?? rootNote.noteId;

        // A Notion database imports as a Trilium table collection: an (empty) `book` whose rows are its
        // children and whose columns are the promoted-attribute definitions added below. `table` is the
        // only view the export preserves — every Notion database exports as a rendered table regardless of
        // its actual view (board/calendar/…), so that information is gone and table is the faithful mapping.
        const { note } = noteService.createNewNote({
            parentNoteId: targetParentId,
            title: page.title,
            content: page.content,
            type: page.isDatabase ? "book" : "text",
            mime: page.isDatabase ? "" : "text/html",
            isProtected
        });
        noteByFolder.set(ownedFolderKey(page.path), note);
        targetByPageId.set(page.id, { noteId: note.noteId, title: page.title });
        if (page.isDatabase) {
            note.addLabel("viewType", "table");
        }

        // Carry the page's own database property values over (file columns become attachments, the rest
        // labels); relations are deferred to the second pass, once every target note exists. A file column
        // also returns reference-links, prepended to the body so its files are reachable from the content.
        const fileLinks = applyOwnedProperties(note, page, resources);
        const body = fileLinks + page.content;

        // Attachments hang off the note, so this must run after creation; it returns the content with the
        // <img> srcs and file links pointing at the saved attachments.
        const withImages = rewriteImages(note, body, page.path, resources, shrinkImages);
        created.push({ note, content: rewriteAttachments(note, withImages, page.path, resources), page });
        taskContext.increaseProgressCount();
    }

    // Now that every container and its rows exist, define the database schema once per container.
    applyDatabaseSchemas(pages, noteByFolder, csvColumnsByFolder);

    // Second pass: now that every page has a note, resolve cross-page links and relations, then persist.
    const resolveTarget = (notionId: string): LinkTarget | null => targetByPageId.get(notionId) ?? null;
    for (const { note, content, page } of created) {
        const finalContent = rewriteCollectionIncludes(rewriteLinks(content, resolveTarget), resolveTarget);
        if (finalContent !== page.content) {
            note.setContent(finalContent);
        }

        applyRelationProperties(note, page, resolveTarget);

        // Preserve Notion's original timestamps. Must run after the content save above, which would
        // otherwise re-stamp the modification date with "now".
        if (page.utcDateCreated || page.utcDateModified) {
            note.setDateCreatedAndModified(page.utcDateCreated ?? page.utcDateModified, page.utcDateModified ?? page.utcDateCreated);
        }
    }

    return rootNote;
}

/**
 * Saves each in-zip image a page references as an attachment on `note` and rewrites the `<img src>` to
 * point at it. References that don't resolve to a bundled file (e.g. external image URLs) are left as-is.
 * Returns the (possibly unchanged) content.
 */
function rewriteImages(note: BNote, content: string, pagePath: string, resources: Map<string, Uint8Array>, shrinkImages: boolean): string {
    const root = parse(content);
    let changed = false;

    for (const img of root.querySelectorAll("img")) {
        const src = img.getAttribute("src");
        if (!src) {
            continue;
        }
        const resourcePath = resolveResourcePath(pagePath, src);
        const bytes = resources.get(resourcePath);
        if (!bytes) {
            continue;
        }
        const { attachmentId, title } = imageService.saveImageToAttachment(note.noteId, bytes, baseName(resourcePath), shrinkImages);
        /* v8 ignore next -- saveImageToAttachment always returns the id of the attachment it just created, so this guard is never false in practice */
        if (attachmentId) {
            img.setAttribute("src", `api/attachments/${attachmentId}/image/${encodeURIComponent(title)}`);
            changed = true;
        }
    }

    return changed ? root.toString() : content;
}

/**
 * Saves each in-zip file a page attaches (`<a class="notion-attachment">`, produced by the converter) as a
 * `role:"file"` attachment on `note`, and rewrites the anchor into a Trilium attachment reference-link
 * (the same shape the ENEX importer and CKEditor use). Anchors whose file isn't bundled lose the marker
 * class and stay plain links. Returns the (possibly unchanged) content.
 */
function rewriteAttachments(note: BNote, content: string, pagePath: string, resources: Map<string, Uint8Array>): string {
    const root = parse(content);
    let changed = false;

    for (const anchor of root.querySelectorAll("a.notion-attachment")) {
        anchor.removeAttribute("class");
        changed = true;

        const href = anchor.getAttribute("href");
        const resourcePath = href ? resolveResourcePath(pagePath, href) : "";
        const bytes = resources.get(resourcePath);
        if (!bytes) {
            continue;
        }

        const title = anchor.textContent.trim() || baseName(resourcePath);
        const attachment = note.saveAttachment({
            role: "file",
            mime: mimeService.getMime(baseName(resourcePath)) || "application/octet-stream",
            title,
            content: bytes
        });
        anchor.setAttribute("href", `#root/${note.noteId}?viewMode=attachments&attachmentId=${attachment.attachmentId}`);
        anchor.setAttribute("class", "reference-link");
    }

    return changed ? root.toString() : content;
}

/**
 * Resolves Notion page-to-page links. Notion exports an internal link as an `<a>` whose href points at
 * the target page's exported HTML file (e.g. `Folder/Subpage 386c…cd5.html`), with the 32-hex Notion id
 * embedded in the filename. Rewrites each link whose target was imported to `#root/<noteId>`; when the
 * link text is the target page's title it becomes a Trilium reference link (the live-title chip),
 * otherwise the original text is kept on a plain internal link. External/unresolved links are untouched.
 */
export function rewriteLinks(html: string, resolve: (notionId: string) => LinkTarget | null): string {
    const root = parse(html);
    let changed = false;

    for (const anchor of root.querySelectorAll("a")) {
        const notionId = internalPageId(anchor.getAttribute("href"));
        if (!notionId) {
            continue;
        }
        const target = resolve(notionId);
        if (!target) {
            continue;
        }

        anchor.setAttribute("href", `#root/${target.noteId}`);
        if (anchor.textContent.trim() === target.title.trim()) {
            anchor.setAttribute("class", "reference-link");
        }
        changed = true;
    }

    return changed ? root.toString() : html;
}

/**
 * Resolves the inline-database include-note placeholders the converter emits — `<section class="include-note"
 * data-notion-id="…">` — to the imported collection note. Notion renders an inline database inside a page as
 * a rendered table (a partial export) or a bare link to its separately-exported CSV (a full/workspace
 * export); the converter normalizes both to this placeholder carrying the database's Notion id. The database
 * itself is imported as a collection note (built from its CSV plus rows folder), so swap that id for the
 * note's id. A placeholder whose database wasn't imported is dropped rather than left as a dangling include.
 */
export function rewriteCollectionIncludes(html: string, resolve: (notionId: string) => LinkTarget | null): string {
    const root = parse(html);
    let changed = false;

    for (const section of root.querySelectorAll("section.include-note")) {
        const notionId = section.getAttribute("data-notion-id");
        if (!notionId) {
            continue;
        }
        section.removeAttribute("data-notion-id");
        const target = resolve(notionId);
        if (target) {
            section.setAttribute("data-note-id", target.noteId);
        } else {
            section.remove();
        }
        changed = true;
    }

    return changed ? root.toString() : html;
}

/**
 * Reads a Notion property-row timestamp (created/last-edited) from the page's properties table and
 * converts it to Trilium's UTC DB format. Returns undefined when the row, the <time> element or the
 * parsed date is missing/invalid.
 */
function extractDate(root: HTMLElement, rowClass: string): string | undefined {
    const text = root.querySelector(`tr.${rowClass} time`)?.textContent?.replace(/@/g, "").trim();
    if (!text) {
        return undefined;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? undefined : dateUtils.utcDateTimeStr(date);
}

export default { importNotion };
