import { Essentials, Paragraph, type ViewElement } from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import KeepViewMappings from "./keep_view_mappings.js";

describe("KeepViewMappings", () => {
    it("keeps a view element bound to the DOM element that it was bound to last", async () => {
        const editor = await createTestEditor([ Essentials, Paragraph, KeepViewMappings ]);
        const { domConverter } = editor.editing.view;
        const [ first, second ] = editor.editing.view.change((writer) => [
            writer.createAttributeElement("span"), writer.createAttributeElement("span")
        ]) as ViewElement[];
        const [ oldSpan, newSpan, otherSpan ] = [ 0, 1, 2 ].map(() =>
            document.createElement("span"));
        const child = document.createElement("span");
        oldSpan.append(child);

        domConverter.bindElements(oldSpan, first);
        domConverter.bindElements(child, second);
        domConverter.bindElements(newSpan, first);
        domConverter.bindElements(otherSpan, second);
        domConverter.unbindDomElement(oldSpan);

        expect(domConverter.mapViewToDom(first)).toBe(newSpan);
        expect(domConverter.mapViewToDom(second)).toBe(otherSpan);
        expect(domConverter.mapDomToView(oldSpan)).toBeUndefined();
        expect(domConverter.mapDomToView(child)).toBeUndefined();

        domConverter.unbindDomElement(newSpan);
        expect(domConverter.mapViewToDom(first)).toBeUndefined();
        expect(domConverter.mapDomToView(newSpan)).toBeUndefined();
    });
});
