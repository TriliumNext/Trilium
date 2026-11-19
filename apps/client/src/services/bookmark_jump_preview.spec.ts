// @vitest-environment jsdom
// The HTML parser moves an `<a>` that sits directly under `<tr>` out of the table, as browsers do;
// happy-dom's parser keeps it there, so these landings run under jsdom.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { showDocumentTarget } from "./bookmark_jump.js";
import { sanitizeNoteContentHtml } from "./sanitize_content.js";

const { showAnchorElement } = vi.hoisted(() => ({ showAnchorElement: vi.fn() }));
vi.mock("@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js", () => ({
    showAnchorElement,
    getScrollContainer: () => ({ scrollTo: vi.fn() })
}));

/**
 * The preview of an EPUB table as the converter writes it and the server marks it: a cell with an
 * id of its own after the converter's anchor of a second id, holding the ids of two entries, and a
 * row whose marker went into its first cell.
 */
const MARKED_TABLE = "<div><table><tbody>"
    + "<tr><td>First row</td></tr>"
    + "<tr><a id=\"trilium_toc_0\" name=\"trilium_toc_0\"></a>"
    + "<td id=\"destination\" data-toc-heading=\"aaaaaaaaaaaaaa bbbbbbbbbbbbbb\">"
    + "Second row</td></tr>"
    + "<tr><td id=\"trilium_toc_1\" data-toc-heading=\"cccccccccccccc\">Third row</td></tr>"
    + "</tbody></table></div>"
    + "<p data-toc-bookmark=\"two words\">A bookmark</p>";

describe("showDocumentTarget in a sanitized preview", () => {
    beforeEach(() => {
        showAnchorElement.mockClear();
    });

    it("lands on the cell of its row for each id of the cell", async () => {
        const container = document.createElement("div");
        container.innerHTML = sanitizeNoteContentHtml(MARKED_TABLE);
        const rows = container.querySelectorAll("tr");
        // The parser moved the converter's anchor out of the table.
        expect(container.querySelector("table a")).toBeNull();

        for (const heading of [ "aaaaaaaaaaaaaa", "bbbbbbbbbbbbbb" ]) {
            await showDocumentTarget(container, { heading });
            expect(showAnchorElement).toHaveBeenLastCalledWith(rows[1].querySelector("td"));
        }
        await showDocumentTarget(container, { heading: "cccccccccccccc" });
        expect(showAnchorElement).toHaveBeenLastCalledWith(rows[2].querySelector("td"));
    });

    it("matches a whole id only, and a bookmark exactly", async () => {
        const container = document.createElement("div");
        container.innerHTML = sanitizeNoteContentHtml(MARKED_TABLE);

        await showDocumentTarget(container, { heading: "aaaaaaa" });
        await showDocumentTarget(container, { bookmark: "two" });
        expect(showAnchorElement).not.toHaveBeenCalled();

        await showDocumentTarget(container, { bookmark: "two words" });
        expect(showAnchorElement).toHaveBeenCalledExactlyOnceWith(container.querySelector("p"));
    });
});
