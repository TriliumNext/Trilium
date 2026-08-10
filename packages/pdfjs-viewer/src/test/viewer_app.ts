/**
 * Installs a deliberately *thin* `window.PDFViewerApplication` for tests.
 *
 * Only the parts pdf.js builds inside its viewer application — which no public entry point
 * lets us construct standalone — are stubbed here: the page-view geometry and the current
 * page number. Everything with a real upstream implementation is the real thing:
 *
 * - `pdfDocument` is a genuine `PDFDocumentProxy` from `getDocument()`, so `getOutline()`,
 *   `getAttachments()`, `getOptionalContentConfig()` and `getAnnotations()` return whatever
 *   pdf.js actually returns today (see {@link ./fixture_pdf}).
 * - `eventBus` is pdf.js' own `EventBus`, so our `on`/`dispatch` calls are checked against
 *   the real implementation rather than a lookalike.
 *
 * Keeping the stub this small is the point: a fatter fake would start asserting our own
 * assumptions back at us instead of pdf.js' behaviour.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { EventBus } from "pdfjs-dist/web/pdf_viewer.mjs";
import { Mock, vi } from "vitest";

export interface PageGeometry {
    /** Distance of the page from the top of the scroll container. */
    offsetTop: number;
    /** Rendered height of the page. */
    clientHeight: number;
}

export interface InstalledViewer {
    pdfDocument: Awaited<ReturnType<typeof getDocument>["promise"]>;
    eventBus: EventBus;
    /** Stubbed link service — pdf.js' own needs a full viewer to construct. */
    pdfLinkService: { goToDestination: Mock };
    /**
     * The single `OptionalContentConfig` the viewer holds. `getOptionalContentConfig()` mints a
     * fresh instance per call, so tests asserting on toggles must use this one — as `layers.ts`
     * does via `pdfViewer.optionalContentConfigPromise`.
     */
    optionalContentConfig(): Promise<any>;
    /** Every message our code posted to the parent frame, oldest first. */
    messages: any[];
    /** Messages narrowed to a single `type`. */
    messagesOfType(type: string): any[];
    /** The most recent message of a given `type`, or `undefined`. */
    lastMessageOfType(type: string): any;
    /** Simulates the parent frame posting a command into the viewer. */
    sendFromParent(data: unknown): void;
    /** Scrolls the fake container, as the active-heading tracker observes it. */
    scrollTo(scrollTop: number): void;
    /** The `#viewer` element pdf.js renders pages into. */
    viewerEl: HTMLElement;
    /** Records `container.scrollTo` calls, since happy-dom does not scroll. */
    scrollRequests: Mock;
}

/**
 * Loads `data` with real pdf.js and exposes it through a minimal viewer application.
 *
 * `pageGeometry` maps a zero-based page index to its on-screen box; only the active-heading
 * tracking in `toc.ts` reads it, and pages without an entry behave as "not yet rendered".
 */
export async function installViewerApp(data: Uint8Array, pageGeometry: Record<number, PageGeometry> = {}): Promise<InstalledViewer> {
    const pdfDocument = await getDocument({ data }).promise;
    const eventBus = new EventBus();

    // Resolved once and shared, mirroring the real viewer: pdf.js returns a new config object
    // from every getOptionalContentConfig() call, and toggling mutates whichever one you hold.
    const optionalContentConfigPromise = pdfDocument.getOptionalContentConfig();

    const container = document.createElement("div");
    container.style.height = "800px";
    // `#viewer` is where pdf.js appends rendered pages; `scrollToAnnotation` observes it for
    // annotations that have not been rendered yet, and throws outright if it is missing.
    const viewerEl = document.createElement("div");
    viewerEl.id = "viewer";
    container.append(viewerEl);
    document.body.append(container);
    // happy-dom leaves layout at zero; the tracker only needs a readable clientHeight.
    Object.defineProperty(container, "clientHeight", { value: 800, configurable: true });
    // happy-dom performs no scrolling, so record the requests instead. Positions asserted
    // against this will be zero-based, since getBoundingClientRect() is also flat.
    const scrollRequests = vi.fn();
    container.scrollTo = scrollRequests;

    const pdfLinkService = { goToDestination: vi.fn() };
    const messages: any[] = [];

    // Each `setup*()` registers its own anonymous window listener, which it never removes
    // (the real viewer lives for the document's lifetime, so it has no reason to). Across a
    // spec file those would pile up and every message would be handled several times, so
    // record them here and strip them in uninstallViewerApp().
    trackWindowListeners();
    // happy-dom has no real parent frame (window.parent === window), so intercept instead of
    // racing the async message event — matches the approach in persistence.spec.ts.
    vi.spyOn(window.parent, "postMessage").mockImplementation((message: any) => {
        // Cloned, as a real cross-frame postMessage would. This is load-bearing for the saved
        // document: the viewer hands the bytes to the parent and then immediately reopens them,
        // and pdf.js transfers that ArrayBuffer to its worker — which would leave a captured
        // reference detached and empty by the time a test looked at it.
        messages.push(structuredClone(message));
    });

    window.PDFViewerApplication = {
        initializedPromise: Promise.resolve(),
        pdfDocument,
        eventBus,
        pdfViewer: {
            container,
            currentPageNumber: 1,
            optionalContentConfigPromise,
            getPageView: (pageIndex: number) => {
                const geometry = pageGeometry[pageIndex];
                if (!geometry) {
                    return undefined;
                }
                const div = document.createElement("div");
                Object.defineProperty(div, "offsetTop", { value: geometry.offsetTop });
                Object.defineProperty(div, "clientHeight", { value: geometry.clientHeight });
                return { div };
            }
        },
        pdfLinkService,
        store: undefined
    } as unknown as Window["PDFViewerApplication"];

    return {
        pdfDocument,
        eventBus,
        pdfLinkService,
        optionalContentConfig: () => window.PDFViewerApplication?.pdfViewer.optionalContentConfigPromise,
        messages,
        messagesOfType: (type) => messages.filter((message) => message?.type === type),
        lastMessageOfType: (type) => messages.filter((message) => message?.type === type).at(-1),
        sendFromParent: (data) => {
            window.dispatchEvent(new MessageEvent("message", { data, origin: window.location.origin }));
        },
        scrollTo: (scrollTop) => {
            container.scrollTop = scrollTop;
        },
        viewerEl,
        scrollRequests
    };
}

/** Tears down the globals `installViewerApp` touched, including any listeners it recorded. */
export function uninstallViewerApp() {
    untrackWindowListeners();
    delete window.PDFViewerApplication;
    document.body.replaceChildren();
    vi.restoreAllMocks();
}

type TrackedListener = Parameters<typeof window.addEventListener>;

let trackedListeners: TrackedListener[] = [];
let realAddEventListener: typeof window.addEventListener | null = null;

/** Starts recording `window.addEventListener` calls made by the code under test. */
function trackWindowListeners() {
    untrackWindowListeners();
    realAddEventListener = window.addEventListener;
    window.addEventListener = function (...args: TrackedListener) {
        trackedListeners.push(args);
        return realAddEventListener?.apply(this, args);
    } as typeof window.addEventListener;
}

/** Removes every recorded listener and restores the original `addEventListener`. */
function untrackWindowListeners() {
    if (realAddEventListener) {
        window.addEventListener = realAddEventListener;
        realAddEventListener = null;
    }
    for (const [ type, listener, options ] of trackedListeners) {
        window.removeEventListener(type, listener, options as EventListenerOptions);
    }
    trackedListeners = [];
}
