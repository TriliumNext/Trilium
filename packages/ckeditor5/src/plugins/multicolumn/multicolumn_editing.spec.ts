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

const column = (content: string) => `<div class="trilium-multicolumn-column">${content}</div>`;

const TWO_COLUMNS =
    "<div class=\"trilium-multicolumn-layout\" data-trilium-column-ratios=\"1-3\">" +
        column("<p>First column</p>") +
        column("<p>Second column</p>") +
    "</div>";

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
            const columns = widget?.querySelectorAll(":scope > .trilium-multicolumn-column") ?? [];
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

        it("reads a column outside a layout as its content", () => {
            editor.setData(column("<p>Text</p>"));

            expect(model()).toBe("<paragraph>Text</paragraph>");
        });
    });

    describe("placeholder", () => {
        /** The placeholder each column shows in its first block, or `null` for none. */
        function placeholders() {
            const root = editor.editing.view.getDomRoot();
            const columns = root?.querySelectorAll(".trilium-multicolumn-column") ?? [];
            return [...columns].map(column => {
                const block = column.firstElementChild;
                return block?.classList.contains("ck-placeholder")
                    ? block.getAttribute("data-placeholder")
                    : null;
            });
        }

        it("shows in each column holding only an empty block, until text is typed there", () => {
            editor.editing.view.document.isFocused = true;
            setModelData(editor.model,
                "<multicolumnLayout columnRatios=\"1-1-1-1\">" +
                    "<multicolumnColumn><paragraph>Text</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph>[]</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn>" +
                        "<paragraph></paragraph><paragraph>Text</paragraph>" +
                    "</multicolumnColumn>" +
                    "<multicolumnColumn></multicolumnColumn>" +
                "</multicolumnLayout>"
            );

            expect(placeholders()).toEqual([
                null,
                "Type the content of the second column",
                null,
                "Type the content of the fourth column"
            ]);

            editor.model.change(writer => {
                editor.model.insertContent(writer.createText("Typed"));
            });

            expect(placeholders()).toEqual([
                null, null, null, "Type the content of the fourth column"
            ]);
        });

        it("names the position of each column, including one added to the layout", () => {
            setModelData(editor.model,
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    "<multicolumnColumn><paragraph>[]</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );

            editor.execute("columnLayout", { value: "1-1-1" });

            expect(placeholders()).toEqual([
                "Type the content of the first column",
                "Type the content of the second column",
                "Type the content of the third column"
            ]);
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
            editor.setData("<p>Before</p><div class=\"trilium-multicolumn-layout\"></div>");

            expect(model()).toBe("<paragraph>Before</paragraph>");
        });

        it("adds an empty column to a layout with one column", () => {
            editor.setData(
                "<div class=\"trilium-multicolumn-layout\">" +
                    "<div class=\"trilium-multicolumn-column\"><p>Only</p></div>" +
                "</div>"
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
                .map(text => column(`<p>${text}</p>`))
                .join("");
            editor.setData(`<div class="trilium-multicolumn-layout">${columns}</div>`);

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
                "<div class=\"trilium-multicolumn-layout\">" +
                    columns.map(column).join("") +
                "</div>"
            );

            expect((layoutAt(0).getChild(3) as ModelElement).childCount).toBe(1);
            expect(editor.getData()).toContain(`${column("<p>E</p>")}</div>`);
        });

        it("gives an empty column a paragraph", () => {
            editor.setData(
                "<div class=\"trilium-multicolumn-layout\">" +
                    column("") + column("<p>B</p>") +
                "</div>"
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
                `<div class="trilium-multicolumn-layout"${ratios}>` +
                    "<div class=\"trilium-multicolumn-column\"><p>A</p></div>" +
                    "<div class=\"trilium-multicolumn-column\"><p>B</p></div>" +
                    "<div class=\"trilium-multicolumn-column\"><p>C</p></div>" +
                "</div>";
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
                "<div class=\"trilium-multicolumn-layout\">" +
                    "<div class=\"trilium-multicolumn-column\">" +
                        "<div class=\"trilium-multicolumn-layout\">" +
                            "<div class=\"trilium-multicolumn-column\"><p>Inner</p></div>" +
                        "</div>" +
                    "</div>" +
                    "<div class=\"trilium-multicolumn-column\"><p>Outer</p></div>" +
                "</div>"
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
