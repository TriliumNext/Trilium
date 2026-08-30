import { Bold, ButtonView, ClassicEditor, Essentials, Paragraph, type ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ClozePlugin, { COMMAND_NAME } from "./cloze.js";

describe("ClozePlugin", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([ Essentials, Paragraph, Bold, ClozePlugin ]);
    });

    it("registers a translated toolbar button wired to the command", () => {
        const command = editor.commands.get(COMMAND_NAME);
        const view = editor.ui.componentFactory.create("clozeDeletion");
        if (!(view instanceof ButtonView)) {
            throw new Error("expected the cloze component to be a button");
        }

        expect(command).toBeDefined();
        expect(view.label).toBe("Make cloze deletion");
        expect(view.isEnabled).toBe(command?.isEnabled);

        const execute = vi.spyOn(editor, "execute");
        const focus = vi.spyOn(editor.editing.view, "focus");
        view.fire("execute");

        expect(execute).toHaveBeenCalledWith(COMMAND_NAME);
        expect(focus).toHaveBeenCalled();
    });

    it("wraps selected rich text and increments the highest canonical cloze index", () => {
        editor.setData("<p>{{c1::Paris}} and <strong>Berlin</strong></p>");
        const paragraph = getParagraph(editor);
        selectOffsets(editor, paragraph.maxOffset - 6, paragraph.maxOffset);

        editor.execute(COMMAND_NAME);

        expect(editor.getData()).toBe("<p>{{c1::Paris}} and {{c2::<strong>Berlin</strong>}}</p>");
    });

    it("inserts and selects a placeholder when the selection is collapsed", () => {
        editor.setData("<p>Question:</p>");
        const paragraph = getParagraph(editor);
        const insertionOffset = paragraph.maxOffset;
        selectOffsets(editor, insertionOffset, insertionOffset);

        editor.execute(COMMAND_NAME);

        expect(editor.getData()).toBe("<p>Question:{{c1::text}}</p>");
        const selection = editor.model.document.selection;
        expect(selection.isCollapsed).toBe(false);
        expect(selection.getFirstPosition()?.offset).toBe(insertionOffset + "{{c1::".length);
        expect(selection.getLastPosition()?.offset).toBe(insertionOffset + "{{c1::text".length);
    });

    it("ignores non-canonical leading-zero cloze indices", () => {
        editor.setData("<p>{{c01::invalid}} answer</p>");
        const paragraph = getParagraph(editor);
        selectOffsets(editor, paragraph.maxOffset - 6, paragraph.maxOffset);

        editor.execute(COMMAND_NAME);

        expect(editor.getData()).toBe("<p>{{c01::invalid}} {{c1::answer}}</p>");
    });

    it("is disabled while the editor is read-only", () => {
        editor.enableReadOnlyMode("test");
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(false);

        editor.disableReadOnlyMode("test");
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(true);
    });
});

function getParagraph(editor: ClassicEditor): ModelElement {
    const paragraph = editor.model.document.getRoot()?.getChild(0);
    if (!paragraph?.is("element")) {
        throw new Error("expected a paragraph");
    }

    return paragraph;
}

function selectOffsets(editor: ClassicEditor, start: number, end: number) {
    const paragraph = getParagraph(editor);
    editor.model.change((writer) => {
        writer.setSelection(writer.createRange(
            writer.createPositionAt(paragraph, start),
            writer.createPositionAt(paragraph, end)
        ));
    });
}
