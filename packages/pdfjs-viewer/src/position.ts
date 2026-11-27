import { whenInitialViewApplied } from "./navigation";

type ViewerApp = NonNullable<Window["PDFViewerApplication"]>;
type PageView = NonNullable<ReturnType<ViewerApp["pdfViewer"]["getPageView"]>>;

/** How far below the top of the viewer the reading line runs, in CSS pixels. */
const READING_LINE_OFFSET = 100;
/** How long scrolling settles before the position is posted. */
const SCROLL_DEBOUNCE_MS = 100;

/** The event buses whose events the tracking listens to, so a second document adds none. */
const trackedEventBuses = new WeakSet<object>();
/** The position last posted, as `pageNumber:x:y`. */
let postedPosition: string | null = null;
/** The rotation last posted for each page, by page index; empty until the list is posted. */
let postedRotations: number[] = [];

/**
 * Posts where the reading line is and the effective rotation of each page, for the outline of a
 * viewer addressed to a note or opened with `position=1`. Runs at each `documentloaded`.
 */
export function setupPositionTracking(app: ViewerApp) {
    postedPosition = null;
    postedRotations = [];
    const pdf = app.pdfDocument;
    const isCurrent = () => app.pdfDocument === pdf;
    void app.pdfViewer.pagesPromise.then(() => {
        if (isCurrent()) {
            postRotations(app);
        }
    });
    void whenInitialViewApplied().then(() => {
        if (isCurrent()) {
            postPosition(app);
        }
    });

    if (trackedEventBuses.has(app.eventBus)) {
        return;
    }
    trackedEventBuses.add(app.eventBus);
    let timer: number | undefined;
    const postSoon = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => postPosition(app), SCROLL_DEBOUNCE_MS);
    };
    app.pdfViewer.container.addEventListener("scroll", postSoon);
    app.eventBus.on("pagechanging", postSoon);
    for (const event of [ "scalechanging", "scrollmodechanged", "spreadmodechanged" ]) {
        app.eventBus.on(event, () => postPosition(app));
    }
    app.eventBus.on("rotationchanging", () => {
        postRotations(app);
        postPosition(app);
    });
    // A page of a document that pdf.js initializes lazily gets its own rotation once rendered.
    app.eventBus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => {
        postPageRotation(app, pageNumber);
    });
}

function postPosition(app: ViewerApp) {
    const position = readPosition(app);
    const key = position && `${position.pageNumber}:${position.x}:${position.y}`;
    if (!position || key === postedPosition) {
        return;
    }
    postedPosition = key;
    window.parent.postMessage({
        type: "pdfjs-viewer-position", ...position, ...getAddress()
    } satisfies PdfViewerPositionMessage, window.location.origin);
}

function postRotations(app: ViewerApp) {
    const rotations = Array.from({ length: app.pdfDocument.numPages }, (_, pageIndex) =>
        getRotation(app.pdfViewer.getPageView(pageIndex)));
    postedRotations = rotations;
    window.parent.postMessage({
        type: "pdfjs-viewer-rotations", rotations, ...getAddress()
    } satisfies PdfViewerRotationsMessage, window.location.origin);
}

function postPageRotation(app: ViewerApp, pageNumber: number) {
    const pageIndex = pageNumber - 1;
    if (postedRotations.length === 0 || !(pageIndex in postedRotations)) {
        return;
    }
    const rotation = getRotation(app.pdfViewer.getPageView(pageIndex));
    if (rotation === postedRotations[pageIndex]) {
        return;
    }
    postedRotations[pageIndex] = rotation;
    window.parent.postMessage({
        type: "pdfjs-viewer-page-rotation", pageNumber, rotation, ...getAddress()
    } satisfies PdfViewerPageRotationMessage, window.location.origin);
}

/**
 * The reading point in the user space of its page: on the reading line, at the middle of the
 * container. The page is the nearest to the point of those that start at or above the line, or
 * the first page when none does, and the point is clamped into it. Views that pdf.js detached,
 * as the scroll page mode does, are left out.
 */
function readPosition(app: ViewerApp) {
    const { container } = app.pdfViewer;
    const pointX = container.scrollLeft + container.clientWidth / 2;
    const pointY = container.scrollTop + READING_LINE_OFFSET;
    let first: PageBox | null = null;
    let nearest: { box: PageBox; distance: number } | null = null;
    for (let pageIndex = 0; pageIndex < app.pdfDocument.numPages; pageIndex++) {
        const view = app.pdfViewer.getPageView(pageIndex);
        if (!view?.div.isConnected) {
            continue;
        }
        const box = toPageBox(view, pageIndex);
        first ??= box;
        if (box.top > pointY) {
            continue;
        }
        const dx = Math.max(box.left - pointX, 0, pointX - (box.left + box.width));
        const dy = Math.max(box.top - pointY, 0, pointY - (box.top + box.height));
        const distance = dx * dx + dy * dy;
        if (!nearest || distance < nearest.distance) {
            nearest = { box, distance };
        }
    }

    const box = nearest?.box ?? first;
    if (!box) {
        return null;
    }
    const x = clamp(pointX - box.left, box.width);
    const y = clamp(pointY - box.top, box.height);
    const [ pdfX, pdfY ] = box.view.viewport.convertToPdfPoint(x, y);
    // Adding 0 turns the -0 of the transform into 0.
    return { pageNumber: box.pageIndex + 1, x: pdfX + 0, y: pdfY + 0 };
}

/** Where a page view is in the scrolled content of the container, in CSS pixels. */
interface PageBox {
    view: PageView;
    pageIndex: number;
    left: number;
    top: number;
    width: number;
    height: number;
}

function toPageBox(view: PageView, pageIndex: number): PageBox {
    const { div, viewport } = view;
    return {
        view,
        pageIndex,
        left: div.offsetLeft + div.clientLeft,
        top: div.offsetTop + div.clientTop,
        width: viewport.width,
        height: viewport.height
    };
}

/** The effective rotation of a page: its view's and its own, as pdf.js renders it. */
function getRotation(view: PageView | undefined) {
    return view ? (view.rotation + view.pdfPageRotate) % 360 : 0;
}

function clamp(value: number, max: number) {
    return Math.min(Math.max(value, 0), max);
}

function getAddress() {
    return {
        loadToken: window.TRILIUM_LOAD_TOKEN,
        ntxId: window.TRILIUM_NTX_ID,
        noteId: window.TRILIUM_NOTE_ID
    };
}
