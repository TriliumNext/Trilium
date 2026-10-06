import { _getViewData as getViewData, _setModelData as setModelData, ClassicEditor, Code, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import InlineCodeNoSpellcheck from "./inline_code_no_spellcheck.js";

describe("InlineCodeNoSpellcheck", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Code, InlineCodeNoSpellcheck]);
    });

    it("loads the plugin", () => {
        expect(editor.plugins.get(InlineCodeNoSpellcheck)).toBeInstanceOf(InlineCodeNoSpellcheck);
    });

    it("disables spellcheck on inline code in the editing view but not in the data", () => {
        setModelData(editor.model, `<paragraph>foo<$text code="true">bar</$text>baz</paragraph>`);

        expect(getViewData(editor.editing.view, { withoutSelection: true }))
            .toBe(`<p>foo<code spellcheck="false">bar</code>baz</p>`);
        expect(editor.getData()).toBe("<p>foo<code>bar</code>baz</p>");
    });

    it("marks every run of inline code, and nothing else", () => {
        setModelData(editor.model,
            `<paragraph><$text code="true">start</$text> middle <$text code="true">end</$text></paragraph>`);

        expect(getViewData(editor.editing.view, { withoutSelection: true }))
            .toBe(`<p><code spellcheck="false">start</code> middle <code spellcheck="false">end</code></p>`);
        expect(editor.getData()).toBe("<p><code>start</code> middle <code>end</code></p>");
    });

    it("does not add spellcheck to plain text", () => {
        setModelData(editor.model, "<paragraph>plain[]text</paragraph>");

        expect(getViewData(editor.editing.view)).not.toContain("spellcheck");
    });

    // Notes saved before the attribute moved to the editing view, and Markdown that keeps a table
    // as raw HTML, both hand the editor a <code> that may or may not carry spellcheck. Either way
    // the data comes back plain, so re-saving a note stops rewriting its every inline code.
    it("normalizes both spellings of <code> to a plain one in the data", () => {
        editor.setData("<p>hello <code>world</code></p>");
        expect(editor.getData()).toBe("<p>hello <code>world</code></p>");

        editor.setData(`<p>hello <code spellcheck="false">world</code></p>`);
        expect(editor.getData()).toBe("<p>hello <code>world</code></p>");
    });
});
