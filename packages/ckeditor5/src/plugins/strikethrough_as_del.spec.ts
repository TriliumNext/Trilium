import { _setModelData as setModelData, ClassicEditor, Essentials, Paragraph, Strikethrough } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import StrikethroughAsDel from "./strikethrough_as_del.js";

describe("StrikethroughAsDel", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Strikethrough, StrikethroughAsDel]);
    });

    it("registers the plugin", () => {
        expect(editor.plugins.get(StrikethroughAsDel)).toBeInstanceOf(StrikethroughAsDel);
    });

    it("downcasts strikethrough attribute to <del> instead of <s>", () => {
        setModelData(editor.model, "<paragraph><$text strikethrough=\"true\">hello</$text></paragraph>");
        const data = editor.getData();
        expect(data).toContain("<del>");
        expect(data).not.toContain("<s>");
    });

    it("upcasts <del> from HTML so getData returns <del>", () => {
        editor.setData("<p><del>world</del></p>");
        const data = editor.getData();
        expect(data).toContain("<del>");
    });

    it("upcasts <del> from HTML so the model text node carries the strikethrough attribute", () => {
        editor.setData("<p><del>test</del></p>");
        const root = editor.model.document.getRoot();
        if (!root) {
            throw new Error("Model root not found");
        }
        const paragraph = root.getChild(0);
        if (!paragraph?.is("element")) {
            throw new Error("Paragraph not found");
        }
        // The Strikethrough plugin upcasts <del> to the `strikethrough` model attribute on the text.
        const textNode = paragraph.getChild(0);
        expect(textNode?.is("$text")).toBe(true);
        expect(textNode?.getAttribute("strikethrough")).toBe(true);
    });

    it("produces <del> wrapping when strikethrough spans partial text", () => {
        setModelData(
            editor.model,
            "<paragraph>foo<$text strikethrough=\"true\">bar</$text>baz</paragraph>"
        );
        const data = editor.getData();
        expect(data).toContain("<del>bar</del>");
        expect(data).not.toContain("<s>bar</s>");
    });
});
