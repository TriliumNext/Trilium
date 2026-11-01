import { _getModelData as getModelData, ClassicEditor, Essentials, type ModelElement, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { seedFootnotes } from "../../../test/footnotes-kit.js";
import { ATTRIBUTES, CLASSES, ELEMENTS } from "./constants.js";
import Footnotes from "./footnotes.js";

describe("footnote converters", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Footnotes]);
    });

    function model(): string {
        return getModelData(editor.model, { withoutSelection: true });
    }

    describe("data downcast", () => {
        it("writes the section as an ol with the endnotes role", () => {
            seedFootnotes(editor, 1);

            const data = editor.getData();

            expect(data).toContain(`<ol class="${CLASSES.footnoteSection} ${CLASSES.footnotes}"`);
            expect(data).toContain(`role="doc-endnotes"`);
        });

        it("writes each item as an li carrying its id and index", () => {
            seedFootnotes(editor, 1);

            const data = editor.getData();

            expect(data).toContain(`<li class="${CLASSES.footnoteItem}"`);
            expect(data).toContain(`id="fnid1"`);
            expect(data).toContain(`role="doc-endnote"`);
        });

        it("writes the reference as a superscript link back to the item", () => {
            seedFootnotes(editor, 1);

            const data = editor.getData();

            expect(data).toContain(`class="${CLASSES.footnoteReference}"`);
            expect(data).toContain(`role="doc-noteref"`);
            expect(data).toContain(`id="fnrefid1"`);
            expect(data).toContain(`<sup><a href="#fnid1">[1]</a></sup>`);
        });

        it("writes the back link as a caret linking to the reference", () => {
            seedFootnotes(editor, 1);

            const data = editor.getData();

            expect(data).toContain(`class="${CLASSES.footnoteBackLink}"`);
            expect(data).toContain(`<a href="#fnrefid1">^</a>`);
        });

        it("writes the content container", () => {
            seedFootnotes(editor, 1);

            expect(editor.getData()).toContain(`class="${CLASSES.footnoteContent}"`);
        });
    });

    describe("upcast", () => {
        it("reads a full footnote structure back into the model", () => {
            seedFootnotes(editor, 1);
            const data = editor.getData();

            editor.setData(data);

            expect(model()).toContain(`<${ELEMENTS.footnoteSection}>`);
            expect(model()).toContain(`${ATTRIBUTES.footnoteId}="id1"`);
            expect(model()).toContain(`<${ELEMENTS.footnoteBackLink}`);
        });

        it("drops a footnote item that is missing its id or index", () => {
            editor.setData(
                `<ol ${ATTRIBUTES.footnoteSection}="" class="${CLASSES.footnoteSection}">` +
                `<li ${ATTRIBUTES.footnoteItem}="" ${ATTRIBUTES.footnoteIndex}="1">no id</li>` +
                `</ol>`
            );

            expect(model()).not.toContain(`<${ELEMENTS.footnoteItem}`);
        });

        it("drops a reference that is missing its id or index", () => {
            editor.setData(
                `<p>text<span ${ATTRIBUTES.footnoteReference}="" ${ATTRIBUTES.footnoteIndex}="1"></span></p>`
            );

            expect(model()).not.toContain(`<${ELEMENTS.footnoteReference}`);
        });

        it("drops a back link that is missing its id", () => {
            editor.setData(
                `<ol ${ATTRIBUTES.footnoteSection}="" class="${CLASSES.footnoteSection}">` +
                `<li ${ATTRIBUTES.footnoteItem}="" ${ATTRIBUTES.footnoteId}="a" ${ATTRIBUTES.footnoteIndex}="1">` +
                `<span ${ATTRIBUTES.footnoteBackLink}=""></span>` +
                `<div ${ATTRIBUTES.footnoteContent}=""><p>x</p></div>` +
                `</li></ol>`
            );

            expect(model()).not.toContain(`<${ELEMENTS.footnoteBackLink}`);
        });
    });

    describe("downcast failure modes", () => {
        function insertBareElement(name: string, attributes: Record<string, string> = {}): ModelElement {
            return editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                const section = writer.createElement(ELEMENTS.footnoteSection);
                writer.insert(section, writer.createPositionAt(root ?? section, "end"));
                const element = writer.createElement(name, attributes);
                writer.insert(element, section, 0);
                return element;
            });
        }

        it("throws when a footnote item has no index", () => {
            expect(() => insertBareElement(ELEMENTS.footnoteItem, { [ATTRIBUTES.footnoteId]: "a" }))
                .toThrow("Footnote item has no provided index.");
        });

        it("throws when a footnote item has no id", () => {
            expect(() => insertBareElement(ELEMENTS.footnoteItem, { [ATTRIBUTES.footnoteIndex]: "1" }))
                .toThrow("Footnote item has no provided id.");
        });

        function insertBareReference(attributes: Record<string, string> = {}): void {
            editor.model.change((writer) => {
                const paragraph = editor.model.document.getRoot()?.getChild(0);
                if (!paragraph?.is("element")) {
                    throw new Error("Expected a paragraph.");
                }
                writer.insert(writer.createElement(ELEMENTS.footnoteReference, attributes), paragraph, 0);
            });
        }

        it("throws when a footnote reference has no index", () => {
            expect(() => insertBareReference({ [ATTRIBUTES.footnoteId]: "a" }))
                .toThrow("Footnote reference has no provided index.");
        });

        it("throws when a footnote reference has no id", () => {
            expect(() => insertBareReference({ [ATTRIBUTES.footnoteIndex]: "1" }))
                .toThrow("Footnote reference has no provided id.");
        });
    });

    describe("reference index updates", () => {
        it("rewrites the reference text and href when the footnote index changes", () => {
            const { items, references } = seedFootnotes(editor, 2);

            editor.model.change((writer) => {
                writer.setAttribute(ATTRIBUTES.footnoteIndex, "7", items[0]);
            });

            expect(references[0].getAttribute(ATTRIBUTES.footnoteIndex)).toBe("7");

            const viewReference = editor.editing.mapper.toViewElement(references[0]);
            expect(viewReference?.getAttribute(ATTRIBUTES.footnoteIndex)).toBe("7");
        });
    });
});
