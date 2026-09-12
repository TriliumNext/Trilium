import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import options from "../../../services/options";
import PdfPages from "./PdfPages";

// The panel reads the note being displayed and the page data the viewer iframe published; both
// arrive through hooks that need the whole app context, so they are handed over directly here.
const shown = vi.hoisted(() => ({
    note: null as FNote | null,
    noteContext: null as NoteContext | null,
    pages: null as { totalPages: number; currentPage: number; scrollToPage: (page: number) => void; requestThumbnail: (page: number) => void } | null
}));
// react-window virtualises rows off the container's laid-out height, which happy-dom does not
// have; and under vitest it resolves a second copy of the hooks and cannot render at all. What the
// panel puts in a row is what matters here, so a stand-in list renders every row.
vi.mock("react-window", () => ({
    List: ({ rowComponent: Row, rowCount, rowProps }: { rowComponent: any; rowCount: number; rowProps: object }) => (
        <div>{Array.from({ length: rowCount }, (_, index) => <Row key={index} index={index} style={{}} {...rowProps} />)}</div>
    )
}));
vi.mock("../../../services/i18n", () => ({
    t: (key: string, options?: Record<string, unknown>) => `${key}(${JSON.stringify(options ?? {})})`
}));
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useActiveNoteContext: () => ({ note: shown.note, noteContext: shown.noteContext }),
    useNoteProperty: (_note: FNote, property: string) => (shown.note as any)?.[property],
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
    shown.pages = { totalPages: 3, currentPage: 2, scrollToPage: vi.fn(), requestThumbnail: vi.fn() };

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

function renderPanel() {
    act(() => render(<PdfPages />, container));
}

/** Delivers a thumbnail the way Pdf.tsx relays one from the viewer iframe. */
function thumbnailArrives(detail: { ntxId: string; pageNumber: number; dataUrl: string }) {
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
        expect(shown.pages?.requestThumbnail).toHaveBeenCalledTimes(3);

        (cells[2] as HTMLElement).click();
        expect(shown.pages?.scrollToPage).toHaveBeenCalledWith(3);
    });

    it("shows a thumbnail rendered for its own context, and ignores another viewer's", () => {
        renderPanel();

        // A second open PDF relays its thumbnails onto the same window; painting one of those into
        // this document's page list would show a page from a different file.
        thumbnailArrives({ ntxId: "ntx-2", pageNumber: 1, dataUrl: "data:image/png;base64,OTHER" });
        expect(container.querySelector(".pdf-page-item img")).toBeNull();

        thumbnailArrives({ ntxId: "ntx-1", pageNumber: 1, dataUrl: "data:image/png;base64,MINE" });
        const images = [ ...container.querySelectorAll(".pdf-page-item img") ] as HTMLImageElement[];
        expect(images).toHaveLength(1);
        expect(images[0].getAttribute("src")).toBe("data:image/png;base64,MINE");
        expect(images[0].getAttribute("alt")).toBe(`pdf.pages_alt({"pageNumber":1})`);
    });

    it("renders nothing for a note that is not a PDF, or before the viewer has reported its pages", () => {
        shown.pages = null;
        renderPanel();
        expect(container.querySelector(".pdf-pages-list")).toBeNull();

        shown.pages = { totalPages: 3, currentPage: 1, scrollToPage: vi.fn(), requestThumbnail: vi.fn() };
        shown.note = { noteId: "note-2", type: "text", mime: "text/html" } as unknown as FNote;
        renderPanel();
        expect(container.querySelector(".pdf-pages-list")).toBeNull();
    });

    it("says so when the document has no pages", () => {
        shown.pages = { totalPages: 0, currentPage: 0, scrollToPage: vi.fn(), requestThumbnail: vi.fn() };
        renderPanel();
        expect(container.querySelector(".no-pages")).not.toBeNull();
    });
});
