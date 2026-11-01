import { Bold, type ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { COPY_FORMAT_COMMAND, FORMAT_PAINTER_COMPONENT, PASTE_FORMAT_COMMAND } from "./constants.js";
import TriliumFormatPainter from "./format_painter.js";
import FormatPainterEditing from "./format_painter_editing.js";
import FormatPainterUI from "./format_painter_ui.js";

describe("TriliumFormatPainter", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([ Essentials, Paragraph, Bold, TriliumFormatPainter ]);
    });

    it("pulls in the editing and UI halves", () => {
        expect(TriliumFormatPainter.pluginName).toBe("TriliumFormatPainter");
        expect(TriliumFormatPainter.requires).toEqual([ FormatPainterEditing, FormatPainterUI ]);
    });

    it("wires up the commands and the toolbar component", () => {
        expect(editor.commands.get(COPY_FORMAT_COMMAND)).toBeTruthy();
        expect(editor.commands.get(PASTE_FORMAT_COMMAND)).toBeTruthy();
        expect(editor.ui.componentFactory.has(FORMAT_PAINTER_COMPONENT)).toBe(true);
    });
});
