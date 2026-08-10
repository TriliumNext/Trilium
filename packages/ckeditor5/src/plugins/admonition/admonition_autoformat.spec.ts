import { _getModelData as getModelData, _setModelData as setModelData, Autoformat, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Admonition from "./admonition.js";
import AdmonitionAutoformat from "./admonition_autoformat.js";

/**
 * Type `text` at the current (collapsed) selection one character at a time, the way the autoformat
 * feature expects to observe it — it reacts to the `insertText` that completes the pattern.
 */
function type(editor: ClassicEditor, text: string): void {
    for (const character of text) {
        editor.execute("insertText", { text: character });
    }
}

describe("AdmonitionAutoformat", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Admonition]);
    });

    it("declares Autoformat as a requirement", () => {
        expect(AdmonitionAutoformat.requires).toContain(Autoformat);
    });

    it("turns `!!! tip ` into a tip admonition", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        type(editor, "!!! tip ");

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            `<aside admonitionType="tip"><paragraph></paragraph></aside>`
        );
    });

    it("keeps an unknown type as the admonition's text", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        type(editor, "!!! nonsense ");

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            `<aside admonitionType="note"><paragraph>nonsense </paragraph></aside>`
        );
    });

    it("does nothing without the admonition command", async () => {
        const plain = await createTestEditor([Essentials, Paragraph, Autoformat, AdmonitionAutoformat]);

        expect(plain.commands.get("admonition")).toBeUndefined();

        setModelData(plain.model, "<paragraph>[]</paragraph>");
        type(plain, "!!! tip ");

        expect(getModelData(plain.model, { withoutSelection: true })).toBe("<paragraph>!!! tip </paragraph>");
    });
});
