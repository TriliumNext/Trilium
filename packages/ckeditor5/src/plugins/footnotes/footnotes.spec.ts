import { _getModelData as getModelData, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { ELEMENTS } from "./constants.js";
import FootnoteEditing from "./footnote_editing.js";
import FootnoteUI from "./footnote_ui.js";
import Footnotes from "./footnotes.js";
import { seedFootnotes } from "../../../test/footnotes-kit.js";

describe("Footnotes", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Footnotes]);
    });

    it("loads the glue plugin and its editing/UI parts", () => {
        expect(editor.plugins.get(Footnotes)).toBeInstanceOf(Footnotes);
        expect(editor.plugins.get(FootnoteEditing)).toBeInstanceOf(FootnoteEditing);
        expect(editor.plugins.get(FootnoteUI)).toBeInstanceOf(FootnoteUI);
    });

    it("declares its plugin name and requirements", () => {
        expect(Footnotes.pluginName).toBe("Footnotes");
        expect(Footnotes.requires).toContain(FootnoteEditing);
        expect(Footnotes.requires).toContain(FootnoteUI);
    });

    it("round-trips a footnote through data and back", () => {
        seedFootnotes(editor, 1);

        const data = editor.getData();

        expect(data).toContain(`class="footnote-reference"`);
        expect(data).toContain(`class="footnote-section footnotes"`);
        expect(data).toContain(`class="footnote-item"`);

        editor.setData(data);

        expect(getModelData(editor.model, { withoutSelection: true })).toContain(ELEMENTS.footnoteSection);
        expect(getModelData(editor.model, { withoutSelection: true })).toContain(ELEMENTS.footnoteReference);
    });
});
