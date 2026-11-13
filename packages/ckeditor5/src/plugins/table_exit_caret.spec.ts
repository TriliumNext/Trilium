import {
    _getModelData as getModelData, _setModelData as setModelData, type Editor, Essentials,
    Paragraph, Table, ViewDocumentDomEventData
} from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import TableExitCaret from "./table_exit_caret.js";

const ROWS = "<tableRow><tableCell><paragraph>a</paragraph></tableCell>"
    + "<tableCell><paragraph>b</paragraph></tableCell></tableRow>"
    + "<tableRow><tableCell><paragraph>c</paragraph></tableCell>"
    + "<tableCell><paragraph>d</paragraph></tableCell></tableRow>";

async function createEditor(data: string) {
    const editor = await createTestEditor([ Essentials, Paragraph, Table, TableExitCaret ]);
    editor.editing.view.focus();
    setModelData(editor.model, data);
    return editor;
}

function pressArrow(editor: Editor, keyCode: number, shiftKey = false) {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, shiftKey });
    Object.defineProperty(event, "keyCode", { value: keyCode });
    editor.editing.view.getDomRoot()?.dispatchEvent(event);
}

/** Types `text`, which the editor inserts at once since the browser does not. */
function type(editor: Editor, text: string) {
    const view = editor.editing.view;
    const domEvent = new Event("beforeinput", { cancelable: true });
    domEvent.preventDefault();
    view.document.fire("insertText", new ViewDocumentDomEventData(view, domEvent, { text }));
}

function getFakeCaret(editor: Editor) {
    return editor.model.document.selection.getAttribute("widget-type-around");
}

describe("TableExitCaret", () => {
    it("leaves a table with Down onto the fake caret after it, where typing adds a paragraph",
        async () => {
        const editor = await createEditor(
            `<paragraph>x</paragraph><table>${ROWS.replace(">d<", ">d[]<")}</table>`);
        pressArrow(editor, 40);
        expect(getFakeCaret(editor)).toBe("after");
        type(editor, "y");
        expect(getModelData(editor.model)).toBe(
            `<paragraph>x</paragraph><table>${ROWS}</table><paragraph>y[]</paragraph>`);
    });

    it("leaves a table with Up onto the fake caret before it, and moves on from there",
        async () => {
        const editor = await createEditor(
            `<table>${ROWS.replace(">a<", ">[]a<")}</table><paragraph>x</paragraph>`);
        pressArrow(editor, 38);
        expect(getFakeCaret(editor)).toBe("before");

        setModelData(editor.model,
            `<table>${ROWS.replace(">d<", ">d[]<")}</table><paragraph>x</paragraph>`);
        pressArrow(editor, 40);
        expect(getFakeCaret(editor)).toBe("after");
        pressArrow(editor, 40);
        expect(getModelData(editor.model)).toBe(`<table>${ROWS}</table><paragraph>[]x</paragraph>`);
    });

    it("leaves the other moves alone", async () => {
        const editor = await createEditor(`<table>${ROWS.replace(">a<", ">a[]<")}</table>`);
        pressArrow(editor, 40);
        expect(getModelData(editor.model)).toContain("<paragraph>[]c</paragraph>");
        expect(getFakeCaret(editor)).toBeUndefined();
        await Promise.resolve();
        const table = editor.model.document.getRoot()?.getChild(0);
        editor.model.change((writer) => writer.setSelection(table as never, "on"));
        expect(getFakeCaret(editor)).toBeUndefined();

        setModelData(editor.model, `<table>${ROWS.replace(">d<", ">d[]<")}</table>`);
        pressArrow(editor, 40, true);
        expect(getFakeCaret(editor)).toBeUndefined();
    });
});
