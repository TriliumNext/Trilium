import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    ButtonView,
    type ClassicEditor,
    type ColorGridView,
    type DowncastAttributeEvent,
    Essentials,
    FontBackgroundColor,
    FontColor,
    type FontColorSelectorDropdownView,
    GeneralHtmlSupport,
    type ModelElement,
    Paragraph,
    Table,
    TableCellProperties,
    TableProperties
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import AdaptiveColors from "./adaptive_colors.js";
import Aside from "./aside/aside.js";

describe("AdaptiveColors", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, FontColor, FontBackgroundColor, Table, TableProperties,
            TableCellProperties, AdaptiveColors
        ]);
        setModelData(editor.model, "<paragraph>[text]</paragraph>");
    });

    it("stores the color as picked, and saves it again as a CSS variable", () => {
        editor.execute("fontColor", { value: "#e64d4d" });
        editor.execute("fontBackgroundColor", { value: "hsl(60, 75%, 60%)" });

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<paragraph><$text fontBackgroundColor=\"hsl(60, 75%, 60%)\" fontColor=\"#e64d4d\">"
            + "text</$text></paragraph>"
        );
        const saved = editor.getData();
        expect(saved).toContain("color:#e64d4d;");
        expect(saved).toContain("--tn-color:#e64d4d;");
        expect(saved).toContain("background-color:hsl(60, 75%, 60%);");
        expect(saved).toContain("--tn-background:hsl(60, 75%, 60%);");
    });

    it("loads the color without its variable, and writes the variable again when saving", () => {
        const saved = "<p><span style=\"--tn-color:#e64d4d;color:#e64d4d;\">a</span></p>";
        editor.setData(saved);
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<paragraph><$text fontColor=\"#e64d4d\">a</$text></paragraph>");
        expect(editor.getData()).toBe(saved);

        // A color saved before the variables existed gets one too.
        editor.setData("<p><span style=\"color:#ff0000;\">b</span></p>");
        expect(editor.getData())
            .toBe("<p><span style=\"--tn-color:#ff0000;color:#ff0000;\">b</span></p>");
    });

    it("removes the variable with the color", () => {
        editor.execute("fontColor", { value: "#e64d4d" });
        editor.execute("fontColor");
        editor.execute("fontBackgroundColor", { value: "#e64d4d" });
        editor.execute("fontBackgroundColor", { value: "" });
        expect(editor.getData()).toBe("<p>text</p>");
    });

    it("writes the variables of table and cell backgrounds and borders", () => {
        setModelData(editor.model, "<table><tableRow><tableCell><paragraph>[]a</paragraph>"
            + "</tableCell></tableRow></table>");
        editor.execute("tableBorderStyle", { value: "solid" });
        editor.execute("tableBorderWidth", { value: "2px" });
        editor.execute("tableBorderColor", { value: "#4d99e6" });
        editor.execute("tableBackgroundColor", { value: "#e5e64d" });
        editor.execute("tableCellBorderStyle", { value: "dashed" });
        editor.execute("tableCellBorderColor", { value: "#000000" });
        editor.execute("tableCellBackgroundColor", { value: "#e64d4d" });

        const saved = editor.getData();
        expect(saved).toContain("border:2px solid #4d99e6;");
        expect(saved).toContain("--tn-border-color:#4d99e6;");
        expect(saved).toContain("--tn-background:#e5e64d;");
        expect(saved).toContain("border-color:#000000;");
        expect(saved).toContain("--tn-border-color:#000000;");
        expect(saved).toContain("--tn-background:#e64d4d;");

        editor.setData(saved);
        expect(editor.getData()).toBe(saved);

        // Loading selects the whole table; removing a cell color needs the caret in the cell.
        const cellParagraph = editor.model.document.getRoot()?.getNodeByPath([ 0, 0, 0, 0 ]);
        if (!cellParagraph) {
            throw new Error("The loaded table has no cell paragraph.");
        }
        editor.model.change((writer) => writer.setSelection(cellParagraph, 0));
        editor.execute("tableCellBackgroundColor", { value: "" });
        editor.execute("tableCellBorderColor", { value: "" });
        const cleared = editor.getData();
        expect(cleared).not.toContain("--tn-background:#e64d4d");
        expect(cleared).not.toContain("--tn-border-color:#000000");
    });

    it("adds no variable for a table color another converter has already handled", () => {
        editor.conversion.for("downcast").add((dispatcher) => {
            dispatcher.on<DowncastAttributeEvent<ModelElement>>(
                "attribute:tableBorderColor:table",
                (eventInfo, data, { consumable }) => {
                    consumable.consume(data.item, eventInfo.name);
                },
                { priority: "highest" }
            );
        });
        setModelData(editor.model, "<table><tableRow><tableCell><paragraph>[]a</paragraph>"
            + "</tableCell></tableRow></table>");
        editor.execute("tableBorderStyle", { value: "solid" });
        editor.execute("tableBorderColor", { value: "#4d99e6" });

        const saved = editor.getData();
        expect(saved).toContain("border-style:solid;");
        expect(saved).not.toContain("--tn-border-color");
    });

    it("writes the variable of the background color of an aside, and of its swatches",
        async () => {
            const withAside = await createTestEditor([
                Essentials, Paragraph, Aside, AdaptiveColors
            ]);
            const saved = "<aside style=\"--tn-background:#e64d4d;background-color:#e64d4d;\">" +
                "<p>A</p></aside>";
            withAside.setData(saved);
            expect(getModelData(withAside.model, { withoutSelection: true })).toBe(
                "<asideBlock backgroundColor=\"#e64d4d\"><asideContent><paragraph>A</paragraph>" +
                "</asideContent></asideBlock>");
            expect(withAside.getData()).toBe(saved);
            const widget = withAside.editing.view.getDomRoot()?.querySelector("aside");
            expect(widget?.style.getPropertyValue("--tn-background")).toBe("#e64d4d");

            const aside = withAside.model.document.getRoot()?.getChild(0) as ModelElement;
            withAside.model.change((writer) => writer.setSelection(aside, "on"));
            withAside.execute("asideColor", { value: null });
            expect(withAside.getData()).toBe("<aside><p>A</p></aside>");
            expect(widget?.style.getPropertyValue("--tn-background")).toBe("");

            const { staticColorsGrid } = openColorDropdown(withAside, "asideColor");
            expect(tileStyles(staticColorsGrid, "--tn-background"))
                .toEqual([ [ "#555555", "rgb(85, 85, 85)" ] ]);
        });

    it("keeps a variable out of the model, also with General HTML Support", async () => {
        const withGhs = await createTestEditor(
            [ Essentials, Paragraph, FontColor, GeneralHtmlSupport, AdaptiveColors ],
            { htmlSupport: { allow: [ { name: "span", styles: true } ] } }
        );
        withGhs.setData("<p><span style=\"--tn-color:#000000;color:#e64d4d;\">a</span></p>");

        // A stale variable would otherwise outlive its color and adapt the wrong one.
        expect(getModelData(withGhs.model, { withoutSelection: true }))
            .toBe("<paragraph><$text fontColor=\"#e64d4d\">a</$text></paragraph>");
        expect(withGhs.getData())
            .toBe("<p><span style=\"--tn-color:#e64d4d;color:#e64d4d;\">a</span></p>");
    });

    it("gives the tiles of the font color dropdowns the variable of their color", async () => {
        const withPalette = await createTestEditor(
            [ Essentials, Paragraph, FontColor, FontBackgroundColor, AdaptiveColors ],
            {
                fontColor: { colors: [ "#e64d4d", "#4d99e6" ] },
                fontBackgroundColor: { colors: [ "#e5e64d" ], documentColors: 0 }
            }
        );
        withPalette.setData("<p><span style=\"color:#4de64d;\">a</span></p>");

        const fontColor = openColorDropdown(withPalette, "fontColor");
        expect(tileStyles(fontColor.staticColorsGrid, "--tn-color")).toEqual([
            [ "#e64d4d", "rgb(230, 77, 77)" ],
            [ "#4d99e6", "rgb(77, 153, 230)" ]
        ]);
        expect(tileStyles(fontColor.documentColorsGrid, "--tn-color"))
            .toEqual([ [ "#4de64d", "rgb(77, 230, 77)" ] ]);

        // Each opening rebuilds the document colors.
        fontColor.dropdown.isOpen = false;
        withPalette.setData("<p><span style=\"color:#994de6;\">b</span></p>");
        fontColor.dropdown.isOpen = true;
        expect(tileStyles(fontColor.documentColorsGrid, "--tn-color"))
            .toEqual([ [ "#994de6", "rgb(153, 77, 230)" ] ]);

        const background = openColorDropdown(withPalette, "fontBackgroundColor");
        expect(tileStyles(background.staticColorsGrid, "--tn-background"))
            .toEqual([ [ "#e5e64d", "rgb(229, 230, 77)" ] ]);
        expect(background.documentColorsGrid).toBeUndefined();

        // Tiles of an unrendered dropdown have no element yet; other components are unchanged.
        const unrendered = withPalette.ui.componentFactory.create("fontColor");
        expect(() => { (unrendered as FontColorSelectorDropdownView).isOpen = true; })
            .not.toThrow();
        expect(withPalette.ui.componentFactory.create("undo")).toBeInstanceOf(ButtonView);
    });
});

/** Renders and opens a font color dropdown, which builds its color grids. */
function openColorDropdown(editor: ClassicEditor, name: string) {
    const dropdown = editor.ui.componentFactory.create(name) as FontColorSelectorDropdownView;
    dropdown.render();
    dropdown.isOpen = true;
    if (!dropdown.colorSelectorView) {
        throw new Error(`The ${name} dropdown has no color selector.`);
    }
    const { staticColorsGrid, documentColorsGrid } =
        dropdown.colorSelectorView.colorGridsFragmentView;
    return { dropdown, staticColorsGrid, documentColorsGrid };
}

/** The variable and the inline background of each tile. */
function tileStyles(grid: ColorGridView | undefined, variable: string) {
    return [ ...grid?.items ?? [] ].map(({ element }) => [
        element?.style.getPropertyValue(variable), element?.style.backgroundColor
    ]);
}
