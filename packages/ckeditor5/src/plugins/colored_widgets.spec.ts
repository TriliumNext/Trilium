import {
    _getModelData as getModelData, _setModelData as setModelData, type ClassicEditor, Essentials,
    FontBackgroundColor, FontColor, type ModelElement, Paragraph, Plugin
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { TestBoxPlugin } from "../../test/fixture-plugins.js";
import AdaptiveColors from "./adaptive_colors.js";
import ColoredWidgets, { copyColors } from "./colored_widgets.js";

class ColoredTestBox extends Plugin {
    static get requires() {
        return [ TestBoxPlugin, ColoredWidgets ];
    }

    init() {
        this.editor.plugins.get(ColoredWidgets).register("testBox");
    }
}

const COLORED_BOX = '<testBox fontBackgroundColor="#e5e64d" fontColor="#e64d4d"></testBox>';

describe("ColoredWidgets", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, FontColor, FontBackgroundColor, AdaptiveColors, ColoredTestBox
        ]);
    });

    it("colors a selected widget with the font color commands, on its own element", () => {
        setModelData(editor.model, "<paragraph>a</paragraph>[<testBox></testBox>]");
        editor.execute("fontColor", { value: "#e64d4d" });
        editor.execute("fontBackgroundColor", { value: "#e5e64d" });

        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph>a</paragraph>${COLORED_BOX}`);
        expect(editor.commands.get("fontColor")?.value).toBe("#e64d4d");
        expect(editor.commands.get("fontBackgroundColor")?.value).toBe("#e5e64d");
        expect(editor.getData()).toBe('<p>a</p><div class="test-box" style="--tn-background:#e5e64d;'
            + '--tn-color:#e64d4d;background-color:#e5e64d;color:#e64d4d;">&nbsp;</div>');

        const view = editor.editing.mapper.toViewElement(box(editor));
        expect(view?.getStyle("color")).toBe("#e64d4d");
        expect(view?.getStyle("--tn-background")).toBe("#e5e64d");
    });

    it("takes the colors off with the commands' Remove color", () => {
        setModelData(editor.model, `[${COLORED_BOX}]`);
        editor.execute("fontColor");
        editor.execute("fontBackgroundColor");

        expect(editor.getData()).toBe('<div class="test-box">&nbsp;</div>');
        expect(editor.commands.get("fontColor")?.value).toBeUndefined();
    });

    it("loads the colors of a widget and writes their variables again", () => {
        editor.setData('<div class="test-box" style="color:#e64d4d;--tn-color:#000000;'
            + 'background-color:#e5e64d;"></div><p style="color:#e64d4d;">b</p>');

        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`${COLORED_BOX}<paragraph>b</paragraph>`);
        expect(editor.getData()).toContain("--tn-color:#e64d4d;");
    });

    it("copies the colors that the element or text replacing a widget can take", () => {
        setModelData(editor.model, `${COLORED_BOX}<paragraph>b</paragraph>`);

        editor.model.change((writer) => {
            const text = writer.createText("x");
            const paragraph = writer.createElement("paragraph");
            const uncolored = writer.createText("y");
            copyColors(writer, box(editor), text);
            copyColors(writer, box(editor), paragraph);
            copyColors(writer, writer.createText("z"), uncolored);

            expect(Object.fromEntries(text.getAttributes()))
                .toEqual({ fontColor: "#e64d4d", fontBackgroundColor: "#e5e64d" });
            expect([ ...paragraph.getAttributeKeys(), ...uncolored.getAttributeKeys() ]).toEqual([]);
        });
    });
});

function box(editor: ClassicEditor): ModelElement {
    for (const child of editor.model.document.getRoot()?.getChildren() ?? []) {
        if (child.is("element", "testBox")) {
            return child;
        }
    }
    throw new Error("Expected a box.");
}
