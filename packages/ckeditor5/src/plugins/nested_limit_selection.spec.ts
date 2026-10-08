import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Essentials,
    Image,
    ImageCaption,
    type ModelElement,
    Paragraph,
    Table
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import Multicolumn from "./multicolumn/multicolumn.js";
import { scopeRange } from "./nested_limit_selection.js";

const CELL = "<tableCell><paragraph>Cell</paragraph></tableCell>";
const TABLE = `<table><tableRow>${CELL}</tableRow></table>`;
const IMAGE = "<imageBlock src=\"a.png\"><caption>Caption</caption></imageBlock>";

function layout(first: string, second = "<paragraph>Other</paragraph>") {
    return "<multicolumnLayout columnRatios=\"1-1\">" +
        `<multicolumnColumn>${first}</multicolumnColumn>` +
        `<multicolumnColumn>${second}</multicolumnColumn>` +
    "</multicolumnLayout>";
}

describe("NestedLimitSelection", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, Table, Image, ImageCaption, Multicolumn
        ]);
    });

    /** Selects from `startPath` to `endPath` through scopeRange() and returns the model data. */
    function select(startPath: number[], endPath: number[]) {
        const model = editor.model;
        const root = model.document.getRoot() as ModelElement;
        const range = model.createRange(
            model.createPositionFromPath(root, startPath),
            model.createPositionFromPath(root, endPath)
        );
        model.change(writer => writer.setSelection(scopeRange(model, range)));
        return getModelData(model);
    }

    describe("scopeRange", () => {
        it("widens an end inside a table only to the table in the column", () => {
            setModelData(editor.model, layout(`<paragraph>Text</paragraph>${TABLE}`));

            expect(select([0, 0, 0, 2], [0, 0, 1, 0, 0, 0, 2])).toBe(layout(
                `<paragraph>Te[xt</paragraph>${TABLE}]`
            ));
        });

        it("widens a start inside an image caption only to the image", () => {
            setModelData(editor.model, layout(`${IMAGE}<paragraph>Text</paragraph>`));

            expect(select([0, 0, 0, 0, 3], [0, 0, 1, 2])).toBe(layout(
                `[${IMAGE}<paragraph>Te]xt</paragraph>`
            ));
        });

        it("widens an end inside a nested layout only to that layout", () => {
            const inner = layout("<paragraph>A</paragraph>", "<paragraph>B</paragraph>");
            setModelData(editor.model, layout(`<paragraph>Text</paragraph>${inner}`));

            expect(select([0, 0, 0, 2], [0, 0, 1, 1, 0, 1])).toBe(layout(
                `<paragraph>Te[xt</paragraph>${inner}]`
            ));
        });

        it("leaves a selection across two columns to select the whole layout", () => {
            setModelData(editor.model, layout("<paragraph>Text</paragraph>"));

            expect(select([0, 0, 0, 2], [0, 1, 0, 2]))
                .toBe(`[${layout("<paragraph>Text</paragraph>")}]`);
        });

        it("matches CKEditor outside any column and keeps a collapsed range", () => {
            setModelData(editor.model, `<paragraph>Text</paragraph>${TABLE}`);

            expect(select([0, 2], [1, 0, 0, 0, 2]))
                .toBe(`<paragraph>Te[xt</paragraph>${TABLE}]`);
            expect(select([0, 2], [0, 2])).toBe(`<paragraph>Te[]xt</paragraph>${TABLE}`);
        });
    });

    it("keeps a page selection inside its column, so a cut keeps the layout", async () => {
        editor.setData(
            "<section class=\"trilium-multicolumn-layout\" data-trilium-column-ratios=\"1-1\">" +
                "<section><p>Text</p><figure class=\"table\"><table><tbody><tr><td>Cell</td></tr>" +
                    "</tbody></table></figure></section>" +
                "<section><p>Other</p></section>" +
            "</section>"
        );
        editor.editing.view.focus();
        const root = editor.editing.view.getDomRoot();
        const text = root?.querySelector(".trilium-multicolumn-layout > section > p")?.firstChild;
        const cellText = findTextNode(root?.querySelector(".trilium-multicolumn-layout td"));
        expect(text && cellText).toBeTruthy();

        window.getSelection()?.setBaseAndExtent(text as Node, 1, text as Node, 3);
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(getModelData(editor.model)).toBe(layout(`<paragraph>T[ex]t</paragraph>${TABLE}`));

        window.getSelection()?.setBaseAndExtent(text as Node, 2, cellText as Node, 2);
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(getModelData(editor.model)).toBe(layout(`<paragraph>Te[xt</paragraph>${TABLE}]`));
        editor.model.deleteContent(editor.model.document.selection);
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(layout("<paragraph>Te</paragraph>"));
    });
});

function findTextNode(element: Element | null | undefined) {
    if (!element) {
        return null;
    }
    return document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
}
