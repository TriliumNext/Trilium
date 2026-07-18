import { describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca.js";
import type BAttachment from "../../becca/entities/battachment.js";
import { buildNote } from "../../test/becca_easy_mocking.js";
import { mapByNoteType } from "./single.js";

describe("Note type mappings", () => {
    it("supports mermaid note", () => {
        const note = buildNote({
            type: "mermaid",
            title: "New note"
        });

        expect(mapByNoteType(note, "", "html")).toMatchObject({
            extension: "mermaid",
            mime: "text/vnd.mermaid"
        });
    });

    it("strips CKEditor's data-list-item-id from single-note HTML and Markdown exports", () => {
        // The bullet converts to Markdown syntax; the list inside the table survives as raw HTML —
        // neither should carry the editor-only id in either format.
        const note = buildNote({ type: "text", title: "Listy" });
        const content = `<ul><li data-list-item-id="e0123">Bullet</li></ul>`
            + `<table><tbody><tr><td><ul><li data-list-item-id="e4567">Cell</li></ul></td></tr></tbody></table>`;

        for (const format of ["html", "markdown"] as const) {
            const { payload } = mapByNoteType(note, content, format);
            expect(payload).not.toContain("data-list-item-id");
            expect(payload).toContain("Bullet");
            expect(payload).toContain("Cell");
        }
    });

    it("inlines a link preview's data-image attachment as base64 in single-note HTML export", () => {
        // A link preview references its card image attachment from `data-image`, not an <img src>;
        // the single-file export must inline it the same way to stay self-contained.
        const note = buildNote({ type: "text", title: "Preview" });
        const fakeAttachment = {
            mime: "image/jpeg",
            getContent: () => new Uint8Array([1, 2, 3])
        } as unknown as BAttachment;
        const getAttachment = vi.spyOn(becca, "getAttachment").mockReturnValue(fakeAttachment);

        try {
            const content = `<section class="link-embed" data-url="https://example.com"`
                + ` data-image="api/attachments/att1/image/preview.jpg"></section>`;
            const { payload } = mapByNoteType(note, content, "html");

            expect(getAttachment).toHaveBeenCalledWith("att1");
            expect(payload).toContain(`data-image="data:image/jpeg;base64,AQID"`);
            expect(payload).not.toContain("api/attachments");
        } finally {
            getAttachment.mockRestore();
        }
    });

    it("exports a spreadsheet note verbatim with a .triliumsheet extension", () => {
        // Like canvas/mermaid, single-note spreadsheet export is a lossless raw dump of the stored
        // Univer workbook JSON — no conversion (the editor's own CSV/XLSX buttons cover interchange).
        const content = JSON.stringify({ workbook: { id: "wb", sheetOrder: ["s1"], sheets: { s1: {} } } });
        const note = buildNote({ type: "spreadsheet", mime: "text/x-spreadsheet", title: "Budget" });

        const result = mapByNoteType(note, content, "html");

        expect(result).toMatchObject({
            extension: "triliumsheet",
            mime: "application/json"
        });
        // Byte-for-byte: the payload is the stored workbook, untouched.
        expect(result.payload).toBe(content);
    });

    it("falls back to a raw .dat dump for note types without a dedicated mapping", () => {
        // book/webView/mindMap/… aren't handled explicitly; rather than a zero-byte `.undefined`, they
        // export their raw content with a generic extension (mirrors the zip export's `dat` fallback).
        const note = buildNote({ type: "book", mime: "", title: "My book" });
        expect(mapByNoteType(note, "raw contents", "html")).toMatchObject({
            payload: "raw contents",
            extension: "dat",
            mime: "application/octet-stream"
        });

        // A note carrying its own MIME keeps it in the Content-Type.
        const webView = buildNote({ type: "webView", mime: "text/html", title: "Site" });
        expect(mapByNoteType(webView, "x", "html")).toMatchObject({ extension: "dat", mime: "text/html" });
    });

    it("exports markdown code notes with a .md extension", () => {
        // `mime-types` doesn't recognize Trilium's custom `text/x-markdown`;
        // without the explicit fallback this was exporting as `.code`.
        for (const mime of [ "text/x-markdown", "text/markdown", "text/x-gfm" ]) {
            const note = buildNote({ type: "code", mime, title: "Doc" });
            expect(mapByNoteType(note, "# hi", "markdown")).toMatchObject({
                extension: "md",
                mime
            });
        }
    });
});
