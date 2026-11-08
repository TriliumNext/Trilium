import {
    _getModelData as getModelData, _setModelData as setModelData, BlockQuote, Essentials,
    Paragraph, Table, TableCaption, type ViewDocumentClipboardOutputEvent
} from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import Admonition from "./admonition/admonition.js";
import Collapsible from "./collapsible/collapsible.js";
import DeleteBlocks from "./delete_blocks.js";

describe("DeleteBlocks", () => {
    it("deletes the blocks that the handle drags, with the caret on the next block", async () => {
        const editor = await createEditor();
        const note = (content: string) => `<aside admonitionType="note">${content}</aside>`;
        const cell = (text: string) => `<tableCell><paragraph>${text}</paragraph></tableCell>`;
        const cases = [ {
            before: "<paragraph>one</paragraph><paragraph>tw[]o</paragraph>"
                + "<paragraph>three</paragraph>",
            after: "<paragraph>one</paragraph><paragraph>[]three</paragraph>"
        }, {
            before: "<paragraph>o[ne</paragraph><paragraph>tw]o</paragraph>"
                + "<paragraph>three</paragraph>",
            after: "<paragraph>[]three</paragraph>"
        }, {
            // The last block leaves the caret at the end of the block before it.
            before: "<paragraph>one</paragraph><paragraph>tw[]o</paragraph>",
            after: "<paragraph>one[]</paragraph>"
        }, {
            before: "<details open=\"true\"><summary>Ti[]tle</summary>"
                + "<paragraph>body</paragraph></details><paragraph>after</paragraph>",
            after: "<paragraph>[]after</paragraph>"
        }, {
            before: `${note("<paragraph>on[]e</paragraph>")}<paragraph>after</paragraph>`,
            after: "<paragraph>[]after</paragraph>"
        }, {
            before: "<blockQuote><paragraph>on[]e</paragraph><paragraph>two</paragraph>"
                + "</blockQuote>",
            after: "<blockQuote><paragraph>[]two</paragraph></blockQuote>"
        }, {
            before: `<paragraph>before</paragraph><table><tableRow>[${cell("a")}][${cell("b")}]`
                + "</tableRow></table><paragraph>after</paragraph>",
            after: "<paragraph>before</paragraph><paragraph>[]after</paragraph>"
        }, {
            // An emptied table cell or root gets an empty paragraph.
            before: `<table><tableRow>${cell("ce[]ll")}</tableRow></table>`,
            after: "<table><tableRow><tableCell><paragraph>[]</paragraph></tableCell>"
                + "</tableRow></table>"
        }, {
            before: "<paragraph>o[ne</paragraph><paragraph>tw]o</paragraph>",
            after: "<paragraph>[]</paragraph>"
        } ];

        for (const { before, after } of cases) {
            setModelData(editor.model, before);
            editor.execute("deleteBlocks");
            expect(getModelData(editor.model)).toBe(after);
        }
    });

    it("deletes the range that a copy returned, wherever the caret is now", async () => {
        const editor = await createEditor();
        setModelData(editor.model, "<paragraph>one</paragraph><paragraph>tw[]o</paragraph>"
            + "<paragraph>three</paragraph>");
        const { range } = editor.execute("copyBlocks");
        const root = editor.model.document.getRoot();
        editor.model.change((writer) => {
            if (root) {
                writer.setSelection(writer.createPositionFromPath(root, [ 0, 1 ]));
            }
        });

        editor.execute("deleteBlocks", range);
        expect(getModelData(editor.model))
            .toBe("<paragraph>one</paragraph><paragraph>[]three</paragraph>");
    });

    it("deletes in one undo step", async () => {
        const editor = await createEditor();
        setModelData(editor.model, "<paragraph>one</paragraph><paragraph>tw[]o</paragraph>"
            + "<paragraph>three</paragraph>");

        editor.execute("deleteBlocks");
        expect(editor.getData()).toBe("<p>one</p><p>three</p>");
        editor.execute("undo");
        expect(editor.getData()).toBe("<p>one</p><p>two</p><p>three</p>");
    });

    it("is enabled only with a selected block, while the editor can be edited", async () => {
        const editor = await createEditor();
        const command = editor.commands.get("deleteBlocks");
        setModelData(editor.model, "<paragraph>o[]ne</paragraph>");
        expect(command?.isEnabled).toBe(true);

        editor.enableReadOnlyMode("spec");
        expect(command?.isEnabled).toBe(false);
        editor.disableReadOnlyMode("spec");
        expect(command?.isEnabled).toBe(true);

        // A caption is in no block.
        setModelData(editor.model, "<table><tableRow><tableCell><paragraph>cell</paragraph>"
            + "</tableCell></tableRow><caption>Cap[]tion</caption></table>");
        expect(command?.isEnabled).toBe(false);
    });
});

describe("CopyBlocksCommand", () => {
    it("serializes the blocks that the handle drags as a copy does, changing nothing", async () => {
        const editor = await createEditor();
        const methods: string[] = [];
        editor.editing.view.document.on<ViewDocumentClipboardOutputEvent>("clipboardOutput",
            (_evt, data) => methods.push(data.method));
        const cell = (text: string) => `<tableCell><paragraph>${text}</paragraph></tableCell>`;
        const cases = [ {
            before: "<paragraph>one</paragraph><paragraph>tw[]o</paragraph>"
                + "<paragraph>three</paragraph>",
            html: "<p>two</p>",
            text: "two"
        }, {
            before: "<paragraph>o[ne</paragraph><paragraph>tw]o</paragraph>"
                + "<paragraph>three</paragraph>",
            html: "<p>one</p><p>two</p>",
            text: "one\n\ntwo"
        }, {
            before: `<paragraph>before</paragraph><table><tableRow>[${cell("a")}][${cell("b")}]`
                + "</tableRow></table>",
            html: "<table class=\"table\"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>",
            text: "a\n\nb"
        } ];

        for (const { before, html, text } of cases) {
            setModelData(editor.model, before);
            expect(editor.execute("copyBlocks")).toMatchObject({ html, text });
            expect(getModelData(editor.model)).toBe(before);
        }
        expect(methods).toEqual([ "copy", "copy", "copy" ]);

        setModelData(editor.model, cases[1].before, { lastRangeBackward: true });
        editor.execute("copyBlocks");
        expect(editor.model.document.selection.isBackward).toBe(true);
    });

    it("is enabled with a selected block, also while the editor is read-only", async () => {
        const editor = await createEditor();
        const command = editor.commands.get("copyBlocks");
        setModelData(editor.model, "<paragraph>o[]ne</paragraph>");
        expect(command?.isEnabled).toBe(true);

        editor.enableReadOnlyMode("spec");
        expect(command?.isEnabled).toBe(true);

        setModelData(editor.model, "<table><tableRow><tableCell><paragraph>cell</paragraph>"
            + "</tableCell></tableRow><caption>Cap[]tion</caption></table>");
        expect(command?.isEnabled).toBe(false);
    });
});

function createEditor() {
    return createTestEditor([
        Essentials, Paragraph, Table, TableCaption, BlockQuote, Admonition, Collapsible,
        DeleteBlocks
    ]);
}
