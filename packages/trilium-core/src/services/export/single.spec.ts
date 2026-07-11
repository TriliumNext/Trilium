import { describe, expect, it } from "vitest";
import { mapByNoteType } from "./single.js";
import { buildNote } from "../../test/becca_easy_mocking.js";

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
