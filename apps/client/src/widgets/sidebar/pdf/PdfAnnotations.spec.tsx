import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import FNote from "../../../entities/fnote";
import options from "../../../services/options";
import PdfAnnotations, { isDark } from "./PdfAnnotations";

// The panel reads the note being displayed and the annotations the viewer iframe published; both
// arrive through hooks that need the whole app context, so they are handed over directly here.
const shown = vi.hoisted(() => ({
    note: null as FNote | null,
    annotations: null as { annotations: PdfAnnotationInfo[]; scrollToAnnotation: (id: string, page: number) => void } | null
}));
// i18next is not initialised for client specs, so t() would render every label as an empty
// string. Echoing the key and its interpolations instead keeps the assertions about which
// label the panel picks, rather than about the English wording.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, options?: Record<string, unknown>) => `${key}(${JSON.stringify(options ?? {})})`
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useActiveNoteContext: () => ({ note: shown.note }),
    useNoteProperty: (_note: FNote, property: string) => (shown.note as any)?.[property],
    useGetContextData: () => shown.annotations
}));

/** A `file` note holding a PDF — the only combination the panel renders for. */
function pdfNote() {
    return { type: "file", mime: "application/pdf" } as unknown as FNote;
}

function annotation(overrides: Partial<PdfAnnotationInfo>): PdfAnnotationInfo {
    return {
        id: "1R",
        type: "highlight",
        contents: "",
        highlightedText: "",
        author: "",
        pageNumber: 1,
        color: null,
        creationDate: null,
        modificationDate: null,
        ...overrides
    };
}

function renderPanel(annotations: PdfAnnotationInfo[], scrollToAnnotation: (id: string, page: number) => void = () => {}) {
    // The surrounding RightPanelWidget reads which panels the user collapsed from the options.
    options.set("rightPaneCollapsedItems", JSON.stringify([]));

    const container = document.createElement("div");
    document.body.append(container);
    shown.note = pdfNote();
    shown.annotations = { annotations, scrollToAnnotation };
    render(<PdfAnnotations />, container);
    return container;
}

describe("PdfAnnotations", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        shown.note = null;
        shown.annotations = null;
    });

    it("renders nothing for a note that is not a PDF, or one with no annotations", () => {
        // The panel hides itself rather than showing an empty section: nothing to list means no
        // Annotations heading in the sidebar.
        const empty = renderPanel([]);
        expect(empty.querySelector("#pdf-annotations, .pdf-annotations-list")).toBeNull();

        options.set("rightPaneCollapsedItems", JSON.stringify([]));
        shown.note = { type: "text", mime: "text/html" } as unknown as FNote;
        shown.annotations = { annotations: [ annotation({}) ], scrollToAnnotation: () => {} };
        const notPdf = document.createElement("div");
        document.body.append(notPdf);
        render(<PdfAnnotations />, notPdf);
        expect(notPdf.querySelector(".pdf-annotations-list")).toBeNull();
    });

    it("navigates to an annotation when its row is clicked", () => {
        const scrollTo = vi.fn();
        const container = renderPanel([ annotation({ id: "5R", pageNumber: 3, contents: "A remark", author: "Alice" }) ], scrollTo);

        const row = container.querySelector(".pdf-annotation-item") as HTMLElement;
        expect(row.querySelector(".pdf-annotation-author")?.textContent).toBe("Alice");
        row.click();
        expect(scrollTo).toHaveBeenCalledWith("5R", 3);
    });

    it("falls back to a generic label and icon for a kind it has no specific ones for", () => {
        // A sticky note with no text is named a note; a kind the sidebar has no icon for gets the
        // generic comment icon rather than none.
        const container = renderPanel([
            annotation({ id: "14R", type: "text", pageNumber: 2 }),
            annotation({ id: "99R", type: "unknown", pageNumber: 5 })
        ]);

        const rows = [ ...container.querySelectorAll(".pdf-annotation-item") ];
        expect(rows[0].querySelector(".pdf-annotation-untitled")?.textContent).toBe(`pdf.annotation_note({"pageNumber":2})`);
        expect(rows[1].querySelector(".tn-icon")?.className).toContain("bx-comment");
    });

    it("names annotations that carry no text of their own by kind and page", () => {
        // A free-hand highlight is stored as ink and never has text; before #11059 it was
        // dropped, taking the whole panel with it when nothing else was annotated.
        const container = renderPanel([
            annotation({ id: "18R", type: "ink", pageNumber: 4 }),
            annotation({ id: "17R", type: "highlight", pageNumber: 2 }),
            annotation({ id: "19R", type: "freetext", pageNumber: 3 }),
            annotation({ id: "5R", highlightedText: "quoted words", contents: "A remark" })
        ]);

        const rows = [ ...container.querySelectorAll(".pdf-annotation-item") ];
        expect(rows).toHaveLength(4);
        expect(rows[0].querySelector(".pdf-annotation-untitled")?.textContent)
            .toBe(`pdf.annotation_drawing({"pageNumber":4})`);
        expect(rows[1].querySelector(".pdf-annotation-untitled")?.textContent)
            .toBe(`pdf.annotation_highlight({"pageNumber":2})`);
        expect(rows[2].querySelector(".pdf-annotation-untitled")?.textContent)
            .toBe(`pdf.annotation_text_box({"pageNumber":3})`);
        // An annotation with text of its own is described by that text, not by its kind.
        expect(rows[3].textContent).toContain("quoted words");
        expect(rows[3].textContent).toContain("A remark");
        expect(rows[3].querySelector(".pdf-annotation-untitled")).toBeNull();
    });

    it("shows a free-text box under its own icon rather than as a comment", () => {
        // The comment icon marks a remark somebody attached to another annotation; a text box's
        // words are the annotation itself, so it keeps the text icon.
        const container = renderPanel([
            annotation({ id: "19R", type: "freetext", contents: "Typed in the box" }),
            annotation({ id: "5R", type: "highlight", contents: "A remark" })
        ]);

        const rows = [ ...container.querySelectorAll(".pdf-annotation-item") ];
        expect(rows[0].textContent).toContain("Typed in the box");
        expect(rows[0].querySelector(".tn-icon")?.className).toContain("bx-text");
        expect(rows[1].querySelector(".tn-icon")?.className).toContain("bxs-comment-detail");
    });

    it("colours a row's text for the tint behind it, and leaves an untinted row to the theme", () => {
        // A row is tinted with its annotation's own colour, so its text cannot follow the theme:
        // dark text for a pale highlight, light for the pen's default black. A text box has no
        // colour, so its row sits on the panel itself and takes the theme's text colour — the
        // fixed dark text would vanish on a dark theme's panel.
        const container = renderPanel([
            annotation({ id: "5R", color: "#ffff98" }),
            annotation({ id: "18R", type: "ink", color: "#000000" }),
            annotation({ id: "19R", type: "freetext", color: null })
        ]);

        const classes = [ ...container.querySelectorAll(".pdf-annotation-item") ]
            .map((row) => [ ...row.classList ].filter((cls) => cls !== "pdf-annotation-item"));
        expect(classes).toEqual([
            [ "tinted" ],
            [ "tinted", "tinted-dark" ],
            []
        ]);
    });
});

describe("isDark", () => {
    it("separates colours needing light text from the rest", () => {
        expect(isDark("#000000")).toBe(true);
        expect(isDark("#1a3d7c")).toBe(true);
        expect(isDark("#ffff98")).toBe(false);
        expect(isDark("#ffffff")).toBe(false);
        // Green weighs heaviest in the luma formula, so a saturated green reads as light.
        expect(isDark("#00ff00")).toBe(false);
    });

    it("treats a missing or unparseable colour as light, matching the untinted row", () => {
        expect(isDark(null)).toBe(false);
        expect(isDark("rgb(0, 0, 0)")).toBe(false);
    });
});
