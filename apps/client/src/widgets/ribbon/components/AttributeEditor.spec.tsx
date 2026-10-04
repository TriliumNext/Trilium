import type { ModelPosition } from "@triliumnext/ckeditor5";
import { describe, expect, it } from "vitest";

import { getClickIndex, getPreprocessedData } from "./AttributeEditor";

describe("getPreprocessedData", () => {
    it("reduces a reference link back to the note path it stands for, and resolves the entities around it", () => {
        expect(getPreprocessedData(
            "<p>#author=Elian&nbsp;~parent=<a class=\"reference-link\" href=\"#root/abc123\">Some note</a>&nbsp;</p>"
        )).toBe("#author=Elian ~parent=#root/abc123 ");

        // A link to anywhere else is not a note path, so it is left to the text extraction below it.
        expect(getPreprocessedData("<a href=\"https://example.com\">Example</a>")).toBe("Example");
        expect(getPreprocessedData("#a&amp;b")).toBe("#a&b");
    });
});

describe("getClickIndex", () => {
    it("measures every sibling before the pressed one as the text it stands for", () => {
        const reference = { name: "reference", getAttribute: () => "#root/abc123" };
        const text = { data: "#author=Elian ", previousSibling: null };
        // …#author=Elian ~parent=#root/abc123 |~other
        const pressed = {
            data: "~other",
            startOffset: 3,
            previousSibling: { data: "~parent=", previousSibling: { ...reference, previousSibling: text } }
        };

        // The offset the editor reports counts the reference as a single node; the index does not.
        const index = getClickIndex({ offset: 5, textNode: pressed } as unknown as ModelPosition);
        expect(index).toBe(2 + "#author=Elian ".length + "~parent=".length + "#root/abc123".length + 1);

        // A press in the first node of all is its own offset.
        expect(getClickIndex({ offset: 4, textNode: text } as unknown as ModelPosition)).toBe(4);
        // A press where there is no text node at all still resolves to a position.
        expect(getClickIndex({ offset: 7, textNode: null } as unknown as ModelPosition)).toBe(7);
    });
});
