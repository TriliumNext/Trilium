/**
 * Creates the Trilium note tree from a OneNote selection. Mirrors the structure of the existing
 * file-based importers (see packages/trilium-core/src/services/import/enex.ts): build a container,
 * then child notes, reporting progress through a TaskContext of type "importNotes" so the existing
 * client-side import toasts apply unchanged.
 */

import type { OneNoteFolderRef, OneNoteSectionSelection } from "@triliumnext/commons";
import { becca, binary_utils, type BNote, date_utils, getLog, imageService, note_service as noteService, protected_session as protectedSession, TaskContext } from "@triliumnext/core";
import { t } from "i18next";
import { parse } from "node-html-parser";

import sql from "../../sql.js";
import converter, { ONENOTE_ATTACHMENT_CLASS } from "./converter.js";
import graph, { type AccessTokenProvider, type OneNotePage, sanitizeGraphUrl } from "./graph.js";
import { inkmlToSvg } from "./inkml.js";
import { type LinkTarget, rewritePageLinks } from "./links.js";
import { type FailedPageReport, type ImportReportData, renderImportReport } from "./report.js";

interface FetchedPage {
    /**
     * The Graph API page id, preserved on the imported note as `#oneNotePageId` so a later pass
     * (re-import dedup, retrying failed pages) can map the note back to its OneNote page. Distinct
     * from {@link pageId}, the GUID OneNote uses in `onenote:` links.
     */
    id: string;
    title: string;
    /** OneNote's indentation level in the page list: 0 for a top-level page, 1+ for a subpage. */
    level: number;
    /** The OneNote page-id GUID, used to resolve cross-page links to the note created for this page. */
    pageId?: string;
    html: string;
    /** The unmodified HTML returned by the Graph API, kept only when debug mode is on. */
    rawHtml: string;
    /** The unmodified InkML (handwriting) returned by the Graph API, kept only when debug mode is on. */
    rawInkml: string;
    /** The page's handwriting/drawing rendered to an SVG, embedded as an inline image (null if none). */
    inkSvg: string | null;
    /** Binary resources (images, file attachments) referenced by the page, downloaded up front. */
    resources: DownloadedResource[];
    /** How many of the page's resources failed to download (skipped, reported in the import report). */
    failedResourceCount: number;
    /** OneNote's page creation timestamp (ISO 8601), preserved on the imported note. */
    createdDateTime?: string;
    /** OneNote's last-modified timestamp (ISO 8601), preserved on the imported note. */
    lastModifiedDateTime?: string;
    /**
     * Set when the page's content could not be fetched (after retries). The page is imported as a
     * placeholder note carrying this error instead of aborting the whole import: one poisoned page
     * must not cost the user hours of already-fetched work.
     */
    fetchError?: string;
}

/**
 * Aborts the import once this many pages in a row fail to fetch. A streak this long means the
 * failure is systemic (expired token, service outage) rather than page-specific, and failing fast
 * beats producing a tree of nothing but placeholders. Mirrors the Obsidian importer's threshold.
 */
const MAX_CONSECUTIVE_PAGE_FAILURES = 5;

interface DownloadedResource {
    /** The Graph resource URL as it still appears in the converted HTML; used to match references. */
    url: string;
    kind: "image" | "file";
    /** Original filename for attachments; a base name (no extension) for images. */
    title: string;
    mime: string;
    content: Uint8Array;
}

interface FetchedSection {
    title: string;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
    groupPath: OneNoteFolderRef[];
    notebookId: string;
    notebookTitle: string;
    notebookCreatedDateTime?: string;
    notebookLastModifiedDateTime?: string;
    pages: FetchedPage[];
}

/**
 * Runs the whole import in the background — the caller does not await it, because a large notebook can
 * take far longer than the client's HTTP request timeout. Progress, completion and failure are all
 * reported over the WebSocket via the "importNotes" TaskContext, so this never throws to the caller:
 * any error is caught and surfaced as a task error toast instead.
 */
export async function importSelection({ getAccessToken, parentNoteId, sections, taskId, debug = false, shrinkImages = false }: { getAccessToken: AccessTokenProvider; parentNoteId: string; sections: OneNoteSectionSelection[]; taskId: string; debug?: boolean; shrinkImages?: boolean }): Promise<void> {
    const taskContext = TaskContext.getInstance(taskId, "importNotes", { safeImport: true, shrinkImages });
    const startedAtMs = Date.now();
    graph.resetThrottleStats();

    try {
        // Phase 1: pull everything over the network first, so note creation can run in a single
        // synchronous transaction afterwards.

        // Enumerate every selected section's pages up front so the total page count is known before
        // any content is fetched — this lets the client show a real progress bar rather than a bare count.
        const sectionPages: { section: OneNoteSectionSelection; pages: OneNotePage[] }[] = [];
        for (const section of sections) {
            sectionPages.push({ section, pages: await graph.listPages(getAccessToken, section.id) });
        }
        taskContext.setTotalCount(sectionPages.reduce((total, entry) => total + entry.pages.length, 0));

        const fetched: FetchedSection[] = [];
        let consecutivePageFailures = 0;
        for (const { section, pages } of sectionPages) {
            const fetchedPages: FetchedPage[] = [];
            for (const page of pages) {
                // The Graph fetch and the local processing (HTML/InkML conversion, resource discovery)
                // are guarded separately. Only a failed *fetch* counts toward the circuit breaker: a run
                // of fetch failures means a systemic problem (expired auth, Graph outage) worth aborting
                // for, whereas a page that fetches but fails to convert is an isolated bad page that must
                // become a placeholder without dragging the whole import down.
                let rawHtml: string;
                let inkml: string;
                try {
                    ({ html: rawHtml, inkml } = await graph.getPageContent(getAccessToken, page.id));
                    consecutivePageFailures = 0;
                } catch (e: unknown) {
                    consecutivePageFailures++;
                    const message = e instanceof Error ? e.message : String(e);
                    getLog().error(`OneNote import: could not fetch page '${page.title}' (${page.id}); a placeholder note will be imported instead: ${message}`);
                    if (consecutivePageFailures > MAX_CONSECUTIVE_PAGE_FAILURES) {
                        throw new Error(`Aborting the OneNote import: ${consecutivePageFailures} pages in a row failed to fetch, which points to a systemic problem rather than individual broken pages. Last error: ${message}`);
                    }
                    fetchedPages.push(buildPlaceholderPage(page, message));
                    taskContext.increaseProgressCount();
                    continue;
                }

                try {
                    const html = converter.convertPageHtml(rawHtml);
                    const { resources, failedResourceCount } = await downloadPageResources(getAccessToken, page.title, html);
                    fetchedPages.push({ id: page.id, title: page.title, level: page.level, pageId: page.pageId, html, rawHtml, rawInkml: inkml, inkSvg: inkmlToSvg(inkml), resources, failedResourceCount, createdDateTime: page.createdDateTime, lastModifiedDateTime: page.lastModifiedDateTime });
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    getLog().error(`OneNote import: fetched page '${page.title}' (${page.id}) but could not process its content; a placeholder note will be imported instead: ${message}`);
                    fetchedPages.push(buildPlaceholderPage(page, message));
                }
                taskContext.increaseProgressCount();
            }
            fetched.push({
                title: section.title,
                createdDateTime: section.createdDateTime,
                lastModifiedDateTime: section.lastModifiedDateTime,
                groupPath: section.groupPath,
                notebookId: section.notebookId,
                notebookTitle: section.notebookTitle,
                notebookCreatedDateTime: section.notebookCreatedDateTime,
                notebookLastModifiedDateTime: section.notebookLastModifiedDateTime,
                pages: fetchedPages
            });
        }

        // Phase 2: create the note tree.
        const rootNoteId = sql.transactional(() => createNotes(parentNoteId, fetched, debug, shrinkImages, startedAtMs));

        taskContext.taskSucceeded({ parentNoteId, importedNoteId: rootNoteId });
    } catch (e: unknown) {
        getLog().error(`OneNote import failed: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
        taskContext.reportError(e instanceof Error ? e.message : String(e));
    }
}

/** A content-less stand-in for a page that could not be fetched or processed; imported so the tree and
 *  cross-page links stay intact and the failure is reported (see {@link FetchedPage.fetchError}). */
function buildPlaceholderPage(page: OneNotePage, error: string): FetchedPage {
    return { id: page.id, title: page.title, level: page.level, pageId: page.pageId, html: "", rawHtml: "", rawInkml: "", inkSvg: null, resources: [], failedResourceCount: 0, fetchError: error, createdDateTime: page.createdDateTime, lastModifiedDateTime: page.lastModifiedDateTime };
}

function createNotes(parentNoteId: string, sections: FetchedSection[], debug: boolean, shrinkImages: boolean, startedAtMs: number): string {
    const parentNote = becca.getNoteOrThrow(parentNoteId);
    const isProtected = parentNote.isProtected && protectedSession.isProtectedSessionAvailable();

    const createFolder = (parentId: string, title: string) =>
        noteService.createNewNote({ parentNoteId: parentId, title, content: "", type: "text", mime: "text/html", isProtected }).note;

    const rootNote = createFolder(parentNoteId, t("onenote_import.root-title"));
    rootNote.addLabel("iconClass", "bx bx-import");

    // Created page notes with their content-so-far (resources/ink applied), plus a map from each
    // page's OneNote page-id GUID to its imported note (and title) — both feed the link-resolution pass.
    const createdPages: { note: BNote; original: string; content: string; page: FetchedPage }[] = [];
    const targetByPageId = new Map<string, LinkTarget>();
    const failedPages: FailedPageReport[] = [];

    // Recreate the OneNote hierarchy as folder notes: a folder per notebook, then a folder per section
    // group on the path down to the section, then the section itself. Folders are keyed by their OneNote
    // id (globally unique) so a notebook/group shared by several selected sections is created once, and
    // notebooks/groups that happen to share a title stay apart.
    const folderNotes = new Map<string, string>();

    const ensureFolder = (parentId: string, ref: OneNoteFolderRef, iconClass: string) => {
        let noteId = folderNotes.get(ref.id);
        if (!noteId) {
            const folder = createFolder(parentId, ref.title);
            folder.addLabel("iconClass", iconClass);
            applyOriginalDates(folder, ref.createdDateTime, ref.lastModifiedDateTime);
            noteId = folder.noteId;
            folderNotes.set(ref.id, noteId);
        }
        return noteId;
    };

    for (const section of sections) {
        const notebookRef: OneNoteFolderRef = { id: section.notebookId, title: section.notebookTitle, createdDateTime: section.notebookCreatedDateTime, lastModifiedDateTime: section.notebookLastModifiedDateTime };
        let containerNoteId = ensureFolder(rootNote.noteId, notebookRef, "bx bx-book");
        for (const group of section.groupPath) {
            containerNoteId = ensureFolder(containerNoteId, group, "bx bx-folder");
        }

        const sectionNote = createFolder(containerNoteId, section.title);
        applyOriginalDates(sectionNote, section.createdDateTime, section.lastModifiedDateTime);

        // OneNote pages carry an indentation level (subpages); preserve it by parenting each page under
        // its OneNote parent page rather than flattening every page under the section. Pages arrive in
        // display order (depth-first), so a page's parent always precedes it and already has a note.
        const parentIndexByPage = resolveSubpageParents(section.pages.map((p) => p.level));
        const pageNoteIds: string[] = [];

        for (const [index, page] of section.pages.entries()) {
            const parentIndex = parentIndexByPage[index];
            const { note: pageNote } = noteService.createNewNote({
                parentNoteId: parentIndex >= 0 ? (pageNoteIds[parentIndex] ?? sectionNote.noteId) : sectionNote.noteId,
                title: page.title,
                content: page.fetchError === undefined ? page.html : renderFailedPagePlaceholder(page.fetchError),
                type: "text",
                mime: "text/html",
                isProtected
            });
            pageNoteIds[index] = pageNote.noteId;
            pageNote.addLabel("oneNotePageId", page.id);
            if (page.pageId) {
                // Registered for placeholders too, so other pages' links to a failed page resolve to it.
                targetByPageId.set(page.pageId, { noteId: pageNote.noteId, title: page.title });
            }

            if (page.fetchError !== undefined) {
                // A placeholder rather than a gap: it holds the page's spot in the tree (subpages
                // resolve their parent by index), keeps the OneNote timestamps, and is findable by
                // label. The dates are applied here because placeholders skip the second pass below.
                pageNote.addLabel("oneNoteImportFailed");
                failedPages.push({ title: page.title, sectionTitle: section.title, noteId: pageNote.noteId, error: page.fetchError });
                applyOriginalDates(pageNote, page.createdDateTime, page.lastModifiedDateTime);
                continue;
            }

            // Resources and ink both need the page note to exist (attachments hang off it), so build
            // the per-page content now: swap Graph URLs for local attachment references, then append
            // the page's handwriting/drawing as an inline SVG image. Cross-page links are deferred to a
            // second pass below, once every page has a note to point at.
            let content = page.html;
            if (page.resources.length > 0) {
                content = rewritePageResources(pageNote, content, page.resources, shrinkImages);
            }
            if (page.inkSvg) {
                content += renderInkFigure(pageNote, page.inkSvg, shrinkImages);
            }

            createdPages.push({ note: pageNote, original: page.html, content, page });

            // Debug aid: keep the unmodified Graph HTML (and InkML, when present) alongside the
            // converted note so the two can be compared when diagnosing conversion issues.
            if (debug) {
                pageNote.saveAttachment({
                    role: "importSource",
                    mime: "text/html",
                    title: "OneNote source.html",
                    content: page.rawHtml
                });
                if (page.rawInkml) {
                    pageNote.saveAttachment({
                        role: "importSource",
                        mime: "application/inkml+xml",
                        title: "OneNote ink.inkml",
                        content: page.rawInkml
                    });
                }
            }
        }
    }

    // Second pass: now that every page has a note, resolve cross-page `onenote:` links and persist the
    // final content. Done once per page (rather than re-saving for resources, then again for links).
    let resolvedLinkCount = 0;
    let unresolvedLinkCount = 0;
    for (const { note, original, content, page } of createdPages) {
        const finalContent = rewritePageLinks(content, (pageId) => {
            const target = targetByPageId.get(pageId) ?? null;
            if (target) {
                resolvedLinkCount++;
            } else {
                unresolvedLinkCount++;
            }
            return target;
        });
        if (finalContent !== original) {
            note.setContent(finalContent);
            void noteService.asyncPostProcessContent(note, finalContent);
        }

        // Preserve OneNote's original timestamps. Must run after setContent, whose save would otherwise
        // re-stamp the modification date with "now".
        applyOriginalDates(note, page.createdDateTime, page.lastModifiedDateTime);
    }

    // Finally, document the import's outcome as the root note's content — the task toast is ephemeral,
    // and for a multi-hour import the user has likely walked away by the time it finishes.
    const allPages = createdPages.map(({ note, page }) => ({ note, page }));
    const throttleStats = graph.getThrottleStats();
    const reportData: ImportReportData = {
        importedPageCount: createdPages.length,
        notebookCount: new Set(sections.map((section) => section.notebookId)).size,
        sectionCount: sections.length,
        durationMs: Date.now() - startedAtMs,
        imageCount: sumResources(allPages, "image", () => 1),
        imageBytes: sumResources(allPages, "image", (resource) => resource.content.length),
        attachmentCount: sumResources(allPages, "file", () => 1),
        attachmentBytes: sumResources(allPages, "file", (resource) => resource.content.length),
        inkPageCount: allPages.filter(({ page }) => page.inkSvg !== null).length,
        resolvedLinkCount,
        unresolvedLinkCount,
        throttledRequestCount: throttleStats.requestCount,
        throttleWaitMs: throttleStats.waitMs,
        failedPages,
        failedResources: allPages
            .filter(({ page }) => page.failedResourceCount > 0)
            .map(({ note, page }) => ({ pageTitle: page.title, pageNoteId: note.noteId, failedCount: page.failedResourceCount }))
    };
    rootNote.setContent(renderImportReport(reportData));

    return rootNote.noteId;
}

/** The body of a placeholder note standing in for a page whose content could not be fetched. */
function renderFailedPagePlaceholder(error: string): string {
    return `<p>${t("onenote_import.failed-page-placeholder", { error })}</p>`;
}

/** Totals `value` over every downloaded page resource of the given kind. */
function sumResources(pages: { page: FetchedPage }[], kind: DownloadedResource["kind"], value: (resource: DownloadedResource) => number): number {
    let sum = 0;
    for (const { page } of pages) {
        for (const resource of page.resources) {
            if (resource.kind === kind) {
                sum += value(resource);
            }
        }
    }
    return sum;
}

/**
 * Maps OneNote's flat, display-ordered page list (each page tagged with an indentation `level`) to a
 * parent-child tree. Returns, for each page, the index of its parent page — the nearest preceding page
 * exactly one level shallower — or -1 when the page is top-level and belongs directly under the section.
 *
 * OneNote orders pages depth-first, so a subpage always follows its parent; we track the most recent
 * page seen at each level and discard deeper levels once we step back out, so siblings resolve to the
 * same parent. A subpage whose expected parent level is missing (malformed input) falls back to -1.
 */
export function resolveSubpageParents(levels: number[]): number[] {
    const lastIndexAtLevel: number[] = [];
    return levels.map((level, index) => {
        const parentIndex = level > 0 ? (lastIndexAtLevel[level - 1] ?? -1) : -1;
        lastIndexAtLevel[level] = index;
        lastIndexAtLevel.length = level + 1;
        return parentIndex;
    });
}

/**
 * Applies OneNote's original created/modified timestamps (ISO 8601) to an imported note, falling back
 * to the creation date when the modification date is absent. A no-op when neither is available.
 */
function applyOriginalDates(note: BNote, createdDateTime?: string, lastModifiedDateTime?: string) {
    const utcDateCreated = toUtcDbDate(createdDateTime);
    const utcDateModified = toUtcDbDate(lastModifiedDateTime) ?? utcDateCreated;
    if (utcDateCreated || utcDateModified) {
        note.setDateCreatedAndModified(utcDateCreated, utcDateModified);
    }
}

/** Converts a Graph ISO 8601 timestamp to Trilium's UTC DB format, or undefined if absent/unparseable. */
function toUtcDbDate(isoDateTime: string | undefined): string | undefined {
    if (!isoDateTime) {
        return undefined;
    }
    const date = new Date(isoDateTime);
    return Number.isNaN(date.getTime()) ? undefined : date_utils.utcDateTimeStr(date);
}

/**
 * Saves a page's rendered ink SVG as an image attachment on the note and returns the `<figure>` markup
 * that embeds it inline. Returns an empty string if the attachment could not be created.
 */
function renderInkFigure(note: BNote, svg: string, shrinkImages: boolean): string {
    const { attachmentId, title } = imageService.saveImageToAttachment(note.noteId, binary_utils.encodeUtf8(svg), "OneNote ink.svg", shrinkImages);
    if (!attachmentId) {
        return "";
    }
    return `<figure class="image"><img src="api/attachments/${attachmentId}/image/${encodeURIComponent(title)}"></figure>`;
}

/**
 * Finds the Graph resource URLs a converted page references (image `src`, attachment-link `href`) and
 * downloads each once. Failures are logged and skipped so one missing resource doesn't abort the whole
 * import; the reference is simply left untouched.
 */
async function downloadPageResources(getAccessToken: AccessTokenProvider, pageTitle: string, html: string): Promise<{ resources: DownloadedResource[]; failedResourceCount: number }> {
    const root = parse(html);

    const refs = new Map<string, Omit<DownloadedResource, "content">>();
    for (const img of root.querySelectorAll("img")) {
        const url = img.getAttribute("src") ?? "";
        if (isGraphResourceUrl(url) && !refs.has(url)) {
            refs.set(url, { url, kind: "image", title: "image", mime: "" });
        }
    }
    for (const anchor of root.querySelectorAll(`a.${ONENOTE_ATTACHMENT_CLASS}`)) {
        const url = anchor.getAttribute("href") ?? "";
        if (isGraphResourceUrl(url) && !refs.has(url)) {
            const title = anchor.textContent.trim() || "attachment";
            refs.set(url, { url, kind: "file", title, mime: anchor.getAttribute("data-mime") || "" });
        }
    }

    if (refs.size === 0) {
        return { resources: [], failedResourceCount: 0 };
    }

    const all = Array.from(refs.values());
    const imageCount = all.filter((ref) => ref.kind === "image").length;
    getLog().info(`OneNote import: page '${pageTitle}' references ${all.length} resource(s) (${imageCount} image(s), ${all.length - imageCount} attachment(s)); downloading with concurrency ${RESOURCE_DOWNLOAD_CONCURRENCY}`);

    // Downloads are independent stateless GETs, so fetch them concurrently — but with a bounded pool,
    // not all at once: an image-heavy page (hundreds of images) would otherwise open hundreds of
    // simultaneous connections, triggering Graph throttling (429) and a large memory spike, which in
    // practice dropped most images and left the note nearly empty. A failed download is skipped.
    const downloaded = await mapWithConcurrency(all, RESOURCE_DOWNLOAD_CONCURRENCY, async (ref) => {
        try {
            const { content, contentType } = await graph.getResource(getAccessToken, ref.url);
            return { ...ref, mime: ref.mime || contentType, content };
        } catch (e: unknown) {
            getLog().error(`OneNote import: could not download resource ${sanitizeGraphUrl(ref.url)}: ${e instanceof Error ? e.message : e}`);
            return null;
        }
    });

    const resources = downloaded.filter((resource): resource is DownloadedResource => resource !== null);
    const failed = all.length - resources.length;
    const totalBytes = resources.reduce((sum, resource) => sum + resource.content.length, 0);
    getLog().info(`OneNote import: page '${pageTitle}' downloaded ${resources.length}/${all.length} resource(s) (${Math.round(totalBytes / 1024)} KiB)${failed > 0 ? `; ${failed} failed and were skipped` : ""}`);
    return { resources, failedResourceCount: failed };
}

/**
 * Caps how many page resources (images, attachments) are downloaded from Graph at once. Kept low
 * because the OneNote API throttles aggressively; the shared throttle gate in graph.ts handles bursts
 * beyond this, but a smaller pool means fewer 429s to recover from in the first place.
 */
const RESOURCE_DOWNLOAD_CONCURRENCY = 4;

/**
 * Maps `items` through `worker` with at most `limit` invocations in flight at once, preserving input
 * order in the result. A small fixed pool of workers each pulls the next item until the list is drained.
 */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    const runWorker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await worker(items[index]);
        }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
    return results;
}

/**
 * Re-parses the converted page and swaps each downloaded Graph URL for a local Trilium reference:
 * images become attachment-backed `<img src="api/attachments/…">`, file attachments become Trilium
 * reference links. References whose download failed are left as-is.
 */
function rewritePageResources(note: BNote, html: string, resources: DownloadedResource[], shrinkImages: boolean): string {
    const byUrl = new Map(resources.map((resource) => [resource.url, resource]));
    const root = parse(html);

    for (const img of root.querySelectorAll("img")) {
        const resource = byUrl.get(img.getAttribute("src") ?? "");
        if (!resource) {
            continue;
        }
        const originalName = resource.title.includes(".") ? resource.title : `${resource.title}.${extensionForMime(resource.mime)}`;
        const { attachmentId, title } = imageService.saveImageToAttachment(note.noteId, resource.content, originalName, shrinkImages);
        if (attachmentId) {
            img.setAttribute("src", `api/attachments/${attachmentId}/image/${encodeURIComponent(title)}`);
        }
    }

    for (const anchor of root.querySelectorAll(`a.${ONENOTE_ATTACHMENT_CLASS}`)) {
        const resource = byUrl.get(anchor.getAttribute("href") ?? "");
        if (!resource) {
            continue;
        }
        const attachment = note.saveAttachment({ role: "file", mime: resource.mime || "application/octet-stream", title: resource.title, content: resource.content });
        anchor.setAttribute("class", "reference-link");
        anchor.removeAttribute("data-mime");
        anchor.setAttribute("href", `#root/${note.noteId}?viewMode=attachments&attachmentId=${attachment.attachmentId}`);
    }

    return root.toString();
}

function isGraphResourceUrl(url: string): boolean {
    return url.startsWith("https://graph.microsoft.com/") && url.includes("/resources/");
}

/** Derives a file extension from a content type (e.g. `image/png` → `png`, `image/svg+xml` → `svg`). */
function extensionForMime(mime: string): string {
    return mime.split("/")[1]?.split("+")[0] || "png";
}

export default { importSelection };
