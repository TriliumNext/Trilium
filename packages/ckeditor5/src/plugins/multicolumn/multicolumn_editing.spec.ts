import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Essentials,
    type ModelElement,
    Paragraph,
    Table
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Collapsible from "../collapsible/collapsible.js";
import Tabs from "../tabs/tabs.js";
import { getDefaultRatios } from "./constants.js";
import Multicolumn from "./multicolumn.js";

const TWO_COLUMNS =
    "<section class=\"trilium-multicolumn-layout\" data-trilium-column-ratios=\"1-3\">" +
        "<section><p>First column</p></section>" +
        "<section><p>Second column</p></section>" +
    "</section>";

describe("MulticolumnEditing", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, Table, Collapsible, Tabs, Multicolumn
        ]);
    });

    function model() {
        return getModelData(editor.model, { withoutSelection: true });
    }

    function layoutAt(index: number) {
        const layout = editor.model.document.getRoot()?.getChild(index);
        expect(layout?.is("element", "multicolumnLayout")).toBe(true);
        return layout as ModelElement;
    }

    describe("conversion", () => {
        it("round-trips the saved HTML through the model", () => {
            editor.setData(TWO_COLUMNS);

            expect(model()).toBe(
                "<multicolumnLayout columnRatios=\"1-3\">" +
                    "<multicolumnColumn><paragraph>First column</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph>Second column</paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );
            expect(editor.getData()).toBe(TWO_COLUMNS);
        });

        it("renders a widget with one editable per column and the weights on the widget", () => {
            editor.setData(TWO_COLUMNS);

            const root = editor.editing.view.getDomRoot();
            const widget = root?.querySelector(".trilium-multicolumn-layout");
            expect(widget?.classList.contains("ck-widget")).toBe(true);
            expect(widget?.getAttribute("data-trilium-column-ratios")).toBe("1-3");
            const columns = widget?.querySelectorAll(":scope > section") ?? [];
            expect([...columns].map(column => column.getAttribute("contenteditable")))
                .toEqual(["true", "true"]);
            expect(columns[0]?.getAttribute("aria-label")).toContain("Column");
        });

        it("updates the weights on the widget in place", () => {
            editor.setData(TWO_COLUMNS);
            const root = editor.editing.view.getDomRoot();
            const widget = root?.querySelector(".trilium-multicolumn-layout");

            editor.model.change(writer => writer.setAttribute("columnRatios", "3-1", layoutAt(0)));

            expect(root?.querySelector(".trilium-multicolumn-layout")).toBe(widget);
            expect(widget?.getAttribute("data-trilium-column-ratios")).toBe("3-1");
        });

        it("reads a plain section outside a layout as something else", () => {
            editor.setData("<section><p>Text</p></section>");

            expect(model()).toBe("<paragraph>Text</paragraph>");
        });
    });

    describe("schema", () => {
        it("allows a layout at the top level, in a column, a tab panel and a collapsible", () => {
            const schema = editor.model.schema;
            setModelData(editor.model,
                "<paragraph>[]</paragraph>" +
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                "</multicolumnLayout>" +
                "<tabs><tab>" +
                    "<tabTitle>T</tabTitle><tabPanel><paragraph></paragraph></tabPanel>" +
                "</tab></tabs>" +
                "<details><summary>S</summary><paragraph></paragraph></details>"
            );
            const root = editor.model.document.getRoot() as ModelElement;
            const column = layoutAt(1).getChild(0) as ModelElement;
            const tab = (root.getChild(2) as ModelElement).getChild(0) as ModelElement;
            const tabPanel = tab.getChild(1) as ModelElement;
            const details = root.getChild(3) as ModelElement;

            for (const parent of [root, column, tabPanel, details]) {
                expect(schema.checkChild(parent, "multicolumnLayout")).toBe(true);
            }
            expect(schema.checkChild(root, "multicolumnColumn")).toBe(false);
            expect(schema.checkChild(layoutAt(1), "paragraph")).toBe(false);
        });
    });

    describe("post-fixer", () => {
        it("removes a layout without columns", () => {
            editor.setData("<p>Before</p><section class=\"trilium-multicolumn-layout\"></section>");

            expect(model()).toBe("<paragraph>Before</paragraph>");
        });

        it("adds an empty column to a layout with one column", () => {
            editor.setData(
                "<section class=\"trilium-multicolumn-layout\">" +
                    "<section><p>Only</p></section>" +
                "</section>"
            );

            expect(model()).toBe(
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    "<multicolumnColumn><paragraph>Only</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );
        });

        it("merges the columns past the fourth into the fourth, in order", () => {
            const columns = ["A", "B", "C", "D", "E", "F"]
                .map(text => `<section><p>${text}</p></section>`)
                .join("");
            editor.setData(`<section class="trilium-multicolumn-layout">${columns}</section>`);

            expect(model()).toBe(
                "<multicolumnLayout columnRatios=\"1-1-1-1\">" +
                    "<multicolumnColumn><paragraph>A</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph>B</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph>C</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn>" +
                        "<paragraph>D</paragraph><paragraph>E</paragraph><paragraph>F</paragraph>" +
                    "</multicolumnColumn>" +
                "</multicolumnLayout>"
            );
        });

        it("merges columns past the fourth without adding blank lines for empty ones", () => {
            const columns = ["<p>A</p>", "<p>B</p>", "<p>C</p>", "", "<p>E</p>", ""];
            editor.setData(
                "<section class=\"trilium-multicolumn-layout\">" +
                    columns.map(column => `<section>${column}</section>`).join("") +
                "</section>"
            );

            expect((layoutAt(0).getChild(3) as ModelElement).childCount).toBe(1);
            expect(editor.getData()).toContain("<section><p>E</p></section></section>");
        });

        it("gives an empty column a paragraph", () => {
            editor.setData(
                "<section class=\"trilium-multicolumn-layout\">" +
                    "<section></section><section><p>B</p></section>" +
                "</section>"
            );

            expect(model()).toBe(
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph>B</paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );
        });

        it("resets weights that are missing, unknown or meant for another column count", () => {
            const layout = (ratios: string) =>
                `<section class="trilium-multicolumn-layout"${ratios}>` +
                    "<section><p>A</p></section>" +
                    "<section><p>B</p></section>" +
                    "<section><p>C</p></section>" +
                "</section>";
            editor.setData(
                layout("") +
                layout(" data-trilium-column-ratios=\"2-5-1\"") +
                layout(" data-trilium-column-ratios=\"1-3\"")
            );

            expect([0, 1, 2].map(index => layoutAt(index).getAttribute("columnRatios")))
                .toEqual(["1-1-1", "1-1-1", "1-1-1"]);

            editor.model.change(writer => writer.setAttribute("columnRatios", "1-1", layoutAt(0)));
            expect(layoutAt(0).getAttribute("columnRatios")).toBe("1-1-1");

            const paragraph = (layoutAt(1).getChild(0) as ModelElement).getChild(0) as ModelElement;
            editor.model.change(writer => writer.setAttribute("alignment", "center", paragraph));
            expect(layoutAt(1).getAttribute("columnRatios")).toBe("1-1-1");
            expect(paragraph.getAttribute("alignment")).toBe("center");
        });

        it("fixes a layout nested in a column", () => {
            editor.setData(
                "<section class=\"trilium-multicolumn-layout\">" +
                    "<section>" +
                        "<section class=\"trilium-multicolumn-layout\">" +
                            "<section><p>Inner</p></section>" +
                        "</section>" +
                    "</section>" +
                    "<section><p>Outer</p></section>" +
                "</section>"
            );

            expect(model()).toBe(
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    "<multicolumnColumn>" +
                        "<multicolumnLayout columnRatios=\"1-1\">" +
                            "<multicolumnColumn><paragraph>Inner</paragraph></multicolumnColumn>" +
                            "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                        "</multicolumnLayout>" +
                    "</multicolumnColumn>" +
                    "<multicolumnColumn><paragraph>Outer</paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );
        });

        it("keeps a layout valid when its column content is removed", () => {
            editor.setData(TWO_COLUMNS);
            const column = layoutAt(0).getChild(1) as ModelElement;

            editor.model.change(writer => writer.remove(writer.createRangeIn(column)));

            expect(column.childCount).toBe(1);
            expect(column.getChild(0)?.is("element", "paragraph")).toBe(true);
        });
    });

    it("falls back to the first weights for an unsupported column count", () => {
        expect([2, 3, 4, 7].map(getDefaultRatios)).toEqual(["1-1", "1-1-1", "1-1-1-1", "1-1"]);
    });
});
