import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Mock react-window so the virtualized List deterministically renders every row via `rowComponent`,
// independent of layout/measurement (which happy-dom does not perform). This lets PdfPageRow and
// PdfPageCell render and be asserted.
vi.mock("react-window", () => ({
    List: ({ rowComponent: RowComponent, rowCount, rowProps, style }: {
        rowComponent: (props: Record<string, unknown>) => preact.ComponentChild;
        rowCount: number;
        rowProps: Record<string, unknown>;
        style?: Record<string, unknown>;
    }) => {
        const rows: preact.ComponentChild[] = [];
        for (let index = 0; index < rowCount; index++) {
            rows.push(
                RowComponent({
                    key: index,
                    index,
                    style: { top: index * 180 },
                    ariaAttributes: { "aria-posinset": index + 1, "aria-setsize": rowCount, role: "listitem" },
                    ...rowProps
                })
            );
        }
        return <div className="mock-list" style={style as preact.JSX.CSSProperties}>{rows}</div>;
    }
}));

import type { OptionNames } from "@triliumnext/commons";

import appContext from "../../../components/app_context";
import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import { fakeNoteContext, renderComponent } from "../../../test/render";
import PdfPages from "./PdfPages";

// --- Test scaffolding ----------------------------------------------------------------------------

interface ResizeStub {
    cb: ResizeObserverCallback;
    el?: Element;
}
let observers: ResizeStub[] = [];
const realResizeObserver = window.ResizeObserver;

class FakeResizeObserver {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        observers.push({ cb });
    }
    observe(el: Element) {
        const stub = observers.find(o => o.cb === this.cb);
        if (stub) stub.el = el;
    }
    unobserve() {}
    disconnect() {}
}

/** Drives the captured ResizeObserver callback(s) with a contentRect height. */
function fireResize(height: number) {
    act(() => {
        for (const obs of observers) {
            obs.cb([{ contentRect: { height } } as ResizeObserverEntry], obs as unknown as ResizeObserver);
        }
    });
}

interface PagesData {
    totalPages: number;
    currentPage: number;
    scrollToPage: (page: number) => void;
    requestThumbnail: (page: number) => void;
}

function fakePagesData(overrides: Partial<PagesData> = {}): PagesData {
    return {
        totalPages: 3,
        currentPage: 1,
        scrollToPage: vi.fn(),
        requestThumbnail: vi.fn(),
        ...overrides
    };
}

/** Installs a fake active note context returning the given note and pdfPages context data. */
function setActiveContext(note: unknown, pagesData: unknown) {
    const noteContext = fakeNoteContext({
        notePath: "root/pdf",
        note,
        getContextData: vi.fn((key: string) => (key === "pdfPages" ? pagesData : undefined))
    });

    Object.assign(appContext, {
        tabManager: {
            ...appContext.tabManager,
            getActiveContext: vi.fn(() => noteContext)
        }
    });
    return noteContext;
}

beforeEach(() => {
    observers = [];
    Object.assign(window, { ResizeObserver: FakeResizeObserver });
    // RightPanelWidget reads rightPaneCollapsedItems via useTriliumOptionJson (JSON.parse).
    options.load({ rightPaneCollapsedItems: "[]" } as Record<OptionNames, string>);
});

afterEach(() => {
    Object.assign(window, { ResizeObserver: realResizeObserver });
});

// --- Top-level gating (PdfPages) -----------------------------------------------------------------

describe("PdfPages - gating", () => {
    it("renders nothing for a non-file note", () => {
        const note = buildNote({ id: "txt", title: "Text", type: "text" });
        setActiveContext(note, fakePagesData());
        const { container: el } = renderComponent(<PdfPages />);
        expect(el.querySelector("#pdf-pages")).toBeNull();
        expect(el.textContent).toBe("");
    });

    it("renders nothing for a file note that is not a PDF", () => {
        const note = buildNote({ id: "img", title: "Image", type: "file" });
        // file note but wrong mime -> the component reads note.mime; override it.
        (note as unknown as { mime: string }).mime = "image/png";
        setActiveContext(note, fakePagesData());
        const { container: el } = renderComponent(<PdfPages />);
        expect(el.querySelector("#pdf-pages")).toBeNull();
    });

    it("renders nothing when there is no active note context", () => {
        Object.assign(appContext, {
            tabManager: { ...appContext.tabManager, getActiveContext: vi.fn(() => null) }
        });
        const { container: el } = renderComponent(<PdfPages />);
        expect(el.querySelector("#pdf-pages")).toBeNull();
    });

    it("renders nothing for a PDF note without pdfPages context data", () => {
        const note = buildNote({ id: "pdf0", title: "Doc", type: "file" });
        (note as unknown as { mime: string }).mime = "application/pdf";
        setActiveContext(note, undefined);
        const { container: el } = renderComponent(<PdfPages />);
        expect(el.querySelector("#pdf-pages")).toBeNull();
    });
});

// --- The widget + list rendering -----------------------------------------------------------------

function makePdfNote(id: string) {
    const note = buildNote({ id, title: "Doc", type: "file" });
    (note as unknown as { mime: string }).mime = "application/pdf";
    return note;
}

describe("PdfPages - widget", () => {
    it("renders the RightPanelWidget for a PDF note with pages", () => {
        const note = makePdfNote("pdf-w1");
        setActiveContext(note, fakePagesData({ totalPages: 4 }));
        const { container: el } = renderComponent(<PdfPages />);

        const widget = el.querySelector("#pdf-pages");
        expect(widget).not.toBeNull();
        expect(el.querySelector(".pdf-pages-list")).not.toBeNull();
    });

    it("shows the empty placeholder when totalPages is 0", () => {
        const note = makePdfNote("pdf-empty");
        setActiveContext(note, fakePagesData({ totalPages: 0 }));
        const { container: el } = renderComponent(<PdfPages />);

        expect(el.querySelector(".no-pages")).not.toBeNull();
        expect(el.querySelector(".pdf-pages-list")).toBeNull();
    });

    it("does not render the List until the container has a measured height", () => {
        const note = makePdfNote("pdf-noheight");
        const pagesData = fakePagesData({ totalPages: 5 });
        setActiveContext(note, pagesData);
        const { container: el } = renderComponent(<PdfPages />);

        // containerHeight is still 0 -> List not rendered.
        expect(el.querySelector(".mock-list")).toBeNull();
    });

    it("renders rows/cells once the ResizeObserver reports a height", () => {
        const note = makePdfNote("pdf-rows");
        const pagesData = fakePagesData({ totalPages: 3, currentPage: 2 });
        setActiveContext(note, pagesData);
        const { container: el } = renderComponent(<PdfPages />);

        fireResize(500);

        const list = el.querySelector(".mock-list");
        expect(list).not.toBeNull();
        // 3 pages, 2 columns -> ceil(3/2) = 2 rows.
        expect(el.querySelectorAll(".pdf-page-row").length).toBe(2);
        // 3 cells total (the second row only has page 3 because page 4 > totalPages).
        const cells = el.querySelectorAll(".pdf-page-item");
        expect(cells.length).toBe(3);
        // Page numbers are rendered.
        const numbers = Array.from(el.querySelectorAll(".pdf-page-number")).map(n => n.textContent);
        expect(numbers).toEqual([ "1", "2", "3" ]);
    });

    it("marks the current page cell as active", () => {
        const note = makePdfNote("pdf-active");
        setActiveContext(note, fakePagesData({ totalPages: 2, currentPage: 2 }));
        const { container: el } = renderComponent(<PdfPages />);
        fireResize(400);

        const activeCells = el.querySelectorAll(".pdf-page-item.active");
        expect(activeCells.length).toBe(1);
        expect(activeCells[0].querySelector(".pdf-page-number")?.textContent).toBe("2");
    });
});

// --- Thumbnails + interactions -------------------------------------------------------------------

describe("PdfPages - thumbnails & interactions", () => {
    it("requests a thumbnail for each rendered page exactly once", () => {
        const note = makePdfNote("pdf-req");
        const requestThumbnail = vi.fn();
        setActiveContext(note, fakePagesData({ totalPages: 2, requestThumbnail }));
        renderComponent(<PdfPages />);
        fireResize(400);

        // Each of the 2 cells requests its page once.
        expect(requestThumbnail).toHaveBeenCalledTimes(2);
        expect(requestThumbnail.mock.calls.map(c => c[0]).sort()).toEqual([ 1, 2 ]);

        // Re-firing the resize re-renders but must not re-request (dedup via refs).
        fireResize(450);
        expect(requestThumbnail).toHaveBeenCalledTimes(2);
    });

    it("renders the loading placeholder when no thumbnail is available", () => {
        const note = makePdfNote("pdf-loading");
        setActiveContext(note, fakePagesData({ totalPages: 1 }));
        const { container: el } = renderComponent(<PdfPages />);
        fireResize(400);

        expect(el.querySelector(".pdf-page-loading")).not.toBeNull();
        expect(el.querySelector(".pdf-page-thumbnail img")).toBeNull();
    });

    it("renders an <img> once a pdf-thumbnail event delivers a data URL", () => {
        const note = makePdfNote("pdf-thumb");
        setActiveContext(note, fakePagesData({ totalPages: 1 }));
        const { container: el } = renderComponent(<PdfPages />);
        fireResize(400);

        act(() => {
            window.dispatchEvent(new CustomEvent("pdf-thumbnail", {
                detail: { pageNumber: 1, dataUrl: "data:image/png;base64,AAAA" }
            }));
        });

        const img = el.querySelector(".pdf-page-thumbnail img") as HTMLImageElement | null;
        expect(img).not.toBeNull();
        expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
        expect(el.querySelector(".pdf-page-loading")).toBeNull();
    });

    it("does not re-request a thumbnail that already arrived via event", () => {
        const note = makePdfNote("pdf-norereq");
        const requestThumbnail = vi.fn();
        setActiveContext(note, fakePagesData({ totalPages: 1, requestThumbnail }));
        renderComponent(<PdfPages />);

        // Deliver the thumbnail BEFORE the list renders so requestThumbnail dedups on the cached set.
        act(() => {
            window.dispatchEvent(new CustomEvent("pdf-thumbnail", {
                detail: { pageNumber: 1, dataUrl: "data:image/png;base64,BBBB" }
            }));
        });
        fireResize(400);

        expect(requestThumbnail).not.toHaveBeenCalled();
    });

    it("invokes scrollToPage when a cell is clicked", () => {
        const note = makePdfNote("pdf-click");
        const scrollToPage = vi.fn();
        setActiveContext(note, fakePagesData({ totalPages: 2, scrollToPage }));
        const { container: el } = renderComponent(<PdfPages />);
        fireResize(400);

        const secondCell = el.querySelectorAll(".pdf-page-item")[1] as HTMLElement;
        act(() => secondCell.click());
        expect(scrollToPage).toHaveBeenCalledWith(2);
    });

    it("removes the pdf-thumbnail listener on unmount", () => {
        const note = makePdfNote("pdf-cleanup");
        setActiveContext(note, fakePagesData({ totalPages: 1 }));
        const { unmount } = renderComponent(<PdfPages />);
        fireResize(400);

        const removeSpy = vi.spyOn(window, "removeEventListener");
        unmount();
        expect(removeSpy.mock.calls.some(([ name ]) => name === "pdf-thumbnail")).toBe(true);
    });
});
