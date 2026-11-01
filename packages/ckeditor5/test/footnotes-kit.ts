import type { ClassicEditor, ModelElement } from "ckeditor5";

import { ATTRIBUTES, ELEMENTS } from "../src/plugins/footnotes/constants.js";

/**
 * Test fixtures for the footnotes plugin.
 *
 * These build the document with a model writer rather than `_setModelData()`, because the parser
 * coerces numeric-looking attribute values (`data-footnote-index="1"`) to numbers, whereas the
 * plugin always writes them as strings and compares them as such. A `_setModelData()` fixture
 * therefore silently fails to match production behaviour.
 *
 * This file lives outside `src/`, so it is excluded from both the production build and the
 * coverage gate.
 */

export interface SeededFootnotes {
    references: Array<ModelElement>;
    items: Array<ModelElement>;
    section: ModelElement;
}

/**
 * Writes a document containing `count` footnotes, each referenced once from a leading paragraph,
 * in the shape the plugin produces. Ids are deterministic (`id1`, `id2`, …).
 *
 * The collapsed selection is left at the end of the paragraph text, before the references.
 */
export function seedFootnotes(editor: ClassicEditor, count: number): SeededFootnotes {
    return editor.model.change((writer) => {
        const root = editor.model.document.getRoot();
        if (!root) {
            throw new Error("Editor has no root element.");
        }

        writer.remove(writer.createRangeIn(root));

        const paragraph = writer.createElement("paragraph");
        writer.insert(paragraph, root, 0);
        writer.insertText("text", paragraph, 0);

        const section = writer.createElement(ELEMENTS.footnoteSection);
        writer.insert(section, root, "end");

        const references: Array<ModelElement> = [];
        const items: Array<ModelElement> = [];

        for (let i = 0; i < count; i++) {
            const id = `id${i + 1}`;
            const index = `${i + 1}`;

            const reference = writer.createElement(ELEMENTS.footnoteReference, {
                [ATTRIBUTES.footnoteId]: id,
                [ATTRIBUTES.footnoteIndex]: index
            });
            writer.insert(reference, paragraph, "end");
            references.push(reference);

            const item = writer.createElement(ELEMENTS.footnoteItem, {
                [ATTRIBUTES.footnoteId]: id,
                [ATTRIBUTES.footnoteIndex]: index
            });
            const backLink = writer.createElement(ELEMENTS.footnoteBackLink, {
                [ATTRIBUTES.footnoteId]: id
            });
            const content = writer.createElement(ELEMENTS.footnoteContent);
            const contentParagraph = writer.createElement("paragraph");

            writer.insert(contentParagraph, content, 0);
            writer.insertText(`note ${i + 1}`, contentParagraph, 0);
            writer.insert(backLink, item, 0);
            writer.insert(content, item, "end");
            writer.insert(item, section, "end");
            items.push(item);
        }

        writer.setSelection(paragraph, 4);

        return { references, items, section };
    });
}

/**
 * Places the collapsed selection at the end of the given footnote's content paragraph.
 */
export function selectInFootnoteContent(editor: ClassicEditor, item: ModelElement): void {
    editor.model.change((writer) => {
        const content = [...item.getChildren()].find((child) => child.is("element", ELEMENTS.footnoteContent));
        if (!content?.is("element")) {
            throw new Error("Footnote item has no content element.");
        }
        const paragraph = content.getChild(0);
        if (!paragraph?.is("element")) {
            throw new Error("Footnote content has no paragraph.");
        }
        writer.setSelection(paragraph, "end");
    });
}
