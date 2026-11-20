import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import NoteContext, { type NoteContextDataMap } from "../../components/note_context";
import type FNote from "../../entities/fnote";
import options from "../../services/options";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { createFilterableTab } from "../../test/outline_filter";
import BoardColumns from "./BoardColumns";
import ChatHighlightsList from "./ChatHighlightsList";
import PdfAnnotations from "./pdf/PdfAnnotations";
import PdfAttachments from "./pdf/PdfAttachments";
import PdfLayers from "./pdf/PdfLayers";
import PdfPages from "./pdf/PdfPages";

vi.mock("../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/i18n")>(),
    t: (key: string, values?: { pageNumber?: number }) => (values?.pageNumber
        ? `${key} ${values.pageNumber}`
        : key)
}));
// A stand-in list renders every row, as happy-dom lays nothing out (see PdfPages.spec.tsx).
vi.mock("react-window", async () => {
    const { useRef } = await import("preact/hooks");
    return {
        List: ({ rowComponent: Row, rowCount, rowProps }: {
            rowComponent: any; rowCount: number; rowProps: object;
        }) => (
            <div>
                {Array.from({ length: rowCount }, (_, index) => (
                    <Row key={index} index={index} style={{}} {...rowProps} />
                ))}
            </div>
        ),
        useListRef: (value: unknown) => useRef(value)
    };
});

let tab: ReturnType<typeof createFilterableTab>;
let noteContext: NoteContext;

beforeEach(() => {
    options.set("rightPaneCollapsedItems", JSON.stringify([]));
    vi.spyOn(server, "put").mockResolvedValue({});
    vi.stubGlobal("ResizeObserver", class {
        constructor(private readonly callback: (entries: object[]) => void) {}
        observe() {
            this.callback([ { contentRect: { height: 400 } } ]);
        }
        disconnect() {}
    });
    tab = createFilterableTab();
});

afterEach(() => {
    tab.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("the layers and attachments of a PDF while filtering", () => {
    it("list the matches, and Enter neither toggles a layer nor downloads", async () => {
        showNote(buildNote({ title: "Doc", type: "file", mime: "application/pdf" }));
        const toggleLayer = vi.fn();
        const downloadAttachment = vi.fn();
        noteContext.setContextData("pdfLayers", {
            status: "ready", loadToken: "1", toggleLayer,
            layers: [ { id: "a", name: "Budget layer", visible: true },
                { id: "b", name: "Other", visible: true } ]
        });
        noteContext.setContextData("pdfAttachments", {
            status: "ready", loadToken: "1", downloadAttachment,
            attachments: [ { id: "x", filename: "budget.xlsx", size: 10 },
                { id: "y", filename: "notes.txt", size: 10 } ]
        });
        await tab.render([ <PdfAttachments />, <PdfLayers /> ]);

        await tab.type("budget");
        expect(texts(".pdf-layer-name")).toStrictEqual([ "Budget layer" ]);
        expect(texts(".pdf-attachment-filename")).toStrictEqual([ "budget.xlsx" ]);

        await tab.press("Enter");
        expect(toggleLayer).not.toHaveBeenCalled();
        expect(downloadAttachment).not.toHaveBeenCalled();
    });

    it("show a card while loading only while filtering", async () => {
        showNote(buildNote({ title: "Doc", type: "file", mime: "application/pdf" }));
        noteContext.setContextData("pdfLayers", { status: "loading", loadToken: "1" });
        noteContext.setContextData("pdfAttachments", { status: "loading", loadToken: "1" });
        await tab.render([ <PdfAttachments />, <PdfLayers /> ]);
        expect(tab.card("pdf-layers")).toBeNull();

        await tab.type("budget");
        expect(tab.isShown("pdf-layers")).toBe(true);
        expect(tab.isShown("pdf-attachments")).toBe(true);
        expect(tab.emptyState()).toBeNull();
    });
});

describe("the annotations of a PDF while filtering", () => {
    it("match an untitled annotation by its description", async () => {
        showNote(buildNote({ title: "Doc", type: "file", mime: "application/pdf" }));
        noteContext.setContextData("pdfAnnotations", readyAnnotations([
            annotation("drawing", { type: "ink", pageNumber: 4 }),
            annotation("remark", { contents: "Budget remark" })
        ]));
        await tab.render([ <PdfAnnotations />, <PdfLayers /> ]);

        await tab.type("drawing 4");

        expect(texts(".pdf-annotation-untitled")).toStrictEqual([ "pdf.annotation_drawing 4" ]);
        expect(tab.container.querySelectorAll(".pdf-annotation-item")).toHaveLength(1);
    });
});

describe("Enter across the sections of a PDF", () => {
    it("goes on to the next section once a loading Pages section goes away", async () => {
        showNote(buildNote({ title: "Doc", type: "file", mime: "application/pdf" }));
        const annotations = readyAnnotations([ annotation("a", { contents: "Item 12" }) ]);
        noteContext.setContextData("pdfPages", { status: "loading", loadToken: "1" });
        noteContext.setContextData("pdfAnnotations", annotations);
        await tab.render([ <PdfPages />, <PdfAnnotations /> ]);

        await tab.type("12");
        await tab.press("Enter");
        expect(annotations.scrollToAnnotation).not.toHaveBeenCalled();

        // The load is given up: the viewer will send no pages.
        await act(async () => noteContext.clearContextData("pdfPages"));
        expect(annotations.scrollToAnnotation).toHaveBeenCalledExactlyOnceWith("a", 1);
    });

    it("waits for annotations still read before the pages, as on a phone", async () => {
        showNote(buildNote({ title: "Doc", type: "file", mime: "application/pdf" }));
        const pages = readyPages(130);
        noteContext.setContextData("pdfPages", pages);
        noteContext.setContextData("pdfAnnotations", { status: "loading", loadToken: "1" });
        await tab.render([ <PdfAnnotations />, <PdfPages /> ], { flat: true });

        await tab.type("12");
        await tab.press("Enter");
        expect(pages.scrollToPage).not.toHaveBeenCalled();

        const annotations = readyAnnotations([ annotation("a", { contents: "Item 12" }) ]);
        await act(async () => noteContext.setContextData("pdfAnnotations", annotations));
        expect(annotations.scrollToAnnotation).toHaveBeenCalledOnce();
        expect(pages.scrollToPage).not.toHaveBeenCalled();
    });

    it("runs the page once the annotations arrive with none", async () => {
        showNote(buildNote({ title: "Doc", type: "file", mime: "application/pdf" }));
        const pages = readyPages(130);
        noteContext.setContextData("pdfPages", pages);
        noteContext.setContextData("pdfAnnotations", { status: "loading", loadToken: "1" });
        await tab.render([ <PdfAnnotations />, <PdfPages /> ], { flat: true });

        await tab.type("12");
        await tab.press("Enter");
        await act(async () => noteContext.setContextData("pdfAnnotations", readyAnnotations([])));

        expect(pages.scrollToPage).toHaveBeenCalledExactlyOnceWith(12);
    });
});

describe("the columns of a board and the highlights of a chat while filtering", () => {
    it("list the matches, and Enter scrolls to the first", async () => {
        showNote(buildNote({ title: "Board", type: "book" }));
        const scrollToColumn = vi.fn();
        const scrollToHighlight = vi.fn();
        noteContext.setContextData("boardColumns", {
            scrollToColumn,
            columns: [ { value: "todo", title: "To do", icon: "bx bx-circle", count: 1 },
                { value: "done", title: "Done", icon: "bx bx-check", count: 2 } ]
        });
        noteContext.setContextData("chatHighlights", {
            highlights: [ { id: "h1", text: "Not done yet" }, { id: "h2", text: "Other" } ],
            scrollToHighlight,
            removeHighlight: vi.fn()
        } as unknown as NoteContextDataMap["chatHighlights"]);
        await tab.render([ <BoardColumns />, <ChatHighlightsList /> ]);

        await tab.type("done");
        expect(texts(".board-column-name")).toStrictEqual([ "Done" ]);
        expect(texts(".chat-highlight-text")).toStrictEqual([ "Not done yet" ]);

        await tab.press("Enter");
        expect(scrollToColumn).toHaveBeenCalledExactlyOnceWith("done");
        expect(scrollToHighlight).not.toHaveBeenCalled();
    });
});

function showNote(note: FNote) {
    noteContext = new NoteContext("sections-ntx");
    // Its `contextDataChanged` events reach the hooks through the app, as in the tab manager.
    appContext.child(noteContext);
    noteContext.noteId = note.noteId;
    noteContext.notePath = note.noteId;
    noteContext.viewScope = { viewMode: "default" };
    Object.defineProperty(noteContext, "note", { get: () => note });
    appContext.tabManager = {
        getActiveContext: () => noteContext
    } as typeof appContext.tabManager;
}

function texts(selector: string) {
    return [ ...tab.container.querySelectorAll(selector) ].map((element) => element.textContent);
}

function annotation(id: string, fields: Partial<PdfAnnotationInfo>): PdfAnnotationInfo {
    return {
        id, type: "text", contents: "", highlightedText: "", author: "", pageNumber: 1,
        color: null, creationDate: null, modificationDate: null, ...fields
    };
}

function readyAnnotations(annotations: PdfAnnotationInfo[]) {
    return {
        status: "ready" as const, loadToken: "1", annotations,
        scrollToAnnotation: vi.fn(), copyReference: vi.fn()
    };
}

function readyPages(totalPages: number) {
    return {
        status: "ready" as const, loadToken: "1", totalPages, currentPage: 1,
        scrollToPage: vi.fn(), requestThumbnail: vi.fn(), copyReference: vi.fn()
    };
}
