import { _setModelData as setModelData, _getViewData as getViewData, ClassicEditor, Code, Essentials, Paragraph } from "ckeditor5";
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

    it("renders inline code with spellcheck=false in the editing view", () => {
        setModelData(editor.model, "<paragraph>foo<$text code=\"true\">bar</$text>baz</paragraph>");
        const viewData = getViewData(editor.editing.view);
        expect(viewData).toContain("spellcheck=\"false\"");
        expect(viewData).toContain("<code");
    });

    it("renders inline code with spellcheck=false in the output data", () => {
        setModelData(editor.model, "<paragraph>foo<$text code=\"true\">bar</$text>baz</paragraph>");
        const data = editor.getData();
        expect(data).toContain("spellcheck=\"false\"");
        expect(data).toContain("<code");
    });

    it("does not add spellcheck=false to non-code text", () => {
        setModelData(editor.model, "<paragraph>plain[]text</paragraph>");
        const viewData = getViewData(editor.editing.view);
        expect(viewData).not.toContain("spellcheck");
    });

    it("round-trips spellcheck=false through setData/getData", () => {
        editor.setData("<p>hello <code>world</code></p>");
        const data = editor.getData();
        expect(data).toContain("spellcheck=\"false\"");
        expect(data).toContain("<code");
    });

    it("applies spellcheck=false to code text adjacent to plain text", () => {
        setModelData(editor.model,
            "<paragraph><$text code=\"true\">start</$text> middle <$text code=\"true\">end</$text></paragraph>");
        const data = editor.getData();
        const matches = data.match(/spellcheck="false"/g);
        expect(matches).not.toBeNull();
        expect(matches?.length).toBeGreaterThanOrEqual(1);
    });
});
