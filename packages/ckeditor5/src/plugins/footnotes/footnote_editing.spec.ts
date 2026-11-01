import { _getModelData as getModelData, _setModelData as setModelData, Autoformat, ClassicEditor, Essentials, type ModelElement, Paragraph, Widget } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { seedFootnotes, selectInFootnoteContent } from "../../../test/footnotes-kit.js";
import { ATTRIBUTES, COMMANDS, ELEMENTS } from "./constants.js";
import FootnoteEditing from "./footnote_editing.js";
import Footnotes from "./footnotes.js";

describe("FootnoteEditing", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Footnotes]);
    });

    function model(): string {
        return getModelData(editor.model, { withoutSelection: true });
    }

    function countOf(elementName: string): number {
        return model().split(`<${elementName}`).length - 1;
    }

    function indicesOf(elementName: string): Array<string> {
        const pattern = new RegExp(`<${elementName}[^>]*${ATTRIBUTES.footnoteIndex}="([^"]*)"`, "g");
        return [...model().matchAll(pattern)].map((match) => match[1]);
    }

    function fireDelete(): void {
        editor.editing.view.document.fire("delete", {
            direction: "backward",
            unit: "character",
            preventDefault: vi.fn()
        });
    }

    /**
     * Clear a footnote's content and put the collapsed selection in it — the state in which the
     * plugin itself removes the footnote. (Selecting the item instead leaves the removal to
     * CKEditor's default delete handling, which does not renumber.)
     */
    function emptyAndSelect(item: ModelElement): void {
        editor.model.change((writer) => {
            const content = item.getChild(1);
            const paragraph = content?.is("element") ? content.getChild(0) : null;
            if (!paragraph?.is("element")) {
                throw new Error("Footnote item has no content paragraph.");
            }
            writer.remove(writer.createRangeIn(paragraph));
            writer.setSelection(paragraph, 0);
        });
    }

    it("declares its name and requirements", () => {
        expect(FootnoteEditing.pluginName).toBe("FootnotesEditing");
        expect(FootnoteEditing.requires).toContain(Widget);
        expect(FootnoteEditing.requires).toContain(Autoformat);
    });

    it("registers the insert command", () => {
        expect(editor.commands.get(COMMANDS.insertFootnote)).toBeDefined();
    });

    describe("rootElement", () => {
        it("returns the document root", () => {
            expect(editor.plugins.get(FootnoteEditing).rootElement.rootName).toBe("main");
        });

        it("throws when the document has no root", () => {
            const editing = editor.plugins.get(FootnoteEditing);
            const originalGetRoot = editor.model.document.getRoot.bind(editor.model.document);
            editor.model.document.getRoot = (() => null) as typeof editor.model.document.getRoot;

            try {
                expect(() => editing.rootElement).toThrow("Document has no rootElement element.");
            } finally {
                editor.model.document.getRoot = originalGetRoot;
            }
        });
    });

    it("maps a view position inside a reference to the model position beside it", () => {
        const { references } = seedFootnotes(editor, 1);
        const viewReference = editor.editing.mapper.toViewElement(references[0]);
        if (!viewReference) {
            throw new Error("Reference has no view element.");
        }

        // A footnote reference renders as a non-empty widget over an empty model element, so a
        // position inside the view element has to map outside the model element rather than into it.
        const modelPosition = editor.editing.mapper.toModelPosition(
            editor.editing.view.createPositionAt(viewReference, 0)
        );

        expect(modelPosition.parent.is("element", "paragraph")).toBe(true);
    });

    describe("ordering references", () => {
        it("renumbers footnotes so items follow the order their references appear in", () => {
            const { items } = seedFootnotes(editor, 2);

            // Insert a reference to the *second* footnote before the existing ones.
            editor.model.change((writer) => {
                const paragraph = editor.model.document.getRoot()?.getChild(0);
                if (paragraph?.is("element")) {
                    writer.setSelection(paragraph, 0);
                }
            });
            editor.execute(COMMANDS.insertFootnote, { footnoteIndex: 2 });

            // The footnote that is now referenced first must be numbered 1.
            expect(items[1].getAttribute(ATTRIBUTES.footnoteIndex)).toBe("1");
            expect(items[0].getAttribute(ATTRIBUTES.footnoteIndex)).toBe("2");
        });

        it("tolerates a reference whose footnote item does not exist", () => {
            // Loaded content can carry a reference with no matching item; ordering must skip it
            // rather than fail.
            seedFootnotes(editor, 1);
            editor.model.change((writer) => {
                const paragraph = editor.model.document.getRoot()?.getChild(0);
                if (!paragraph?.is("element")) {
                    throw new Error("Expected a paragraph.");
                }
                writer.insert(writer.createElement(ELEMENTS.footnoteReference, {
                    [ATTRIBUTES.footnoteId]: "missing",
                    [ATTRIBUTES.footnoteIndex]: "9"
                }), paragraph, 0);
            });

            expect(countOf(ELEMENTS.footnoteItem)).toBe(1);
            expect(indicesOf(ELEMENTS.footnoteItem)).toEqual(["1"]);
        });

        it("keeps each reference's index in step with its footnote", () => {
            seedFootnotes(editor, 2);

            editor.model.change((writer) => {
                const paragraph = editor.model.document.getRoot()?.getChild(0);
                if (paragraph?.is("element")) {
                    writer.setSelection(paragraph, 0);
                }
            });
            editor.execute(COMMANDS.insertFootnote, { footnoteIndex: 2 });

            const itemIndices = indicesOf(ELEMENTS.footnoteItem);
            const referenceIndices = indicesOf(ELEMENTS.footnoteReference);

            expect(itemIndices).toEqual(["1", "2"]);
            // Three references: the newly inserted one, then the two seeded ones.
            expect(referenceIndices).toEqual(["1", "2", "1"]);
        });
    });

    describe("deleting", () => {
        it("removes an empty footnote and its reference on backspace", () => {
            const { items } = seedFootnotes(editor, 1);
            editor.model.change((writer) => {
                const content = items[0].getChild(1);
                const paragraph = content?.is("element") ? content.getChild(0) : null;
                if (paragraph?.is("element")) {
                    writer.remove(writer.createRangeIn(paragraph));
                    writer.setSelection(paragraph, 0);
                }
            });

            fireDelete();

            expect(countOf(ELEMENTS.footnoteItem)).toBe(0);
            expect(countOf(ELEMENTS.footnoteSection)).toBe(0);
            expect(countOf(ELEMENTS.footnoteReference)).toBe(0);
        });

        it("leaves a non-empty footnote alone", () => {
            const { items } = seedFootnotes(editor, 1);
            selectInFootnoteContent(editor, items[0]);

            fireDelete();

            expect(countOf(ELEMENTS.footnoteItem)).toBe(1);
        });

        it("does nothing when the selection is outside any footnote", () => {
            seedFootnotes(editor, 1);

            fireDelete();

            expect(countOf(ELEMENTS.footnoteItem)).toBe(1);
        });

        it("removes every reference when the whole footnote section is deleted", () => {
            const { section } = seedFootnotes(editor, 2);
            editor.model.change((writer) => writer.setSelection(section, "on"));

            fireDelete();

            expect(countOf(ELEMENTS.footnoteReference)).toBe(0);
        });

        it("renumbers the footnotes after the one that was emptied and removed", () => {
            const { items } = seedFootnotes(editor, 3);
            emptyAndSelect(items[0]);

            fireDelete();

            expect(countOf(ELEMENTS.footnoteItem)).toBe(2);
            // The two survivors renumber to 1 and 2 — this is the case the old
            // `index ?? 0 + i + 1` precedence bug got wrong, leaving both at the same number.
            expect(indicesOf(ELEMENTS.footnoteItem)).toEqual(["1", "2"]);
        });

        it("renumbers correctly when a middle footnote is removed", () => {
            const { items } = seedFootnotes(editor, 3);
            emptyAndSelect(items[1]);

            fireDelete();

            expect(indicesOf(ELEMENTS.footnoteItem)).toEqual(["1", "2"]);
        });

        it("keeps the section when other footnotes remain", () => {
            const { items } = seedFootnotes(editor, 2);
            editor.model.change((writer) => writer.setSelection(items[1], "on"));

            fireDelete();

            expect(countOf(ELEMENTS.footnoteSection)).toBe(1);
            expect(countOf(ELEMENTS.footnoteItem)).toBe(1);
        });

        it("removes an emptied footnote that is not inside a section", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                const item = writer.createElement(ELEMENTS.footnoteItem, {
                    [ATTRIBUTES.footnoteId]: "orphan",
                    [ATTRIBUTES.footnoteIndex]: "1"
                });
                const content = writer.createElement(ELEMENTS.footnoteContent);
                const paragraph = writer.createElement("paragraph");
                writer.insert(paragraph, content, 0);
                writer.insert(content, item, 0);
                writer.insert(item, writer.createPositionAt(root ?? item, "end"));
                writer.setSelection(paragraph, 0);
            });

            fireDelete();

            expect(countOf(ELEMENTS.footnoteItem)).toBe(0);
        });

        it("removes a footnote that is not inside a section", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            const orphan = editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                const item = writer.createElement(ELEMENTS.footnoteItem, {
                    [ATTRIBUTES.footnoteId]: "orphan",
                    [ATTRIBUTES.footnoteIndex]: "1"
                });
                const content = writer.createElement(ELEMENTS.footnoteContent);
                const paragraph = writer.createElement("paragraph");
                writer.insert(paragraph, content, 0);
                writer.insert(content, item, 0);
                writer.insert(item, writer.createPositionAt(root ?? item, "end"));
                writer.setSelection(item, "on");
                return item;
            });

            expect(orphan.findAncestor(ELEMENTS.footnoteSection)).toBeNull();

            fireDelete();

            expect(countOf(ELEMENTS.footnoteItem)).toBe(0);
        });

        it("throws when the selection has no range", () => {
            seedFootnotes(editor, 1);
            const selection = editor.model.document.selection;
            const originalGetLastPosition = selection.getLastPosition.bind(selection);
            selection.getLastPosition = (() => null) as typeof selection.getLastPosition;

            try {
                expect(() => fireDelete()).toThrow("Selection must have at least one range");
            } finally {
                selection.getLastPosition = originalGetLastPosition;
            }
        });
    });
});
