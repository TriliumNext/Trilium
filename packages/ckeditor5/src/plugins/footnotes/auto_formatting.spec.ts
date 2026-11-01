import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { seedFootnotes } from "../../../test/footnotes-kit.js";
import { ELEMENTS } from "./constants.js";
import Footnotes from "./footnotes.js";

/**
 * Type `text` at the collapsed selection one character at a time, which is what the autoformat
 * feature observes — it reacts to the `insertText` that completes the pattern.
 */
function type(editor: ClassicEditor, text: string): void {
    for (const character of text) {
        editor.execute("insertText", { text: character });
    }
}

describe("footnote autoformatting", () => {
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

    it("turns `[^1]` into the first footnote", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");

        type(editor, "[^1]");

        expect(countOf(ELEMENTS.footnoteItem)).toBe(1);
        expect(countOf(ELEMENTS.footnoteReference)).toBe(1);
        expect(model()).not.toContain("[^1]");
    });

    it("ignores `[^2]` when no footnote exists yet", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");

        type(editor, "[^2]");

        expect(countOf(ELEMENTS.footnoteItem)).toBe(0);
        expect(model()).toContain("[^2]");
    });

    it("appends a new footnote when the number is one past the end", () => {
        seedFootnotes(editor, 1);

        type(editor, "[^2]");

        expect(countOf(ELEMENTS.footnoteItem)).toBe(2);
    });

    it("references an existing footnote when the number is in range", () => {
        seedFootnotes(editor, 2);

        type(editor, "[^1]");

        expect(countOf(ELEMENTS.footnoteItem)).toBe(2);
        expect(countOf(ELEMENTS.footnoteReference)).toBe(3);
    });

    it("ignores a number past the end of the list", () => {
        seedFootnotes(editor, 1);

        type(editor, "[^9]");

        expect(countOf(ELEMENTS.footnoteItem)).toBe(1);
        expect(model()).toContain("[^9]");
    });

    it("ignores the pattern when the cursor is not at the end of the match", () => {
        // Written with the writer rather than _setModelData, which would read the brackets as
        // selection markers and silently drop the pattern from the text.
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (!paragraph?.is("element")) {
                throw new Error("Expected a paragraph.");
            }
            writer.insertText("[^1]bar", paragraph, 0);
            writer.setSelection(paragraph, "end");
        });

        // The matcher re-runs, but the cursor no longer sits at the end of the `[^1]` run.
        type(editor, "x");

        expect(countOf(ELEMENTS.footnoteItem)).toBe(0);
        expect(model()).toContain("[^1]");
    });

    it("does nothing when the insert command is disabled", () => {
        seedFootnotes(editor, 1);
        const command = editor.commands.get("InsertFootnote");
        if (!command) {
            throw new Error("Command not registered.");
        }
        command.forceDisabled("test");

        type(editor, "[^1]");

        expect(countOf(ELEMENTS.footnoteReference)).toBe(1);
        // Note the matched text is still consumed: the callback returns `undefined` rather than
        // `false` in this branch, and `inlineAutoformatEditing` only skips its deletion step on an
        // explicit `false`. Preserved as-is from the original plugin.
        expect(model()).not.toContain("[^1]");
    });
});
