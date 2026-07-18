import {
    AttributeEditor as CKEditorAttributeEditor,
    CHAT_INPUT_PLUGINS,
} from "@triliumnext/ckeditor5";
import { _getModelData, _setModelData } from "ckeditor5";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    insertNewBlock,
    isSelectionInCodeBlock,
    outdentListItemAtStart,
} from "./chat_input_editing.js";

// Runs the real CKEditor (our chat plugin set) under happy-dom and asserts the model, so the
// list/code Enter behavior is verified deterministically rather than by hand in the app.
describe("chat input editing", () => {
    let editor: Awaited<ReturnType<typeof CKEditorAttributeEditor.create>>;

    beforeAll(async () => {
        const el = document.createElement("div");
        document.body.appendChild(el);
        editor = await CKEditorAttributeEditor.create(el, {
            extraPlugins: CHAT_INPUT_PLUGINS,
            licenseKey: "GPL",
        });
    });

    afterAll(async () => {
        await editor.destroy();
    });

    describe("insertNewBlock", () => {
        it("splits a non-empty list item into a new item (so lists can be built)", () => {
            _setModelData(
                editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">item[]</paragraph>',
            );
            insertNewBlock(editor);
            expect(
                (_getModelData(editor.model).match(/listItemId=/g) ?? [])
                    .length,
            ).toBe(2);
        });

        it("leaves the list from an empty item (so the list can be exited)", () => {
            _setModelData(
                editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">[]</paragraph>',
            );
            insertNewBlock(editor);
            expect(_getModelData(editor.model)).not.toContain("listItemId");
        });

        it("adds a newline (soft break) inside a code block", () => {
            _setModelData(
                editor.model,
                '<codeBlock language="plaintext">foo[]</codeBlock>',
            );
            insertNewBlock(editor);
            const data = _getModelData(editor.model);
            expect(data).toContain("softBreak");
            expect(data).toContain("codeBlock");
        });

        it("keeps a single blank line in a code block instead of leaving (only exits after two)", () => {
            _setModelData(
                editor.model,
                '<codeBlock language="plaintext">foo<softBreak></softBreak>[]</codeBlock>',
            );
            insertNewBlock(editor);
            const data = _getModelData(editor.model);
            // Still in the block (no paragraph created), with a second line break — so a blank line can precede more code.
            expect(data).toContain("codeBlock");
            expect(data).not.toContain("<paragraph>");
            expect((data.match(/<softBreak>/g) ?? []).length).toBe(2);
        });

        it("leaves the code block after two trailing blank lines (so the fence can be exited)", () => {
            _setModelData(
                editor.model,
                '<codeBlock language="plaintext">foo<softBreak></softBreak><softBreak></softBreak>[]</codeBlock>',
            );
            insertNewBlock(editor);
            const data = _getModelData(editor.model);
            // Caret ends up in a fresh paragraph after the block, which keeps its content but drops the blank lines.
            expect(data).toContain("<paragraph>[]</paragraph>");
            expect(data).toContain("foo</codeBlock>");
            expect(data).not.toContain("softBreak");
        });

        it("keeps a single blank line in a quote instead of leaving (only exits after two)", () => {
            _setModelData(
                editor.model,
                "<blockQuote><paragraph>quoted</paragraph><paragraph>[]</paragraph></blockQuote>",
            );
            insertNewBlock(editor);
            const data = _getModelData(editor.model);
            // Caret stays inside the quote (before the closing tag), with a second blank line added.
            expect(data).toContain("[]</paragraph></blockQuote>");
            expect(data).not.toContain("</blockQuote><paragraph>[]");
        });

        it("leaves a block quote after two trailing blank lines (so the quote can be exited)", () => {
            _setModelData(
                editor.model,
                "<blockQuote><paragraph>quoted</paragraph><paragraph></paragraph><paragraph>[]</paragraph></blockQuote>",
            );
            insertNewBlock(editor);
            const data = _getModelData(editor.model);
            // Both empty blocks are consumed and the caret lands in a paragraph after the quote.
            expect(data).toContain("</blockQuote><paragraph>[]</paragraph>");
            expect(data).toContain("quoted");
            expect(data).not.toContain("<paragraph></paragraph>");
        });

        it("splits a plain paragraph into a new paragraph", () => {
            _setModelData(editor.model, "<paragraph>hello[]</paragraph>");
            insertNewBlock(editor);
            expect(
                (_getModelData(editor.model).match(/<paragraph/g) ?? []).length,
            ).toBe(2);
        });
    });

    describe("isSelectionInCodeBlock", () => {
        it("is true inside a code block and false elsewhere", () => {
            _setModelData(
                editor.model,
                '<codeBlock language="plaintext">foo[]</codeBlock>',
            );
            expect(isSelectionInCodeBlock(editor)).toBe(true);
            _setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            expect(isSelectionInCodeBlock(editor)).toBe(false);
        });
    });

    describe("outdentListItemAtStart", () => {
        it("leaves the list from the start of an item (instead of merging into the previous one)", () => {
            _setModelData(
                editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">[]item</paragraph>',
            );
            expect(outdentListItemAtStart(editor)).toBe(true);
            expect(_getModelData(editor.model)).not.toContain("listItemId");
        });

        it("does nothing when the caret is not at the start of the item", () => {
            _setModelData(
                editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">it[]em</paragraph>',
            );
            expect(outdentListItemAtStart(editor)).toBe(false);
            expect(_getModelData(editor.model)).toContain("listItemId");
        });

        it("does nothing outside a list", () => {
            _setModelData(editor.model, "<paragraph>[]text</paragraph>");
            expect(outdentListItemAtStart(editor)).toBe(false);
        });
    });
});
