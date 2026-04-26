import {
    ClassicEditor,
    _setModelData as setModelData,
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FormatCodeblockCommand } from "../src/plugins/format_codeblock/format_codeblock_command";
import {
    createEditor,
    setCodeFormatter,
} from "./format_codeblock_helpers";

describe("FormatCodeblockButton", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;

    beforeEach(async () => {
        const result = await createEditor({
            isLanguageSupported: () => true,
            format: async (code) => code,
        });
        editor = result.editor;
        domElement = result.div;
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    describe("plugin registration", () => {
        it("should register the formatCodeblock command", () => {
            const command = editor.commands.get("formatCodeblock");
            expect(command).toBeDefined();
            expect(command).toBeInstanceOf(FormatCodeblockCommand);
        });

        it("should register the formatCodeblock UI component", () => {
            expect(editor.ui.componentFactory.has("formatCodeblock")).toBe(true);
        });
    });

    describe("button UI", () => {
        it("should have the correct tooltip", () => {
            const button = editor.ui.componentFactory.create("formatCodeblock");
            expect((button as any).tooltip).toBe("Format code block");
        });

        it("button isEnabled should follow command isEnabled", () => {
            setModelData(editor.model, '<codeBlock language="javascript">foo[]</codeBlock>');

            const button = editor.ui.componentFactory.create("formatCodeblock");
            const command = editor.commands.get("formatCodeblock")!;

            expect(command.isEnabled).toBe(true);
            expect((button as any).isEnabled).toBe(true);

            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            expect(command.isEnabled).toBe(false);
            expect((button as any).isEnabled).toBe(false);
        });
    });

    describe("without codeFormatter config", () => {
        it("should still register the command and UI component", async () => {
            const { editor: noConfigEditor, div } = await createEditor();

            expect(noConfigEditor.commands.get("formatCodeblock")).toBeDefined();
            expect(noConfigEditor.commands.get("formatCodeblock")).toBeInstanceOf(FormatCodeblockCommand);
            expect(noConfigEditor.ui.componentFactory.has("formatCodeblock")).toBe(true);

            await noConfigEditor.destroy();
            div.remove();
        });

        it("command should always be disabled when no formatter config is provided", async () => {
            const { editor: noConfigEditor, div } = await createEditor();

            setModelData(noConfigEditor.model, '<codeBlock language="javascript">foo[]</codeBlock>');
            expect(noConfigEditor.commands.get("formatCodeblock")!.isEnabled).toBe(false);

            await noConfigEditor.destroy();
            div.remove();
        });
    });
});
