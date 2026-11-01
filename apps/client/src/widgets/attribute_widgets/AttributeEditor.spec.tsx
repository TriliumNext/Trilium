import type { ModelPosition } from "@triliumnext/ckeditor5";
import { describe, expect, it } from "vitest";

import link from "../../services/link";
import { buildAttributeEditorConfig, getClickIndex } from "./AttributeEditor";

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

describe("buildAttributeEditorConfig", () => {
    it("titles the notes picked as relation targets", () => {
        const referenceLink = buildAttributeEditorConfig([]).referenceLink;

        expect(referenceLink?.getTitle).toBe(link.getReferenceLinkTitle);
        expect(referenceLink?.getTitleSync).toBe(link.getReferenceLinkTitleSync);
        expect(referenceLink?.renderTitle).toBeTypeOf("function");
    });
});
