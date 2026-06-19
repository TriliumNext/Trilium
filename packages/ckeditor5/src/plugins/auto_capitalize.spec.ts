import { _getModelData as getModelData, _setModelData as setModelData, Bold, Code, CodeBlock, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import AutoCapitalize from "./auto_capitalize.js";

describe("AutoCapitalize", () => {
    let editor: Awaited<ReturnType<typeof createTestEditor>>;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Bold, Code, CodeBlock, AutoCapitalize]);
    });

    // Type text the way real keystrokes are processed: the Typing plugin wraps
    // `editor.execute("insertText", …)` in an outer `enqueueChange(buffer.batch, …)`,
    // which defers the command's own insertion. Reproducing that wrapping exercises
    // the plugin exactly as it runs during actual typing.
    const type = (text: string) => {
        const command = editor.commands.get("insertText");
        for (const ch of text) {
            editor.model.enqueueChange(command!.buffer.batch, () => {
                const selection = editor.model.createSelection(editor.model.document.selection.getRanges());
                editor.execute("insertText", { text: ch, selection });
            });
        }
    };

    it("loads the plugin", () => {
        expect(editor.plugins.get(AutoCapitalize)).toBeInstanceOf(AutoCapitalize);
    });

    describe("capitalizes the first letter of a sentence once the word ends", () => {
        it("at the start of a block (only the first word)", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hi there");
            expect(getModelData(editor.model)).toBe("<paragraph>Hi there[]</paragraph>");
        });

        it("after a period and a space", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("one. two now");
            expect(getModelData(editor.model)).toBe("<paragraph>One. Two now[]</paragraph>");
        });

        it("after an exclamation mark", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("wow! yes ok");
            expect(getModelData(editor.model)).toBe("<paragraph>Wow! Yes ok[]</paragraph>");
        });

        it("after a question mark", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("ok? no way");
            expect(getModelData(editor.model)).toBe("<paragraph>Ok? No way[]</paragraph>");
        });

        it("the single-letter word \"i\"", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("i am");
            expect(getModelData(editor.model)).toBe("<paragraph>I am[]</paragraph>");
        });

        it("after a closing quote that follows the punctuation", () => {
            setModelData(editor.model, "<paragraph>He said \"ok.\" []</paragraph>");
            type("go now");
            expect(getModelData(editor.model)).toBe("<paragraph>He said \"ok.\" Go now[]</paragraph>");
        });

        it("when the sentence boundary is far back in a long paragraph", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("word ".repeat(15) + "done. now ok");
            const lead = "Word " + "word ".repeat(14);
            expect(getModelData(editor.model)).toBe(`<paragraph>${lead}done. Now ok[]</paragraph>`);
        });

        it("preserves inline formatting carried by the letter", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.model.change((writer) => writer.setSelectionAttribute("bold", true));
            type("hi x");
            expect(editor.getData()).toContain("<strong>Hi x</strong>");
        });
    });

    describe("only on word end, not while typing", () => {
        it("does not capitalize a word that has not been ended yet", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hello");
            expect(getModelData(editor.model)).toBe("<paragraph>hello[]</paragraph>");
        });

        it("capitalizes as soon as the ending space is typed", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hello");
            expect(getModelData(editor.model)).toBe("<paragraph>hello[]</paragraph>");
            type(" ");
            expect(getModelData(editor.model)).toBe("<paragraph>Hello []</paragraph>");
        });
    });

    describe("when a line break ends the word", () => {
        it("Enter capitalizes the last word of the line", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hello");
            editor.execute("enter");
            expect(getModelData(editor.model)).toBe("<paragraph>Hello</paragraph><paragraph>[]</paragraph>");
        });

        it("Enter capitalizes the first word of a new sentence on the line", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("ok. yes");
            editor.execute("enter");
            expect(getModelData(editor.model)).toBe("<paragraph>Ok. Yes</paragraph><paragraph>[]</paragraph>");
        });

        it("Enter leaves a mid-sentence final word untouched", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hello world");
            editor.execute("enter");
            expect(getModelData(editor.model)).toBe("<paragraph>Hello world</paragraph><paragraph>[]</paragraph>");
        });

        it("Shift+Enter capitalizes the word before the soft break", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hello");
            editor.execute("shiftEnter");
            expect(getModelData(editor.model)).toBe("<paragraph>Hello<softBreak></softBreak>[]</paragraph>");
        });
    });

    describe("undo (matches Word / OneNote autocorrect)", () => {
        it("Ctrl+Z reverts only the capitalization, keeping the typed word", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("is ");
            expect(getModelData(editor.model)).toBe("<paragraph>Is []</paragraph>");

            // First undo: capital -> lowercase, the word and trailing space stay.
            editor.execute("undo");
            expect(getModelData(editor.model)).toBe("<paragraph>is []</paragraph>");

            // Second undo: the typed text is removed.
            editor.execute("undo");
            expect(getModelData(editor.model)).toBe("<paragraph>[]</paragraph>");
        });

        it("Ctrl+Z does not remove the triggering space first", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("i ");
            expect(getModelData(editor.model)).toBe("<paragraph>I []</paragraph>");

            // The capitalization is undone before the space, so the space remains.
            editor.execute("undo");
            expect(getModelData(editor.model)).toBe("<paragraph>i []</paragraph>");
        });

        it("redo re-applies the capitalization", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("is ");
            editor.execute("undo");
            expect(getModelData(editor.model)).toBe("<paragraph>is []</paragraph>");

            editor.execute("redo");
            expect(getModelData(editor.model)).toBe("<paragraph>Is []</paragraph>");
        });
    });

    describe("leaves text untouched", () => {
        it("a word that does not start a sentence", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hello world again");
            expect(getModelData(editor.model)).toBe("<paragraph>Hello world again[]</paragraph>");
        });

        it("a word whose first letter is already uppercase", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("Hi there");
            expect(getModelData(editor.model)).toBe("<paragraph>Hi there[]</paragraph>");
        });

        it("a word that starts with a non-letter", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("123 abc");
            expect(getModelData(editor.model)).toBe("<paragraph>123 abc[]</paragraph>");
        });

        it("multi-character insertions (paste / IME)", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("insertText", { text: "hello " });
            expect(getModelData(editor.model)).toBe("<paragraph>hello []</paragraph>");
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
            type("hello world");
            expect(getModelData(editor.model)).toBe("<codeBlock language=\"plaintext\">hello world[]</codeBlock>");
        });

        it("does not capitalize inline code", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.model.change((writer) => writer.setSelectionAttribute("code", true));
            type("hi x");
            expect(editor.getData()).toContain("<code>hi x</code>");
        });
    });
});
