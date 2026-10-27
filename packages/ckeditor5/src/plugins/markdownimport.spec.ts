import { ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import MarkdownImportPlugin, { COMMAND_NAME } from "./markdownimport.js";

describe("MarkdownImportPlugin", () => {
    let editor: ClassicEditor;
    let open: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        open = vi.fn();
        editor = await createTestEditor([Essentials, Paragraph, MarkdownImportPlugin], {
            markdownImport: { open }
        });
    });

    it("loads the plugin and registers the command and toolbar button", () => {
        expect(editor.plugins.get(MarkdownImportPlugin)).toBeInstanceOf(MarkdownImportPlugin);
        expect(editor.commands.get(COMMAND_NAME)).toBeDefined();
        expect(editor.ui.componentFactory.has("markdownImport")).toBe(true);

        // No dictionary is configured here, so `t()` renders the message id, which is the English
        // label.
        const view = editor.ui.componentFactory.create("markdownImport") as { label?: string };
        expect(view.label).toBe("Markdown import from clipboard");
    });

    it("has the host open the Markdown import when executed", () => {
        editor.execute(COMMAND_NAME);
        expect(open).toHaveBeenCalledOnce();
    });

    it("wires the button to the command (enablement and execution)", () => {
        const view = editor.ui.componentFactory.create("markdownImport") as { isEnabled: boolean; fire(name: string): void };
        const command = editor.commands.get(COMMAND_NAME);

        expect(view.isEnabled).toBe(command?.isEnabled);

        const spy = vi.spyOn(editor, "execute");
        view.fire("execute");
        expect(spy).toHaveBeenCalledWith(COMMAND_NAME);
    });

    it("is enabled in a regular paragraph", () => {
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(true);
    });

    it("is disabled when the editor is read-only", () => {
        editor.enableReadOnlyMode("test");
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(false);
        editor.disableReadOnlyMode("test");
    });
});
