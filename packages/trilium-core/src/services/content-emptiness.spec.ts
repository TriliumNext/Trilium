import { describe, expect, it } from "vitest";

import { isVisuallyEmptyTextContent } from "./content-emptiness.js";

describe("isVisuallyEmptyTextContent", () => {
    it("treats empty and whitespace-only content as empty", () => {
        expect(isVisuallyEmptyTextContent("")).toBe(true);
        expect(isVisuallyEmptyTextContent("   \n\t ")).toBe(true);
    });

    it("treats the editor's emptied-note skeletons as empty (#10908)", () => {
        expect(isVisuallyEmptyTextContent("<p>&nbsp;</p>")).toBe(true);
        expect(isVisuallyEmptyTextContent("<p><br></p>")).toBe(true);
        expect(isVisuallyEmptyTextContent("<div><br></div>")).toBe(true);
        expect(isVisuallyEmptyTextContent("<p>  </p>\n<p>&#160;</p>")).toBe(true);
        expect(isVisuallyEmptyTextContent("<!-- comment only --><p><br></p>")).toBe(true);
    });

    it("keeps real content non-empty", () => {
        expect(isVisuallyEmptyTextContent("<p>hello</p>")).toBe(false);
        expect(isVisuallyEmptyTextContent("<p>&nbsp;</p><p>text</p>")).toBe(false);
        // A list with an item label is content even though its tags strip away.
        expect(isVisuallyEmptyTextContent("<ul><li>item</li></ul>")).toBe(false);
        expect(isVisuallyEmptyTextContent("plain text")).toBe(false);
    });
});
