import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../../components/note_context";
import type { NoteContextDataMap } from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import options from "../../../services/options";
import { FilterProvider } from "../../react/filter";
import PdfPages from "./PdfPages";

// The panel reads the note being displayed and the page data the viewer iframe published; both
// arrive through hooks that need the whole app context, so they are handed over directly here.
const shown = vi.hoisted(() => ({
    note: null as FNote | null,
    noteContext: null as NoteContext | null,
    pages: null as NoteContextDataMap["pdfPages"] | null
}));
// react-window virtualises rows off the container's laid-out height, which happy-dom does not
// have; and under vitest it resolves a second copy of the hooks and cannot render at all. What the
// panel puts in a row is what matters here, so a stand-in list renders every row.
const { scrollToRow } = vi.hoisted(() => ({ scrollToRow: vi.fn() }));
vi.mock("react-window", async () => {
    const { useRef } = await import("preact/hooks");
    return {
        List: ({ rowComponent: Row, rowCount, rowProps, listRef }: {
            rowComponent: any; rowCount: number; rowProps: object;
            listRef?: { current: unknown };
        }) => {
            if (listRef) listRef.current = { scrollToRow };
            return (
                <div>
                    {Array.from({ length: rowCount }, (_, index) => (
                        <Row key={index} index={index} style={{}} {...rowProps} />
                    ))}
                </div>
            );
        },
        useListRef: (value: unknown) => useRef(value)
    };
});
vi.mock("../../../services/i18n", () => ({
    t: (key: string, options?: Record<string, unknown>) => `${key}(${JSON.stringify(options ?? {})})`
}));
vi.mock("../../react/hooks/note", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks/note")>()),
    useNoteProperty: (_note: FNote, property: string) => (shown.note as any)?.[property]
}));
vi.mock("../../react/hooks/tree", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks/tree")>()),
    useActiveNoteContext: () => ({ note: shown.note, noteContext: shown.noteContext }),
    useGetContextData: () => shown.pages
}));

/** happy-dom lays nothing out, so the list gets its height from a stand-in observer. */
const LIST_HEIGHT = 400;
let container: HTMLDivElement;

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
        constructor(private readonly callback: (entries: { contentRect: { height: number } }[]) => void) {}
        observe() {
            this.callback([ { contentRect: { height: LIST_HEIGHT } } ]);
        }
        disconnect() {}
    });
    // The surrounding RightPanelWidget reads which panels the user collapsed from the options.
    options.set("rightPaneCollapsedItems", JSON.stringify([]));

    shown.note = { noteId: "note-1", type: "file", mime: "application/pdf" } as unknown as FNote;
    shown.noteContext = { ntxId: "ntx-1" } as NoteContext;
    shown.pages = readyPages({ totalPages: 3, currentPage: 2 });

    container = document.createElement("div");
    document.body.append(container);
});

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    vi.unstubAllGlobals();
    shown.note = null;
    shown.noteContext = null;
    shown.pages = null;
});

function renderPanel(query?: string) {
    act(() => render(<FilterProvider query={query}><PdfPages /></FilterProvider>, container));
}

describe("PdfPages while filtering", () => {
    it("lists the pages whose number matches from the lowest, back at the top of the list", () => {
        shown.pages = readyPages({ totalPages: 130, currentPage: 1 });
        renderPanel();
        scrollToRow.mockClear();

        renderPanel("12");

        const numbers = [ ...container.querySelectorAll(".pdf-page-number") ]
            .map((cell) => cell.textContent);
        expect(numbers).toStrictEqual([ "12", "112", "120", "121", "122", "123", "124", "125",
            "126", "127", "128", "129" ]);
        expect(scrollToRow).toHaveBeenLastCalledWith({ index: 0 });
    });

    it("keeps its place when the viewer moves to another page", () => {
        const pages = readyPages({ totalPages: 130, currentPage: 1 });
        shown.pages = pages;
        renderPanel("12");
        scrollToRow.mockClear();

        // Pdf.tsx publishes a copy of the data with the new current page.
        shown.pages = { ...pages, currentPage: 112 };
        renderPanel("12");

        expect(container.querySelector(".pdf-page-item.active .pdf-page-number")?.textContent)
            .toBe("112");
        expect(scrollToRow).not.toHaveBeenCalled();
    });

    it("asks for no thumbnail it already has, whatever the query", () => {
        const requestThumbnail = vi.fn();
        shown.pages = {
            status: "ready", loadToken: "1", totalPages: 3, currentPage: 1,
            scrollToPage: vi.fn(), requestThumbnail, copyReference: vi.fn()
        };
        renderPanel();
        for (const pageNumber of [ 1, 2, 3 ]) {
            thumbnailArrives({ ntxId: "ntx-1", loadToken: "1", pageNumber, dataUrl: "data:," });
        }
        requestThumbnail.mockClear();

        for (const query of [ "2", "zz", "3", "" ]) {
            renderPanel(query);
        }

        expect(requestThumbnail).not.toHaveBeenCalled();
        expect(container.querySelectorAll(".pdf-page-item")).toHaveLength(3);
    });
});

/** The pages of the viewer load `loadToken`, as Pdf.tsx publishes them. */
function readyPages({ totalPages, currentPage, loadToken = "1" }: {
    totalPages: number; currentPage: number; loadToken?: string;
}): Extract<NoteContextDataMap["pdfPages"], { status: "ready" }> {
    return {
        status: "ready", loadToken, totalPages, currentPage,
        scrollToPage: vi.fn(), requestThumbnail: vi.fn(), copyReference: vi.fn()
    };
}

/** Delivers a thumbnail the way Pdf.tsx relays one from the viewer iframe. */
function thumbnailArrives(detail: {
    ntxId: string; pageNumber: number; dataUrl: string; loadToken?: string;
}) {
    act(() => {
        window.dispatchEvent(new CustomEvent("pdf-thumbnail", { detail }));
    });
}

describe("PdfPages", () => {
    it("lists every page, marks the current one, and asks the viewer for each thumbnail", () => {
        renderPanel();

        const cells = [ ...container.querySelectorAll(".pdf-page-item") ];
        expect(cells.map((cell) => cell.querySelector(".pdf-page-number")?.textContent)).toEqual([ "1", "2", "3" ]);
        expect(cells.map((cell) => cell.classList.contains("active"))).toEqual([ false, true, false ]);
        // Nothing has arrived yet, so every cell is a placeholder and each page was requested once.
        expect(container.querySelectorAll(".pdf-page-loading")).toHaveLength(3);
        expect((shown.pages as any)?.requestThumbnail).toHaveBeenCalledTimes(3);

        (cells[2] as HTMLElement).click();
        expect((shown.pages as any)?.scrollToPage).toHaveBeenCalledWith(3);
    });

    it("copies a reference to a page from its context menu", () => {
        const show = vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);
        renderPanel();

        const cell = container.querySelectorAll(".pdf-page-item")[2] as HTMLElement;
        cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        expect(show).toHaveBeenCalledOnce();
        const [ item ] = show.mock.calls[0][0].items as { title: string; handler: () => void }[];
        expect(item.title).toBe("pdf.copy_reference({})");
        item.handler();
        expect((shown.pages as any)?.copyReference).toHaveBeenCalledWith(3);
        show.mockRestore();
    });

    it("shows a thumbnail rendered for its own context, and ignores another viewer's", () => {
        renderPanel();

        // A second open PDF relays its thumbnails onto the same window; painting one of those into
        // this document's page list would show a page from a different file.
        thumbnailArrives({
            ntxId: "ntx-2", loadToken: "1", pageNumber: 1, dataUrl: "data:image/png;base64,OTHER"
        });
        expect(container.querySelector(".pdf-page-item img")).toBeNull();

        thumbnailArrives({
            ntxId: "ntx-1", loadToken: "1", pageNumber: 1, dataUrl: "data:image/png;base64,MINE"
        });
        const images = [ ...container.querySelectorAll(".pdf-page-item img") ] as HTMLImageElement[];
        expect(images).toHaveLength(1);
        expect(images[0].getAttribute("src")).toBe("data:image/png;base64,MINE");
        expect(images[0].getAttribute("alt")).toBe(`pdf.pages_alt({"pageNumber":1})`);
    });

    it("renders nothing for a note that is not a PDF, or before the viewer has reported its pages", () => {
        shown.pages = null;
        renderPanel();
        expect(container.querySelector(".pdf-pages-list")).toBeNull();

        shown.pages = readyPages({ totalPages: 3, currentPage: 1 });
        shown.note = { noteId: "note-2", type: "text", mime: "text/html" } as unknown as FNote;
        renderPanel();
        expect(container.querySelector(".pdf-pages-list")).toBeNull();
    });

    it("shows a loading card while the viewer load has not reported its pages", () => {
        shown.pages = { status: "loading", loadToken: "2" };
        renderPanel();

        expect(container.querySelector("#pdf-pages")).not.toBeNull();
        expect(container.querySelector(".pdf-pages-list")).toBeNull();
        expect(container.querySelector(".pdf-pages-loading")?.textContent)
            .toBe("pdf.pages_loading({})");
    });

    it("keeps the thumbnails of each viewer load apart", () => {
        renderPanel();
        const firstLoad = shown.pages;
        thumbnailArrives({ ntxId: "ntx-1", loadToken: "1", pageNumber: 1, dataUrl: "data:,ONE" });
        expect(container.querySelectorAll(".pdf-page-item img")).toHaveLength(1);

        // The same note loads another document, with a request for page 2 still outstanding.
        shown.pages = readyPages({ totalPages: 3, currentPage: 1, loadToken: "2" });
        renderPanel();
        expect(container.querySelector(".pdf-page-item img")).toBeNull();
        const secondLoad = shown.pages;
        expect(secondLoad.status === "ready" && secondLoad.requestThumbnail)
            .toHaveBeenCalledTimes(3);

        // The old load's late reply paints nothing.
        thumbnailArrives({ ntxId: "ntx-1", loadToken: "1", pageNumber: 2, dataUrl: "data:,OLD" });
        expect(container.querySelector(".pdf-page-item img")).toBeNull();
        expect(firstLoad?.status === "ready" && firstLoad.requestThumbnail)
            .toHaveBeenCalledTimes(3);

        thumbnailArrives({ ntxId: "ntx-1", loadToken: "2", pageNumber: 2, dataUrl: "data:,NEW" });
        const images = [ ...container.querySelectorAll(".pdf-page-item img") ];
        expect(images.map((image) => image.getAttribute("src"))).toStrictEqual([ "data:,NEW" ]);
    });

    it("says so when the document has no pages", () => {
        shown.pages = readyPages({ totalPages: 0, currentPage: 0 });
        renderPanel();
        expect(container.querySelector(".no-pages")).not.toBeNull();
    });
});
