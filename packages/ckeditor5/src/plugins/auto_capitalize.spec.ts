import { _getModelData as getModelData, _setModelData as setModelData, Code, CodeBlock, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import AutoCapitalize from "./auto_capitalize.js";

describe("AutoCapitalize", () => {
    let editor: Awaited<ReturnType<typeof createTestEditor>>;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Code, CodeBlock, AutoCapitalize]);
    });

    it("loads the plugin", () => {
        expect(editor.plugins.get(AutoCapitalize)).toBeInstanceOf(AutoCapitalize);
    });

    describe("capitalizes the first letter of a sentence", () => {
        it("at the start of a block", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("insertText", { text: "h" });
            expect(getModelData(editor.model)).toBe("<paragraph>H[]</paragraph>");
        });

        it("after a period and a space", () => {
            setModelData(editor.model, "<paragraph>Hello world. []</paragraph>");
            editor.execute("insertText", { text: "w" });
            expect(getModelData(editor.model)).toBe("<paragraph>Hello world. W[]</paragraph>");
        });

        it("after an exclamation mark", () => {
            setModelData(editor.model, "<paragraph>Wow! []</paragraph>");
            editor.execute("insertText", { text: "n" });
            expect(getModelData(editor.model)).toBe("<paragraph>Wow! N[]</paragraph>");
        });

        it("after a closing quote following the punctuation", () => {
            setModelData(editor.model, "<paragraph>He said \"ok.\" []</paragraph>");
            editor.execute("insertText", { text: "t" });
            expect(getModelData(editor.model)).toBe("<paragraph>He said \"ok.\" T[]</paragraph>");
        });

        it("treating a non-text inline element as a word break", () => {
            setModelData(editor.model, "<paragraph>Done.<softBreak></softBreak>[]</paragraph>");
            editor.execute("insertText", { text: "n" });
            expect(getModelData(editor.model)).toBe("<paragraph>Done.<softBreak></softBreak>N[]</paragraph>");
        });

        it("after a sentence end far beyond the lookbehind window in a long paragraph", () => {
            const lead = "word ".repeat(20);
            setModelData(editor.model, `<paragraph>${lead}done. []</paragraph>`);
            editor.execute("insertText", { text: "n" });
            expect(getModelData(editor.model)).toBe(`<paragraph>${lead}done. N[]</paragraph>`);
        });
    });

    describe("leaves text untouched", () => {
        it("in the middle of a sentence", () => {
            setModelData(editor.model, "<paragraph>Hello []</paragraph>");
            editor.execute("insertText", { text: "w" });
            expect(getModelData(editor.model)).toBe("<paragraph>Hello w[]</paragraph>");
        });

        it("when the letter is already uppercase", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("insertText", { text: "H" });
            expect(getModelData(editor.model)).toBe("<paragraph>H[]</paragraph>");
        });

        it("for non-letter characters", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("insertText", { text: "1" });
            expect(getModelData(editor.model)).toBe("<paragraph>1[]</paragraph>");
        });

        it("for multi-character insertions (paste / IME)", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("insertText", { text: "hello" });
            expect(getModelData(editor.model)).toBe("<paragraph>hello[]</paragraph>");
        });

        it("when the insertion has empty text", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("insertText", { text: "" });
            expect(getModelData(editor.model)).toBe("<paragraph>[]</paragraph>");
        });

        it("when the command is executed without options", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("insertText");
            expect(getModelData(editor.model)).toBe("<paragraph>[]</paragraph>");
        });
    });

    describe("respects case-sensitive contexts", () => {
        it("does not capitalize inside a code block", () => {
            setModelData(editor.model, "<codeBlock language=\"plaintext\">[]</codeBlock>");
            editor.execute("insertText", { text: "h" });
            expect(getModelData(editor.model)).toBe("<codeBlock language=\"plaintext\">h[]</codeBlock>");
        });

        it("does not capitalize inline code", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.model.change((writer) => writer.setSelectionAttribute("code", true));
            editor.execute("insertText", { text: "h" });
            expect(editor.getData()).toContain("<code>h</code>");
        });
    });

    describe("resolves the insertion point", () => {
        it("from an explicit selection", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (!paragraph) {
                throw new Error("missing paragraph");
            }
            const selection = editor.model.createSelection(editor.model.createPositionAt(paragraph, 0));
            editor.execute("insertText", { text: "h", selection });
            expect(editor.getData()).toBe("<p>Hfoo</p>");
        });
    });
});
