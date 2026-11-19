import { findHeading, getBlobTag } from "@triliumnext/commons/src/lib/toc.js";
import { deferred } from "@triliumnext/commons/src/lib/utils.js";

import { getDocumentBlobId } from "./digest";
import { ensureOutline } from "./toc";

type ViewerApp = NonNullable<Window["PDFViewerApplication"]>;

/** Where a request moves the view: a page, and a place on it if one is known. */
interface Target {
    pageNumber: number;
    /** The explicit destination of a heading. */
    dest?: unknown[];
    /** The rectangle of an annotation, in PDF units. */
    rect?: number[] | null;
}

let documentLoaded = deferred<ViewerApp>();
let isDocumentLoaded = false;
/**
 * Settles once pdf.js has applied the initial view of the document, which restores the last-read
 * position and would undo an earlier move. Already settled unless {@link trackDocument} was called.
 */
let initialViewApplied: Promise<void> = Promise.resolve();
/** The number of the latest request, the only one that may move the view. */
let latestRequest = 0;

/**
 * Registers the one listener for the requests that move the view: a heading, from a link or from
 * the sidebar, and a page or an annotation. Runs before the first `await` of `main()`, so that a
 * request posted as soon as the frame loads is not missed.
 */
export function setupNavigation() {
    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin) return;

        const { data } = event;
        if (data?.type === "trilium-scroll-to-heading") {
            void navigate((app) => resolveHeading(app, data));
        } else if (data?.type === "trilium-scroll-to-annotation") {
            void navigate((app) => resolveAnnotation(app, data));
        }
    });
}

/**
 * Follows the load of the document of `app`: requests wait until it has loaded and pdf.js has
 * applied its initial view, at `documentinit` and, for pages of unequal size, after
 * `pagesPromise`. Must be called before the document loads.
 */
export function trackDocument(app: ViewerApp) {
    if (isDocumentLoaded) {
        documentLoaded = deferred();
        isDocumentLoaded = false;
    }
    const loaded = documentLoaded;
    app.eventBus.on("documentloaded", () => {
        isDocumentLoaded = true;
        loaded.resolve(app);
    }, { once: true });

    initialViewApplied = new Promise((resolve) => {
        app.eventBus.on("documentinit", () => {
            void app.pdfViewer.pagesPromise.then(() => requestAnimationFrame(() => resolve()));
        }, { once: true });
    });
}

/** Settles with the viewer application once it has loaded its document. */
export function whenDocumentLoaded(): Promise<ViewerApp> {
    return documentLoaded;
}

/**
 * Moves the view to the target that `resolveTarget` finds, unless a newer request arrived while
 * it waited. The move itself is synchronous, so nothing can come between the last check and it.
 */
async function navigate(resolveTarget: (app: ViewerApp) => Promise<Target | null>) {
    const request = ++latestRequest;
    const app = await documentLoaded;
    const [ , target ] = await Promise.all([
        initialViewApplied, resolveTarget(app).catch(() => null)
    ]);
    if (request !== latestRequest || !target || window.PDFViewerApplication !== app) return;

    moveTo(app, target);
}

/**
 * The place of a heading request, the first that applies: the heading's own destination, the
 * page it inherits from the first heading below it, the page of the request, or nothing. The
 * sidebar names a heading by its key; a link by its saved id, which needs a digest of the
 * document only when it is bound to a blob.
 */
async function resolveHeading(
    app: ViewerApp, { headingId, headingKey, pageNumber }: Record<string, unknown>
): Promise<Target | null> {
    const pdf = app.pdfDocument;
    const { headings: outline, isCut } = await ensureOutline(pdf)
        .catch(() => ({ headings: [], isCut: false }));
    let index = -1;
    if (typeof headingKey === "string") {
        index = parseHeadingKey(headingKey);
    } else if (typeof headingId === "string") {
        index = await findHeading(headingId, outline, async (blobTag, isProtected) =>
            getBlobTag(await getDocumentBlobId(pdf, isProtected)) === blobTag, { isCut });
    }

    const heading = index >= 0 ? outline[index] : undefined;
    if (heading?.page !== undefined && isExplicitDestination(heading.dest)) {
        return { pageNumber: heading.page, dest: heading.dest };
    }
    return toPageTarget(heading?.page ?? heading?.inheritedPage ?? pageNumber, pdf.numPages);
}

/** The place of an annotation request: the annotation on its page, or the top of the page. */
async function resolveAnnotation(
    app: ViewerApp, { annotationId, pageNumber }: Record<string, unknown>
): Promise<Target | null> {
    const target = toPageTarget(pageNumber, app.pdfDocument.numPages);
    if (!target) return null;

    const rect = typeof annotationId === "string"
        ? await findAnnotationRect(app, annotationId, target.pageNumber)
        : null;
    return { ...target, rect };
}

/**
 * Moves the view, then has pdf.js record the position with `update()`: on a resize, pdf.js
 * reapplies an `auto` zoom and scrolls back to the position it recorded last, and a viewer shown
 * again resizes in the same frame as the move.
 */
function moveTo(app: ViewerApp, { pageNumber, dest, rect }: Target) {
    const viewer = app.pdfViewer;
    if (dest) {
        viewer.scrollPageIntoView({ pageNumber, destArray: dest });
        // pdf.js only logs a destination of a type it does not know.
        if (viewer.currentPageNumber !== pageNumber) {
            viewer.currentPageNumber = pageNumber;
        }
        viewer.update();
        return;
    }

    // In single-page scroll mode the viewer holds only the current page's element, so the page
    // is turned to before its element is measured.
    viewer.currentPageNumber = pageNumber;
    const pageView = rect ? viewer.getPageView(pageNumber - 1) : undefined;
    if (rect && pageView) {
        // The viewport maps PDF units, which grow upwards, to the page's CSS pixels at the current
        // zoom and rotation.
        const [ x1, y1 ] = pageView.viewport.convertToViewportPoint(rect[0], rect[1]);
        const [ x2, y2 ] = pageView.viewport.convertToViewportPoint(rect[2], rect[3]);
        const { div } = pageView;
        const { container } = viewer;
        container.scrollTo({
            left: div.offsetLeft + div.clientLeft + (x1 + x2 - container.clientWidth) / 2,
            top: div.offsetTop + div.clientTop + (y1 + y2 - container.clientHeight) / 2,
            behavior: "instant"
        });
    }
    viewer.update();
}

/**
 * The rectangle of an annotation in PDF units, or `null` if it is not on the page or was deleted.
 * An annotation edited in this session is read from `annotationStorage`, which holds where it is
 * now and is keyed by the editor's id, with `id` naming the document annotation it edits.
 */
async function findAnnotationRect(
    app: ViewerApp, annotationId: string, pageNumber: number
): Promise<number[] | null> {
    const storage: any = app.pdfDocument.annotationStorage;
    for (const [ id, serialized ] of storage?.serializable?.map ?? []) {
        if (id === annotationId || serialized.id === annotationId) {
            return serialized.deleted ? null : serialized.rect ?? null;
        }
    }

    const page = await app.pdfDocument.getPage(pageNumber);
    const annotations = await page.getAnnotations({ intent: "display" });
    return annotations.find((ann: Record<string, any>) => ann.id === annotationId)?.rect ?? null;
}

/**
 * A page target for `pageNumber`: the last page for one past the end, from a link to an earlier
 * and longer version of the document, and nothing for one below 1.
 */
function toPageTarget(pageNumber: unknown, pagesCount: number): Target | null {
    if (typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1) {
        return null;
    }
    return { pageNumber: Math.min(pageNumber, pagesCount) };
}

/** The index in the outline of the heading that a sidebar key such as `outline-3` names. */
function parseHeadingKey(key: string) {
    const match = /^outline-(\d+)$/.exec(key);
    return match ? Number(match[1]) : -1;
}

/** Whether `dest` is an explicit destination that `scrollPageIntoView()` can read. */
function isExplicitDestination(dest: unknown[] | undefined): dest is unknown[] {
    const mode = dest?.[1];
    return typeof mode === "object" && mode !== null
        && typeof (mode as { name?: unknown }).name === "string";
}
