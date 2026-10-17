import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Essentials,
    Paragraph
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor, pressKey as press } from "../../../test/editor-kit.js";
import { installGlobMock } from "../../../test/globals-test-kit.js";
import ContentEmbed from "../content_embed/content_embed.js";
import Multicolumn from "../multicolumn/multicolumn.js";
import Tabs from "../tabs/tabs.js";

const EMBED = "<contentEmbed boxSize=\"medium\" noteId=\"n1\"></contentEmbed>";

describe("container keyboard shortcuts", () => {

    it("act in the innermost column or tab around the selection", async () => {
        const editor = await createEditor();

        setModelData(editor.model, columns(block(tab("A", p("a[]")), tab("B", p("b"))), p("C")));
        expect(press(editor, "ArrowRight", { ctrlKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(columns(block(tab("B", p("b")), tab("A", p("a[]"))), p("C")));

        setModelData(editor.model, block(tab("A", columns(p("x[]"), p("y"))), tab("B", p("b"))));
        expect(press(editor, "ArrowRight", { ctrlKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(block(tab("A", columns(p("y"), p("x[]"))), tab("B", p("b"))));

        setModelData(editor.model, block(tab("A", columns(p("[x]"), p("y"))), tab("B", p("b"))));
        expect(press(editor, "ArrowRight", { ctrlKey: true })).toBe(true);
        expect(model(editor))
            .toBe(block(tab("A", columns(p(""), p("[x]", "y"))), tab("B", p("b"))));
    });

    it("leave a title to the editor, and move a tabs block selected as a whole", async () => {
        const editor = await createEditor();
        const data = columns(block(tab("[A]", p("a")), tab("B", p("b"))), p("C"));
        setModelData(editor.model, data);
        expect(press(editor, "ArrowRight", { ctrlKey: true })).toBe(false);
        expect(model(editor)).toBe(data);

        const tabs = block(tab("A", p("a")), tab("B", p("b")));
        setModelData(editor.model, columns(`[${tabs}]`, p("C")));
        expect(press(editor, "ArrowRight", { ctrlKey: true })).toBe(true);
        expect(model(editor)).toBe(columns(p(""), `[${tabs}]${p("C")}`));
    });

    it("leave the keys pressed in an embed to the editor of the embed", async () => {
        installGlobMock({ getComponentByEl: () => ({ loadEmbeddedNote: vi.fn() }) });
        const editor = await createTestEditor([Essentials, Paragraph, Multicolumn, ContentEmbed]);
        const data = columns(p("a[]"), EMBED);
        setModelData(editor.model, data);
        const wrapper = editor.editing.view.getDomRoot()?.querySelector(".include-note-wrapper");
        expect(wrapper).toBeInstanceOf(HTMLElement);
        const nestedRoot = document.createElement("div");
        nestedRoot.tabIndex = -1;
        wrapper?.append(nestedRoot);

        const event = new KeyboardEvent("keydown", {
            key: "Enter", ctrlKey: true, bubbles: true, cancelable: true
        });
        nestedRoot.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(model(editor)).toBe(data);
        expect(press(editor, "Enter", { ctrlKey: true })).toBe(true);
    });
});

async function createEditor() {
    return createTestEditor([Essentials, Paragraph, Multicolumn, Tabs]);
}

function model(editor: ClassicEditor) {
    return getModelData(editor.model);
}

/** A paragraph for each of `texts`, in model notation. */
function p(...texts: string[]) {
    return texts.map(text => `<paragraph>${text}</paragraph>`).join("");
}

/** A layout of equal columns that hold the given model content. */
function columns(...contents: string[]) {
    const content = contents.map(inner => `<multicolumnColumn>${inner}</multicolumnColumn>`);
    const ratios = contents.map(() => "1").join("-");
    return `<multicolumnLayout columnRatios="${ratios}">${content.join("")}</multicolumnLayout>`;
}

/** A tabs block in model notation that holds `tabs`. */
function block(...tabs: string[]) {
    return `<tabs>${tabs.join("")}</tabs>`;
}

/** A tab in model notation with the given title and panel content. */
function tab(title: string, panel: string) {
    return `<tab><tabTitle>${title}</tabTitle><tabPanel>${panel}</tabPanel></tab>`;
}
