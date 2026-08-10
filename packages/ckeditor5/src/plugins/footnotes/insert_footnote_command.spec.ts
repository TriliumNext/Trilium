import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { ATTRIBUTES, COMMANDS, ELEMENTS } from "./constants.js";
import type InsertFootnoteCommand from "./insert_footnote_command.js";
import Footnotes from "./footnotes.js";
import { seedFootnotes } from "../../../test/footnotes-kit.js";

describe("InsertFootnoteCommand", () => {
    let editor: ClassicEditor;
    let command: InsertFootnoteCommand;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Footnotes]);
        command = editor.commands.get(COMMANDS.insertFootnote) as InsertFootnoteCommand;
    });

    function model(): string {
        return getModelData(editor.model, { withoutSelection: true });
    }

    function countOf(elementName: string): number {
        return model().split(`<${elementName}`).length - 1;
    }

    describe("refresh", () => {
        it("is enabled inside a paragraph", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            expect(command.isEnabled).toBe(true);
        });

        it("is disabled inside the footnote section, where a reference is not allowed", () => {
            seedFootnotes(editor, 1);
            const section = editor.model.document.getRoot()?.getChild(1);
            if (!section?.is("element")) {
                throw new Error("Expected a footnote section.");
            }
            editor.model.change((writer) => writer.setSelection(section, "on"));

            expect(command.isEnabled).toBe(false);
        });
    });

    describe("inserting a new footnote", () => {
        it("creates the section, the item and the reference", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.execute(COMMANDS.insertFootnote, { footnoteIndex: 0 });

            expect(countOf(ELEMENTS.footnoteSection)).toBe(1);
            expect(countOf(ELEMENTS.footnoteItem)).toBe(1);
            expect(countOf(ELEMENTS.footnoteReference)).toBe(1);
            expect(countOf(ELEMENTS.footnoteBackLink)).toBe(1);
            expect(model()).toContain(`${ATTRIBUTES.footnoteIndex}="1"`);
        });

        it("defaults to inserting a new footnote when called with no options", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.execute(COMMANDS.insertFootnote);

            expect(countOf(ELEMENTS.footnoteItem)).toBe(1);
        });

        it("reuses the existing section and numbers the second footnote 2", () => {
            seedFootnotes(editor, 1);

            editor.execute(COMMANDS.insertFootnote, { footnoteIndex: 0 });

            expect(countOf(ELEMENTS.footnoteSection)).toBe(1);
            expect(countOf(ELEMENTS.footnoteItem)).toBe(2);
            expect(model()).toContain(`${ATTRIBUTES.footnoteIndex}="2"`);
        });

        it("gives each footnote a distinct id", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.execute(COMMANDS.insertFootnote, { footnoteIndex: 0 });
            editor.execute(COMMANDS.insertFootnote, { footnoteIndex: 0 });

            const ids = [...model().matchAll(new RegExp(`${ATTRIBUTES.footnoteId}="([^"]+)"`, "g"))]
                .map((match) => match[1]);

            expect(new Set(ids).size).toBeGreaterThan(1);
        });
    });

    describe("referencing an existing footnote", () => {
        it("adds a second reference without adding a second item", () => {
            seedFootnotes(editor, 1);

            editor.execute(COMMANDS.insertFootnote, { footnoteIndex: 1 });

            expect(countOf(ELEMENTS.footnoteItem)).toBe(1);
            expect(countOf(ELEMENTS.footnoteReference)).toBe(2);
        });

        it("does nothing when the requested index has no matching footnote", () => {
            seedFootnotes(editor, 1);
            const before = model();

            editor.execute(COMMANDS.insertFootnote, { footnoteIndex: 9 });

            expect(model()).toBe(before);
        });
    });

    it("does nothing when the document has no root", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        const before = model();

        // `getRoot()` returns null for a root name that does not exist; the command must bail
        // rather than throw.
        const originalGetRoot = editor.model.document.getRoot.bind(editor.model.document);
        editor.model.document.getRoot = (() => null) as typeof editor.model.document.getRoot;
        try {
            editor.execute(COMMANDS.insertFootnote, { footnoteIndex: 0 });
        } finally {
            editor.model.document.getRoot = originalGetRoot;
        }

        expect(model()).toBe(before);
    });
});
