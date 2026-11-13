import {
    _getModelData as getModelData, _setModelData as setModelData, CodeBlock, Essentials, Heading,
    Paragraph
} from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import DropDisallowedAttributes from "./drop_disallowed_attributes.js";

describe("DropDisallowedAttributes", () => {
    it("drops the language of a code block that becomes a heading or a paragraph", async () => {
        const editor = await createTestEditor(
            [ Essentials, Paragraph, Heading, CodeBlock, DropDisallowedAttributes ]);
        setModelData(editor.model, "<codeBlock language=\"plaintext\">[]a</codeBlock>");
        editor.execute("heading", { value: "heading2" });
        expect(getModelData(editor.model)).toBe("<heading2>[]a</heading2>");
        editor.execute("codeBlock", { language: "javascript" });
        editor.execute("insertText", { text: "b" });
        editor.execute("paragraph");
        expect(getModelData(editor.model)).toBe("<paragraph>b[]a</paragraph>");
    });
});
