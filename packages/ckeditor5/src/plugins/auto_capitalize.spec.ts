import {
    _getModelData as getModelData, _setModelData as setModelData,
    Bold, Code, CodeBlock, Essentials, Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import AutoCapitalize from "./auto_capitalize.js";

describe("AutoCapitalize", () => {
    let editor: Awaited<ReturnType<typeof createTestEditor>>;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, Bold, Code, CodeBlock, AutoCapitalize
        ]);
    });

    // Type text the way real keystrokes are processed: the Typing plugin wraps
    // `editor.execute("insertText", …)` in an outer `enqueueChange(buffer.batch, …)`,
    // which defers the command's own insertion. Reproducing that wrapping exercises
    // the plugin exactly as it runs during actual typing.
    const type = (text: string) => {
        const command = editor.commands.get("insertText");
        if (!command) {
            throw new Error("insertText command is not registered");
        }
        for (const ch of text) {
            editor.model.enqueueChange(command.buffer.batch, () => {
                const ranges = editor.model.document.selection.getRanges();
                const selection = editor.model.createSelection(ranges);
                editor.execute("insertText", { text: ch, selection });
            });
        }
    };

    // Assert the model content (with the selection marker) after an action.
    const expectModel = (expected: string) =>
        expect(getModelData(editor.model)).toBe(expected);

    it("loads the plugin", () => {
        expect(editor.plugins.get(AutoCapitalize)).toBeInstanceOf(AutoCapitalize);
    });

    describe("capitalizes the first letter of a sentence once the word ends", () => {
        it("at the start of a block (only the first word)", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hi there");
            expectModel("<paragraph>Hi there[]</paragraph>");
        });

        it("after a period and a space", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("one. two now");
            expectModel("<paragraph>One. Two now[]</paragraph>");
        });

        it("after an exclamation mark", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("wow! yes ok");
            expectModel("<paragraph>Wow! Yes ok[]</paragraph>");
        });

        it("after a question mark", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("ok? no way");
            expectModel("<paragraph>Ok? No way[]</paragraph>");
        });

        it("the single-letter word \"i\"", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("i am");
            expectModel("<paragraph>I am[]</paragraph>");
        });

        it("after a closing quote that follows the punctuation", () => {
            setModelData(editor.model, "<paragraph>He said \"ok.\" []</paragraph>");
            type("go now");
            expectModel("<paragraph>He said \"ok.\" Go now[]</paragraph>");
        });

        it("treating a non-text inline element as a word break", () => {
            setModelData(editor.model, "<paragraph>Done.<softBreak></softBreak>now[]</paragraph>");
            type(" ");
            expectModel("<paragraph>Done.<softBreak></softBreak>Now []</paragraph>");
        });

        it("when the sentence boundary is far back in a long paragraph", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("word ".repeat(15) + "done. now ok");
            const lead = "Word " + "word ".repeat(14);
            expectModel(`<paragraph>${lead}done. Now ok[]</paragraph>`);
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
            expectModel("<paragraph>hello[]</paragraph>");
        });

        it("capitalizes as soon as the ending space is typed", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hello");
            expectModel("<paragraph>hello[]</paragraph>");
            type(" ");
            expectModel("<paragraph>Hello []</paragraph>");
        });
    });

    describe("when a line break ends the word", () => {
        it("Enter capitalizes the last word of the line", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hello");
            editor.execute("enter");
            expectModel("<paragraph>Hello</paragraph><paragraph>[]</paragraph>");
        });

        it("Enter capitalizes the first word of a new sentence on the line", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("ok. yes");
            editor.execute("enter");
            expectModel("<paragraph>Ok. Yes</paragraph><paragraph>[]</paragraph>");
        });

        it("Enter leaves a mid-sentence final word untouched", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hello world");
            editor.execute("enter");
            expectModel("<paragraph>Hello world</paragraph><paragraph>[]</paragraph>");
        });

        it("Shift+Enter capitalizes the word before the soft break", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hello");
            editor.execute("shiftEnter");
            expectModel("<paragraph>Hello<softBreak></softBreak>[]</paragraph>");
        });

        it("Enter on an empty line does nothing", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("enter");
            expectModel("<paragraph></paragraph><paragraph>[]</paragraph>");
        });
    });

    describe("undo (matches Word / OneNote autocorrect)", () => {
        it("Ctrl+Z reverts only the capitalization, keeping the typed word", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("is ");
            expectModel("<paragraph>Is []</paragraph>");

            // First undo: capital -> lowercase, the word and trailing space stay.
            editor.execute("undo");
            expectModel("<paragraph>is []</paragraph>");

            // Second undo: the typed text is removed.
            editor.execute("undo");
            expectModel("<paragraph>[]</paragraph>");
        });

        it("Ctrl+Z does not remove the triggering space first", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("i ");
            expectModel("<paragraph>I []</paragraph>");

            // The capitalization is undone before the space, so the space remains.
            editor.execute("undo");
            expectModel("<paragraph>i []</paragraph>");
        });

        it("redo re-applies the capitalization", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("is ");
            editor.execute("undo");
            expectModel("<paragraph>is []</paragraph>");

            editor.execute("redo");
            expectModel("<paragraph>Is []</paragraph>");
        });
    });

    describe("leaves text untouched", () => {
        it("a word that does not start a sentence", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("hello world again");
            expectModel("<paragraph>Hello world again[]</paragraph>");
        });

        it("a word whose first letter is already uppercase", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("Hi there");
            expectModel("<paragraph>Hi there[]</paragraph>");
        });

        it("a word that starts with a non-letter", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("123 abc");
            expectModel("<paragraph>123 abc[]</paragraph>");
        });

        it("multi-character insertions (paste / IME)", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("insertText", { text: "hello " });
            expectModel("<paragraph>hello []</paragraph>");
        });

        it("when the insertion has empty text", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("insertText", { text: "" });
            expectModel("<paragraph>[]</paragraph>");
        });

        it("when the command is executed without options", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("insertText");
            expectModel("<paragraph>[]</paragraph>");
        });
    });

    describe("respects case-sensitive contexts", () => {
        it("does not capitalize inside a code block", () => {
            setModelData(editor.model, "<codeBlock language=\"plaintext\">[]</codeBlock>");
            type("hello world");
            expectModel("<codeBlock language=\"plaintext\">hello world[]</codeBlock>");
        });

        it("does not capitalize inline code", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.model.change((writer) => writer.setSelectionAttribute("code", true));
            type("hi x");
            expect(editor.getData()).toContain("<code>hi x</code>");
        });
    });
});
