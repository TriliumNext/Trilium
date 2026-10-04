import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    type DowncastAttributeEvent,
    Essentials,
    FontBackgroundColor,
    FontColor,
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
});
