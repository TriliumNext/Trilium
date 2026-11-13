import {
    _getModelData as getModelData, _setModelData as setModelData, Autoformat, type ClassicEditor,
    Essentials, Heading, type HeadingCommand, Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { HEADING_OPTIONS } from "../../test/headings-kit.js";
import HeadingLevelOne from "./heading_level_one.js";

describe("HeadingLevelOne", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor(
            [ Essentials, Paragraph, Heading, Autoformat, HeadingLevelOne ],
            { heading: { options: HEADING_OPTIONS } }
        );
    });

    it("keeps an h1 of the content as a heading", () => {
        editor.setData("<h1>Title</h1><h2>Section</h2><p>Body</p>");

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<heading1>Title</heading1><heading2>Section</heading2><paragraph>Body</paragraph>"
        );
        expect(editor.getData()).toBe("<h1>Title</h1><h2>Section</h2><p>Body</p>");
        expect(editor.editing.view.getDomRoot()?.querySelector("h1")?.textContent).toBe("Title");
    });

    it("leaves heading 1 out of the heading command and its autoformat", () => {
        const command = editor.commands.get("heading") as HeadingCommand;
        expect(command.modelElements).not.toContain("heading1");

        setModelData(editor.model, "<paragraph>#[]</paragraph>");
        editor.execute("insertText", { text: " " });
        expect(getModelData(editor.model)).toBe("<paragraph># []</paragraph>");
    });

    it("turns the empty block after a heading 1 into a paragraph on enter", () => {
        setModelData(editor.model, "<heading1>Title[]</heading1>");
        editor.execute("enter");
        expect(getModelData(editor.model)).toBe("<heading1>Title</heading1><paragraph>[]</paragraph>");

        setModelData(editor.model, "<heading1>Ti[]tle</heading1>");
        editor.execute("enter");
        expect(getModelData(editor.model)).toBe("<heading1>Ti</heading1><heading1>[]tle</heading1>");
    });
});
