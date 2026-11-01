import { ClassicEditor, Essentials, List, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { ATTRIBUTES, ELEMENTS } from "./constants.js";
import Footnotes from "./footnotes.js";

describe("footnote schema", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, List, Footnotes]);
    });

    it("registers every footnote element", () => {
        const schema = editor.model.schema;

        for (const name of Object.values(ELEMENTS)) {
            expect(schema.isRegistered(name)).toBe(true);
        }
    });

    it("allows the section in the root, and items only within the section", () => {
        const schema = editor.model.schema;

        expect(schema.checkChild(["$root"], ELEMENTS.footnoteSection)).toBe(true);
        expect(schema.checkChild(["$root", ELEMENTS.footnoteSection], ELEMENTS.footnoteItem)).toBe(true);
        expect(schema.checkChild(["$root", ELEMENTS.footnoteSection, ELEMENTS.footnoteItem], ELEMENTS.footnoteContent)).toBe(true);
        expect(schema.checkChild(["$root", ELEMENTS.footnoteSection, ELEMENTS.footnoteItem], ELEMENTS.footnoteBackLink)).toBe(true);
    });

    it("allows a reference wherever text is allowed", () => {
        expect(editor.model.schema.checkChild(["$root", "paragraph"], ELEMENTS.footnoteReference)).toBe(true);
    });

    it("marks the section, item and reference as objects, and the back link as unselectable", () => {
        const schema = editor.model.schema;

        expect(schema.isObject(ELEMENTS.footnoteSection)).toBe(true);
        expect(schema.isObject(ELEMENTS.footnoteItem)).toBe(true);
        expect(schema.isObject(ELEMENTS.footnoteReference)).toBe(true);
        expect(schema.isInline(ELEMENTS.footnoteReference)).toBe(true);
        expect(schema.isSelectable(ELEMENTS.footnoteBackLink)).toBe(false);
    });

    it("declares the id and index attributes on items and references", () => {
        const schema = editor.model.schema;

        expect(schema.checkAttribute([ELEMENTS.footnoteItem], ATTRIBUTES.footnoteId)).toBe(true);
        expect(schema.checkAttribute([ELEMENTS.footnoteItem], ATTRIBUTES.footnoteIndex)).toBe(true);
        expect(schema.checkAttribute([ELEMENTS.footnoteReference], ATTRIBUTES.footnoteId)).toBe(true);
        expect(schema.checkAttribute([ELEMENTS.footnoteReference], ATTRIBUTES.footnoteIndex)).toBe(true);
    });

    describe("the child check", () => {
        it("forbids nesting a footnote section inside footnote content", () => {
            const allowed = editor.model.schema.checkChild(
                ["$root", ELEMENTS.footnoteSection, ELEMENTS.footnoteItem, ELEMENTS.footnoteContent],
                ELEMENTS.footnoteSection
            );

            expect(allowed).toBe(false);
        });

        it("forbids list items inside footnote content", () => {
            const allowed = editor.model.schema.checkChild(
                ["$root", ELEMENTS.footnoteSection, ELEMENTS.footnoteItem, ELEMENTS.footnoteContent],
                "listItem"
            );

            expect(allowed).toBe(false);
        });

        it("still allows paragraphs inside footnote content", () => {
            const allowed = editor.model.schema.checkChild(
                ["$root", ELEMENTS.footnoteSection, ELEMENTS.footnoteItem, ELEMENTS.footnoteContent],
                "paragraph"
            );

            expect(allowed).toBe(true);
        });
    });
});
