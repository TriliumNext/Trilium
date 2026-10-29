import {
    _setModelData as setModelData, ButtonView, ClassicEditor, CodeBlock, Essentials, LinkEditing,
    Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ChildNotePlugin, { COMMAND_NAME } from "./child_note.js";

describe("ChildNotePlugin", () => {
    let editor: ClassicEditor;
    let create: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        create = vi.fn();
        editor = await createTestEditor(
            [ Essentials, Paragraph, CodeBlock, LinkEditing, ChildNotePlugin ],
            { childNote: { create } }
        );
    });

    it("has the host create the note from a button bound to the command", () => {
        const button = editor.ui.componentFactory.create(COMMAND_NAME);
        if (!(button instanceof ButtonView)) {
            throw new Error("The child note component is not a button.");
        }
        const command = editor.commands.get(COMMAND_NAME);

        // No dictionary is configured here, so `t()` renders the message id, the English label.
        expect(button.label).toBe("New child note");
        expect(button.icon).toContain("<svg");
        expect(button.isEnabled).toBe(true);

        button.fire("execute");
        expect(create).toHaveBeenCalledOnce();

        editor.enableReadOnlyMode("test");
        expect(command?.isEnabled).toBe(false);
        expect(button.isEnabled).toBe(false);
    });

    it("is enabled only where the link to the new note can go", () => {
        const command = editor.commands.get(COMMAND_NAME);

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        expect(command?.isEnabled).toBe(true);

        setModelData(editor.model, "<codeBlock language=\"plaintext\">foo[]bar</codeBlock>");
        expect(command?.isEnabled).toBe(false);
    });

    it("is disabled without a host to create the note", async () => {
        const hostless =
            await createTestEditor([ Essentials, Paragraph, LinkEditing, ChildNotePlugin ]);
        setModelData(hostless.model, "<paragraph>foo[]</paragraph>");

        expect(hostless.commands.get(COMMAND_NAME)?.isEnabled).toBe(false);
    });
});
